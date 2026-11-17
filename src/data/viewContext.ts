/** Port of android/.../ui/SheetViewContext.kt: alias vs true name, player-safe mode. */
import type { CharacterIdentity, CharacterSheet, CombatActionEntry, SoundBite } from './model';
import { displayName, isSecretBite } from './model';

export type DisplayNameChoice = 'primary' | 'alias';
export type SheetViewMode = 'combat' | 'noncombat' | 'full';

export interface SheetViewContext {
  displayNameChoice: DisplayNameChoice;
  playerSafeMode: boolean;
}

export const defaultViewContext: SheetViewContext = { displayNameChoice: 'alias', playerSafeMode: false };

export interface DisplayNameOption { choice: DisplayNameChoice; label: string; isSecret: boolean }

export function availableNames(identity: CharacterIdentity | null | undefined): DisplayNameOption[] {
  if (!identity) return [];
  const out: DisplayNameOption[] = [];
  const alias = identity.cultAlias?.trim();
  if (alias) out.push({ choice: 'alias', label: alias, isSecret: false });
  const name = identity.name?.trim();
  if (name) out.push({ choice: 'primary', label: name, isSecret: true });
  return out.filter((o, i) => out.findIndex((x) => x.label === o.label) === i);
}

export const visibleNameOptions = (ctx: SheetViewContext, identity: CharacterIdentity | null | undefined) =>
  availableNames(identity).filter((o) => !ctx.playerSafeMode || !o.isSecret);

export function effectiveDisplayChoice(ctx: SheetViewContext, identity: CharacterIdentity | null | undefined): DisplayNameChoice {
  const visible = visibleNameOptions(ctx, identity);
  if (visible.length === 0) return 'primary';
  if (visible.some((o) => o.choice === ctx.displayNameChoice)) return ctx.displayNameChoice;
  return visible[0].choice;
}

/** True when showing the public persona or in player-safe mode: hides true identity and secrets. */
export function shouldHideSecretIdentity(ctx: SheetViewContext, identity: CharacterIdentity | null | undefined): boolean {
  if (ctx.playerSafeMode) return true;
  if (!identity) return false;
  if (!identity.cultAlias?.trim() || !identity.name?.trim()) return false;
  return effectiveDisplayChoice(ctx, identity) === 'alias';
}

export function sheetTitle(sheet: CharacterSheet, ctx: SheetViewContext): string {
  const id = sheet.identity;
  if (!id) return displayName(sheet);
  const alias = id.cultAlias?.trim();
  if (ctx.playerSafeMode && alias) return alias;
  if (ctx.displayNameChoice === 'alias') return alias || displayName(sheet);
  return id.name?.trim() || displayName(sheet);
}

/** Public bites with alias; all with true name; none in player view. */
export function visibleSoundBites(ctx: SheetViewContext, bites: SoundBite[], identity: CharacterIdentity | null | undefined): SoundBite[] {
  if (ctx.playerSafeMode || bites.length === 0) return [];
  return effectiveDisplayChoice(ctx, identity) === 'alias' ? bites.filter((b) => !isSecretBite(b)) : bites;
}

export const canShowSecretBackstory = (ctx: SheetViewContext, identity: CharacterIdentity | null | undefined): boolean =>
  !ctx.playerSafeMode && effectiveDisplayChoice(ctx, identity) === 'primary';

export const visibleCombatAction = (ctx: SheetViewContext, entry: CombatActionEntry, identity: CharacterIdentity | null | undefined): boolean =>
  !entry.secret || !shouldHideSecretIdentity(ctx, identity);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fields the views read as required text: a list item that would lose one is dropped whole. */
const REQUIRED = ['name', 'rulesText', 'summary', 'prompt', 'answer', 'location'];

/**
 * Display-only copy of the sheet for alias / player-safe views: any string that mentions the
 * concealed true name is removed (same safety net as the player-safe DM handoff). Never saved.
 */
export function redactForView(sheet: CharacterSheet, ctx: SheetViewContext): CharacterSheet {
  const name = sheet.identity?.name?.trim();
  if (!name || !sheet.identity?.cultAlias?.trim() || !shouldHideSecretIdentity(ctx, sheet.identity)) return sheet;
  const named = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
  const lost = (before: unknown, after: unknown) =>
    typeof before === 'object' && before !== null && !Array.isArray(before) &&
    REQUIRED.some((k) => typeof (before as Record<string, unknown>)[k] === 'string' && (after as Record<string, unknown>)[k] === null);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return named.test(v) ? null : v;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const x of v) {
        const y = walk(x);
        if (y !== null && !lost(x, y)) out.push(y);
      }
      return out;
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  const { identity, ...rest } = sheet;
  return { ...(walk(rest) as CharacterSheet), identity };
}
