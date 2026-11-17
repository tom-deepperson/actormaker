// Spec: android/app/src/test/.../data/{Equipment,Feature}*SerializerTest.kt, *ParseTest.kt,
// CombatSessionLogicTest.kt, DmHandoffExporterTest.kt and ui/SheetViewContextTest.kt
import { describe, expect, it } from 'vitest';
import {
  actionBuckets, cosmologyBelief, cosmologyOrigin, equipmentLabel, lineWeightLb, normalizedForSave, parseEquipmentLocation, parseSheet,
  resolvedEquipmentLocations,
} from '../src/data/model';
import { advanceTurn, autoEnterEffects, createEffect, EndsOn, enterCombat, exitCombat } from '../src/data/combat';
import { summarize } from '../src/data/encumbrance';
import { buildHandoff, handoffFileName } from '../src/data/handoff';
import { normalizeTracker, trackerFromCharacter } from '../src/data/tracker';
import {
  canShowSecretBackstory, defaultViewContext, redactForView, sheetTitle, shouldHideSecretIdentity, visibleSoundBites,
} from '../src/data/viewContext';
import { fixture, sheet } from './helpers';

describe('parsing', () => {
  it('legacy equipment strings', () => {
    const s = parseSheet({ ruleset: 'dnd5e', equipment: ['Tent (two-person) — 20 lb', 'Javelins (×4)'] });
    expect(s.equipment[0]).toMatchObject({ name: 'Tent (two-person)', weightLb: 20 });
    expect(lineWeightLb(s.equipment[0])).toBe(20);
    expect(s.equipment[1]).toMatchObject({ name: 'Javelins', quantity: 4, weightLb: null });
  });

  it('rich equipment objects and labels', () => {
    const s = parseSheet({ equipment: [{ name: '+1 Halberd', quantity: '1', weightLb: 6, notes: 'Fire rune inscribed' }] });
    expect(s.equipment[0]).toMatchObject({ weightLb: 6, quantity: 1, notes: 'Fire rune inscribed' });
    expect(equipmentLabel({ name: 'Backpack', quantity: 1, weightLb: 5 })).toBe('Backpack — 5 lb');
  });

  it('legacy and rich features', () => {
    const legacy = parseSheet({ features: ['Second Wind (1/short rest)', 'Action Surge (1/short rest)'] });
    expect(legacy.features).toHaveLength(2);
    expect(legacy.features[0].id).toBe('second_wind');
    expect(legacy.features[0].rulesText).toContain('Second Wind');
    const rich = parseSheet({ features: [{ id: 'second_wind', name: 'Second Wind', uses: { max: '1', per: 'short_rest' }, rulesText: 'r' }] });
    expect(rich.features[0].uses).toEqual({ max: 1, per: 'short_rest' });
  });

  it('locations accept items and legacy stash', () => {
    const loc = parseEquipmentLocation({ location: 'Cult safehouse', notes: 'Stashed', items: ['Staff (Outlander)', 'Javelins (×4) — 8 lb'] });
    expect(loc.equipment.map((e) => e.name)).toEqual(['Staff (Outlander)', 'Javelins']);
    expect(loc.equipment[1]).toMatchObject({ quantity: 4, weightLb: 8 });
    expect('items' in loc).toBe(false);
    const s = parseSheet({ edition: '2014', equipmentStash: { location: 'Wagon', items: ['Bedroll — 7 lb'] } });
    expect(resolvedEquipmentLocations(s)[0].equipment[0]).toMatchObject({ name: 'Bedroll', weightLb: 7 });
    const saved = normalizedForSave(s);
    expect(saved.equipmentLocations).toHaveLength(1);
    expect(saved.equipmentStash).toBeNull();
  });

  it.each(['sample-level9.json', 'sample-stash.json', 'sample-current.json'])('parses %s and survives a round trip', (name) => {
    const s = parseSheet(fixture(name));
    expect(s.identity?.name).toBeTruthy();
    expect(s.features.length).toBeGreaterThan(0);
    expect(s.features.every((f) => f.rulesText.trim().length > 0)).toBe(true);
    const again = parseSheet(JSON.stringify(normalizedForSave(s)));
    expect(again.features).toEqual(s.features);
    expect(again.identity).toEqual(s.identity);
    expect(summarize(again).status).toBe('normal');
  });

  it('keeps unknown keys', () => {
    const s = parseSheet({ ruleset: 'dnd5e', appearance: { portraitDna: { primary: 'x' } }, futureField: 3 });
    expect(JSON.parse(JSON.stringify(s)).futureField).toBe(3);
    expect(s.appearance).toEqual({ portraitDna: { primary: 'x' } });
  });
});

describe('combat session', () => {
  const active = (effects = [] as ReturnType<typeof createEffect>[]) => ({ ...enterCombat('hero', null), effects });

  it('advance resets economy and increments round', () => {
    const s = { ...active(), round: 2, actionUsed: true, bonusUsed: true, reactionUsed: true, movementUsed: true };
    const n = advanceTurn(s);
    expect(n.round).toBe(3);
    expect([n.actionUsed, n.bonusUsed, n.reactionUsed, n.movementUsed]).toEqual([false, false, false, false]);
  });

  it('ticks and expires end-of-turn effects', () => {
    const rage = createEffect({ name: 'Rage', kind: 'buff', roundsRemaining: 2 });
    expect(advanceTurn(active([rage])).effects[0].roundsRemaining).toBe(1);
    const reckless = createEffect({ name: 'Reckless', kind: 'buff', roundsRemaining: 1 });
    expect(advanceTurn(active([reckless])).effects).toEqual([]);
  });

  it('permanent effects survive exit with clear timed', () => {
    const s = active([
      createEffect({ name: 'Bless', kind: 'buff', roundsRemaining: 5 }),
      createEffect({ name: 'Exhaustion', kind: 'debuff', roundsRemaining: null, endsOn: EndsOn.PERMANENT }),
    ]);
    const out = exitCombat(s, true);
    expect(out.active).toBe(false);
    expect(out.effects.map((e) => e.name)).toEqual(['Exhaustion']);
  });

  it('enter merges kit effects; a Rune Knight gets Giant\'s Might', () => {
    const kit = createEffect({ name: "Giant's Might", kind: 'buff', source: 'kit', roundsRemaining: 10 });
    const s = enterCombat('hero', null, [kit]);
    expect(s.active).toBe(true);
    expect(s.round).toBe(1);
    expect(s.effects.map((e) => e.name)).toEqual(["Giant's Might"]);
    const sample = parseSheet(fixture('sample-current.json'));
    expect(autoEnterEffects(sample).map((e) => e.name)).toEqual(["Giant's Might"]);
  });
});

describe('view context', () => {
  const id = { name: 'Mira', cultAlias: 'Corvin', class: 'Fighter' };
  const bites = [
    { id: 'pub', tier: 'public', prompt: 'Where?', answer: 'North.' },
    { id: 'sec', tier: 'secret', prompt: 'Why?', answer: 'Retribution.' },
  ];
  const alias = defaultViewContext;
  const primary = { displayNameChoice: 'primary' as const, playerSafeMode: false };
  const safe = { displayNameChoice: 'primary' as const, playerSafeMode: true };

  it('hides secrets for the alias and in player-safe mode', () => {
    expect(shouldHideSecretIdentity(alias, id)).toBe(true);
    expect(shouldHideSecretIdentity(primary, id)).toBe(false);
    expect(shouldHideSecretIdentity(safe, id)).toBe(true);
  });

  it('sound bites and backstory', () => {
    expect(visibleSoundBites(alias, bites, id).map((b) => b.id)).toEqual(['pub']);
    expect(canShowSecretBackstory(alias, id)).toBe(false);
    expect(visibleSoundBites(primary, bites, id).map((b) => b.id)).toEqual(['pub', 'sec']);
    expect(canShowSecretBackstory(primary, id)).toBe(true);
    expect(visibleSoundBites(safe, bites, id)).toEqual([]);
    expect(canShowSecretBackstory(safe, id)).toBe(false);
  });

  it('titles', () => {
    const s = sheet({ identity: id });
    expect(sheetTitle(s, alias)).toBe('Corvin');
    expect(sheetTitle(s, primary)).toBe('Mira');
    expect(sheetTitle(s, safe)).toBe('Corvin');
  });
});

describe('DM handoff', () => {
  const s = parseSheet(fixture('sample-level9.json'));
  const tracker = normalizeTracker({
    slug: 'mira-corvin', currentHp: 92, maxHp: 99, hitDiceRemaining: 7, hitDiceTotal: 9, featureUses: { action_surge: 0 },
  });

  it('DM copy has live state and secrets', () => {
    const text = buildHandoff({ sheet: s, tracker, combat: null, dateLabel: '17 Nov 2026', includeSecrets: true, playerNotes: 'Hold the line.' });
    expect(text).toContain('HP: 92 / 99');
    expect(text).toContain('Hit dice: 7 / 9d10');
    expect(text).toContain('Action Surge: 0 /');
    expect(text).toContain('Hold the line.');
    expect(text).toContain('True name is Mira');
    expect(text).toContain('[DM only]');
    expect(text).toContain('## Features (full rules text)');
  });

  it('player-safe copy drops secrets', () => {
    const text = buildHandoff({ sheet: s, tracker, combat: null, dateLabel: '17 Nov 2026', includeSecrets: false });
    expect(text.startsWith('# Corvin:')).toBe(true);
    expect(text).not.toContain('True name');
    expect(/\bMira\b/.test(text)).toBe(false);
    expect(text).not.toContain('mira-corvin');
    expect(handoffFileName(s, false)).toBe('corvin-handoff.txt');
    expect(text).not.toContain('[DM only]');
    expect(text).not.toContain('## DM only');
    for (const [, entries] of actionBuckets(s.combatActions)) {
      for (const e of entries.filter((x) => x.secret)) expect(text).not.toContain(`${e.name}: ${e.summary}`);
    }
  });

  it('shows the rune on its item', () => {
    const r = sheet({ runes: { known: ['Fire'], inscribed: { halberd: 'Fire', halfPlate: 'Stone' } } });
    const text = buildHandoff({ sheet: r, tracker: trackerFromCharacter('r', r), combat: null, dateLabel: 'today', includeSecrets: true });
    expect(text).toContain('Fire rune: inscribed on halberd');
    expect(text).toContain('Stone rune: inscribed on half plate');
  });

  it('works on the current sheet with a fresh tracker', () => {
    const cur = parseSheet(fixture('sample-current.json'));
    const text = buildHandoff({ sheet: cur, tracker: trackerFromCharacter('x', cur), combat: null, dateLabel: 'today', includeSecrets: false });
    expect(text).toContain('Hit dice: 10 / 10d10');
    expect(/\bMira\b/.test(text)).toBe(false);
  });
});

describe('redactForView', () => {
  const sample = parseSheet(fixture('sample-current.json'));
  const strings = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

  it('drops every mention of the true name when the alias is shown', () => {
    const { identity, ...rest } = redactForView(sample, defaultViewContext);
    expect(redactForView(sample, { displayNameChoice: 'primary', playerSafeMode: true }).cosmology?.cultSymbolNotes ?? null).toBeNull();
    expect(identity).toEqual(sample.identity);
    expect(strings(rest).some((s) => /\bMira\b/.test(s))).toBe(false);
    expect(rest.features.length).toBe(sample.features.length);
    expect(rest.cosmology?.soundBites?.length).toBe((sample.cosmology?.soundBites?.length ?? 0) - 1);
  });

  it('leaves the sheet alone when the true name is shown', () => {
    expect(redactForView(sample, { displayNameChoice: 'primary', playerSafeMode: false })).toBe(sample);
  });
});

describe('cosmology origin and belief', () => {
  it('reads the neutral keys', () => {
    const s = parseSheet(fixture('sample-current.json'));
    expect(cosmologyOrigin(s.cosmology)).toMatch(/^Sample /);
    expect(cosmologyBelief(s.cosmology)).toMatch(/^Sample /);
  });

  it('falls back to older per-character keys and keeps them on export', () => {
    const s = parseSheet({ cosmology: { miraOrigin: 'Born in the north.', miraBelief: 'The stars listen.' } });
    expect(cosmologyOrigin(s.cosmology)).toBe('Born in the north.');
    expect(cosmologyBelief(s.cosmology)).toBe('The stars listen.');
    expect(JSON.parse(JSON.stringify(normalizedForSave(s))).cosmology.miraOrigin).toBe('Born in the north.');
    expect(cosmologyOrigin(parseSheet({ cosmology: { origin: 'New', miraOrigin: 'Old' } }).cosmology)).toBe('Old'); // as on Android
  });

  it('older sheets with a text <name>Origin and a structured origin object: the text wins, nothing crashes', () => {
    const s = parseSheet(fixture('sample-stash.json'));
    expect(typeof s.cosmology?.origin).toBe('object');
    expect(cosmologyOrigin(s.cosmology)).toMatch(/^Sample characterOrigin/);
    expect(cosmologyOrigin(parseSheet({ cosmology: { origin: { region: 'North' } } }).cosmology)).toBeNull();
    const again = parseSheet(JSON.stringify(normalizedForSave(s)));
    expect(again.cosmology?.origin).toEqual(s.cosmology?.origin);
  });
});
