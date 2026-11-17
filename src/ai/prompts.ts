/**
 * Prompts, ported word for word from android/.../ai/LevelUpPrompts.kt, AiAssistantPrompts.kt and
 * CharacterImportPrompts.kt. The rules files are the Android app's assets/rules, bundled at build time.
 */
import ruleset14 from '../assets/rules/2014/ruleset-dnd5e.mdc?raw';
import core14 from '../assets/rules/2014/character-creator-core.mdc?raw';
import research14 from '../assets/rules/2014/character-creator-research.mdc?raw';
import edition14 from '../assets/rules/2014/ruleset-dnd5e-2014-core.mdc?raw';
import expansions14 from '../assets/rules/2014/ruleset-dnd5e-2014-expansions.mdc?raw';
import ruleset24 from '../assets/rules/2024/ruleset-dnd5e.mdc?raw';
import core24 from '../assets/rules/2024/character-creator-core.mdc?raw';
import research24 from '../assets/rules/2024/character-creator-research.mdc?raw';
import edition24 from '../assets/rules/2024/ruleset-dnd5e-2024-core.mdc?raw';
import expansions24 from '../assets/rules/2024/ruleset-dnd5e-2024-expansions.mdc?raw';

export function rulesForEdition(edition: string | null | undefined): string {
  const files = edition?.trim() === '2024'
    ? [ruleset24, core24, research24, edition24, expansions24]
    : [ruleset14, core14, research14, edition14, expansions14];
  return files.join('\n\n---\n\n');
}

/** The JSON object in a reply: inside a ``` fence if there is one, else from the first { to the last }. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

/** Level-up step 1: list what the level grants and the decisions the player must make. Small output. */
export const levelUpPlanPrompt = (currentJson: string, rules: string, targetLevel: number, classTarget = '') => `You are a D&D 5e rules assistant for the Actormaker companion app. The character below is going up to total character level ${targetLevel}.

Which class gains the level:
${classTarget.trim() || '- Their only class.'}

Search D&D Beyond (or the official SRD) for that class (and subclass) at its NEW class level, plus any multiclassing rules that apply. Do not rely on memory alone.
Use the hit die of the class gaining the level in "hitPoints.die".
Do NOT build the character. List what the new level grants and every decision the PLAYER must make, so they can choose.

Return ONLY this JSON object, no markdown fences, no commentary:
{
  "targetLevel": ${targetLevel},
  "hitPoints": { "die": "d10", "perLevelBonus": 0, "bonusNotes": "extra HP per level from feats/traits (e.g. Tough +2), else empty" },
  "automatic": [ { "name": "feature gained with no choice", "summary": "one or two sentences", "source": "book" } ],
  "choices": [
    {
      "title": "Learn a new rune",
      "kind": "rune | spell | cantrip | feat | asi | maneuver | fighting_style | subclass | other",
      "pick": 1,
      "current": [ { "name": "what the character already has for this kind of choice", "summary": "short" } ],
      "allowReplace": 0,
      "options": [ { "name": "Cloud Rune", "summary": "what it does, in one or two sentences", "source": "TCoE", "recommended": false } ],
      "notes": "rules for this choice in one sentence"
    }
  ],
  "notes": "anything the player should know"
}

Rules for the list:
- One entry in "choices" per decision the level grants (new spells, new cantrips, a new rune or maneuver, ASI or feat, etc.). Empty list if there are none.
- "pick" is how many options the player takes. "allowReplace" is how many existing entries the rules let them swap out at this level (0 if none).
- "current" lists what the character already has of that kind, taken from the sheet (including homebrew entries).
- "options" lists every legal option the character does not already have, within contentSources and constraints.allowedSources. Mark at most one or two "recommended": true for this build.
- For an ASI level, offer "+2 to one ability", "+1 to two abilities", and eligible feats as options with pick 1.

Actormaker rules:
${rules}

Current character JSON:
${currentJson}`;

/** Level-up step 2: build the sheet with the player's decisions. */
export const levelUpBuildPrompt = (currentJson: string, rules: string, targetLevel: number, playerDecisions = '', classTarget = '') => `You are a D&D 5e character builder assistant for the Actormaker companion app.

Apply the Actormaker rules below when leveling up the character. Return ONLY a valid JSON object — no markdown fences, no commentary.

Output format:
- Return only the top-level keys whose content changes (always include "derived" and "constraints"; usually "features", and "feats", "abilityScores", "spells", "combatActions", "proficiencies", "sources" when they change).
- Objects you return are merged field by field into the current sheet (you may send only the changed fields of "derived", for example).
- Lists you return (features, feats, spells lists, combatActions buckets, sources) REPLACE the current list, so write every entry, old and new.
- Omit top-level keys that do not change (identity, personality, appearance, cosmology, equipment, wealth, etc.). Omitted keys are kept as they are.

Requirements:
- Increase level to ${targetLevel} in derived.level and constraints.level.
- Update derived stats (HP, proficiency if applicable, attacks, saving throws, passive Perception, etc.).
- Add or update class/subclass features gained at the new level.
- Every feature MUST be an object with: id, name, source, rulesText (full ability text verbatim from rules), and uses when limited (max + per: short_rest | long_rest | day).
- Preserve identity, personality, equipment, and campaign-specific fields unless rules require changes.
- Equipment entries MUST be objects: name, quantity, weightLb (per PHB), optional notes. Include weightLb on consumables when carried.
- Do NOT include portrait prompts, portrait DNA, portraitLab fields, or any AI image generation metadata.
- Keep feats as objects when present; include rulesText for feats when updated.
- Append or update sources[] with topic, url, edition, and verifiedAt (today's date) for every rule you verify via search.
- If you have a web search tool, search D&D Beyond (or the official SRD) for new features, feats, and spells before writing rulesText. Without one, use the rules text you know and add a source entry for each so it can be checked.
- Respect contentSources and constraints.allowedSources from the current sheet.
- Record new runes in runes.known, spells in spells.known/prepared/cantrips, feats in feats[] and abilityScores.asiHistory, using the same naming style as the existing entries.
- Spell slots: spells.slots is an object of slot counts keyed "1".."9" (e.g. {"1": 4, "2": 3}), using the multiclass spellcaster table when the character has several casting classes. Warlock Pact Magic goes in spells.pactMagic as {"slots": 2, "level": 3}, not in spells.slots.

Which class gains the level:
${classTarget.trim() || '- Their only class.'}

The PLAYER made these decisions. Apply them exactly; do not substitute your own picks:
${playerDecisions.trim() || '- (none recorded: apply only what the level grants automatically)'}

Actormaker rules:
${rules}

Current character JSON:
${currentJson}`;

export const eventPrompt = (currentJson: string, rules: string, eventText: string) => `You are a D&D 5e table companion for the Actormaker app.

The player describes a tabletop event. Research official rules for the character's edition, then return ONLY a valid JSON object with the sheet changes — no markdown fences, no commentary outside JSON.

Event:
${eventText}

Output format:
- Return only the top-level keys that change. Omitted keys are kept as they are.
- Objects you return are merged field by field (e.g. send only "wealth": {"gold": 120}).
- Lists you return (equipment, consumables, magicItems, features, sources) REPLACE the current list, so write every entry, old and new.
- Coins live in wealth: platinum, gold, electrum, silver, copper (counts of coins). Gaining or spending money changes those counts.

Requirements:
- Respect edition, contentSources, and constraints.allowedSources on the current sheet.
- Apply mechanical interactions across the sheet (equipment, magicItems, features notes, derived.stealth, attacks, etc.).
- Example: Boots of Elvenkind (advantage on Stealth; typically ignore disadvantage from armor) worn with Half Plate must update derived.stealth / notes so the sheet reflects the interaction for that edition.
- Always write the final derived.stealth string the player should see on the combat sheet (e.g. "advantage (Boots of Elvenkind; armor disadvantage ignored)" — do not leave the old disadvantage-only line).
- Do not return identity, personality, or other unrelated sections.
- Equipment entries MUST be objects: name, quantity, weightLb, optional notes.
- Magic items: name, attunement, notes, weightLb when known.
- Append sources[] with topic, url, edition, verifiedAt (today) for rules you verify.
- Do NOT include portrait prompts or image-generation metadata.
- Search D&D Beyond / official SRD when web search is available — do not invent magic item text.

Also include a top-level field "_changeSummary" as an array of short human-readable bullets describing what changed. The companion will strip this field before saving.

Actormaker rules:
${rules}

Current character JSON:
${currentJson}`;

export const researchPrompt = (rules: string, question: string, edition: string | null | undefined, characterContext: string | null) => `You are a D&D 5e rules research assistant for the Actormaker companion.
Answer the player's question. Do NOT modify any character sheet.

Return ONLY valid JSON of the form:
{"answer":"...","sources":[{"topic":"...","url":"...","edition":"...","verifiedAt":"YYYY-MM-DD"}]}

Edition context: ${edition ?? 'unknown'}
${characterContext?.trim() ? `Character context (read-only):\n${characterContext}\n` : ''}
Question:
${question}

Prefer official D&D Beyond / SRD links for the matching edition. Use Actormaker rules for workflow context only:
${rules}`;

export const importPrompt = (rules: string, edition: string | null | undefined, playerNotes: string, extraText: string) => `You are a D&D 5e character builder for the Actormaker companion app. The player attached their character sheet
(photos of a paper sheet, a PDF, a screenshot, or text). Read every page and rebuild the character as JSON.

Return ONLY one JSON object, no markdown fences, no commentary.

How to read it:
- Copy what the sheet says: name, class(es) and levels, subclass, species/race, background, ability scores,
  proficiencies, skills with their modifiers, saving throws, HP, AC, speed, initiative, attacks, spells, equipment, coins,
  features and traits, personality.
- Skills: "proficiencies.skills" lists ONLY the skills the character is proficient in (filled bubble or marked),
  each with its total modifier; put "expertise" in notes when doubled. Leave every other skill out; the app works those out.
- Handwriting can be hard to read. When a number is unclear, compute it from the rules (ability modifier, proficiency
  bonus by level) instead of guessing, and add a line about it to "importNotes".
- Fill "rulesText" for every feature with the full rules text. Use the text on the sheet when it is there; otherwise
  write it from the rules for this edition (search D&D Beyond or the SRD if you have a search tool and are unsure).
- Build "combatActions" from the features and attacks: put each option in the bucket for what it costs.
- Leave out anything the sheet doesn't support. Never invent magic items, feats, or spells that aren't on the sheet.
- Edition: ${edition?.trim() || 'decide from the sheet (2024 sheets list Species and Weapon Mastery; 2014 sheets list Race); write it in "edition"'}.

JSON shape (use these exact keys; omit empty ones):
{
  "ruleset": "dnd5e",
  "edition": "2014 or 2024",
  "status": "imported",
  "identity": { "name": "", "race": "", "species": "", "class": "Main class", "subclass": "", "background": "", "alignment": "" },
  "classes": [ { "name": "Fighter", "subclass": "Champion", "level": 5, "hitDie": "d10" } ],
  "abilityScores": { "final": { "STR": 10, "DEX": 10, "CON": 10, "INT": 10, "WIS": 10, "CHA": 10 } },
  "proficiencies": {
    "skills": [ { "name": "Athletics", "modifier": 5, "notes": "expertise, if any" } ],
    "savingThrows": ["STR", "CON"], "armor": [], "weapons": [], "tools": [], "languages": []
  },
  "feats": [ { "name": "", "source": "", "rulesText": "" } ],
  "features": [ { "id": "snake_case_id", "name": "", "source": "class / species / background", "rulesText": "", "uses": { "max": 1, "per": "short_rest | long_rest | day" } } ],
  "combatActions": {
    "movement": [], "action": [], "bonus": [], "reaction": [], "freeOrSpecial": [], "onHitOrTrigger": [
      { "id": "snake_case_id", "name": "", "summary": "one line: what it does", "featureId": "matching feature id or omit" } ]
  },
  "spells": { "ability": "INT", "cantrips": [], "prepared": [], "known": [], "slots": { "1": 4, "2": 2 }, "pactMagic": { "slots": 2, "level": 3 } },
  "derived": {
    "level": 5, "proficiencyBonus": 3, "hitPoints": { "total": 44 }, "hitDice": "5d10", "armorClass": 16, "speed": 30,
    "initiative": 2, "passivePerception": 13,
    "attacks": [ { "name": "Longsword", "bonus": 6, "damage": "1d8+3 slashing", "reach": 5, "range": "80/320 (ranged weapons only)", "notes": "" } ],
    "savingThrows": { "STR": 6, "DEX": 2, "CON": 5, "INT": 0, "WIS": 1, "CHA": -1 }
  },
  "equipment": [ { "name": "", "quantity": 1, "weightLb": 3, "notes": "" } ],
  "consumables": [ { "name": "Potion of Healing", "quantity": 2, "weightLb": 0.5 } ],
  "magicItems": [ { "name": "", "rarity": "", "notes": "attunement etc." } ],
  "wealth": { "platinum": 0, "gold": 0, "electrum": 0, "silver": 0, "copper": 0 },
  "personality": { "traits": [], "ideals": [], "bonds": [], "flaws": [], "notes": "" },
  "importNotes": [ "anything unclear or computed instead of read" ]
}
Use "pactMagic" only for Warlock Pact Magic. "classes" lists every class for a multiclass character.

${playerNotes.trim() ? `Player's notes:\n${playerNotes.trim()}\n` : ''}
${extraText.trim() ? `Sheet text:\n${extraText.trim()}\n` : ''}
Actormaker rules:
${rules}`;
