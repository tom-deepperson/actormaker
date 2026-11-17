/** Port of android/.../data/EncumbranceCalculator.kt. Stored (location) gear is not carried. */
import { type CharacterSheet, lineWeightLb } from './model';
import { type Coins, coinCount, wealthCoins } from './coins';

export type EncumbranceStatus = 'normal' | 'encumbered' | 'heavily' | 'over';

export interface EncumbranceSummary {
  knownLb: number;
  coinLb: number;
  totalKnownLb: number;
  unknownCount: number;
  strength: number;
  encumberedThresholdLb: number;
  heavilyEncumberedThresholdLb: number;
  maxCapacityLb: number;
  status: EncumbranceStatus;
  trackingEnabled: boolean;
}

const COINS_PER_LB = 50;

/** Explicit `constraints.encumbranceRule` wins; otherwise the player's preference (default off). */
export function isTrackingEnabled(sheet: CharacterSheet, preferenceEnabled = false): boolean {
  const rule = sheet.constraints?.encumbranceRule?.trim().toLowerCase();
  if (rule === 'none') return false;
  if (rule === 'variant') return true;
  return preferenceEnabled;
}

export const strengthScore = (sheet: CharacterSheet): number => sheet.abilityScores?.final?.STR ?? 10;

/** Every coin weighs the same: 50 coins = 1 lb. */
export function coinWeightLb(c: Coins | number | null | undefined): number {
  if (c === null || c === undefined) return 0;
  const n = typeof c === 'number' ? c : coinCount(c);
  return n <= 0 ? 0 : Math.floor(n / COINS_PER_LB);
}

export function encumbranceStatus(strength: number, totalLb: number): EncumbranceStatus {
  if (totalLb > strength * 15) return 'over';
  if (totalLb > strength * 10) return 'heavily';
  if (totalLb > strength * 5) return 'encumbered';
  return 'normal';
}

export function summarize(sheet: CharacterSheet, preferenceEnabled = false): EncumbranceSummary {
  const str = strengthScore(sheet);
  const coinLb = coinWeightLb(wealthCoins(sheet.wealth));
  let knownLb = 0;
  let unknownCount = 0;
  for (const e of sheet.equipment) {
    const w = lineWeightLb(e);
    if (w !== null) knownLb += w;
    else unknownCount++;
  }
  for (const c of sheet.consumables) {
    if (c.weightLb !== null && c.weightLb !== undefined) knownLb += c.weightLb * Math.max(1, c.quantity);
    else unknownCount++;
  }
  for (const m of sheet.magicItems) {
    if (m.weightLb !== null && m.weightLb !== undefined) knownLb += m.weightLb;
    else unknownCount++;
  }
  const totalKnownLb = knownLb + coinLb;
  const tracking = isTrackingEnabled(sheet, preferenceEnabled);
  return {
    knownLb,
    coinLb,
    totalKnownLb,
    unknownCount,
    strength: str,
    encumberedThresholdLb: str * 5,
    heavilyEncumberedThresholdLb: str * 10,
    maxCapacityLb: str * 15,
    status: tracking ? encumbranceStatus(str, totalKnownLb) : 'normal',
    trackingEnabled: tracking,
  };
}

export const speedPenaltyFt = (s: EncumbranceStatus): number => (s === 'encumbered' ? 10 : s === 'normal' ? 0 : 20);

export const effectiveSpeed = (base: number | null | undefined, s: EncumbranceStatus): number | null =>
  base === null || base === undefined ? null : Math.max(0, base - speedPenaltyFt(s));

export function penaltyDescription(s: EncumbranceStatus): string | null {
  switch (s) {
    case 'normal': return null;
    case 'encumbered': return 'Speed −10 ft';
    case 'heavily': return 'Speed −20 ft; disadvantage on STR/DEX/CON checks, attacks, and saves';
    case 'over': return 'Over carrying capacity (max STR × 15 lb)';
  }
}

export const statusLabel = (s: EncumbranceStatus): string =>
  ({ normal: 'Normal', encumbered: 'Encumbered', heavily: 'Heavily encumbered', over: 'Over capacity' })[s];
