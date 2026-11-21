// Static portraits (one picture with its background painted in) and the true-name-only rule.
// Fictional names only: this repository is public.
import { describe, expect, it } from 'vitest';
import { parseSheet } from '../src/data/model';
import {
  allPortraits, forgetFile, manifestSecrets, migratePrefs, resolveFace, secretHints, setSecret, storedPrefs, visiblePortraits, withPrefs,
} from '../src/data/portraits';
import { helpMarkdown, parseHelp } from '../src/ui/QuickHelp';

const sheet = parseSheet({ identity: { name: 'Mirel Ashdown', cultAlias: 'Ashdown' } });
const trueName = { displayNameChoice: 'primary' as const, playerSafeMode: false };
const alias = { displayNameChoice: 'alias' as const, playerSafeMode: false };
const playerSafe = { displayNameChoice: 'primary' as const, playerSafeMode: true };

const files = ['armor.png', 'court.jpg', 'mirel_helm_off.png', 'notes.txt', 'manifest.json'];
const names = (list: { file: string }[]) => list.map((p) => p.file);

describe('portrait pictures', () => {
  it('lists only images, in the order given', () => {
    expect(names(allPortraits(sheet, {}, files))).toEqual(['armor.png', 'court.jpg', 'mirel_helm_off.png']);
  });

  it('shows everything under the true name', () => {
    expect(names(visiblePortraits(sheet, { secret: ['court.jpg'] }, files, trueName))).toEqual(['armor.png', 'court.jpg', 'mirel_helm_off.png']);
  });

  it('hides marked pictures and name hints in alias and player-safe views', () => {
    for (const ctx of [alias, playerSafe]) {
      expect(names(visiblePortraits(sheet, { secret: ['COURT.jpg'] }, files, ctx))).toEqual(['armor.png']);
    }
  });

  it('builds hints from the true name but not the part shared with the alias', () => {
    expect(secretHints(sheet)).toContain('mirel');
    expect(secretHints(sheet)).not.toContain('ashdown');
  });

  it('lets the player show a picture whose name only looks secret, and hide it again', () => {
    const shown = setSecret({}, 'mirel_helm_off.png', false);
    expect(names(visiblePortraits(sheet, shown, files, alias))).toContain('mirel_helm_off.png');
    const hidden = setSecret(shown, 'mirel_helm_off.png', true);
    expect(names(visiblePortraits(sheet, hidden, files, alias))).not.toContain('mirel_helm_off.png');
    expect(hidden.public).toEqual([]);
  });

  it('never falls back to a secret picture when nothing public is left', () => {
    const visible = visiblePortraits(sheet, { face: 'court.jpg', secret: ['court.jpg'] }, ['court.jpg'], alias);
    expect(visible).toEqual([]);
    expect(resolveFace(visible, { face: 'court.jpg' })).toBeNull();
  });
});

describe('the face', () => {
  it('is the chosen picture when it can be shown, else the first that can', () => {
    const prefs = { face: 'court.jpg', secret: ['court.jpg'] };
    expect(resolveFace(visiblePortraits(sheet, prefs, files, trueName), prefs)?.file).toBe('court.jpg');
    expect(resolveFace(visiblePortraits(sheet, prefs, files, alias), prefs)?.file).toBe('armor.png');
    expect(resolveFace(visiblePortraits(sheet, {}, files, trueName), {})?.file).toBe('armor.png');
  });

  it('is cleared when its picture is deleted, but the secret mark stays for a re-import', () => {
    const next = forgetFile({ face: 'court.jpg', secret: ['court.jpg'] }, 'Court.jpg');
    expect(next).toEqual({ face: null, secret: ['court.jpg'] });
  });

  it('is saved in appearance.portrait, keeping other fields and dropping the old layered prefs', () => {
    const s = parseSheet({ appearance: { height: '6 ft', portraitPrefs: { activeSetId: 'a' } } });
    const next = withPrefs(s, { face: 'armor.png' });
    expect(next.appearance).toEqual({ height: '6 ft', portrait: { face: 'armor.png' } });
    expect(storedPrefs(next)).toEqual({ face: 'armor.png' });
    expect(storedPrefs(s)).toBeNull();
  });
});

describe('from the old layered portraits', () => {
  const manifest = '﻿' + JSON.stringify({
    sets: [
      { id: 'outfit_armor', label: 'Masked armor', secret: false, defaultExpression: 'neutral', expressions: { neutral: { side_left: 'armor_sl.png', front: 'armor.png' } } },
      { id: 'outfit_court', label: 'Court dress', secret: true, expressions: { neutral: { front: 'court.png', back: 'court_back.png' }, smile: { front: 'court__smile.png' } } },
      { id: 'helm_off', label: 'Bare head', views: [{ profile: 'front', file: 'bare.png' }] },
    ],
  });

  it('marks the files of secret sets, and of sets whose name hints at the true identity', () => {
    expect(manifestSecrets(manifest, sheet)).toEqual(['court.png', 'court_back.png', 'court__smile.png', 'bare.png']);
    expect(manifestSecrets('not json', sheet)).toEqual([]);
  });

  it('carries the active outfit over as the face (its front view)', () => {
    const s = parseSheet({ ...sheet, appearance: { portraitPrefs: { activeSetId: 'outfit_armor' } } });
    expect(migratePrefs(s, manifest)).toEqual({ face: 'armor.png', secret: ['court.png', 'court_back.png', 'court__smile.png', 'bare.png'] });
    expect(migratePrefs(sheet, manifest)?.face).toBeNull();
    expect(migratePrefs(sheet, null)).toBeNull();
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
