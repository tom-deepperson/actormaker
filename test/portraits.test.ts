// Static portraits (one picture with its background painted in) and the true-name-only rule.
// Fictional names only: this repository is public.
import { describe, expect, it } from 'vitest';
import { parseSheet } from '../src/data/model';
import {
  allPortraits, faceFor, forgetFile, manifestSecrets, migratePrefs, resolveFace, secretHints, setFace, setSecret, storedPrefs, visiblePortraits, withPrefs,
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
    expect(next).toEqual({ faces: { alias: null, primary: null }, secret: ['court.jpg'] });
    expect(forgetFile({ faces: { alias: 'armor.png', primary: 'court.jpg' } }, 'armor.png').faces).toEqual({ alias: null, primary: 'court.jpg' });
  });

  it('is saved in appearance.portrait, keeping other fields and dropping the old layered prefs', () => {
    const s = parseSheet({ appearance: { height: '6 ft', portraitPrefs: { activeSetId: 'a' } } });
    const next = withPrefs(s, { face: 'armor.png' });
    expect(next.appearance).toEqual({ height: '6 ft', portrait: { face: 'armor.png' } });
    expect(storedPrefs(next)).toEqual({ face: 'armor.png' });
    expect(storedPrefs(s)).toBeNull();
  });
});

describe('a face for the alias and one for the true name', () => {
  const both = setFace(setFace({ secret: ['court.jpg'] }, 'primary', 'court.jpg'), 'alias', 'armor.png');

  it('shows each face in its own views, the alias one in player-safe view too', () => {
    expect(faceFor(sheet, both, files, trueName)?.file).toBe('court.jpg');
    expect(faceFor(sheet, both, files, alias)?.file).toBe('armor.png');
    expect(faceFor(sheet, both, files, playerSafe)?.file).toBe('armor.png');
  });

  it('carries on from the single face saved before: that is the true-name face', () => {
    const old = { face: 'court.jpg', secret: ['court.jpg'] };
    expect(faceFor(sheet, old, files, trueName)?.file).toBe('court.jpg');
    expect(faceFor(sheet, old, files, alias)?.file).toBe('armor.png');
    expect(setFace(old, 'alias', 'armor.png')).toEqual({ faces: { alias: 'armor.png', primary: 'court.jpg' }, secret: ['court.jpg'], public: ['armor.png'] });
  });

  it('shows a picture chosen for the alias under the alias, even one whose name looked secret', () => {
    const p = setFace({}, 'alias', 'mirel_helm_off.png');
    expect(faceFor(sheet, p, files, alias)?.file).toBe('mirel_helm_off.png');
  });

  it('never shows a secret picture under the alias, even if it is still named as the alias face', () => {
    const p = { faces: { alias: 'court.jpg' }, secret: ['court.jpg'] };
    expect(faceFor(sheet, p, files, alias)?.file).toBe('armor.png');
    expect(setSecret(setFace({}, 'alias', 'court.jpg'), 'court.jpg', true).faces?.alias).toBeNull();
  });

  it('uses the true-name face everywhere but player-safe view for a character without an alias', () => {
    const plain = parseSheet({ identity: { name: 'Odo Fenn' } });
    const p = setFace({}, 'primary', 'court.jpg');
    expect(faceFor(plain, p, files, alias)?.file).toBe('court.jpg');
    expect(faceFor(plain, p, files, trueName)?.file).toBe('court.jpg');
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
    expect(migratePrefs(s, manifest)).toEqual({ faces: { primary: 'armor.png', alias: 'armor.png' }, secret: ['court.png', 'court_back.png', 'court__smile.png', 'bare.png'] });
    const court = parseSheet({ ...sheet, appearance: { portraitPrefs: { activeSetId: 'outfit_court' } } });
    expect(migratePrefs(court, manifest)?.faces).toEqual({ primary: 'court.png', alias: null });
    expect(migratePrefs(sheet, manifest)?.faces).toEqual({ primary: null, alias: null });
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
