// Spec: archive/android/app/src/test/.../data/BoardsAndDiceTest.kt
import { describe, expect, it } from 'vitest';
import { parseSheet } from '../src/data/model';
import { d20, exprLabel, parseDice, roll, seededRng } from '../src/data/dice';
import { availability, buildBoard, inferCost, sessionAfterUse } from '../src/data/actionBoard';
import { abilities, abilityMod, passives, skills, utilityFeatures } from '../src/data/exploreBoard';
import { inactiveSession } from '../src/data/combat';
import { trackerFromCharacter } from '../src/data/tracker';
import { fixture, sheet } from './helpers';

const sample = parseSheet(fixture('sample-level9.json'));

describe('dice', () => {
  it('parses damage formulas', () => {
    expect(exprLabel(parseDice('1d10 + 4 slashing')!)).toBe('1d10+4');
    expect(exprLabel(parseDice('2d6+1d8-1 fire')!)).toBe('2d6+1d8-1');
    expect(parseDice('damage varies')).toBeNull();
    expect(parseDice('5')).toBeNull();
  });

  it('rolls stay in range', () => {
    const expr = parseDice('2d6+3')!;
    for (let i = 0; i < 200; i++) {
      const r = roll(expr, seededRng(i));
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(15);
      expect(r.dice).toHaveLength(2);
    }
    expect(roll(expr, seededRng(1), true).dice).toHaveLength(4);
  });

  it('advantage keeps the higher die', () => {
    for (let i = 0; i < 100; i++) {
      const r = d20(5, 'advantage', seededRng(i));
      expect(r.dice[0]).toBeGreaterThanOrEqual(r.dropped!);
      expect(r.total).toBe(r.dice[0] + 5);
      const d = d20(0, 'disadvantage', seededRng(i));
      expect(d.dice[0]).toBeLessThanOrEqual(d.dropped!);
    }
  });
});

describe('action board', () => {
  const board = buildBoard(sample);

  it('lists attacks, features and standard actions', () => {
    const attacks = board.filter((o) => o.kind === 'attack');
    expect(attacks).toHaveLength(sample.derived!.attacks!.length);
    expect(attacks.every((o) => o.cost === 'action')).toBe(true);
    const secondWind = board.find((o) => o.featureId === 'second_wind')!;
    expect(secondWind.cost).toBe('bonus');
    expect(secondWind.uses?.max).toBe(1);
    const surge = board.find((o) => o.name.includes('Action Surge'))!;
    expect(surge.grantsAction).toBe(true);
    expect(surge.cost).toBe('free');
    expect(board.some((o) => o.kind === 'standard' && o.name === 'Dash')).toBe(true);
    // The sample already has a Polearm Master opportunity attack, so no generic one.
    expect(board.some((o) => o.kind === 'standard' && o.name === 'Opportunity attack')).toBe(false);
    expect(new Set(board.map((o) => o.id)).size).toBe(board.length);
  });

  it('hiding secrets drops secret entries', () => {
    const ca = sample.combatActions!;
    const secretNames = [...ca.bonus!, ...ca.reaction!].filter((e) => e.secret).map((e) => e.name);
    expect(secretNames.length).toBeGreaterThan(0);
    const hidden = buildBoard(sample, true);
    expect(secretNames.some((n) => hidden.some((o) => o.name === n))).toBe(false);
    // The feature behind those entries has uses; it must not reappear as an unlinked card.
    expect(hidden.some((o) => o.featureId === 'secret_rune_invoke')).toBe(false);
    expect(board.some((o) => o.featureId === 'secret_rune_invoke')).toBe(true);
  });

  it("a hidden entry's feature doesn't come back as its own card", () => {
    const s = sheet({
      features: [{ id: 'veil', name: 'Veil', uses: { max: 2, per: 'long_rest' }, rulesText: 'As a bonus action, you vanish.' }],
      combatActions: { bonus: [{ id: 'b1', name: 'Veil', summary: 'vanish', featureId: 'veil', secret: true }] },
    });
    expect(buildBoard(s).some((o) => o.featureId === 'veil')).toBe(true);
    expect(buildBoard(s, true).some((o) => o.featureId === 'veil')).toBe(false);
  });

  it('eclipse stays hidden even when not flagged', () => {
    const s = sheet({
      features: [{ id: 'eclipse_rune', name: 'Shadow Rune', uses: { max: 1, per: 'long_rest' }, rulesText: 'As a bonus action, darkness.' }],
      combatActions: { reaction: [{ id: 'r1', name: 'Eclipse Ward', summary: 'ward' }] },
    });
    const hidden = buildBoard(s, true);
    expect(hidden.some((o) => /eclipse/i.test(o.name) || /eclipse/i.test(o.featureId ?? ''))).toBe(false);
    expect(buildBoard(s).some((o) => o.name === 'Eclipse Ward')).toBe(true);
  });

  it('using a card spends economy and Action Surge refunds', () => {
    const session = { ...inactiveSession('t'), active: true };
    const attack = board.find((o) => o.kind === 'attack')!;
    const afterAttack = sessionAfterUse(session, attack);
    expect(afterAttack.actionUsed).toBe(true);
    expect(availability(attack, null, afterAttack)).toBe('economySpent');
    const surge = board.find((o) => o.grantsAction)!;
    expect(sessionAfterUse(afterAttack, surge).actionUsed).toBe(false);
    // Out of combat nothing is tracked.
    const idle = inactiveSession('t');
    expect(sessionAfterUse(idle, attack)).toEqual(idle);
    const t = trackerFromCharacter('t', sample);
    const spent = { ...t, featureUses: { ...t.featureUses, second_wind: 0 } };
    expect(availability(board.find((o) => o.featureId === 'second_wind')!, spent, session)).toBe('noUses');
  });

  it('infers cost from rules text', () => {
    expect(inferCost('As a bonus action, you can regain hit points.')).toBe('bonus');
    expect(inferCost('You can use your reaction to impose disadvantage.')).toBe('reaction');
    expect(inferCost('As an action, you can touch a creature.')).toBe('action');
    expect(inferCost('You have advantage on checks to track.')).toBe('free');
  });

  it('lists cantrips and spells once, with standard 2024 actions', () => {
    const s = sheet({ edition: '2024', spells: { cantrips: ['Fire Bolt'], prepared: ['Shield', 'fire bolt'], known: ['shield', 'Sleep'] } });
    const b = buildBoard(s);
    expect(b.filter((o) => o.kind === 'spell').map((o) => o.name)).toEqual(['Fire Bolt', 'Shield', 'Sleep']);
    expect(b.find((o) => o.name === 'Shield')!.needsSlot).toBe(true);
    expect(b.some((o) => o.name === 'Influence')).toBe(true);
    expect(b.some((o) => o.name === 'Opportunity attack')).toBe(true);
  });
});

describe('explore board', () => {
  it('computes all skills', () => {
    const list = skills(sample);
    expect(list).toHaveLength(18);
    const athletics = list.find((s) => s.name === 'Athletics')!;
    expect(athletics.proficient).toBe(true);
    expect(athletics.modifier).toBe(sample.proficiencies!.skills!.find((s) => s.name === 'Athletics')!.modifier);
    const arcana = list.find((s) => s.name === 'Arcana')!;
    expect(arcana.proficient).toBe(false);
    expect(arcana.modifier).toBe(abilityMod(sample, 'INT'));
    expect(passives(sample)[0][1]).toBe(sample.derived!.passivePerception);
    expect(abilities(sample)).toHaveLength(6);
    // Turn-list features don't repeat on the explore board.
    expect(utilityFeatures(sample).some((f) => f.id === 'second_wind')).toBe(false);
  });

  it('saves use proficiency when the sheet has no totals', () => {
    const s = sheet({
      abilityScores: { final: { STR: 16, DEX: 10 } },
      proficiencies: { savingThrows: ['Strength'] },
      derived: { level: 5, proficiencyBonus: 3 },
    });
    expect(abilities(s)).toEqual([
      { ability: 'STR', score: 16, check: 3, save: 6, saveProficient: true },
      { ability: 'DEX', score: 10, check: 0, save: 0, saveProficient: false },
    ]);
    expect(passives(s).map(([, v]) => v)).toEqual([10, 10, 10]);
  });
});
