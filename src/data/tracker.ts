/**
 * Port of android/.../data/TrackerState.kt (TrackerState, HitDicePools, SpellSlots, rests).
 * Maps whose order matters (hit dice largest-first, slot levels then pact) use `Map`, since plain
 * objects reorder integer-like keys. Stored tracker state uses plain records, as the Android JSON does.
 */
import { type CharacterSheet, level, maxHp, usesLongRest, usesShortRest } from './model';
import { classLevels, findClass } from './classes';

export interface TrackerState {
  slug: string;
  currentHp: number;
  maxHp: number;
  tempHp: number;
  /** Sum over all die types; kept for older tracker files. */
  hitDiceRemaining: number;
  hitDiceTotal: number;
  featureUses: Record<string, number>;
  lastShortRestMillis?: number | null;
  lastLongRestMillis?: number | null;
  /** Remaining hit dice per die type ("d10" -> 7). Empty in older files. */
  hitDiceByDie: Record<string, number>;
  /** Spell slots spent, by key ("1".."9" or "pact"). */
  spellSlotsUsed: Record<string, number>;
}

export type RestType = 'short' | 'long';
export const PACT = 'pact';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dieSize = (die: string) => Number(die.replace(/^d/, '')) || 0;

/** Hit dice per die type, largest first ("Fighter 9 / Barbarian 1" -> d12: 1, d10: 9). */
export function hitDiceTotals(sheet: CharacterSheet): Map<string, number> {
  const pools = new Map<string, number>();
  const add = (die: string, n: number) => pools.set(die, (pools.get(die) ?? 0) + n);
  const classes = classLevels(sheet);
  if (classes.length > 0) {
    for (const c of classes) {
      const fromSheet = c.hitDie ? /d\d+/.exec(c.hitDie)?.[0] : undefined;
      const info = findClass(c.name);
      const die = fromSheet ?? (info ? `d${info.hitDie}` : 'd8');
      add(die, Math.max(0, c.level));
    }
  } else {
    for (const m of (sheet.derived?.hitDice ?? '').matchAll(/(\d+)\s*(d\d+)/g)) add(m[2], Number(m[1]));
    if (pools.size === 0) pools.set('d8', level(sheet));
  }
  return new Map([...pools.entries()].sort((a, b) => dieSize(b[0]) - dieSize(a[0])));
}

/** Slot maximums: spells.slots ("1st", "2", ...) by level, then pact magic. */
export function spellSlotMax(sheet: CharacterSheet): Map<string, number> {
  const spells = sheet.spells;
  const result = new Map<string, number>();
  if (!spells) return result;
  Object.entries(spells.slots ?? {})
    .map(([k, count]) => [/\d/.exec(k)?.[0], Number(count)] as const)
    .filter((e): e is readonly [string, number] => e[0] !== undefined && e[1] > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([lvl, count]) => result.set(lvl, (result.get(lvl) ?? 0) + count));
  if (spells.pactMagic && spells.pactMagic.slots > 0) result.set(PACT, spells.pactMagic.slots);
  return result;
}

export const slotLabel = (sheet: CharacterSheet, key: string): string =>
  key === PACT ? `Pact (level ${sheet.spells?.pactMagic?.level ?? '?'})` : `Level ${key}`;

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export function trackerFromCharacter(slug: string, sheet: CharacterSheet): TrackerState {
  const hp = maxHp(sheet);
  const totals = hitDiceTotals(sheet);
  const uses: Record<string, number> = {};
  for (const f of sheet.features) if (f.uses) uses[f.id] = f.uses.max;
  return {
    slug,
    currentHp: hp,
    maxHp: hp,
    tempHp: 0,
    hitDiceRemaining: sum(totals),
    hitDiceTotal: sum(totals),
    featureUses: uses,
    hitDiceByDie: Object.fromEntries(totals),
    spellSlotsUsed: {},
  };
}

/** Fill in fields missing from older or hand-written tracker JSON. */
export function normalizeTracker(t: Partial<TrackerState> & { slug: string }): TrackerState {
  return {
    currentHp: 1,
    maxHp: 1,
    tempHp: 0,
    hitDiceRemaining: 0,
    hitDiceTotal: 0,
    lastShortRestMillis: null,
    lastLongRestMillis: null,
    ...t,
    featureUses: { ...(t.featureUses ?? {}) },
    hitDiceByDie: { ...(t.hitDiceByDie ?? {}) },
    spellSlotsUsed: { ...(t.spellSlotsUsed ?? {}) },
  };
}

export const effectiveHp = (t: TrackerState): number => t.currentHp + t.tempHp;

/** Remaining dice per type, largest first. Older files only have one number: spread it largest-first. */
export function hitDiceRemainingByDie(t: TrackerState, sheet: CharacterSheet): Map<string, number> {
  const totals = hitDiceTotals(sheet);
  const out = new Map<string, number>();
  if (Object.keys(t.hitDiceByDie).length > 0) {
    for (const [die, total] of totals) out.set(die, clamp(t.hitDiceByDie[die] ?? total, 0, total));
    return out;
  }
  let left = t.hitDiceRemaining;
  for (const [die, total] of totals) {
    const take = clamp(left, 0, total);
    left -= take;
    out.set(die, take);
  }
  return out;
}

function withHitDice(t: TrackerState, remaining: Map<string, number>, totals: Map<string, number>): TrackerState {
  return { ...t, hitDiceByDie: Object.fromEntries(remaining), hitDiceRemaining: sum(remaining), hitDiceTotal: sum(totals) };
}

/** Spend one die of `die` ("d12"). Null if none of that type are left. */
export function spendHitDie(t: TrackerState, sheet: CharacterSheet, die: string): TrackerState | null {
  const remaining = hitDiceRemainingByDie(t, sheet);
  const have = remaining.get(die);
  if (have === undefined || have <= 0) return null;
  remaining.set(die, have - 1);
  return withHitDice(t, remaining, hitDiceTotals(sheet));
}

export function slotsRemaining(t: TrackerState, sheet: CharacterSheet, key: string): number {
  const max = spellSlotMax(sheet).get(key);
  if (max === undefined) return 0;
  return clamp(max - (t.spellSlotsUsed[key] ?? 0), 0, max);
}

export function useSpellSlot(t: TrackerState, sheet: CharacterSheet, key: string): TrackerState | null {
  const max = spellSlotMax(sheet).get(key);
  if (max === undefined) return null;
  const used = t.spellSlotsUsed[key] ?? 0;
  if (used >= max) return null;
  return { ...t, spellSlotsUsed: { ...t.spellSlotsUsed, [key]: used + 1 } };
}

export function restoreSpellSlot(t: TrackerState, key: string): TrackerState {
  const used = t.spellSlotsUsed[key] ?? 0;
  return { ...t, spellSlotsUsed: { ...t.spellSlotsUsed, [key]: Math.max(0, used - 1) } };
}

/** Set HP fields directly (null leaves a field alone). */
export function setHp(t: TrackerState, current?: number | null, max?: number | null, temp?: number | null): TrackerState {
  return {
    ...t,
    currentHp: current ?? t.currentHp,
    maxHp: max ?? t.maxHp,
    tempHp: temp ?? t.tempHp,
  };
}

/** Quick +/- like the Android tracker buttons: changes current HP only, never below 0. */
export const adjustHp = (t: TrackerState, delta: number): TrackerState => ({ ...t, currentHp: Math.max(0, t.currentHp + delta) });

/** Damage: temporary HP absorbs it first, then current HP (floor 0). */
export function applyDamage(t: TrackerState, amount: number): TrackerState {
  const dmg = Math.max(0, amount);
  const fromTemp = Math.min(t.tempHp, dmg);
  return { ...t, tempHp: t.tempHp - fromTemp, currentHp: Math.max(0, t.currentHp - (dmg - fromTemp)) };
}

/** Healing never goes above max HP. */
export const applyHealing = (t: TrackerState, amount: number): TrackerState => ({
  ...t,
  currentHp: Math.min(t.maxHp, Math.max(t.currentHp, t.currentHp + Math.max(0, amount))),
});

export function useFeature(t: TrackerState, featureId: string): TrackerState | null {
  const remaining = t.featureUses[featureId];
  if (remaining === undefined || remaining <= 0) return null;
  return { ...t, featureUses: { ...t.featureUses, [featureId]: remaining - 1 } };
}

export const setFeatureUses = (t: TrackerState, featureId: string, remaining: number): TrackerState => ({
  ...t,
  featureUses: { ...t.featureUses, [featureId]: Math.max(0, remaining) },
});

/**
 * Short rest: refresh short-rest features and pact slots (hit dice are spent separately).
 * Long rest (both editions): HP to max, temp HP gone, all features and slots refreshed.
 * Hit dice: 2024 regains all; 2014 regains half the total (minimum 1), largest dice first.
 */
export function afterRest(t: TrackerState, sheet: CharacterSheet, rest: RestType, nowMillis: number): TrackerState {
  const refreshed = { ...t.featureUses };
  for (const f of sheet.features) {
    if (!f.uses) continue;
    const resets = rest === 'short' ? usesShortRest(f.uses) : usesShortRest(f.uses) || usesLongRest(f.uses);
    if (resets) refreshed[f.id] = f.uses.max;
  }
  if (rest === 'short') {
    const { [PACT]: _pact, ...slots } = t.spellSlotsUsed;
    return { ...t, featureUses: refreshed, spellSlotsUsed: slots, lastShortRestMillis: nowMillis };
  }
  const totals = hitDiceTotals(sheet);
  const remaining = hitDiceRemainingByDie(t, sheet);
  let budget = sheet.edition?.trim() === '2024' ? sum(totals) : Math.max(1, Math.floor(sum(totals) / 2));
  for (const [die, total] of totals) {
    const have = remaining.get(die) ?? 0;
    const regain = Math.min(budget, total - have);
    remaining.set(die, have + regain);
    budget -= regain;
  }
  return {
    ...withHitDice(t, remaining, totals),
    currentHp: t.maxHp,
    tempHp: 0,
    featureUses: refreshed,
    spellSlotsUsed: {},
    lastLongRestMillis: nowMillis,
  };
}

/**
 * Carry session state across a sheet update (level-up or re-import) instead of resetting it:
 * HP and hit dice rise by what was gained, feature uses and spent slots keep what was used.
 */
export function afterLevelUp(t: TrackerState, previous: CharacterSheet | null, leveled: CharacterSheet): TrackerState {
  const newMax = maxHp(leveled);
  const hpGain = Math.max(0, newMax - t.maxHp);
  const oldMaxUses = new Map((previous?.features ?? []).filter((f) => f.uses).map((f) => [f.id, f.uses!.max]));
  const uses: Record<string, number> = {};
  for (const f of leveled.features) {
    if (!f.uses) continue;
    const oldMax = oldMaxUses.get(f.id);
    const left = t.featureUses[f.id];
    uses[f.id] = oldMax === undefined || left === undefined ? f.uses.max : clamp(left + (f.uses.max - oldMax), 0, f.uses.max);
  }
  const newTotals = hitDiceTotals(leveled);
  const oldTotals = previous ? hitDiceTotals(previous) : new Map<string, number>();
  const oldRemaining = previous ? hitDiceRemainingByDie(t, previous) : new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const [die, total] of newTotals) {
    const gained = Math.max(0, total - (oldTotals.get(die) ?? 0));
    remaining.set(die, clamp((oldRemaining.get(die) ?? 0) + gained, 0, total));
  }
  const slotMax = spellSlotMax(leveled);
  const slotsUsed: Record<string, number> = {};
  for (const [k, used] of Object.entries(t.spellSlotsUsed)) {
    const m = slotMax.get(k);
    if (m !== undefined) slotsUsed[k] = Math.min(used, m);
  }
  return {
    ...withHitDice(t, remaining, newTotals),
    maxHp: newMax,
    currentHp: clamp(t.currentHp + hpGain, 0, newMax),
    featureUses: uses,
    spellSlotsUsed: slotsUsed,
  };
}
