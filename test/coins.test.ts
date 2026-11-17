// Spec: android/app/src/test/.../data/CoinsAndClassesTest.kt and EncumbranceCalculatorTest.kt
import { describe, expect, it } from 'vitest';
import { parseSheet, level } from '../src/data/model';
import { coinLabel, coins, spend, valueCp, valueGpLabel, wealthCoins, withCoins } from '../src/data/coins';
import { classLabel, classLevels, hitDieFor, multiclassProblems } from '../src/data/classes';
import { coinWeightLb, effectiveSpeed, encumbranceStatus, isTrackingEnabled, summarize } from '../src/data/encumbrance';
import { fixture, sheet } from './helpers';

const sample = parseSheet(fixture('sample-level9.json'));

describe('coins', () => {
  it('old sheets read gold as coins', () => {
    const c = wealthCoins(sample.wealth);
    expect(c.gp).toBe(sample.wealth!.gold);
    expect(c.sp).toBe(0);
  });

  it('every coin weighs the same', () => {
    expect(coinWeightLb(coins({ cp: 100 }))).toBe(2);
    expect(coinWeightLb(coins({ pp: 60, gp: 40 }))).toBe(2);
    expect(summarize(sheet({ wealth: { gold: 50, silver: 50 } })).coinLb).toBe(2);
  });

  it('value and labels', () => {
    const c = coins({ pp: 1, gp: 2, ep: 1, sp: 3, cp: 4 });
    expect(valueCp(c)).toBe(1284);
    expect(valueGpLabel(c)).toBe('12 gp 8 sp 4 cp');
    expect(coinLabel(c)).toBe('1 pp 2 gp 1 ep 3 sp 4 cp');
  });

  it('spending makes change', () => {
    expect(spend(coins({ gp: 10 }), 5, 'gp')).toEqual(coins({ gp: 5 }));
    expect(spend(coins({ sp: 12 }), 1, 'gp')).toEqual(coins({ sp: 2 }));
    expect(spend(coins({ gp: 1 }), 3, 'sp')).toEqual(coins({ sp: 7 }));
    expect(spend(coins({ pp: 2 }), 15, 'gp')).toEqual(coins({ gp: 5 }));
    expect(spend(coins({ gp: 1 }), 2, 'gp')).toBeNull();
    const start = coins({ pp: 3, gp: 7, ep: 1, sp: 4, cp: 9 });
    expect(valueCp(spend(start, 23, 'sp')!)).toBe(valueCp(start) - 230);
  });

  it('withCoins keeps unused denominations out', () => {
    const w = withCoins({ gold: 10 }, coins({ gp: 12 }));
    expect(w.gold).toBe(12);
    expect(w.silver).toBeUndefined();
    expect(withCoins({ gold: 10 }, coins({ gp: 1, sp: 3 })).silver).toBe(3);
  });
});

describe('classes', () => {
  it('single class sheet becomes one class level', () => {
    const cl = classLevels(sample);
    expect(cl).toHaveLength(1);
    expect(cl[0]).toMatchObject({ name: 'Fighter', level: level(sample), hitDie: 'd10' });
    expect(classLabel(sample)).toBe('Fighter (Rune Knight)');
  });

  it('multiclass prerequisites', () => {
    expect(multiclassProblems(sample, 'Barbarian')).toEqual([]);
    expect(multiclassProblems(sample, 'Rogue')).toEqual([]);
    expect(multiclassProblems(sample, 'Wizard')).toEqual(['Wizard needs INT 13']);
    expect(multiclassProblems(sample, 'Paladin')).toEqual(['Paladin needs STR 13 and CHA 13']);
    expect(multiclassProblems(sample, 'Blood Hunter')).toEqual([]);
  });

  it('multiclass summary', () => {
    const multi = {
      ...sample,
      classes: [
        { name: 'Fighter', subclass: 'Rune Knight', level: 9, hitDie: 'd10' },
        { name: 'Barbarian', subclass: null, level: 1, hitDie: 'd12' },
      ],
    };
    expect(classLabel(multi)).toBe('Fighter 9 (Rune Knight) / Barbarian 1');
    expect(hitDieFor(multi, 'barbarian')).toBe(12);
  });
});

describe('encumbrance', () => {
  const loaded = (str: number, lb: number, gold = 0) =>
    sheet({
      edition: '2014',
      constraints: { encumbranceRule: 'variant' },
      abilityScores: { final: { STR: str } },
      equipment: [{ name: 'Pack', quantity: 1, weightLb: lb }],
      wealth: { gold },
      derived: { level: 1, proficiencyBonus: 2, speed: 30 },
    });

  it('coin weight uses fifty per pound', () => {
    expect(coinWeightLb(100)).toBe(2);
    expect(coinWeightLb(49)).toBe(0);
  });

  it('variant thresholds at STR 16', () => {
    expect([80, 81, 161, 241].map((lb) => encumbranceStatus(16, lb))).toEqual(['normal', 'encumbered', 'heavily', 'over']);
  });

  it('summarize includes coin weight', () => {
    const s = summarize(loaded(16, 78, 100));
    expect(s.totalKnownLb).toBe(80);
    expect(s.status).toBe('normal');
  });

  it('speed penalty', () => {
    expect(effectiveSpeed(30, 'encumbered')).toBe(20);
    expect(effectiveSpeed(30, 'heavily')).toBe(10);
  });

  it('counts unknown weights', () => {
    const s = summarize(sheet({ equipment: [{ name: 'Mystery item', quantity: 1 }, { name: 'Backpack', quantity: 1, weightLb: 5 }] }));
    expect(s.unknownCount).toBe(1);
    expect(s.knownLb).toBe(5);
  });

  it('tracking rules', () => {
    const anvil = [{ name: 'Anvil', quantity: 1, weightLb: 500 }];
    const none = sheet({ constraints: { encumbranceRule: 'none' }, abilityScores: { final: { STR: 16 } }, equipment: anvil });
    expect(isTrackingEnabled(none)).toBe(false);
    expect(summarize(none).status).toBe('normal');
    const unset = sheet({ abilityScores: { final: { STR: 16 } }, equipment: anvil });
    expect(isTrackingEnabled(unset, false)).toBe(false);
    expect(isTrackingEnabled(unset, true)).toBe(true);
    expect(summarize(unset, false).trackingEnabled).toBe(false);
  });

  it('ignores stored equipment', () => {
    const s = sheet({
      constraints: { encumbranceRule: 'variant' },
      abilityScores: { final: { STR: 16 } },
      equipment: [{ name: 'Pack', quantity: 1, weightLb: 78 }],
      equipmentLocations: [{ location: 'Chest', equipment: [{ name: 'Anvil', quantity: 1, weightLb: 500 }] }],
      wealth: { gold: 100 },
    });
    expect(summarize(s).totalKnownLb).toBe(80);
  });
});
