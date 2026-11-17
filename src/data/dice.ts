/** Port of android/.../data/Dice.kt. */

/** One term of a dice expression: `count` dice of `sides` (sides 0 = flat number). */
export interface DiceTerm { count: number; sides: number; sign: 1 | -1 }
export interface DiceExpr { terms: DiceTerm[] }

export interface RollResult {
  label: string;
  total: number;
  /** Each die rolled, in order, for showing the breakdown. */
  dice: number[];
  modifier: number;
  /** For d20 rolls with advantage/disadvantage: the die that was not used. */
  dropped?: number | null;
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

/** Returns a whole number in [min, max]. Tests pass a seeded one. */
export type Rng = (min: number, max: number) => number;

export const defaultRng: Rng = (min, max) => {
  const span = max - min + 1;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    // Rejection sampling keeps every face equally likely.
    const limit = Math.floor(0x100000000 / span) * span;
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return min + (buf[0] % span);
  }
  return min + Math.floor(Math.random() * span);
};

/** Small seeded generator (mulberry32) for tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (min, max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return min + Math.floor(r * (max - min + 1));
  };
}

export function exprLabel(expr: DiceExpr): string {
  return expr.terms
    .map((t, i) => {
      const body = t.sides === 0 ? `${t.count}` : `${t.count}d${t.sides}`;
      if (i === 0 && t.sign > 0) return body;
      return t.sign > 0 ? `+${body}` : `-${body}`;
    })
    .join('');
}

export const isNatural20 = (r: RollResult) => r.label.startsWith('d20') && r.dice[0] === 20;
export const isNatural1 = (r: RollResult) => r.label.startsWith('d20') && r.dice[0] === 1;

export function breakdown(r: RollResult): string {
  const mod = r.modifier > 0 ? ` + ${r.modifier}` : r.modifier < 0 ? ` - ${-r.modifier}` : '';
  const drop = r.dropped != null ? ` (other die ${r.dropped})` : '';
  return `[${r.dice.join(' + ')}]${mod}${drop}`;
}

/** Reads the dice part of text such as "1d10 + 4 slashing" or "2d6+1d8+3". Null when there are no dice. */
export function parseDice(text: string): DiceExpr | null {
  // Only the leading formula: stop at the first letter that isn't part of a "d".
  const formula = /^[\s\dd+-]+/i.exec(text.trim())?.[0];
  if (!formula) return null;
  const terms: DiceTerm[] = [];
  for (const m of formula.matchAll(/([+-]?)\s*(\d*)\s*d\s*(\d+)|([+-]?)\s*(\d+)/gi)) {
    if (m[3]) terms.push({ count: m[2] ? Number(m[2]) : 1, sides: Number(m[3]), sign: m[1] === '-' ? -1 : 1 });
    else if (m[5]) terms.push({ count: Number(m[5]), sides: 0, sign: m[4] === '-' ? -1 : 1 });
  }
  return terms.some((t) => t.sides > 0) ? { terms } : null;
}

export function roll(expr: DiceExpr, rng: Rng = defaultRng, critical = false): RollResult {
  const dice: number[] = [];
  let total = 0;
  let modifier = 0;
  for (const t of expr.terms) {
    if (t.sides === 0) {
      modifier += t.sign * t.count;
      continue;
    }
    const count = critical ? t.count * 2 : t.count;
    for (let i = 0; i < count; i++) {
      const r = rng(1, t.sides);
      dice.push(r);
      total += t.sign * r;
    }
  }
  const label = critical ? `${exprLabel(expr)} (critical)` : exprLabel(expr);
  return { label, total: total + modifier, dice, modifier };
}

export function d20(modifier: number, mode: RollMode = 'normal', rng: Rng = defaultRng): RollResult {
  const a = rng(1, 20);
  const b = mode === 'normal' ? null : rng(1, 20);
  const kept = b === null ? a : mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
  const dropped = b === null ? null : kept === a ? b : a;
  const modLabel = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const modeLabel = mode === 'advantage' ? ' (adv)' : mode === 'disadvantage' ? ' (dis)' : '';
  return { label: `d20${modLabel}${modeLabel}`, total: kept + modifier, dice: [kept], modifier, dropped };
}
