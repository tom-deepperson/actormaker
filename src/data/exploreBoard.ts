/** Port of archive/android/.../data/ExploreBoard.kt: skills, checks, saves, senses and utility traits. */
import { type CharacterSheet, type Feature, abilityModifier, actionBuckets } from './model';
import { inferCost, isSecretRune } from './actionBoard';

export interface SkillCheck { name: string; ability: string; modifier: number; proficient: boolean; notes?: string | null }
export interface AbilityLine { ability: string; score: number; check: number; save: number; saveProficient: boolean }

export const SKILLS: [string, string][] = [
  ['Acrobatics', 'DEX'], ['Animal Handling', 'WIS'], ['Arcana', 'INT'], ['Athletics', 'STR'],
  ['Deception', 'CHA'], ['History', 'INT'], ['Insight', 'WIS'], ['Intimidation', 'CHA'],
  ['Investigation', 'INT'], ['Medicine', 'WIS'], ['Nature', 'INT'], ['Perception', 'WIS'],
  ['Performance', 'CHA'], ['Persuasion', 'CHA'], ['Religion', 'INT'], ['Sleight of Hand', 'DEX'],
  ['Stealth', 'DEX'], ['Survival', 'WIS'],
];
export const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export function abilityMod(sheet: CharacterSheet, ability: string): number {
  const score = sheet.abilityScores?.final?.[ability];
  return typeof score === 'number' ? abilityModifier(score) : 0;
}

const proficiency = (sheet: CharacterSheet) => sheet.derived?.proficiencyBonus ?? 2;

/** All 18 skills. A modifier stored on the sheet wins (it may include expertise); otherwise it's computed. */
export function skills(sheet: CharacterSheet): SkillCheck[] {
  const listed = sheet.proficiencies?.skills ?? [];
  return SKILLS.map(([name, ability]) => {
    const entry = listed.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const computed = abilityMod(sheet, ability) + (entry ? proficiency(sheet) : 0);
    return { name, ability, modifier: entry?.modifier ?? computed, proficient: !!entry, notes: entry?.notes ?? null };
  });
}

export function abilities(sheet: CharacterSheet): AbilityLine[] {
  const scores = sheet.abilityScores?.final ?? {};
  const saveProf = new Set((sheet.proficiencies?.savingThrows ?? []).map((s) => s.toUpperCase().slice(0, 3)));
  return ABILITIES.filter((a) => typeof scores[a] === 'number').map((a) => {
    const check = abilityMod(sheet, a);
    const save = sheet.derived?.savingThrows?.[a] ?? check + (saveProf.has(a) ? proficiency(sheet) : 0);
    return { ability: a, score: scores[a], check, save, saveProficient: saveProf.has(a) };
  });
}

/** Passive scores: 10 + the skill modifier (Perception uses the sheet's own value when it has one). */
export function passives(sheet: CharacterSheet): [string, number][] {
  const by = new Map(skills(sheet).map((s) => [s.name, s.modifier]));
  return [
    ['Perception', sheet.derived?.passivePerception ?? 10 + by.get('Perception')!],
    ['Insight', 10 + by.get('Insight')!],
    ['Investigation', 10 + by.get('Investigation')!],
  ];
}

/** Features that aren't part of the turn list: traits, exploration and social abilities. */
export function utilityFeatures(sheet: CharacterSheet, hideSecret = false): Feature[] {
  const inCombatList = new Set(
    actionBuckets(sheet.combatActions).flatMap(([, e]) => e).map((e) => e.featureId).filter((id): id is string => !!id),
  );
  return sheet.features
    .filter((f) => !inCombatList.has(f.id))
    .filter((f) => !f.uses || inferCost(f.rulesText) === 'free')
    .filter((f) => !(hideSecret && isSecretRune(f.name, f.id)));
}
