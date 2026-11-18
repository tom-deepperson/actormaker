// Spec: archive/android/app/src/test/.../ai/LevelUpPlanTest.kt, LevelUpRobustnessTest.kt, SheetChangeSummaryTest.kt
// and the import cases of data/BoardsAndDiceTest.kt.
import { describe, expect, it } from 'vitest';
import { level, maxHp, normalizedForSave, parseSheet } from '../src/data/model';
import { abilityModifier } from '../src/data/model';
import { SKILLS } from '../src/data/exploreBoard';
import { afterLevelUp, normalizeTracker } from '../src/data/tracker';
import {
  anthropicBody, anthropicUserContent, anthropicWebSearchType, extractAnthropicText, extractGeminiText, extractOpenAiText,
  geminiBody, isAnthropicTruncated, isGeminiTruncated, isOpenAiTruncated, openAiBody, parseAnthropicModels, parseGeminiModels,
  parseOpenAiModels,
} from '../src/ai/client';
import { extractJson, levelUpBuildPrompt } from '../src/ai/prompts';
import { blockingProblem, compareSheets, extractChangeSummary, levelUpWarnings, overlayTopLevel, sheetFrom, stripChangeSummary } from '../src/ai/sheetMerge';
import {
  choiceWarnings, decisionsText, hpGain, isComplete, parsePlan, requiredPicks, resolvePlan, sameThing, togglePick, toggleSwap,
} from '../src/ai/levelUp';
import { parseImportReply } from '../src/ai/importSheet';
import { directSheet } from '../src/ai/scanLoader';
import { fixture, sheet } from './helpers';

const sampleText = fixture('sample-level9.json');
const sample = parseSheet(sampleText);
const sampleJson = () => normalizedForSave(parseSheet(sampleText)) as Record<string, unknown>;

// Shaped like a real reply: fenced, a null field, the AI repeating runes the character already has.
const reply = `
\`\`\`json
{
  "targetLevel": 10,
  "hitPoints": {"die": "d10", "perLevelBonus": 2, "bonusNotes": "Tough +2"},
  "automatic": [{"name": "Rune Carver improvement", "summary": "You learn an additional rune."}],
  "choices": [{
    "title": "Learn a new rune",
    "kind": "rune",
    "pick": 1,
    "current": [{"name": "Fire Rune", "summary": "Doubles tool proficiency; fiery shackles."}],
    "allowReplace": null,
    "options": [
      {"name": "Fire Rune", "summary": "already known"},
      {"name": "Cloud Rune", "summary": "Redirect an attack.", "source": "TCoE", "recommended": true},
      {"name": "Stone Rune", "summary": "Charm a creature.", "source": "TCoE"},
      {"name": "Storm Rune", "summary": "Prophetic state.", "source": "TCoE"}
    ]
  }],
  "notes": null
}
\`\`\``;

describe('level-up plan', () => {
  it('parses and compares against the sheet', () => {
    const plan = resolvePlan(parsePlan(reply), sample);
    const choice = plan.choices[0];
    expect(plan.choices).toHaveLength(1);
    // "You have" comes from the sheet, so a homebrew rune shows even though the AI left it out.
    expect(choice.current.map((c) => c.name)).toEqual(sample.runes!.known);
    expect(choice.current[0].summary).toContain('fiery shackles');
    // "Fire Rune" is the same as the sheet's "Fire": dropped from the options.
    expect(choice.options.map((o) => o.name)).toEqual(['Cloud Rune', 'Stone Rune', 'Storm Rune']);
    expect(choice.allowReplace).toBe(0);
  });

  it('matches names', () => {
    expect(sameThing('Fire', 'Fire Rune')).toBe(true);
    expect(sameThing('Polearm Master (PHB)', 'polearm master')).toBe(true);
    expect(sameThing('Fire', "Fire Giant's Might")).toBe(false);
    expect(sameThing('Hill', 'Hillside Rune')).toBe(false);
  });

  it('computes hit points', () => {
    const plan = parsePlan(reply);
    const avg = hpGain(sample, plan, 'average', null);
    expect(avg.dieSize).toBe(10);
    expect(avg.average).toBe(6);
    expect(avg.total).toBe(6 + avg.conMod + 2);
    expect(hpGain(sample, plan, 'rolled', 7).total).toBe(7 + avg.conMod + 2);
    expect(hpGain(sample, plan, 'rolled', 99).base).toBe(10); // clamped to the die
    expect(hpGain({ ...sample, abilityScores: null }, null, 'rolled', 1).total).toBe(1);
  });

  it('swaps add picks and completeness follows', () => {
    const choice = {
      title: 'Spells', kind: 'spell', pick: 2, allowReplace: 1,
      current: [{ name: 'Shield', summary: '' }, { name: 'Sleep', summary: '' }],
      options: [1, 2, 3, 4, 5].map((i) => ({ name: `Spell ${i}`, summary: '' })),
    };
    const plan = { targetLevel: 2, hitPoints: { perLevelBonus: 0 }, automatic: [], choices: [choice] };
    expect(requiredPicks(choice, 1)).toBe(3);
    expect(isComplete(plan, { 0: [0, 1] }, { 0: [1] })).toBe(false);
    expect(isComplete(plan, { 0: [0, 1, 2] }, { 0: [1] })).toBe(true);
    // Dropping the swap trims the extra pick.
    const back = toggleSwap(plan, { 0: [0, 1, 2] }, { 0: [1] }, 0, 1);
    expect(back.picks[0]).toEqual([0, 1]);
    // A single pick acts like a radio button.
    const single = { ...plan, choices: [{ ...choice, pick: 1, allowReplace: 0 }] };
    expect(togglePick(single, { 0: [0] }, {}, 0, 3)[0]).toEqual([3]);
  });

  it('decisions text carries picks, swaps, HP and notes', () => {
    const plan = resolvePlan(parsePlan(reply), sample);
    const hp = hpGain(sample, plan, 'rolled', 7);
    const text = decisionsText(plan, { 0: [0] }, {}, maxHp(sample) + hp.total, hp, 'rolled', 'Inscribe it on the boots.');
    expect(text).toContain(`derived.hitPoints.total to ${maxHp(sample) + hp.total}`);
    expect(text).toContain('rolled 7 on d10');
    expect(text).toContain('Learn a new rune: take Cloud Rune.');
    expect(text).toContain('Inscribe it on the boots.');
    expect(levelUpBuildPrompt('{}', 'rules', 10, text)).toContain('take Cloud Rune');
  });

  it('warns when the pick is missing or the swap stayed', () => {
    const honored = { ...sample, runes: { ...sample.runes, known: [...(sample.runes?.known ?? []), 'Cloud'] } };
    expect(choiceWarnings(honored, ['Cloud Rune'], [])).toEqual([]);
    expect(choiceWarnings(sample, ['Cloud Rune'], [])).toHaveLength(1);
    expect(choiceWarnings(honored, [], [['rune', 'Hill']])).toHaveLength(1);
    expect(choiceWarnings(sample, ['+2 to one ability'], [])).toEqual([]);
  });
});

describe('level-up robustness', () => {
  it('a truncated full sheet fails to parse', () => {
    const cut = extractJson(sampleText.slice(0, Math.floor((sampleText.length * 2) / 3)));
    expect(() => overlayTopLevel(sampleJson(), cut)).toThrow();
  });

  it('detects truncation per provider', () => {
    expect(isAnthropicTruncated('{"stop_reason":"max_tokens","content":[]}')).toBe(true);
    expect(isAnthropicTruncated('{"stop_reason":"end_turn","content":[]}')).toBe(false);
    expect(isGeminiTruncated('{"candidates":[{"finishReason":"MAX_TOKENS"}]}')).toBe(true);
    expect(isGeminiTruncated('{"candidates":[{"finishReason":"STOP"}]}')).toBe(false);
    expect(isOpenAiTruncated('{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}')).toBe(true);
    expect(isOpenAiTruncated('{"status":"completed"}')).toBe(false);
    expect(isAnthropicTruncated('not json')).toBe(false);
  });

  it('a partial response keeps omitted sections', () => {
    const partial = JSON.stringify({ derived: { level: level(sample) + 1, hitPoints: { total: maxHp(sample) + 9 } }, constraints: { level: level(sample) + 1 } });
    const merged = sheetFrom(overlayTopLevel(sampleJson(), partial));
    expect(level(merged)).toBe(level(sample) + 1);
    expect(merged.identity).toEqual(sample.identity);
    expect(merged.equipment).toEqual(sample.equipment);
    expect(merged.features).toEqual(sample.features);
    expect(merged.cosmology).toEqual(sample.cosmology);
    expect(sample.derived?.armorClass).not.toBeUndefined();
    expect(merged.derived?.armorClass).toBe(sample.derived?.armorClass);
    expect(merged.derived?.speed).toBe(sample.derived?.speed);
    expect(merged.derived?.hitPoints?.formula).toBe(sample.derived?.hitPoints?.formula);
    expect(blockingProblem(sample, merged, level(sample) + 1)).toBeNull();
  });

  it('null for a list or map falls back to empty', () => {
    const r = JSON.stringify({ derived: { level: 10, level10Preview: null, savingThrows: null }, constraints: { level: 10, houseRules: null }, contentSources: null, spells: { slots: null } });
    const merged = sheetFrom(overlayTopLevel({ ...sampleJson(), contentSources: ['PHB'] }, r));
    expect(level(merged)).toBe(10);
    expect(merged.derived!.level10Preview).toEqual({});
    expect(merged.derived!.savingThrows).toEqual({});
    expect(merged.contentSources).toEqual([]);
    expect(merged.derived?.armorClass).toBe(sample.derived?.armorClass);
  });

  it('blocks the wrong level and warns on lost items', () => {
    const current = sheet({
      identity: { name: 'Mira' },
      derived: { level: 9, proficiencyBonus: 4, hitPoints: { total: 80 } },
      equipment: [{ name: 'Rope', quantity: 1 }, { name: 'Torch', quantity: 1 }],
    });
    const sameLevel = { ...current, equipment: [] };
    expect(blockingProblem(current, sameLevel, 10)).not.toBeNull();
    const leveled = { ...sameLevel, derived: { level: 10, proficiencyBonus: 4, hitPoints: { total: 89 } } };
    expect(blockingProblem(current, leveled, 10)).toBeNull();
    expect(levelUpWarnings(current, leveled).some((w) => w.startsWith('Equipment'))).toBe(true);
    expect(blockingProblem(current, { ...leveled, identity: { name: 'Someone' } }, 10)).toContain('name');
  });

  it('the tracker keeps damage and spent uses across a level-up', () => {
    const before = sheet({
      derived: { level: 9, proficiencyBonus: 4, hitPoints: { total: 80 } },
      features: [{ id: 'second-wind', name: 'Second Wind', uses: { max: 1, per: 'short_rest' }, rulesText: 'x' }],
    });
    const after = {
      ...before,
      derived: { level: 10, proficiencyBonus: 4, hitPoints: { total: 89 } },
      features: [...before.features, { id: 'indomitable', name: 'Indomitable', uses: { max: 2, per: 'long_rest' }, rulesText: 'y' }],
    };
    const t = normalizeTracker({ slug: 't', currentHp: 50, maxHp: 80, hitDiceRemaining: 3, hitDiceTotal: 9, featureUses: { 'second-wind': 0 } });
    const u = afterLevelUp(t, before, after);
    expect(u.maxHp).toBe(89);
    expect(u.currentHp).toBe(59);
    expect(u.hitDiceTotal).toBe(10);
    expect(u.hitDiceRemaining).toBe(4);
    expect(u.featureUses['second-wind']).toBe(0);
    expect(u.featureUses.indomitable).toBe(2);
  });
});

describe('change summary', () => {
  it('detects boots and the stealth change', () => {
    const before = sheet({ equipment: [{ name: 'Half Plate', quantity: 1, weightLb: 40 }], derived: { level: 1, proficiencyBonus: 2, stealth: 'Disadvantage (armor)' } });
    const after = sheet({
      equipment: [{ name: 'Half Plate', quantity: 1, weightLb: 40 }],
      magicItems: [{ name: 'Boots of Elvenkind' }],
      derived: { level: 1, proficiencyBonus: 2, stealth: 'Advantage (Boots of Elvenkind; ignore armor disadvantage)' },
    });
    const s = compareSheets(before, after);
    expect(s.some((l) => /boots of elvenkind/i.test(l))).toBe(true);
    expect(s.some((l) => /stealth/i.test(l))).toBe(true);
  });

  it('extracts and strips the change summary', () => {
    const raw = '{"_changeSummary": ["Added Boots of Elvenkind", "Updated stealth"], "edition": "2014", "identity": {"name": "Test"}}';
    expect(extractChangeSummary(raw)).toEqual(['Added Boots of Elvenkind', 'Updated stealth']);
    const stripped = stripChangeSummary(raw);
    expect(stripped).not.toContain('_changeSummary');
    expect(stripped).toContain('2014');
  });

  it('extracts fenced JSON', () => {
    expect(extractJson('Sure!\n```json\n{"answer":"ok","sources":[]}\n```')).toContain('"answer"');
  });
});

describe('provider requests', () => {
  const photo = { mimeType: 'image/jpeg', base64: 'AAA', fileName: 'p1.jpg' };
  const pdf = { mimeType: 'application/pdf', base64: 'BBB', fileName: 'sheet.pdf' };

  it('gemini: inline data first, search tool', () => {
    const b = geminiBody('read it', true, [photo, pdf]) as any;
    expect(b.contents[0].parts).toEqual([
      { inline_data: { mime_type: 'image/jpeg', data: 'AAA' } },
      { inline_data: { mime_type: 'application/pdf', data: 'BBB' } },
      { text: 'read it' },
    ]);
    expect(b.tools).toEqual([{ google_search: {} }]);
    expect((geminiBody('x', false) as any).tools).toBeUndefined();
  });

  it('openai: input_image and input_file data URLs', () => {
    const b = openAiBody('gpt-4.1-mini', 'read it', true, [photo, pdf]) as any;
    expect(b.model).toBe('gpt-4.1-mini');
    expect(b.input[0].content).toEqual([
      { type: 'input_image', image_url: 'data:image/jpeg;base64,AAA' },
      { type: 'input_file', filename: 'sheet.pdf', file_data: 'data:application/pdf;base64,BBB' },
      { type: 'input_text', text: 'read it' },
    ]);
    expect(b.tools).toEqual([{ type: 'web_search' }]);
  });

  it('anthropic: blocks before the text, search tool by model, token cap', () => {
    const content = anthropicUserContent('read it', [photo, pdf]) as any[];
    expect(content.map((c) => c.type)).toEqual(['image', 'document', 'text']);
    expect(content[1].source).toEqual({ type: 'base64', media_type: 'application/pdf', data: 'BBB' });
    const b = anthropicBody('claude-opus-5-5', [{ role: 'user', content }], true) as any;
    expect(b.max_tokens).toBe(32000);
    expect(b.tools[0]).toEqual({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
  });

  it('anthropic search tool version by model', () => {
    expect(anthropicWebSearchType('claude-haiku-4-5-20251001')).toBe('web_search_20250305');
    expect(anthropicWebSearchType('claude-haiku-5-5')).toBe('web_search_20250305');
    expect(anthropicWebSearchType('claude-opus-5-5')).toBe('web_search_20260209');
    expect(anthropicWebSearchType('claude-sonnet-4-6')).toBe('web_search_20260209');
    expect(anthropicWebSearchType('something-new')).toBe('web_search_20250305');
  });

  it('reads the text out of each response', () => {
    expect(extractGeminiText('{"candidates":[{"content":{"parts":[{"text":"thinking","thought":true},{"text":"{\\"a\\""},{"text":":1}"}]}}]}')).toBe('{"a":1}');
    expect(extractOpenAiText('{"output":[{"type":"web_search_call"},{"content":[{"type":"output_text","text":"hi"}]}]}')).toBe('hi');
    expect(extractOpenAiText('{"output_text":"direct"}')).toBe('direct');
    expect(extractAnthropicText(JSON.stringify({
      content: [{ type: 'text', text: 'Let me search.' }, { type: 'server_tool_use' }, { type: 'web_search_tool_result' }, { type: 'text', text: '{"answer":' }, { type: 'text', text: '"x"}' }],
    }))).toBe('{"answer":"x"}');
  });
});

describe('sheet import', () => {
  it('folds notes and sums class levels', () => {
    const raw = `Here you go:
\`\`\`json
{"identity":{"name":"Brin","characterClass":"Wizard"},
 "classes":[{"name":"Wizard","level":3,"hitDie":"d6"},{"name":"Cleric","level":1,"hitDie":"d8"}],
 "abilityScores":{"final":{"INT":16}},
 "derived":{"level":1,"hitPoints":{"total":22}},
 "importNotes":["AC was smudged; computed 12"]}
\`\`\``;
    const s = parseImportReply(raw);
    expect(s.identity?.name).toBe('Brin');
    expect(s.identity?.class).toBe('Wizard');
    expect(level(s)).toBe(4);
    expect(s.constraints?.level).toBe(4);
    expect(s.status).toBe('imported');
    expect(s.personality?.notes).toContain('AC was smudged');
    expect('importNotes' in s).toBe(false);
    expect(() => parseImportReply('{"wealth":{"gold":3}}')).toThrow();
  });

  it('keeps only proficient skills', () => {
    // A paper sheet lists all 18 skills; only Athletics, Perception and Stealth have the +3 proficiency bonus.
    const scores: Record<string, number> = { STR: 16, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 8 };
    const proficient = new Set(['Athletics', 'Perception', 'Stealth']);
    const skills = SKILLS.map(([name, ab]) => ({ name, modifier: abilityModifier(scores[ab]) + (proficient.has(name) ? 3 : 0) }));
    const s = parseImportReply(JSON.stringify({ identity: { name: 'Kai', class: 'Rogue' }, abilityScores: { final: scores }, proficiencies: { skills } }));
    expect(new Set(s.proficiencies!.skills!.map((x) => x.name))).toEqual(proficient);
  });

  it('imports a real character.json directly', () => {
    expect(directSheet(sampleText)).not.toBeNull();
    expect(directSheet('{"name":"not a sheet"}')).toBeNull();
    expect(directSheet('STR 16 DEX 12')).toBeNull();
  });
});

describe('model lists', () => {
  it('gemini keeps generateContent models, newest version first', () => {
    const body = JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-10-pro', displayName: 'Gemini 10 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
    ] });
    expect(parseGeminiModels(body).map((m) => m.id)).toEqual(['gemini-10-pro', 'gemini-3.5-flash', 'gemini-2.5-flash']);
    expect(parseGeminiModels(body)[1].label).toBe('Gemini 3.5 Flash');
  });

  it('openai keeps chat models, newest first', () => {
    const body = JSON.stringify({ data: [
      { id: 'gpt-4.1-mini', created: 100 }, { id: 'text-embedding-3-small', created: 300 }, { id: 'tts-1', created: 300 },
      { id: 'whisper-1', created: 300 }, { id: 'dall-e-3', created: 300 }, { id: 'gpt-image-1', created: 300 },
      { id: 'omni-moderation-latest', created: 300 }, { id: 'gpt-4o-realtime-preview', created: 300 }, { id: 'gpt-4o-mini-tts', created: 300 },
      { id: 'o3', created: 200 }, { id: 'gpt-5', created: 250 }, { id: 'davinci-002', created: 50 },
    ] });
    expect(parseOpenAiModels(body).map((m) => m.id)).toEqual(['gpt-5', 'o3', 'gpt-4.1-mini']);
  });

  it('anthropic sorts by release date', () => {
    const body = JSON.stringify({ data: [
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
      { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
    ] });
    expect(parseAnthropicModels(body)).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ]);
    expect(parseAnthropicModels('not json')).toEqual([]);
  });
});
