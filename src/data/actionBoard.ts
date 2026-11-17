/** Port of android/.../data/ActionBoard.kt: every turn option as a card, with its cost and uses. */
import type { AttackEntry, CharacterSheet, CombatActionEntry, FeatureUses } from './model';
import { formatModifier } from './model';
import type { TrackerState } from './tracker';
import { type CombatSession, type EconomySlot, isUsed, spendEconomy } from './combat';

export type ActionCostId = 'action' | 'bonus' | 'reaction' | 'move' | 'free' | 'trigger';

export interface ActionCost { id: ActionCostId; label: string; short: string; slot: EconomySlot | null }

export const COSTS: Record<ActionCostId, ActionCost> = {
  action: { id: 'action', label: 'Action', short: 'Action', slot: 'action' },
  bonus: { id: 'bonus', label: 'Bonus action', short: 'Bonus', slot: 'bonus' },
  reaction: { id: 'reaction', label: 'Reaction', short: 'Reaction', slot: 'reaction' },
  move: { id: 'move', label: 'Movement', short: 'Move', slot: 'move' },
  free: { id: 'free', label: 'Free / special', short: 'Free', slot: null },
  trigger: { id: 'trigger', label: 'On hit / trigger', short: 'Trigger', slot: null },
};
export const COST_ORDER: ActionCostId[] = ['action', 'bonus', 'reaction', 'move', 'free', 'trigger'];

export type OptionKind = 'attack' | 'feature' | 'spell' | 'standard';

export interface BoardOption {
  id: string;
  name: string;
  summary: string;
  cost: ActionCostId;
  kind: OptionKind;
  featureId?: string | null;
  uses?: FeatureUses | null;
  rulesText?: string | null;
  attack?: AttackEntry | null;
  /** True for a spell that may need a slot (anything but a cantrip). */
  needsSlot?: boolean;
  /** Using it gives the action back (Action Surge). */
  grantsAction?: boolean;
}

export type Availability = 'ready' | 'economySpent' | 'noUses';

/** The Eclipse rune is part of the hidden identity; keep it off the player-safe board even if unflagged. */
export const isSecretRune = (name: string, featureId?: string | null) => /eclipse/i.test(name) || /eclipse/i.test(featureId ?? '');
const isActionSurge = (name: string) => /action surge/i.test(name);

function bucketsInOrder(sheet: CharacterSheet): [ActionCostId, CombatActionEntry[]][] {
  const ca = sheet.combatActions;
  if (!ca) return [];
  const list: [ActionCostId, CombatActionEntry[] | undefined][] = [
    ['move', ca.movement], ['action', ca.action], ['bonus', ca.bonus],
    ['reaction', ca.reaction], ['free', ca.freeOrSpecial], ['trigger', ca.onHitOrTrigger],
  ];
  return list.map(([c, e]) => [c, e ?? []]);
}

export function buildBoard(sheet: CharacterSheet, hideSecret = false): BoardOption[] {
  const features = new Map(sheet.features.map((f) => [f.id, f]));
  const options: BoardOption[] = [];

  (sheet.derived?.attacks ?? []).forEach((a, i) => {
    options.push({ id: `attack_${i}`, name: a.name, summary: attackLine(a), cost: 'action', kind: 'attack', attack: a });
  });

  // Every feature the turn list links to, hidden entries included: a hidden secret entry's
  // feature must not come back below as an unlinked card.
  const linked = new Set<string>();
  const secretFeatures = new Set<string>();
  for (const [, entries] of bucketsInOrder(sheet)) {
    for (const e of entries) {
      if (!e.featureId) continue;
      linked.add(e.featureId);
      if (e.secret || isSecretRune(e.name, e.featureId)) secretFeatures.add(e.featureId);
    }
  }

  for (const [cost, entries] of bucketsInOrder(sheet)) {
    for (const e of entries) {
      if (hideSecret && (e.secret || isSecretRune(e.name, e.featureId))) continue;
      const feature = e.featureId ? features.get(e.featureId) : undefined;
      const surge = isActionSurge(e.name);
      options.push({
        id: `ca_${cost}_${e.id}`,
        name: e.name,
        summary: e.summary,
        cost: surge ? 'free' : cost,
        kind: 'feature',
        featureId: feature?.id ?? null,
        uses: feature?.uses ?? null,
        rulesText: e.rulesText ?? feature?.rulesText ?? null,
        grantsAction: surge,
      });
    }
  }

  // Limited-use features the turn list doesn't mention yet.
  for (const f of sheet.features) {
    if (!f.uses || linked.has(f.id)) continue;
    if (hideSecret && (isSecretRune(f.name, f.id) || secretFeatures.has(f.id))) continue;
    const surge = isActionSurge(f.name);
    options.push({
      id: `feature_${f.id}`,
      name: f.name,
      summary: firstSentence(f.rulesText),
      cost: surge ? 'free' : inferCost(f.rulesText),
      kind: 'feature',
      featureId: f.id,
      uses: f.uses,
      rulesText: f.rulesText,
      grantsAction: surge,
    });
  }

  const sp = sheet.spells;
  if (sp) {
    const cantrips = sp.cantrips ?? [];
    for (const name of cantrips) {
      options.push({ id: `cantrip_${name}`, name, summary: 'Cantrip · usually 1 action (check casting time)', cost: 'action', kind: 'spell' });
    }
    const seen = new Set<string>();
    for (const name of [...(sp.prepared ?? []), ...(sp.known ?? [])]) {
      const key = name.toLowerCase();
      if (seen.has(key) || cantrips.some((c) => c.toLowerCase() === key)) continue;
      seen.add(key);
      options.push({ id: `spell_${name}`, name, summary: 'Spell · usually 1 action (check casting time)', cost: 'action', kind: 'spell', needsSlot: true });
    }
  }

  options.push(...standardActions(sheet.edition, options));
  return options;
}

/** Guess the cost from rules text ("As a bonus action, ..."). */
export function inferCost(text: string): ActionCostId {
  const t = text.toLowerCase();
  if (t.includes('bonus action')) return 'bonus';
  if (/\breaction\b/.test(t)) return 'reaction';
  if (/\b(as an|use your|take the|take an|an) action\b/.test(t)) return 'action';
  return 'free';
}

export function usesLeft(option: BoardOption, tracker: TrackerState | null | undefined): number | null {
  if (!option.uses || !option.featureId) return null;
  return tracker?.featureUses[option.featureId] ?? option.uses.max;
}

export function availability(option: BoardOption, tracker: TrackerState | null | undefined, session: CombatSession | null | undefined): Availability {
  const left = usesLeft(option, tracker);
  if (left != null && left <= 0) return 'noUses';
  const slot = COSTS[option.cost].slot;
  if (session?.active && slot && isUsed(session, slot)) return 'economySpent';
  return 'ready';
}

/** The combat session after using `option`: spends its cost, or refreshes the action for Action Surge. */
export function sessionAfterUse(session: CombatSession, option: BoardOption): CombatSession {
  if (!session.active) return session;
  if (option.grantsAction) return { ...session, actionUsed: false };
  const slot = COSTS[option.cost].slot;
  return slot ? spendEconomy(session, slot) : session;
}

export function attackLine(a: AttackEntry): string {
  return [
    a.bonus != null ? `${formatModifier(a.bonus)} to hit` : null,
    a.damage,
    a.reach != null ? `reach ${a.reach} ft` : null,
    a.range ? `range ${a.range}` : null,
  ].filter(Boolean).join(' · ');
}

function firstSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const end = t.indexOf('. ');
  const s = end >= 1 && end <= 160 ? t.slice(0, end + 1) : t;
  return s.length > 160 ? s.slice(0, 157) + '…' : s;
}

function standardActions(edition: string | null | undefined, existing: BoardOption[]): BoardOption[] {
  const has = existing.map((o) => o.name.toLowerCase());
  const mentioned = (word: string) => has.some((n) => n.includes(word));
  const list: [string, ActionCostId, string][] = [
    ['Dash', 'action', 'Gain extra movement equal to your speed this turn.'],
    ['Disengage', 'action', "Your movement doesn't provoke opportunity attacks this turn."],
    ['Dodge', 'action', 'Attacks against you have disadvantage; you have advantage on DEX saves until your next turn.'],
    ['Help', 'action', 'Give an ally advantage on their next check, or on their next attack against a creature within 5 ft of you.'],
    ['Hide', 'action', 'Make a Dexterity (Stealth) check to hide.'],
    ['Ready', 'action', 'Choose a trigger and an action; use your reaction to take it when the trigger happens.'],
    ['Search', 'action', 'Look for something: a Wisdom (Perception) or Intelligence (Investigation) check.'],
  ];
  if (edition?.trim() === '2024') {
    list.push(
      ['Influence', 'action', "Try to sway a creature's attitude with a Charisma check."],
      ['Study', 'action', 'Recall or work out information with an Intelligence check.'],
      ['Utilize', 'action', 'Use a non-magical object that needs an action.'],
      ['Grapple / Shove', 'action', 'Replace one attack with an Unarmed Strike to grapple or push a creature.'],
    );
  } else {
    list.push(
      ['Use an Object', 'action', 'Use an object that needs your action, such as drinking a potion.'],
      ['Grapple / Shove', 'action', 'Replace one attack: Athletics contest to grapple, or shove prone or 5 ft away.'],
    );
  }
  if (!mentioned('opportunity')) list.push(['Opportunity attack', 'reaction', 'Make one melee attack when a creature you can see leaves your reach.']);
  list.push(
    ['Stand up', 'move', "Costs half your speed when you're prone."],
    ['Drop prone', 'free', 'Fall prone; no cost.'],
    ['Interact with an object', 'free', 'One free object interaction per turn: draw a weapon, open a door.'],
  );
  return list
    .filter(([name]) => !has.includes(name.toLowerCase()))
    .map(([name, cost, summary]) => ({
      id: `std_${name.toLowerCase().replace(/[^a-z]+/g, '_')}`,
      name,
      summary,
      cost,
      kind: 'standard' as const,
    }));
}
