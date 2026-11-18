/** Port of archive/android/.../data/ClassRules.kt. */
import { type CharacterSheet, type ClassLevel, level } from './model';

export interface ClassInfo { name: string; hitDie: number; prerequisite: string[][] }

export const CLASSES: ClassInfo[] = [
  { name: 'Artificer', hitDie: 8, prerequisite: [['INT']] },
  { name: 'Barbarian', hitDie: 12, prerequisite: [['STR']] },
  { name: 'Bard', hitDie: 8, prerequisite: [['CHA']] },
  { name: 'Cleric', hitDie: 8, prerequisite: [['WIS']] },
  { name: 'Druid', hitDie: 8, prerequisite: [['WIS']] },
  { name: 'Fighter', hitDie: 10, prerequisite: [['STR', 'DEX']] },
  { name: 'Monk', hitDie: 8, prerequisite: [['DEX'], ['WIS']] },
  { name: 'Paladin', hitDie: 10, prerequisite: [['STR'], ['CHA']] },
  { name: 'Ranger', hitDie: 10, prerequisite: [['DEX'], ['WIS']] },
  { name: 'Rogue', hitDie: 8, prerequisite: [['DEX']] },
  { name: 'Sorcerer', hitDie: 6, prerequisite: [['CHA']] },
  { name: 'Warlock', hitDie: 8, prerequisite: [['CHA']] },
  { name: 'Wizard', hitDie: 6, prerequisite: [['INT']] },
];

export const findClass = (name: string): ClassInfo | undefined =>
  CLASSES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

export const prerequisiteLabel = (info: ClassInfo): string =>
  info.prerequisite.map((g) => g.join(' or ') + ' 13').join(' and ');

export function multiclassProblems(sheet: CharacterSheet, newClass: string): string[] {
  const scores = sheet.abilityScores?.final ?? {};
  const unmet = (info: ClassInfo) => info.prerequisite.some((g) => g.every((a) => (scores[a] ?? 0) < 13));
  const names = [...new Set([...classLevels(sheet).map((c) => c.name), newClass])];
  return names
    .map(findClass)
    .filter((i): i is ClassInfo => !!i && unmet(i))
    .map((i) => `${i.name} needs ${prerequisiteLabel(i)}`);
}

export function hitDieFor(sheet: CharacterSheet, className: string): number | undefined {
  const c = classLevels(sheet).find((x) => x.name.toLowerCase() === className.toLowerCase());
  const m = c?.hitDie ? /d(\d+)/.exec(c.hitDie) : null;
  if (m) return Number(m[1]);
  return findClass(className)?.hitDie;
}

/** Classes with levels: the sheet's list when present, else the single class from identity. */
export function classLevels(sheet: CharacterSheet): ClassLevel[] {
  if (sheet.classes.length > 0) return sheet.classes;
  const name = sheet.identity?.class?.trim() ?? '';
  if (!name) return [];
  const die = sheet.derived?.hitDice ? /d\d+/.exec(sheet.derived.hitDice)?.[0] ?? null : null;
  return [{ name, subclass: sheet.identity?.subclass ?? null, level: level(sheet), hitDie: die }];
}

const sub = (s?: string | null) => (s && s.trim() ? ` (${s})` : '');

/** "Fighter 9 (Rune Knight) / Barbarian 1". */
export const classSummary = (sheet: CharacterSheet): string =>
  classLevels(sheet).map((c) => `${c.name} ${c.level}${sub(c.subclass)}`).join(' / ');

/** Single class: "Fighter (Rune Knight)". Multiclass: the summary. */
export function classLabel(sheet: CharacterSheet): string {
  const list = classLevels(sheet);
  if (list.length > 1) return classSummary(sheet);
  const c = list[0];
  if (!c) return sheet.identity?.class ?? '';
  return c.name + sub(c.subclass);
}
