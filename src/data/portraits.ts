/**
 * Character portraits: each one is a single static picture with its background painted in (a
 * head-and-shoulders painting, the way Mild Gilding shows its portraits). A character can have
 * several. A character with an alias has two faces: the one shown under the alias (and in
 * player-safe view) and the one shown under the true name. There is no separate background layer,
 * no cutout positioning, and no expressions or facings.
 *
 * Pure logic: it works on file names (what was imported) plus the sheet; the screens turn names
 * into blob URLs. Choices live in sheet.appearance.portrait, so they travel in backups even though
 * the images do not.
 */
import type { CharacterSheet } from './model';
import { type SheetViewContext, shouldHideSecretIdentity } from './viewContext';

export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
export const MANIFEST_FILE = 'manifest.json';

export const stem = (file: string) => file.replace(/\.[^.]+$/, '');
const lower = (s: string) => s.toLowerCase();

export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, ''));
}

/** Saved in sheet.appearance.portrait. File names are matched case-insensitively. */
export interface PortraitPrefs {
  /** The chosen faces: `alias` for alias and player-safe views, `primary` for the true name. */
  faces?: { alias?: string | null; primary?: string | null };
  /** The single face saved before there were two (read as the true-name face). */
  face?: string | null;
  /** Pictures that show the hidden identity: true-name view only. */
  secret?: string[];
  /** Pictures whose name looks secret (see secretHints) but that the player marked as fine to show. */
  public?: string[];
}

export interface Portrait { file: string; label: string; secret: boolean }

const has = (list: string[] | undefined, file: string) => !!list?.some((f) => lower(f) === lower(file));
const without = (list: string[] | undefined, file: string) => (list ?? []).filter((f) => lower(f) !== lower(file));

export function storedPrefs(sheet: CharacterSheet): PortraitPrefs | null {
  const p = (sheet.appearance as Record<string, unknown> | null | undefined)?.portrait;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as PortraitPrefs) : null;
}

/** Replace the prefs, keeping the other appearance fields; drops the old layered-portrait prefs. */
export function withPrefs(sheet: CharacterSheet, prefs: PortraitPrefs): CharacterSheet {
  const { portraitPrefs: _old, ...appearance } = (sheet.appearance as Record<string, unknown> | null | undefined) ?? {};
  return { ...sheet, appearance: { ...appearance, portrait: prefs } };
}

// ---------------------------------------------------------------- secrets

const SECRET_HINTS = ['helm off', 'helm-off', 'helm_off', 'unarmored', 'no helm'];

/** Name hints that mark a picture as showing the hidden identity (generic words plus the true name). */
export function secretHints(sheet: CharacterSheet): string[] {
  const hints = [...SECRET_HINTS];
  const name = sheet.identity?.name?.trim().toLowerCase();
  const alias = sheet.identity?.cultAlias?.trim().toLowerCase();
  if (name) {
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3 && !(alias && alias.includes(part))) hints.push(part);
    }
  }
  return hints;
}

const looksSecret = (label: string, hints: string[]) => {
  const l = label.toLowerCase().replace(/_/g, ' ');
  return hints.some((h) => l.includes(h.replace(/_/g, ' ')));
};

/** Every imported picture, oldest first, with whether it is secret. */
export function allPortraits(sheet: CharacterSheet, prefs: PortraitPrefs, files: string[]): Portrait[] {
  const hints = secretHints(sheet);
  return files
    .filter((f) => IMAGE_EXT.test(f))
    .map((file) => ({
      file,
      label: stem(file).replace(/_/g, ' '),
      secret: has(prefs.secret, file) || (looksSecret(stem(file), hints) && !has(prefs.public, file)),
    }));
}

/**
 * What may be shown. In alias or player-safe view secret pictures are dropped, and there is no
 * "show everything if nothing is left" fallback: an empty list shows the empty state instead.
 */
export function visiblePortraits(sheet: CharacterSheet, prefs: PortraitPrefs, files: string[], ctx: SheetViewContext): Portrait[] {
  const all = allPortraits(sheet, prefs, files);
  return shouldHideSecretIdentity(ctx, sheet.identity) ? all.filter((p) => !p.secret) : all;
}

export type FaceSlot = 'alias' | 'primary';

/** Which face a view shows: the alias one whenever the true identity is hidden. */
export const slotFor = (sheet: CharacterSheet, ctx: SheetViewContext): FaceSlot =>
  shouldHideSecretIdentity(ctx, sheet.identity) ? 'alias' : 'primary';

/** The picture chosen for a slot, whether or not it may be shown. */
export function chosenFace(prefs: PortraitPrefs, slot: FaceSlot): string | null {
  return (slot === 'primary' ? prefs.faces?.primary ?? prefs.face : prefs.faces?.alias) ?? null;
}

/**
 * The face to show: the one chosen for the slot if it is visible, else the first visible picture,
 * else none. `visible` is already filtered for the view, so a secret picture never comes back here.
 */
export function resolveFace(visible: Portrait[], prefs: PortraitPrefs, slot: FaceSlot = 'primary'): Portrait | null {
  const chosen = chosenFace(prefs, slot);
  return (chosen ? visible.find((p) => lower(p.file) === lower(chosen)) : undefined) ?? visible[0] ?? null;
}

/** The face this view shows. */
export function faceFor(sheet: CharacterSheet, prefs: PortraitPrefs, files: string[], ctx: SheetViewContext): Portrait | null {
  return resolveFace(visiblePortraits(sheet, prefs, files, ctx), prefs, slotFor(sheet, ctx));
}

/** Choose a slot's face. A picture chosen for the alias is shown under the alias from then on. */
export function setFace(prefs: PortraitPrefs, slot: FaceSlot, file: string): PortraitPrefs {
  const { face: _old, ...rest } = prefs;
  const faces = { alias: prefs.faces?.alias ?? null, primary: chosenFace(prefs, 'primary'), [slot]: file };
  const next = { ...rest, faces };
  return slot === 'alias' ? setSecret(next, file, false) : next;
}

/** Mark a picture true-name only (or not). Hiding the alias face from the alias also clears that face. */
export function setSecret(prefs: PortraitPrefs, file: string, secret: boolean): PortraitPrefs {
  if (!secret) return { ...prefs, secret: without(prefs.secret, file), public: [...without(prefs.public, file), file] };
  const next = { ...prefs, secret: [...without(prefs.secret, file), file], public: without(prefs.public, file) };
  const alias = prefs.faces?.alias;
  return alias && lower(alias) === lower(file) ? { ...next, faces: { ...prefs.faces, alias: null } } : next;
}

/** After a picture is deleted: no face uses it. Its secret / public mark stays, so adding the same file again keeps it hidden. */
export function forgetFile(prefs: PortraitPrefs, file: string): PortraitPrefs {
  const keep = (f: string | null | undefined) => (f && lower(f) === lower(file) ? null : f ?? null);
  const { face: _old, ...rest } = prefs;
  return { ...rest, faces: { alias: keep(prefs.faces?.alias), primary: keep(chosenFace(prefs, 'primary')) } };
}

// ---------------------------------------------------------------- the old layered portraits

/**
 * The files of a portrait manifest (the old outfit sets) that are secret: sets marked secret, and
 * sets whose label or id hints at the hidden identity. A manifest can still be imported for this.
 */
export function manifestSecrets(manifestText: string | null | undefined, sheet: CharacterSheet): string[] {
  const sets = manifestSets(manifestText);
  const hints = secretHints(sheet);
  return sets.filter((s) => s.secret || looksSecret(s.label, hints) || looksSecret(s.id, hints)).flatMap((s) => s.files);
}

interface ManifestSet { id: string; label: string; secret: boolean; files: string[]; first: string | null }

function manifestSets(manifestText: string | null | undefined): ManifestSet[] {
  let json: unknown;
  try {
    json = manifestText ? parseJsonText(manifestText) : null;
  } catch {
    return [];
  }
  const raw = json && typeof json === 'object' ? (json as { sets?: unknown }).sets : null;
  if (!Array.isArray(raw)) return [];
  const out: ManifestSet[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    const files: string[] = [];
    let first: string | null = null;
    if (o.expressions && typeof o.expressions === 'object') {
      const exprs = o.expressions as Record<string, unknown>;
      const def = typeof o.defaultExpression === 'string' ? exprs[o.defaultExpression] : undefined;
      for (const facing of [def, ...Object.values(exprs)]) {
        if (!facing || typeof facing !== 'object') continue;
        const f = facing as Record<string, unknown>;
        const front = typeof f.front === 'string' ? f.front : null;
        for (const v of Object.values(f)) if (typeof v === 'string' && !files.includes(v)) files.push(v);
        first ??= front ?? files[0] ?? null;
      }
    } else if (Array.isArray(o.views)) {
      for (const v of o.views as Record<string, unknown>[]) if (typeof v?.file === 'string') files.push(v.file);
      first = files[0] ?? null;
    }
    out.push({ id: o.id, label: typeof o.label === 'string' ? o.label : o.id, secret: o.secret === true, files, first });
  }
  return out;
}

/**
 * Prefs for a character imported under the old layered system (a manifest of outfit sets and
 * appearance.portraitPrefs.activeSetId), so its secret pictures stay hidden and its face carries on.
 * Null when there is nothing to carry over.
 */
export function migratePrefs(sheet: CharacterSheet, manifestText: string | null | undefined): PortraitPrefs | null {
  const sets = manifestSets(manifestText);
  if (!sets.length) return null;
  const old = (sheet.appearance as Record<string, unknown> | null | undefined)?.portraitPrefs as { activeSetId?: unknown } | undefined;
  const active = sets.find((s) => s.id === old?.activeSetId);
  const secret = manifestSecrets(manifestText, sheet);
  const first = active?.first ?? null;
  const isSecret = !!first && secret.some((f) => lower(f) === lower(first));
  return { faces: { primary: first, alias: isSecret ? null : first }, secret };
}
