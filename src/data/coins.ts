/** Port of Coins (CharacterModels.kt), Wealth.coins/withCoins and data/CoinMath.kt. */
import type { Wealth } from './model';

export interface Coins { pp: number; gp: number; ep: number; sp: number; cp: number }
export type Coin = keyof Coins;

/** Largest first. PHB: 1 pp = 10 gp, 1 gp = 2 ep = 10 sp = 100 cp. */
export const COINS: { coin: Coin; valueCp: number }[] = [
  { coin: 'pp', valueCp: 1000 },
  { coin: 'gp', valueCp: 100 },
  { coin: 'ep', valueCp: 50 },
  { coin: 'sp', valueCp: 10 },
  { coin: 'cp', valueCp: 1 },
];
const VALUE: Record<Coin, number> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

export const coins = (c: Partial<Coins> = {}): Coins => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...c });

export const coinCount = (c: Coins): number =>
  Math.max(0, c.pp) + Math.max(0, c.gp) + Math.max(0, c.ep) + Math.max(0, c.sp) + Math.max(0, c.cp);

export const valueCp = (c: Coins): number => c.pp * 1000 + c.gp * 100 + c.ep * 50 + c.sp * 10 + c.cp;

export function valueGpLabel(c: Coins): string {
  const v = valueCp(c);
  const whole = Math.trunc(v / 100);
  const rest = v % 100;
  if (rest === 0) return `${whole} gp`;
  return `${whole} gp ${Math.trunc(rest / 10)} sp ${rest % 10} cp`.replace(' 0 sp', '').replace(' 0 cp', '');
}

export function coinLabel(c: Coins): string {
  const parts = COINS.filter(({ coin }) => c[coin] !== 0).map(({ coin }) => `${c[coin]} ${coin}`);
  return parts.length ? parts.join(' ') : '0 gp';
}

export function wealthCoins(w: Wealth | null | undefined): Coins {
  return coins({
    pp: w?.platinum ?? 0,
    gp: w?.gold ?? 0,
    ep: w?.electrum ?? 0,
    sp: w?.silver ?? 0,
    cp: w?.copper ?? 0,
  });
}

/** gold is always written; other coins only when nonzero or already on the sheet. */
export function withCoins(w: Wealth, c: Coins): Wealth {
  const keep = (n: number, prev: number | null | undefined) => (n !== 0 || (prev !== null && prev !== undefined) ? n : null);
  const out: Wealth = { ...w, gold: c.gp };
  const set = (k: 'platinum' | 'electrum' | 'silver' | 'copper', n: number) => {
    const v = keep(n, w[k]);
    if (v === null) delete out[k];
    else out[k] = v;
  };
  set('platinum', c.pp);
  set('electrum', c.ep);
  set('silver', c.sp);
  set('copper', c.cp);
  return out;
}

export const gain = (c: Coins, amount: number, coin: Coin): Coins => ({ ...c, [coin]: c[coin] + Math.max(0, amount) });

/**
 * Pay `amount` of `coin` the way you would at a table: that coin first, then smaller coins,
 * then break the smallest larger coin and take change in gp/sp/cp. Null if the purse can't cover it.
 */
export function spend(start: Coins, amount: number, coin: Coin): Coins | null {
  if (amount <= 0) return start;
  let need = amount * VALUE[coin];
  if (need > valueCp(start)) return null;
  let purse = { ...start };

  const payOrder: Coin[] = [coin, ...COINS.filter((c) => c.valueCp < VALUE[coin]).map((c) => c.coin)];
  for (const c of payOrder) {
    const have = purse[c];
    const use = Math.min(have, Math.floor(need / VALUE[c]));
    if (use > 0) {
      purse[c] = have - use;
      need -= use * VALUE[c];
    }
  }
  const smallestFirst = [...COINS].reverse();
  while (need > 0) {
    const breakable =
      smallestFirst.find((c) => c.valueCp > need && purse[c.coin] > 0) ??
      smallestFirst.find((c) => purse[c.coin] > 0);
    if (!breakable) return null;
    purse[breakable.coin] -= 1;
    const change = breakable.valueCp - need;
    need = Math.max(0, need - breakable.valueCp);
    if (change > 0) purse = giveChange(purse, change);
  }
  return purse;
}

function giveChange(c: Coins, value: number): Coins {
  let rest = value;
  const purse = { ...c };
  for (const k of ['gp', 'sp', 'cp'] as Coin[]) {
    const n = Math.floor(rest / VALUE[k]);
    if (n > 0) {
      purse[k] += n;
      rest -= n * VALUE[k];
    }
  }
  return purse;
}
