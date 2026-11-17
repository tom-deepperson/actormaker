/** The AI flows: level-up (plan, then build), table events, research and sheet import. Port of AiAssistantClient.kt. */
import { type CharacterSheet, type SourceRef, level, normalizedForSave } from '../data/model';
import { classSummary } from '../data/classes';
import { getSetting, setSetting } from '../data/db';
import { type AiAttachment, type AiSettings, DEFAULT_AI_SETTINGS, callModel } from './client';
import { eventPrompt, extractJson, importPrompt, levelUpBuildPrompt, levelUpPlanPrompt, researchPrompt, rulesForEdition } from './prompts';
import { compareSheets, extractChangeSummary, overlayTopLevel, sheetFrom, stripChangeSummary } from './sheetMerge';
import { type LevelUpPlan, parsePlan, resolvePlan } from './levelUp';
import { parseImportReply } from './importSheet';

/** Keys live only in this device's IndexedDB settings store, which backups and exports never include. */
export async function loadAiSettings(): Promise<AiSettings> {
  return { ...DEFAULT_AI_SETTINGS, ...((await getSetting<Partial<AiSettings>>('ai')) ?? {}) };
}
export const saveAiSettings = (s: AiSettings) => setSetting('ai', s);

const sheetJson = (sheet: CharacterSheet) => JSON.stringify(normalizedForSave(sheet), null, 2);

export async function proposeLevelUpPlan(settings: AiSettings, sheet: CharacterSheet, targetLevel: number, classTarget: string, signal?: AbortSignal): Promise<LevelUpPlan> {
  const prompt = levelUpPlanPrompt(sheetJson(sheet), rulesForEdition(sheet.edition), targetLevel, classTarget);
  const raw = await callModel(settings, prompt, { webSearch: true, signal });
  try {
    return resolvePlan(parsePlan(raw), sheet);
  } catch (e) {
    throw new Error(`Could not read the level-up options: ${(e as Error).message}`);
  }
}

/** Level-up step 2. Top-level keys the model left out keep their current values. */
export async function proposeLevelUp(settings: AiSettings, sheet: CharacterSheet, targetLevel: number, decisions: string, classTarget: string, signal?: AbortSignal): Promise<CharacterSheet> {
  const current = normalizedForSave(sheet);
  const prompt = levelUpBuildPrompt(JSON.stringify(current, null, 2), rulesForEdition(sheet.edition), targetLevel, decisions, classTarget);
  const raw = await callModel(settings, prompt, { webSearch: true, signal });
  try {
    return sheetFrom(overlayTopLevel(current as Record<string, unknown>, extractJson(raw)));
  } catch (e) {
    throw new Error(`Could not parse level-up JSON: ${(e as Error).message}`);
  }
}

export interface EventProposal { sheet: CharacterSheet; summary: string[] }

export async function proposeEvent(settings: AiSettings, sheet: CharacterSheet, eventText: string, signal?: AbortSignal): Promise<EventProposal> {
  const current = normalizedForSave(sheet);
  const raw = await callModel(settings, eventPrompt(JSON.stringify(current, null, 2), rulesForEdition(sheet.edition), eventText), { signal });
  const fromModel = extractChangeSummary(raw);
  let proposed: CharacterSheet;
  try {
    // Merge onto the current sheet: anything the AI left out stays as it was.
    proposed = sheetFrom(overlayTopLevel(current as Record<string, unknown>, extractJson(stripChangeSummary(raw))));
  } catch (e) {
    throw new Error(`Could not parse event JSON: ${(e as Error).message}`);
  }
  return { sheet: proposed, summary: fromModel.length ? fromModel : compareSheets(sheet, proposed) };
}

export interface ResearchAnswer { answer: string; sources: SourceRef[] }

export async function research(settings: AiSettings, sheet: CharacterSheet | null, question: string, signal?: AbortSignal): Promise<ResearchAnswer> {
  // Only what the question needs, and the public name: the full sheet stays on the device.
  const context = sheet
    ? [
        `Name: ${sheet.identity?.cultAlias || sheet.identity?.name || ''}`,
        `Level: ${level(sheet)} Class: ${classSummary(sheet) || sheet.identity?.class || ''}`,
        `Edition: ${sheet.edition ?? ''}`,
        sheet.derived?.stealth ? `Stealth: ${sheet.derived.stealth}` : '',
      ].filter(Boolean).join('\n')
    : null;
  const raw = await callModel(settings, researchPrompt(rulesForEdition(sheet?.edition), question, sheet?.edition, context), { signal });
  try {
    const obj = JSON.parse(extractJson(raw));
    const answer = typeof obj?.answer === 'string' ? obj.answer.trim() : '';
    if (!answer) throw new Error('Missing answer');
    const sources: SourceRef[] = (Array.isArray(obj.sources) ? obj.sources : [])
      .filter((x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x: Record<string, unknown>) => ({
        topic: typeof x.topic === 'string' && x.topic.trim() ? x.topic : 'Source',
        url: typeof x.url === 'string' ? x.url : '',
        edition: typeof x.edition === 'string' && x.edition ? x.edition : null,
        verifiedAt: typeof x.verifiedAt === 'string' && x.verifiedAt ? x.verifiedAt : null,
      }));
    return { answer, sources };
  } catch {
    // Fallback: treat the whole text as the answer.
    return { answer: raw.trim(), sources: [] };
  }
}

/** Read a character sheet from photos, a PDF, or pasted text and build a full sheet. */
export async function importCharacter(settings: AiSettings, attachments: AiAttachment[], extraText: string, edition: string | null, playerNotes: string, signal?: AbortSignal): Promise<CharacterSheet> {
  const raw = await callModel(settings, importPrompt(rulesForEdition(edition), edition, playerNotes, extraText), { attachments, signal });
  return parseImportReply(raw);
}

/** Only http(s) links from a model reply are opened. */
export const safeUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
};
