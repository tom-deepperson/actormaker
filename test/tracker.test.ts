// Spec: archive/android/app/src/test/.../data/TrackerStateTest.kt and HitDiceAndSlotsTest.kt
import { describe, expect, it } from 'vitest';
import { abilityModifier, type CharacterSheet } from '../src/data/model';
import {
  type TrackerState, afterLevelUp, afterRest, applyDamage, applyHealing, hitDiceRemainingByDie, hitDiceTotals,
  normalizeTracker, restoreSpellSlot, slotsRemaining, spellSlotMax, spendHitDie, trackerFromCharacter, useSpellSlot,
} from '../src/data/tracker';
import { sheet } from './helpers';

const derived = (level: number, hp?: number, extra: object = {}) =>
  ({ level, proficiencyBonus: 2, ...(hp !== undefined ? { hitPoints: { total: hp } } : {}), ...extra });

describe('TrackerState', () => {
  const restSheet = sheet({
    features: [
      { id: 'second_wind', name: 'Second Wind', uses: { max: 1, per: 'short_rest' }, rulesText: 'x' },
      { id: 'giants_might', name: "Giant's Might", uses: { max: 4, per: 'long_rest' }, rulesText: 'x' },
    ],
    derived: derived(9, 99),
  });
  const tired = normalizeTracker({
    slug: 't', currentHp: 20, maxHp: 99, tempHp: 5, hitDiceRemaining: 1, hitDiceTotal: 9,
    featureUses: { second_wind: 0, giants_might: 0 },
  });

  it('fromCharacter initializes uses', () => {
    const t = trackerFromCharacter('mira-corvin', restSheet);
    expect(t.currentHp).toBe(99);
    expect(t.featureUses.second_wind).toBe(1);
    expect(t.featureUses.giants_might).toBe(4);
  });

  it('2014 long rest restores all HP and half hit dice', () => {
    const r = afterRest(tired, { ...restSheet, edition: '2014' }, 'long', 1);
    expect(r.currentHp).toBe(99);
    expect(r.tempHp).toBe(0);
    expect(r.hitDiceRemaining).toBe(5);
    expect(r.featureUses).toEqual({ second_wind: 1, giants_might: 4 });
  });

  it('2024 long rest restores all hit dice', () => {
    const r = afterRest(tired, { ...restSheet, edition: '2024' }, 'long', 1);
    expect(r.currentHp).toBe(99);
    expect(r.hitDiceRemaining).toBe(9);
  });

  it('short rest only refreshes short-rest features', () => {
    const r = afterRest(tired, restSheet, 'short', 1);
    expect(r.currentHp).toBe(20);
    expect(r.hitDiceRemaining).toBe(1);
    expect(r.featureUses.second_wind).toBe(1);
    expect(r.featureUses.giants_might).toBe(0);
  });

  it('ability modifier rounds down', () => {
    expect([9, 7, 10, 11, 17].map(abilityModifier)).toEqual([-1, -2, 0, 0, 3]);
  });

  it('damage eats temp HP first; healing caps at max', () => {
    const t = normalizeTracker({ slug: 't', currentHp: 50, maxHp: 99, tempHp: 5 });
    expect(applyDamage(t, 8)).toMatchObject({ tempHp: 0, currentHp: 47 });
    expect(applyDamage(t, 3)).toMatchObject({ tempHp: 2, currentHp: 50 });
    expect(applyDamage(t, 500).currentHp).toBe(0);
    expect(applyHealing(t, 100).currentHp).toBe(99);
  });
});

describe('hit dice and slots', () => {
  const multiclass = sheet({
    edition: '2014',
    classes: [
      { name: 'Fighter', subclass: 'Rune Knight', level: 9, hitDie: 'd10' },
      { name: 'Barbarian', subclass: null, level: 2, hitDie: 'd12' },
    ],
    derived: derived(11, 120),
  });
  const fresh = (s: CharacterSheet) => trackerFromCharacter('t', s);

  it('pools per die, largest first', () => {
    expect([...hitDiceTotals(multiclass)]).toEqual([['d12', 2], ['d10', 9]]);
    expect([...hitDiceTotals(sheet({ derived: derived(9, undefined, { hitDice: '9d10' }) }))]).toEqual([['d10', 9]]);
    expect([...hitDiceTotals(sheet({ identity: { class: 'Wizard' }, derived: derived(3) }))]).toEqual([['d6', 3]]);
  });

  it('spending comes from the chosen pool', () => {
    const t = spendHitDie(spendHitDie(fresh(multiclass), multiclass, 'd12')!, multiclass, 'd12')!;
    expect([...hitDiceRemainingByDie(t, multiclass)]).toEqual([['d12', 0], ['d10', 9]]);
    expect(t.hitDiceRemaining).toBe(9);
    expect(spendHitDie(t, multiclass, 'd12')).toBeNull();
  });

  it('older tracker files spread the single number', () => {
    const legacy = normalizeTracker({ slug: 't', currentHp: 1, maxHp: 1, hitDiceRemaining: 5, hitDiceTotal: 11 });
    expect([...hitDiceRemainingByDie(legacy, multiclass)]).toEqual([['d12', 2], ['d10', 3]]);
  });

  it('2014 long rest regains half, largest first', () => {
    let t: TrackerState = fresh(multiclass);
    for (let i = 0; i < 2; i++) t = spendHitDie(t, multiclass, 'd12')!;
    for (let i = 0; i < 9; i++) t = spendHitDie(t, multiclass, 'd10')!;
    const rested = afterRest(t, multiclass, 'long', 1);
    expect([...hitDiceRemainingByDie(rested, multiclass)]).toEqual([['d12', 2], ['d10', 3]]);
    expect(afterRest(t, { ...multiclass, edition: '2024' }, 'long', 1).hitDiceRemaining).toBe(11);
  });

  it('multiclass level-up adds to the new pool', () => {
    const before = { ...multiclass, classes: [multiclass.classes[0]], derived: derived(9, 99) };
    let t = fresh(before);
    for (let i = 0; i < 4; i++) t = spendHitDie(t, before, 'd10')!;
    const after = {
      ...before,
      classes: [...before.classes, { name: 'Barbarian', subclass: null, level: 1, hitDie: 'd12' }],
      derived: derived(10, 108),
    };
    const leveled = afterLevelUp(t, before, after);
    expect([...hitDiceRemainingByDie(leveled, after)]).toEqual([['d12', 1], ['d10', 5]]);
    expect(leveled.hitDiceTotal).toBe(10);
  });

  const caster = sheet({ spells: { slots: { '1st': 4, '2': 2, '3': 0 }, pactMagic: { slots: 2, level: 3 } } });

  it('slot maximums accept loose keys', () => {
    expect([...spellSlotMax(caster)]).toEqual([['1', 4], ['2', 2], ['pact', 2]]);
  });

  it('spend, restore and rest slots', () => {
    let t: TrackerState = fresh(caster);
    t = useSpellSlot(useSpellSlot(useSpellSlot(t, caster, '1')!, caster, '1')!, caster, 'pact')!;
    expect(slotsRemaining(t, caster, '1')).toBe(2);
    expect(slotsRemaining(t, caster, 'pact')).toBe(1);
    for (let i = 0; i < 2; i++) t = useSpellSlot(t, caster, '2')!;
    expect(useSpellSlot(t, caster, '2')).toBeNull();
    expect(useSpellSlot(t, caster, '9')).toBeNull();
    t = restoreSpellSlot(t, '1');
    expect(slotsRemaining(t, caster, '1')).toBe(3);
    const short = afterRest(t, caster, 'short', 1);
    expect(slotsRemaining(short, caster, 'pact')).toBe(2);
    expect(slotsRemaining(short, caster, '1')).toBe(3);
    expect('pact' in short.spellSlotsUsed).toBe(false);
    const long = afterRest(t, caster, 'long', 1);
    expect(slotsRemaining(long, caster, '1')).toBe(4);
    expect(slotsRemaining(long, caster, '2')).toBe(2);
  });
});
