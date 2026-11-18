/**
 * Portrait and background library for Portrait and Play mode. Port of
 * archive/android/.../portrait/PortraitRepository.kt and the portrait parts of CompanionViewModel.kt.
 *
 * Pure logic: it works on file names (what was imported) plus the manifest text; the screens
 * turn names into blob URLs.
 */
import type { CharacterSheet } from './model';
import { type SheetViewContext, shouldHideSecretIdentity } from './viewContext';

export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
export const MANIFEST_FILE = 'manifest.json';

const PROFILE_ORDER = ['side_right', 'three_quarter_front_right', 'front', 'three_quarter_front_left', 'side_left', 'back'];
const PROFILE_LABELS: Record<string, string> = {
  side_right: 'Side right',
  three_quarter_front_right: '3/4 right',
  front: 'Front',
  three_quarter_front_left: '3/4 left',
  side_left: 'Side left',
  back: 'Back',
};

export interface ViewSlot { profile: string; file: string; label: string }

export interface RotationSet {
  id: string;
  label: string;
  shot: string;
  secret: boolean;
  defaultExpression: string;
  /** Expression name → facing views, in manifest order. */
  expressions: Record<string, ViewSlot[]>;
}

export interface FlatPortrait { file: string; label: string }

export interface PortraitLibrary {
  rotationSets: RotationSet[];
  /** Images not named by the manifest. */
  flat: FlatPortrait[];
}

/** One thing the outfit carousel can show: a rotation set or a loose image. */
export type Outfit = { kind: 'set'; set: RotationSet } | { kind: 'flat'; portrait: FlatPortrait };

export const stem = (file: string) => file.replace(/\.[^.]+$/, '');
const profileLabel = (p: string) => PROFILE_LABELS[p] ?? p.replace(/_/g, ' ');
const orderOf = (p: string) => {
  const i = PROFILE_ORDER.indexOf(p);
  return i >= 0 ? i : 99;
};

export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, ''));
}

/** Files are matched by name, case-insensitively; entries whose file wasn't imported are skipped. */
function fileIndex(files: string[]): Map<string, string> {
  return new Map(files.map((f) => [f.toLowerCase(), f]));
}

export function parsePortraitLibrary(manifestText: string | null | undefined, files: string[]): PortraitLibrary {
  const index = fileIndex(files);
  const find = (name: unknown) => (typeof name === 'string' && name.trim() ? index.get(name.trim().toLowerCase()) : undefined);
  const sets: RotationSet[] = [];

  let json: unknown = null;
  if (manifestText) {
    try {
      json = parseJsonText(manifestText);
    } catch {
      json = null;
    }
  }
  const rawSets = json && typeof json === 'object' && Array.isArray((json as { sets?: unknown }).sets) ? (json as { sets: unknown[] }).sets : [];

  for (const raw of rawSets) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    const declaredDefault = typeof o.defaultExpression === 'string' && o.defaultExpression.trim() ? o.defaultExpression : null;
    const expressions: Record<string, ViewSlot[]> = {};

    if (o.expressions && typeof o.expressions === 'object') {
      for (const [expr, facing] of Object.entries(o.expressions as Record<string, unknown>)) {
        if (!facing || typeof facing !== 'object') continue;
        const slots: ViewSlot[] = [];
        for (const [profile, name] of Object.entries(facing as Record<string, unknown>)) {
          const file = find(name);
          if (file) slots.push({ profile, file, label: profileLabel(profile) });
        }
        if (slots.length) expressions[expr] = slots.sort((a, b) => orderOf(a.profile) - orderOf(b.profile));
      }
    } else if (Array.isArray(o.views)) {
      // Legacy: a views array is one expression.
      const slots: ViewSlot[] = [];
      for (const v of o.views as Record<string, unknown>[]) {
        const file = find(v?.file);
        if (file && typeof v.profile === 'string') slots.push({ profile: v.profile, file, label: profileLabel(v.profile) });
      }
      if (slots.length) expressions[declaredDefault ?? 'neutral'] = slots.sort((a, b) => orderOf(a.profile) - orderOf(b.profile));
    }

    const names = Object.keys(expressions);
    if (!names.length) continue;
    sets.push({
      id: o.id,
      label: typeof o.label === 'string' && o.label.trim() ? o.label : o.id,
      shot: typeof o.shot === 'string' ? o.shot : 'bust',
      secret: o.secret === true,
      defaultExpression: declaredDefault && expressions[declaredDefault] ? declaredDefault : names[0],
      expressions,
    });
  }

  const used = new Set(sets.flatMap((s) => Object.values(s.expressions).flat().map((v) => v.file)));
  const flat = files
    .filter((f) => IMAGE_EXT.test(f) && !used.has(f))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((file) => ({ file, label: stem(file) }));
  return { rotationSets: sets, flat };
}

// ---------------------------------------------------------------- secrets

const SECRET_HINTS = ['helm off', 'helm-off', 'helm_off', 'unarmored', 'no helm'];

/** Label hints that mark a portrait as showing the hidden identity (generic words plus the true name). */
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

/**
 * What the carousel may show. In alias or player-safe view, secret sets and images whose name
 * hints at the hidden identity are dropped. Unlike Android, there is no "show everything if
 * nothing is left" fallback: an empty list shows the empty state instead of a secret.
 */
export function visibleOutfits(lib: PortraitLibrary, sheet: CharacterSheet, ctx: SheetViewContext): Outfit[] {
  const all: Outfit[] = [
    ...lib.rotationSets.map((set) => ({ kind: 'set' as const, set })),
    ...lib.flat.map((portrait) => ({ kind: 'flat' as const, portrait })),
  ];
  if (!shouldHideSecretIdentity(ctx, sheet.identity)) return all;
  const hints = secretHints(sheet);
  return all.filter((o) =>
    o.kind === 'set' ? !o.set.secret && !looksSecret(o.set.label, hints) && !looksSecret(o.set.id, hints) : !looksSecret(o.portrait.label, hints),
  );
}

export const outfitKey = (o: Outfit): string => (o.kind === 'set' ? o.set.id : stem(o.portrait.file));
export const outfitLabel = (o: Outfit): string => (o.kind === 'set' ? o.set.label : o.portrait.label);

// ---------------------------------------------------------------- prefs (sheet.appearance.portraitPrefs, Android shape)

export interface PortraitSetPrefs {
  defaultExpression?: string | null;
  defaultFacing?: string | null;
  /** Android: pixels. */
  offsetX?: number;
  offsetY?: number;
  /** PWA: fractions of the scene size (preferred when present). */
  fracX?: number;
  fracY?: number;
  scale?: number;
}
export interface PortraitPrefs { activeSetId?: string | null; sets?: Record<string, PortraitSetPrefs> }

export function portraitPrefs(sheet: CharacterSheet): PortraitPrefs {
  const p = (sheet.appearance as Record<string, unknown> | null | undefined)?.portraitPrefs;
  return p && typeof p === 'object' ? (p as PortraitPrefs) : {};
}

export function withSetPrefs(sheet: CharacterSheet, key: string, patch: PortraitSetPrefs): CharacterSheet {
  const appearance = { ...((sheet.appearance as Record<string, unknown> | null | undefined) ?? {}) };
  const prefs = portraitPrefs(sheet);
  const sets = { ...(prefs.sets ?? {}) };
  sets[key] = { ...(sets[key] ?? {}), ...patch };
  appearance.portraitPrefs = { ...prefs, sets };
  return { ...sheet, appearance };
}

export function resolveExpression(set: RotationSet, preferred: string | null | undefined): string {
  if (preferred && set.expressions[preferred]) return preferred;
  if (set.expressions[set.defaultExpression]) return set.defaultExpression;
  return Object.keys(set.expressions)[0];
}

/** Starting facing: the saved default, else 3/4 left, else front, else the first view. */
export function initialFacing(set: RotationSet, expression: string, prefs: PortraitPrefs): number {
  const views = set.expressions[expression] ?? [];
  const saved = prefs.sets?.[set.id]?.defaultFacing;
  if (saved) {
    const i = views.findIndex((v) => v.profile === saved);
    if (i >= 0) return i;
  }
  const anchor = views.findIndex((v) => v.profile === 'three_quarter_front_left');
  if (anchor >= 0) return anchor;
  return Math.max(0, views.findIndex((v) => v.profile === 'front'));
}

export const initialExpression = (set: RotationSet, prefs: PortraitPrefs) => resolveExpression(set, prefs.sets?.[set.id]?.defaultExpression);

/**
 * Cutout pan and zoom. Offsets are fractions of the scene's width and height, so a position set
 * on one screen (or in Portrait mode) lands in the same place in Play mode, full screen and on
 * other devices. Saved as fracX / fracY next to Android's pixel offsetX / offsetY.
 */
export interface Transform { offsetX: number; offsetY: number; scale: number }
export const DEFAULT_TRANSFORM: Transform = { offsetX: 0, offsetY: 0, scale: 1 };
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
/** Android saved device pixels; its portrait scene was roughly a 1080 x 1920 phone screen. */
const ANDROID_SCENE = { w: 1080, h: 1920 };

export function clampTransform(t: Transform): Transform {
  const num = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  const frac = (v: number) => Math.min(2, Math.max(-2, num(v, 0)));
  return { offsetX: frac(t.offsetX), offsetY: frac(t.offsetY), scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, num(t.scale, 1))) };
}

export function savedTransform(sheet: CharacterSheet, key: string | null): Transform {
  if (!key) return DEFAULT_TRANSFORM;
  const p = portraitPrefs(sheet).sets?.[key];
  if (!p) return DEFAULT_TRANSFORM;
  const x = typeof p.fracX === 'number' ? p.fracX : (p.offsetX ?? 0) / ANDROID_SCENE.w;
  const y = typeof p.fracY === 'number' ? p.fracY : (p.offsetY ?? 0) / ANDROID_SCENE.h;
  return clampTransform({ offsetX: x, offsetY: y, scale: p.scale ?? 1 });
}

/** Prefs patch for a transform: fractions rounded to 0.0001, scale to 0.001. */
export function transformPrefs(t: Transform): PortraitSetPrefs {
  const v = clampTransform(t);
  const r = (n: number, d: number) => Math.round(n * d) / d;
  return { fracX: r(v.offsetX, 1e4), fracY: r(v.offsetY, 1e4), scale: r(v.scale, 1e3) };
}

// ---------------------------------------------------------------- backgrounds

export interface BackgroundItem { file: string; label: string }

/** Manifest items first (by `file`, else `id` + any image extension), then the rest by name. */
export function orderBackgrounds(manifestText: string | null | undefined, files: string[]): BackgroundItem[] {
  const images = files.filter((f) => IMAGE_EXT.test(f));
  const byName = fileIndex(images);
  const byStem = new Map(images.map((f) => [stem(f).toLowerCase(), f]));
  const out: BackgroundItem[] = [];
  const seen = new Set<string>();
  let items: unknown[] = [];
  if (manifestText) {
    try {
      const j = parseJsonText(manifestText) as { items?: unknown };
      if (Array.isArray(j?.items)) items = j.items;
    } catch {
      items = [];
    }
  }
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const id = typeof it.id === 'string' ? it.id : '';
    const file =
      (typeof it.file === 'string' && byName.get(it.file.toLowerCase())) ||
      // Imported backgrounds are re-encoded to JPEG, so match on the name without extension too.
      (typeof it.file === 'string' && byStem.get(stem(it.file).toLowerCase())) ||
      (id && byStem.get(id.toLowerCase()));
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push({ file, label: typeof it.displayName === 'string' && it.displayName.trim() ? it.displayName : id || stem(file) });
  }
  for (const f of [...images].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    if (!seen.has(f)) out.push({ file: f, label: stem(f) });
  }
  return out;
}

/** Built-in gradient scenes, used when no background images are on the device. */
export const PLACEHOLDER_BACKGROUNDS: { id: string; label: string; from: string; to: string }[] = [
  { id: 'road', label: 'Road', from: '#a8927a', to: '#5c4d3c' },
  { id: 'tavern', label: 'Tavern', from: '#4a3728', to: '#1a1208' },
  { id: 'cave', label: 'Cave', from: '#6b5b4f', to: '#2a2218' },
  { id: 'ruins', label: 'Ruins', from: '#5a4a3a', to: '#1e1810' },
  { id: 'catacomb', label: 'Catacomb', from: '#4d3d32', to: '#15100c' },
  { id: 'dungeon', label: 'Dungeon', from: '#3a3028', to: '#0e0a08' },
];

export const wrapIndex = (i: number, n: number) => (n <= 0 ? 0 : ((i % n) + n) % n);
