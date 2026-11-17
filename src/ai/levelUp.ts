/** Port of android/.../ai/LevelUpPlan.kt and LevelUpCheck.choiceWarnings (SheetMerge.kt). */
import { type CharacterSheet, abilityModifier, formatModifier, level, normalizedForSave } from '../data/model';
import { classLevels, classSummary, hitDieFor } from '../data/classes';
import { extractJson } from './prompts';

export interface PlanEntry { name: string; summary: string; source?: string | null; recommended?: boolean }
export interface PlanChoice {
  title: string;
  /** rune, spell, cantrip, feat, asi, maneuver, subclass, fighting_style, other */
  kind: string;
  pick: number;
  current: PlanEntry[];
  /** How many current entries the rules let the player swap out at this level. */
  allowReplace: number;
  options: PlanEntry[];
  notes?: string | null;
}
export interface LevelUpPlan {
  targetLevel: number;
  hitPoints: { die?: string | null; perLevelBonus: number; bonusNotes?: string | null };
  automatic: PlanEntry[];
  choices: PlanChoice[];
  notes?: string | null;
}

export type HpMode = 'average' | 'rolled';
export interface HpGain { dieSize: number; average: number; base: number; conMod: number; perLevelBonus: number; total: number }

/** Picks and swaps are keyed by choice index, then option/current index. */
export type Selection = Record<number, number[]>;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : d);
const entries = (v: unknown): PlanEntry[] =>
  (Array.isArray(v) ? v : []).filter(isObj).map((e) => ({
    name: s(e.name),
    summary: s(e.summary),
    source: typeof e.source === 'string' ? e.source : null,
    recommended: e.recommended === true,
  }));

/** Read the model's plan, with the same defaults as the Kotlin data classes. */
export function parsePlan(raw: string): LevelUpPlan {
  const obj = JSON.parse(extractJson(raw));
  if (!isObj(obj)) throw new Error("The reply wasn't a JSON object.");
  const hp = isObj(obj.hitPoints) ? obj.hitPoints : {};
  return {
    targetLevel: n(obj.targetLevel, 0),
    hitPoints: { die: typeof hp.die === 'string' ? hp.die : null, perLevelBonus: n(hp.perLevelBonus, 0), bonusNotes: typeof hp.bonusNotes === 'string' ? hp.bonusNotes : null },
    automatic: entries(obj.automatic),
    choices: (Array.isArray(obj.choices) ? obj.choices : []).filter(isObj).map((c) => ({
      title: s(c.title),
      kind: s(c.kind) || 'other',
      pick: n(c.pick, 1),
      current: entries(c.current),
      allowReplace: n(c.allowReplace, 0),
      options: entries(c.options),
      notes: typeof c.notes === 'string' ? c.notes : null,
    })),
    notes: typeof obj.notes === 'string' ? obj.notes : null,
  };
}

const GENERIC = new Set(['rune', 'runes', 'spell', 'cantrip', 'feat', 'maneuver', 'the', 'of']);

/** "Cloud Rune (TCoE)" -> "cloud"; "Polearm Master" -> "polearm master". */
export function coreName(name: string): string {
  return name.split('(')[0].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter((w) => w && !GENERIC.has(w)).join(' ');
}

/** "Fire" = "Fire Rune", "Polearm Master" = "Polearm Master (PHB)", but "Fire" != "Fire Giant's Might". */
export function sameThing(a: string, b: string): boolean {
  const x = coreName(a);
  return x !== '' && x === coreName(b);
}

export function currentFromSheet(kind: string, sheet: CharacterSheet): string[] {
  switch (kind.toLowerCase()) {
    case 'rune': return sheet.runes?.known ?? [];
    case 'cantrip': return sheet.spells?.cantrips ?? [];
    case 'spell': return [...new Set([...(sheet.spells?.known ?? []), ...(sheet.spells?.prepared ?? [])])];
    case 'feat': return sheet.feats.map((f) => f.name);
    default: return [];
  }
}

/**
 * Make the plan trustworthy for comparison: "current" comes from the sheet where the sheet tracks it
 * (the AI may not know homebrew entries), and options the character already has are dropped.
 */
export function resolvePlan(plan: LevelUpPlan, sheet: CharacterSheet): LevelUpPlan {
  return {
    ...plan,
    choices: plan.choices
      .filter((c) => c.title.trim() || c.options.length)
      .map((choice) => {
        const sheetNames = currentFromSheet(choice.kind, sheet);
        const current = sheetNames.length === 0
          ? choice.current
          : sheetNames.map((name) => {
              const described = choice.current.find((e) => sameThing(e.name, name));
              const feature = sheet.features.find((f) => sameThing(f.name, name));
              return {
                name,
                summary: described?.summary.trim() ? described.summary : (feature?.rulesText ?? '').slice(0, 240),
                source: described?.source ?? null,
              };
            });
        const seen = new Set<string>();
        return {
          ...choice,
          pick: Math.max(1, choice.pick),
          allowReplace: Math.min(Math.max(0, choice.allowReplace), current.length),
          current,
          options: choice.options
            .filter((o) => o.name.trim())
            .filter((o) => !current.some((c) => sameThing(c.name, o.name)))
            .filter((o) => {
              const k = o.name.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            }),
        };
      }),
  };
}

/** `className` is the class gaining the level; its hit die wins (multiclass levels use that class's die). */
export function hpGain(sheet: CharacterSheet, plan: LevelUpPlan | null, mode: HpMode, roll: number | null, className?: string): HpGain {
  const dieText = sheet.derived?.hitDice ?? plan?.hitPoints.die ?? null;
  const fromText = dieText ? Number(/d(\d+)/.exec(dieText)?.[1]) || undefined : undefined;
  const dieSize = (className ? hitDieFor(sheet, className) : undefined) ?? fromText ?? 8;
  const average = Math.floor(dieSize / 2) + 1;
  const base = mode === 'rolled' && roll != null ? Math.min(Math.max(roll, 1), dieSize) : average;
  const con = sheet.abilityScores?.final?.CON;
  const conMod = typeof con === 'number' ? abilityModifier(con) : 0;
  const perLevelBonus = plan?.hitPoints.perLevelBonus ?? 0;
  return { dieSize, average, base, conMod, perLevelBonus, total: Math.max(1, base + conMod + perLevelBonus) };
}

export function describeHp(hp: HpGain, mode: HpMode): string {
  let out = mode === 'rolled' ? `rolled ${hp.base} on d${hp.dieSize}` : `average ${hp.base} for d${hp.dieSize}`;
  out += `, CON ${formatModifier(hp.conMod)}`;
  if (hp.perLevelBonus !== 0) out += `, ${formatModifier(hp.perLevelBonus)} per-level bonus`;
  return out;
}

/** Which class gains the level, written for both prompts. */
export function classTargetText(sheet: CharacterSheet, className: string, isNewClass: boolean, targetLevel: number): string {
  const classes = classLevels(sheet);
  const lines: string[] = [];
  if (isNewClass) {
    lines.push(
      `- This level goes into a NEW class: ${className} (multiclassing; ${className} level 1). Apply the ` +
        `multiclassing rules: only the multiclass proficiencies for ${className}, its level 1 features, ` +
        'and multiclass spell slots if spellcasting is involved.',
    );
  } else {
    const cur = classes.find((c) => c.name.toLowerCase() === className.toLowerCase())?.level ?? level(sheet);
    lines.push(`- This level goes into ${className} (class level ${cur} → ${cur + 1}).`);
  }
  lines.push(`- Current classes: ${classSummary(sheet) || 'unknown'}. Total level ${level(sheet)} → ${targetLevel}.`);
  if (isNewClass || classes.length > 1) {
    lines.push(
      '- Write the top-level "classes" list with every class as {"name","subclass","level","hitDie"}; ' +
        `levels must add up to ${targetLevel}. Keep identity.class as the first class. ` +
        'Set derived.hitDice per class, like "9d10 + 1d12".',
    );
  }
  return lines.join('\n');
}

/** Picks per choice: the base count plus one for every current entry swapped out. */
export const requiredPicks = (choice: PlanChoice, swapCount: number) => Math.min(choice.pick + swapCount, choice.options.length);

export const isComplete = (plan: LevelUpPlan, picks: Selection, swaps: Selection) =>
  plan.choices.every((c, i) => (picks[i] ?? []).length === requiredPicks(c, (swaps[i] ?? []).length));

/** The player's decisions, written for the build prompt. */
export function decisionsText(plan: LevelUpPlan, picks: Selection, swaps: Selection, newMaxHp: number, hp: HpGain, mode: HpMode, playerNotes: string): string {
  const lines = [`- Max HP: set derived.hitPoints.total to ${newMaxHp} (${describeHp(hp, mode)}; +${hp.total} this level).`];
  plan.choices.forEach((choice, i) => {
    const chosen = [...(picks[i] ?? [])].sort((a, b) => a - b).map((j) => choice.options[j]?.name).filter(Boolean);
    const removed = [...(swaps[i] ?? [])].sort((a, b) => a - b).map((j) => choice.current[j]?.name).filter(Boolean);
    let line = `- ${choice.title.trim() || choice.kind}: take ${chosen.join(', ') || 'nothing'}.`;
    if (removed.length) line += ` Remove (swapped out): ${removed.join(', ')}.`;
    lines.push(line);
  });
  if (playerNotes.trim()) lines.push(`- Player notes (follow these): ${playerNotes.trim()}`);
  return lines.join('\n');
}

export const chosenNames = (plan: LevelUpPlan, picks: Selection): string[] =>
  plan.choices.flatMap((c, i) => (picks[i] ?? []).map((j) => c.options[j]?.name).filter((x): x is string => !!x));

/** Swapped-out entries paired with their kind, for checking the result. */
export const swappedOut = (plan: LevelUpPlan, swaps: Selection): [string, string][] =>
  plan.choices.flatMap((c, i) => (swaps[i] ?? []).map((j) => c.current[j]?.name).filter((x): x is string => !!x).map((name) => [c.kind, name] as [string, string]));

/** Recommended options pre-selected, so a one-choice level is one tap. */
export const recommendedPicks = (plan: LevelUpPlan): Selection =>
  Object.fromEntries(plan.choices.map((c, i) => [i, c.options.map((o, j) => (o.recommended ? j : -1)).filter((j) => j >= 0).slice(0, c.pick)]));

/** Did the AI apply what the player picked, and drop what they swapped out? */
export function choiceWarnings(proposed: CharacterSheet, chosen: string[], swapped: [string, string][]): string[] {
  const out: string[] = [];
  const text = JSON.stringify(normalizedForSave(proposed)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // "+2 to one ability" style picks show up as score changes, not names; skip those.
  for (const name of chosen.filter((x) => !x.trim().startsWith('+'))) {
    const core = coreName(name);
    if (core && !new RegExp(`(^| )${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text)) {
      out.push(`Your pick "${name}" doesn't appear in the new sheet.`);
    }
  }
  for (const [kind, name] of swapped) {
    if (currentFromSheet(kind, proposed).some((x) => sameThing(x, name))) out.push(`"${name}" was supposed to be swapped out but is still listed.`);
  }
  return out;
}

/** Toggle a pick: a single pick behaves like a radio button; otherwise up to the required count. */
export function togglePick(plan: LevelUpPlan, picks: Selection, swaps: Selection, ci: number, oi: number): Selection {
  const choice = plan.choices[ci];
  if (!choice) return picks;
  const max = requiredPicks(choice, (swaps[ci] ?? []).length);
  const cur = picks[ci] ?? [];
  const next = cur.includes(oi) ? cur.filter((x) => x !== oi) : max === 1 ? [oi] : cur.length < max ? [...cur, oi] : cur;
  return { ...picks, [ci]: next };
}

/** Toggle a swap; fewer swaps means fewer picks allowed, so extras are dropped. */
export function toggleSwap(plan: LevelUpPlan, picks: Selection, swaps: Selection, ci: number, idx: number): { picks: Selection; swaps: Selection } {
  const choice = plan.choices[ci];
  if (!choice) return { picks, swaps };
  const cur = swaps[ci] ?? [];
  const next = cur.includes(idx) ? cur.filter((x) => x !== idx) : cur.length < choice.allowReplace ? [...cur, idx] : cur;
  const max = requiredPicks(choice, next.length);
  return { swaps: { ...swaps, [ci]: next }, picks: { ...picks, [ci]: [...(picks[ci] ?? [])].sort((a, b) => a - b).slice(0, max) } };
}
