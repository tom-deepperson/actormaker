/** Port of archive/android/.../ai/SheetMerge.kt and SheetChangeSummary (AiAssistantPrompts.kt). */
import { type CharacterSheet, level, maxHp, parseSheet, resolvedEquipmentLocations } from '../data/model';
import { extractJson } from './prompts';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Overlay the model's JSON onto the current sheet's JSON. Objects merge field by field, so keys the
 * model omitted keep their current value. Arrays and primitives the model returned replace the current
 * value. A null where the sheet has a list or map becomes an empty one (the Kotlin defaults).
 * Throws when the model's JSON doesn't parse (for example a reply cut off mid-object).
 */
export function overlayTopLevel(current: Json, proposedJson: string): Json {
  const proposed = JSON.parse(proposedJson);
  if (!isObj(proposed)) throw new Error("The reply wasn't a JSON object.");
  return deepMerge(current, proposed);
}

function deepMerge(current: Json, proposed: Json): Json {
  const out: Json = { ...current };
  for (const [k, v] of Object.entries(proposed)) {
    const existing = out[k];
    if (isObj(existing) && isObj(v)) out[k] = deepMerge(existing, v);
    else if (v === null && Array.isArray(existing)) out[k] = [];
    else if (v === null && isObj(existing)) out[k] = {};
    else out[k] = v;
  }
  return out;
}

/** The model's "_changeSummary" bullets, if any. */
export function extractChangeSummary(raw: string): string[] {
  try {
    const obj = JSON.parse(extractJson(raw));
    const arr = isObj(obj) && Array.isArray(obj._changeSummary) ? obj._changeSummary : [];
    return arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function stripChangeSummary(raw: string): string {
  try {
    const obj = JSON.parse(extractJson(raw));
    if (!isObj(obj)) return raw;
    delete obj._changeSummary;
    return JSON.stringify(obj);
  } catch {
    return raw;
  }
}

const names = (list: { name: string }[] | undefined) => new Set((list ?? []).map((x) => x.name));
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Human-readable list of what changed between two sheets. */
export function compareSheets(before: CharacterSheet, after: CharacterSheet): string[] {
  const lines: string[] = [];
  if (level(before) !== level(after)) lines.push(`Level ${level(before)} → ${level(after)}`);
  if (!same(before.equipment, after.equipment)) {
    const added = minus(names(after.equipment), names(before.equipment));
    const removed = minus(names(before.equipment), names(after.equipment));
    added.forEach((n) => lines.push(`Equipment added: ${n}`));
    removed.forEach((n) => lines.push(`Equipment removed: ${n}`));
    if (!added.length && !removed.length) lines.push('Equipment updated');
  }
  if (!same(before.magicItems, after.magicItems)) {
    const added = minus(names(after.magicItems), names(before.magicItems));
    const removed = minus(names(before.magicItems), names(after.magicItems));
    added.forEach((n) => lines.push(`Magic item added: ${n}`));
    removed.forEach((n) => lines.push(`Magic item removed: ${n}`));
    if (!added.length && !removed.length) lines.push('Magic items updated');
  }
  const bs = before.derived?.stealth ?? null;
  const as = after.derived?.stealth ?? null;
  if (bs !== as) lines.push(`Stealth: ${bs ?? '—'} → ${as ?? '—'}`);
  if ((before.derived?.armorClass ?? null) !== (after.derived?.armorClass ?? null)) {
    lines.push(`AC: ${before.derived?.armorClass ?? 'null'} → ${after.derived?.armorClass ?? 'null'}`);
  }
  const feat = (s: CharacterSheet) => s.features.map((f) => [f.id, f.rulesText]);
  if (!same(feat(before), feat(after))) lines.push('Features updated');
  if (!same(before.sources, after.sources)) {
    const topics = (s: CharacterSheet) => new Set((s.sources ?? []).map((x) => x.topic).filter(Boolean));
    const fresh = minus(topics(after), topics(before));
    fresh.slice(0, 5).forEach((t) => lines.push(`Source: ${t}`));
    if (!fresh.length) lines.push('Sources updated');
  }
  if (!lines.length) lines.push('Sheet revised (see preview)');
  return lines;
}

/** Parse the merged sheet the same way an import does. */
export const sheetFrom = (json: Json): CharacterSheet => parseSheet(json);

// ---------------------------------------------------------------- level-up checks (LevelUpCheck)

/** Hard failure: the proposal should not be offered at all. */
export function blockingProblem(current: CharacterSheet, proposed: CharacterSheet, targetLevel: number): string | null {
  if (level(proposed) !== targetLevel) return `AI returned level ${level(proposed)} instead of ${targetLevel}. Try again.`;
  const oldName = current.identity?.name?.trim() ?? '';
  const newName = proposed.identity?.name?.trim() ?? '';
  if (oldName && oldName.toLowerCase() !== newName.toLowerCase()) return `AI changed the character name to "${newName}". Try again.`;
  return null;
}

/** Soft warnings: shown on the preview so the player can decide. */
export function levelUpWarnings(current: CharacterSheet, proposed: CharacterSheet): string[] {
  const out: string[] = [];
  const shrank = (label: string, before: number, after: number) => {
    if (after < before) out.push(`${label} dropped from ${before} to ${after} entries.`);
  };
  shrank('Equipment', current.equipment.length, proposed.equipment.length);
  shrank('Consumables', current.consumables.length, proposed.consumables.length);
  shrank('Magic items', current.magicItems.length, proposed.magicItems.length);
  shrank('Features', current.features.length, proposed.features.length);
  shrank('Feats', current.feats.length, proposed.feats.length);
  shrank('Storage locations', resolvedEquipmentLocations(current).length, resolvedEquipmentLocations(proposed).length);
  if (maxHp(proposed) < maxHp(current)) out.push(`Max HP went down (${maxHp(current)} to ${maxHp(proposed)}).`);
  return out;
}
