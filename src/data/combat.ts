/** Port of archive/android/.../data/CombatSession.kt and combat/CombatKitCatalog.kt. */
import type { CharacterSheet } from './model';
import conditionsJson from '../assets/conditions.json';
import kitTimersJson from '../assets/kit_timers.json';

export const EndsOn = {
  END_OF_YOUR_TURN: 'end_of_your_turn',
  START_OF_YOUR_TURN: 'start_of_your_turn',
  SAVE_ENDS: 'save_ends',
  PERMANENT: 'permanent',
} as const;

export const EffectKind = { BUFF: 'buff', DEBUFF: 'debuff', CONDITION: 'condition' } as const;

export interface ActiveEffect {
  id: string;
  name: string;
  kind: string;
  source?: string | null;
  roundsRemaining?: number | null;
  endsOn: string;
  notes?: string | null;
}

export interface CombatSession {
  slug: string;
  active: boolean;
  round: number;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  movementUsed: boolean;
  freeInteractionUsed: boolean;
  effects: ActiveEffect[];
}

export type EconomySlot = 'action' | 'bonus' | 'reaction' | 'move' | 'free';

const FIELD: Record<EconomySlot, keyof CombatSession> = {
  action: 'actionUsed',
  bonus: 'bonusUsed',
  reaction: 'reactionUsed',
  move: 'movementUsed',
  free: 'freeInteractionUsed',
};

const fresh = {
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  movementUsed: false,
  freeInteractionUsed: false,
};

export const inactiveSession = (slug: string): CombatSession => ({ slug, active: false, round: 1, ...fresh, effects: [] });

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'e' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createEffect(e: Omit<ActiveEffect, 'id' | 'endsOn'> & { endsOn?: string }): ActiveEffect {
  return { endsOn: EndsOn.END_OF_YOUR_TURN, ...e, id: uuid() };
}

export function tickEffects(effects: ActiveEffect[], phase: string): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const e of effects) {
    if (e.endsOn !== phase || e.endsOn === EndsOn.PERMANENT || e.endsOn === EndsOn.SAVE_ENDS) {
      out.push(e);
      continue;
    }
    if (e.roundsRemaining === null || e.roundsRemaining === undefined) {
      out.push(e);
      continue;
    }
    const next = e.roundsRemaining - 1;
    if (next > 0) out.push({ ...e, roundsRemaining: next });
  }
  return out;
}

/** One player turn: tick start-of-turn, then end-of-turn effects; reset economy; next round. */
export function advanceTurn(s: CombatSession): CombatSession {
  if (!s.active) return s;
  let effects = tickEffects(s.effects, EndsOn.START_OF_YOUR_TURN);
  effects = tickEffects(effects, EndsOn.END_OF_YOUR_TURN);
  return { ...s, round: s.round + 1, ...fresh, effects };
}

export function enterCombat(slug: string, existing: CombatSession | null, kitEffects: ActiveEffect[] = []): CombatSession {
  const base = existing && existing.slug === slug ? existing : inactiveSession(slug);
  const kept = base.active ? base.effects : [];
  const seen = new Set<string>();
  const merged = [...kept, ...kitEffects].filter((e) => {
    const key = e.name.toLowerCase() + '\u0000' + (e.source ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { slug, active: true, round: 1, ...fresh, effects: merged };
}

export function exitCombat(s: CombatSession, clearTimedEffects: boolean): CombatSession {
  const effects = clearTimedEffects
    ? s.effects.filter(
        (e) => e.endsOn === EndsOn.PERMANENT || ((e.roundsRemaining === null || e.roundsRemaining === undefined) && e.endsOn === EndsOn.SAVE_ENDS),
      )
    : s.effects;
  return { ...s, active: false, ...fresh, effects };
}

export const toggleEconomy = (s: CombatSession, slot: EconomySlot): CombatSession => ({ ...s, [FIELD[slot]]: !s[FIELD[slot]] });
export const spendEconomy = (s: CombatSession, slot: EconomySlot): CombatSession => ({ ...s, [FIELD[slot]]: true });
export const isUsed = (s: CombatSession, slot: EconomySlot): boolean => s[FIELD[slot]] as boolean;

// ---------------------------------------------------------------- kit catalog

export interface ConditionTemplate {
  id: string;
  name: string;
  kind?: string;
  roundsRemaining?: number | null;
  endsOn?: string;
  notes?: string | null;
}

export interface KitTimerTemplate {
  featureIdPatterns: string[];
  name: string;
  kind?: string;
  roundsRemaining?: number | null;
  endsOn?: string;
  autoOnEnter?: boolean;
  notes?: string | null;
}

export const CONDITIONS = conditionsJson as ConditionTemplate[];
export const KIT_TIMERS = kitTimersJson as KitTimerTemplate[];

export const conditionToEffect = (t: ConditionTemplate): ActiveEffect =>
  createEffect({
    name: t.name,
    kind: t.kind ?? EffectKind.CONDITION,
    source: 'manual',
    roundsRemaining: t.roundsRemaining ?? null,
    endsOn: t.endsOn ?? EndsOn.SAVE_ENDS,
    notes: t.notes ?? null,
  });

const kitToEffect = (k: KitTimerTemplate, source: string): ActiveEffect =>
  createEffect({
    name: k.name,
    kind: k.kind ?? EffectKind.BUFF,
    source,
    roundsRemaining: k.roundsRemaining === undefined ? 10 : k.roundsRemaining,
    endsOn: k.endsOn ?? EndsOn.END_OF_YOUR_TURN,
    notes: k.notes ?? null,
  });

/** Kit timers marked autoOnEnter that match the character's features (e.g. Giant's Might). */
export function autoEnterEffects(sheet: CharacterSheet, kits: KitTimerTemplate[] = KIT_TIMERS): ActiveEffect[] {
  const ids = sheet.features.map((f) => f.id.toLowerCase());
  const names = sheet.features.map((f) => f.name.toLowerCase());
  const out: ActiveEffect[] = [];
  for (const kit of kits.filter((k) => k.autoOnEnter)) {
    const pats = kit.featureIdPatterns.map((p) => p.toLowerCase());
    const matchId = ids.find((id) => pats.some((p) => id.includes(p)));
    if (matchId) {
      out.push(kitToEffect(kit, matchId));
      continue;
    }
    const matchName = names.find((n) => pats.some((p) => n.includes(p.replace(/-/g, ' '))) || n.includes(kit.name.toLowerCase()));
    if (matchName) out.push(kitToEffect(kit, matchName));
  }
  return out;
}
