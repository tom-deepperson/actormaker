// Spec: android/.../portrait/PortraitRepository.kt and the portrait parts of CompanionViewModel.kt.
// Fictional names only: this repository is public.
import { describe, expect, it } from 'vitest';
import { parseSheet } from '../src/data/model';
import {
  clampTransform, initialExpression, initialFacing, orderBackgrounds, parsePortraitLibrary, portraitPrefs, savedTransform,
  secretHints, transformPrefs, visibleOutfits, withSetPrefs, outfitKey,
} from '../src/data/portraits';
import { helpMarkdown, parseHelp } from '../src/ui/QuickHelp';

const manifest = JSON.stringify({
  sets: [
    { id: 'outfit_armor', label: 'Masked armor', shot: 'bust', secret: false, defaultExpression: 'neutral', expressions: { neutral: { front: 'armor.png' } } },
    {
      id: 'outfit_court',
      label: 'Court dress',
      secret: true,
      defaultExpression: 'neutral',
      expressions: {
        neutral: { front: 'court.png', side_left: 'court_sl.png', three_quarter_front_left: 'court_ql.png', back: 'court_back.png' },
        smile: { front: 'court__smile.png' },
      },
    },
    { id: 'legacy', views: [{ profile: 'side_right', file: 'leg_sr.png' }, { profile: 'front', file: 'leg_f.png' }] },
  ],
});

const files = ['armor.png', 'court.png', 'COURT_SL.png', 'court_ql.png', 'court_back.png', 'leg_f.png', 'leg_sr.png', 'loose.webp', 'manifest.json', 'notes.txt'];

const sheet = parseSheet({ identity: { name: 'Mirel Ashdown', cultAlias: 'Ashdown' } });

describe('portrait manifest', () => {
  const lib = parsePortraitLibrary(manifest, files);

  it('reads sets, skips files that were not imported, and orders facings', () => {
    expect(lib.rotationSets.map((s) => s.id)).toEqual(['outfit_armor', 'outfit_court', 'legacy']);
    const court = lib.rotationSets[1];
    // court__smile.png was never imported, so the expression is dropped.
    expect(Object.keys(court.expressions)).toEqual(['neutral']);
    expect(court.expressions.neutral.map((v) => v.profile)).toEqual(['front', 'three_quarter_front_left', 'side_left', 'back']);
    // Matched case-insensitively, keeping the stored name.
    expect(court.expressions.neutral[2].file).toBe('COURT_SL.png');
    expect(court.secret).toBe(true);
  });

  it('treats a legacy views array as one neutral expression', () => {
    const legacy = lib.rotationSets[2];
    expect(Object.keys(legacy.expressions)).toEqual(['neutral']);
    expect(legacy.expressions.neutral.map((v) => v.profile)).toEqual(['side_right', 'front']);
    expect(legacy.label).toBe('legacy');
  });

  it('lists images not named by the manifest as loose portraits', () => {
    expect(lib.flat.map((f) => f.file)).toEqual(['loose.webp']);
    expect(parsePortraitLibrary(null, ['b.png', 'a.PNG']).flat.map((f) => f.file)).toEqual(['a.PNG', 'b.png']);
    expect(parsePortraitLibrary('not json', ['a.png']).flat).toHaveLength(1);
  });

  it('starts on the saved facing, else 3/4 left, else front', () => {
    const court = lib.rotationSets[1];
    expect(initialFacing(court, 'neutral', {})).toBe(1);
    expect(initialFacing(court, 'neutral', { sets: { outfit_court: { defaultFacing: 'back' } } })).toBe(3);
    expect(initialFacing(lib.rotationSets[2], 'neutral', {})).toBe(1);
    expect(initialExpression(court, { sets: { outfit_court: { defaultExpression: 'missing' } } })).toBe('neutral');
  });
});

describe('secret portraits', () => {
  const lib = parsePortraitLibrary(manifest, [...files, 'mirel_helm_off.png', 'unarmored.png']);
  const keys = (ctx: { displayNameChoice: 'alias' | 'primary'; playerSafeMode: boolean }) => visibleOutfits(lib, sheet, ctx).map(outfitKey);

  it('shows everything under the true name', () => {
    expect(keys({ displayNameChoice: 'primary', playerSafeMode: false })).toContain('outfit_court');
    expect(keys({ displayNameChoice: 'primary', playerSafeMode: false })).toContain('mirel_helm_off');
  });

  it('hides secret sets and identity hints in alias and player-safe views', () => {
    for (const ctx of [{ displayNameChoice: 'alias' as const, playerSafeMode: false }, { displayNameChoice: 'primary' as const, playerSafeMode: true }]) {
      expect(keys(ctx)).toEqual(['outfit_armor', 'legacy', 'loose']);
    }
  });

  it('builds hints from the true name but not the part shared with the alias', () => {
    expect(secretHints(sheet)).toContain('mirel');
    expect(secretHints(sheet)).not.toContain('ashdown');
  });

  it('never falls back to secret images when nothing public is left', () => {
    const onlySecret = parsePortraitLibrary(null, ['helm_off.png']);
    expect(visibleOutfits(onlySecret, sheet, { displayNameChoice: 'alias', playerSafeMode: false })).toEqual([]);
  });
});

describe('portrait prefs', () => {
  it('writes the Android shape and keeps other appearance fields', () => {
    const s = parseSheet({ appearance: { height: '6 ft', portraitPrefs: { activeSetId: 'a', sets: { a: { defaultExpression: 'neutral' } } } } });
    const next = withSetPrefs(s, 'a', { offsetX: 12, offsetY: -4, scale: 1.5 });
    expect((next.appearance as Record<string, unknown>).height).toBe('6 ft');
    expect(portraitPrefs(next)).toEqual({ activeSetId: 'a', sets: { a: { defaultExpression: 'neutral', offsetX: 12, offsetY: -4, scale: 1.5 } } });
    // Android pixel offsets are read against a 1080 x 1920 scene.
    expect(savedTransform(next, 'a')).toEqual({ offsetX: 12 / 1080, offsetY: -4 / 1920, scale: 1.5 });
    // PWA fractions win when present.
    const pwa = withSetPrefs(next, 'a', transformPrefs({ offsetX: 0.123456, offsetY: -0.5, scale: 2.00049 }));
    expect(portraitPrefs(pwa).sets?.a).toMatchObject({ offsetX: 12, fracX: 0.1235, fracY: -0.5, scale: 2 });
    expect(savedTransform(pwa, 'a')).toEqual({ offsetX: 0.1235, offsetY: -0.5, scale: 2 });
    expect(savedTransform(next, 'other')).toEqual({ offsetX: 0, offsetY: 0, scale: 1 });
  });

  it('clamps scale to 0.25–4', () => {
    expect(clampTransform({ offsetX: 0, offsetY: 0, scale: 10 }).scale).toBe(4);
    expect(clampTransform({ offsetX: Number.NaN, offsetY: 0, scale: 0.01 })).toEqual({ offsetX: 0, offsetY: 0, scale: 0.25 });
  });
});

describe('backgrounds', () => {
  it('puts manifest items first, matching by file, then name without extension, then the rest', () => {
    const m = '﻿' + JSON.stringify({
      items: [
        { id: 'road_rut', file: 'road_rut.png', displayName: 'Forest track' },
        { id: 'tavern', displayName: 'Warm hearth' },
        { id: 'missing', displayName: 'Not imported' },
      ],
    });
    const out = orderBackgrounds(m, ['zz_extra.jpg', 'tavern.jpg', 'road_rut.jpg', 'manifest.json']);
    expect(out).toEqual([
      { file: 'road_rut.jpg', label: 'Forest track' },
      { file: 'tavern.jpg', label: 'Warm hearth' },
      { file: 'zz_extra.jpg', label: 'zz_extra' },
    ]);
  });
});

describe('quick help', () => {
  it('picks the edition and splits sections', () => {
    expect(helpMarkdown('combat', '2024')).toContain('2024');
    expect(helpMarkdown('combat', null)).toContain('2014');
    const doc = parseHelp(helpMarkdown('noncombat', '2014'));
    expect(doc.title).toMatch(/Quick Reference/);
    expect(doc.sections.length).toBeGreaterThan(5);
    expect(doc.sections[0].heading).toBe('Ability checks');
  });
});
