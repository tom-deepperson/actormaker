/** Reading a character from the model's reply. Port of CharacterImportPrompts.parse / dropUnproficientSkills. */
import { type CharacterSheet, abilityModifier, parseSheet } from '../data/model';
import { SKILLS } from '../data/exploreBoard';
import { extractJson } from './prompts';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A paper sheet shows all 18 skills. If the model copied ones without proficiency, their modifier equals the plain
 * ability modifier: drop those, since anything listed counts as proficient.
 */
export function dropUnproficientSkills(sheet: CharacterSheet): CharacterSheet {
  const prof = sheet.proficiencies;
  const scores = sheet.abilityScores?.final ?? {};
  if (!prof?.skills?.length || Object.keys(scores).length === 0) return sheet;
  const abilityOf = new Map(SKILLS.map(([name, ab]) => [name.toLowerCase(), ab]));
  const kept = prof.skills.filter((sk) => {
    const ability = abilityOf.get(sk.name.trim().toLowerCase());
    const score = ability ? scores[ability] : undefined;
    if (ability === undefined || typeof score !== 'number' || sk.modifier == null) return true;
    return sk.modifier !== abilityModifier(score) || !!sk.notes?.trim();
  });
  return kept.length === prof.skills.length ? sheet : { ...sheet, proficiencies: { ...prof, skills: kept } };
}

/** Parse the model's reply into a sheet, folding importNotes into the personality notes. */
export function parseImportReply(raw: string): CharacterSheet {
  try {
    const obj = JSON.parse(extractJson(raw));
    if (!isObj(obj)) throw new Error("The reply wasn't a JSON object.");
    const notes = (Array.isArray(obj.importNotes) ? obj.importNotes : [])
      .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : ''))
      .filter(Boolean);
    delete obj.importNotes;
    // The sheet format names the identity's class "class"; accept the spelled-out key too.
    if (isObj(obj.identity) && typeof obj.identity.characterClass === 'string' && !obj.identity.class) {
      const { characterClass, ...rest } = obj.identity;
      obj.identity = { ...rest, class: characterClass };
    }
    const sheet = parseSheet(obj);
    const hasCharacter = !!sheet.identity?.name?.trim() || !!sheet.identity?.class?.trim() || sheet.classes.length > 0 ||
      Object.keys(sheet.abilityScores?.final ?? {}).length > 0;
    if (!hasCharacter) throw new Error("Couldn't find a character on that sheet.");
    const summed = sheet.classes.reduce((t, c) => t + c.level, 0);
    const lvl = summed > 0 ? summed : sheet.derived?.level ?? sheet.constraints?.level ?? 1;
    let out: CharacterSheet = {
      ...dropUnproficientSkills(sheet),
      status: 'imported',
      derived: { proficiencyBonus: 2, ...(sheet.derived ?? {}), level: lvl },
      constraints: { ...(sheet.constraints ?? {}), level: lvl },
    };
    if (notes.length) {
      const text = 'Import notes (check these):\n' + notes.map((x) => `- ${x}`).join('\n');
      const p = out.personality ?? {};
      out = { ...out, personality: { ...p, notes: [p.notes?.trim() ? p.notes : null, text].filter(Boolean).join('\n\n') } };
    }
    return out;
  } catch (e) {
    throw new Error(`Could not read the character: ${(e as Error).message}`);
  }
}
