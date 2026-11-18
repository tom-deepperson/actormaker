/**
 * Port of archive/android/.../data/DmHandoffExporter.kt: a play-ready text snapshot for whoever runs the
 * character while the player is away. Plain text with light Markdown.
 */
import {
  type CharacterSheet,
  abilityModifier,
  actionBuckets,
  displayName,
  humanizeKey,
  equipmentLabel,
  formatModifier,
  isSecretBite,
  level,
  maxHp,
  resolvedEquipmentLocations,
  restLabel,
  slugHint,
} from './model';
import { classLabel } from './classes';
import { coinCount, coinLabel, valueGpLabel, wealthCoins } from './coins';
import { type TrackerState, hitDiceRemainingByDie, hitDiceTotals, slotLabel, slotsRemaining, spellSlotMax } from './tracker';
import type { CombatSession } from './combat';

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface HandoffOptions {
  sheet: CharacterSheet;
  tracker: TrackerState | null;
  combat: CombatSession | null;
  dateLabel: string;
  includeSecrets: boolean;
  playerNotes?: string;
}

export function buildHandoff({ sheet, tracker, combat, dateLabel, includeSecrets, playerNotes = '' }: HandoffOptions): string {
  const out: string[] = [];
  const line = (t = '') => out.push(t);
  const bullet = (t: string) => line(`- ${t}`);
  const section = (t: string) => {
    line();
    line(`## ${t}`);
  };

  const identity = sheet.identity;
  const alias = identity?.cultAlias?.trim() ?? '';
  const trueName = identity?.name?.trim() ?? '';
  const shownName =
    includeSecrets && trueName && alias ? `${trueName} ("${alias}")` : alias ? alias : displayName(sheet);

  line(`# ${shownName}: session handoff`);
  line();
  const classLine = [identity?.race ?? identity?.species, classLabel(sheet) || null].filter(Boolean).join(' ');
  line(`Level ${level(sheet)} ${classLine}`.trim());
  const meta = [
    identity?.background ? `Background: ${identity.background}` : null,
    identity?.alignment ? `Alignment: ${identity.alignment}` : null,
    sheet.edition ? `D&D 5e (${sheet.edition})` : null,
  ].filter(Boolean);
  if (meta.length) line(meta.join(' · '));
  line(`State as of ${dateLabel}`);
  if (!includeSecrets) line('(Player-safe copy: DM-only secrets left out.)');

  if (playerNotes.trim()) {
    section("Player's notes for this session");
    line(playerNotes.trim());
  }

  section('Current status');
  const derived = sheet.derived;
  if (tracker) {
    const temp = tracker.tempHp > 0 ? ` (+${tracker.tempHp} temp)` : '';
    bullet(`HP: ${tracker.currentHp} / ${tracker.maxHp}${temp}`);
    const left = hitDiceRemainingByDie(tracker, sheet);
    bullet('Hit dice: ' + [...hitDiceTotals(sheet)].map(([die, total]) => `${left.get(die) ?? 0} / ${total}${die}`).join(', '));
    const slots = spellSlotMax(sheet);
    if (slots.size > 0) {
      bullet('Spell slots left: ' + [...slots].map(([k, max]) => `${slotLabel(sheet, k)} ${slotsRemaining(tracker, sheet, k)}/${max}`).join(', '));
    }
  } else {
    bullet(`HP: ${maxHp(sheet)} max (no tracked current HP)`);
  }
  const limited = sheet.features.filter((f) => f.uses);
  if (limited.length) {
    bullet('Limited uses remaining:');
    for (const f of limited) {
      const left = tracker?.featureUses[f.id] ?? f.uses!.max;
      line(`  - ${f.name}: ${left} / ${f.uses!.max} (${restLabel(f.uses!.per)})`);
    }
  }
  const effects = combat?.effects ?? [];
  if (effects.length) {
    bullet('Active effects: ' + effects.map((e) => e.name + (e.roundsRemaining != null ? ` (${e.roundsRemaining} rds)` : '')).join(', '));
  }
  const purse = wealthCoins(sheet.wealth);
  if (sheet.wealth && coinCount(purse) > 0) bullet(`Coins: ${coinLabel(purse)} (worth ${valueGpLabel(purse)})`);

  section('Combat stats');
  if (derived) {
    const stats = [
      derived.armorClass != null ? `AC ${derived.armorClass}` : null,
      derived.speed != null ? `Speed ${derived.speed} ft` : null,
      derived.initiative != null ? `Initiative ${formatModifier(derived.initiative)}` : null,
      `Proficiency ${formatModifier(derived.proficiencyBonus)}`,
      derived.passivePerception != null ? `Passive Perception ${derived.passivePerception}` : null,
    ].filter(Boolean);
    line(stats.join(' · '));
    if (derived.stealth) line(`Stealth: ${derived.stealth}`);
  }
  const scores = sheet.abilityScores?.final ?? {};
  if (Object.keys(scores).length) {
    line();
    line(ABILITIES.filter((a) => a in scores).map((a) => `${a} ${scores[a]} (${formatModifier(abilityModifier(scores[a]))})`).join(' · '));
  }
  const saves = derived?.savingThrows ?? {};
  if (Object.keys(saves).length) {
    const proficient = new Set((sheet.proficiencies?.savingThrows ?? []).map((s) => s.toUpperCase().slice(0, 3)));
    line(
      'Saves: ' +
        ABILITIES.filter((a) => a in saves).map((a) => `${a} ${formatModifier(saves[a])}${proficient.has(a) ? '*' : ''}`).join(' · ') +
        (proficient.size ? '  (* proficient)' : ''),
    );
  }
  const skills = sheet.proficiencies?.skills ?? [];
  if (skills.length) line('Skills: ' + skills.map((s) => s.name + (s.modifier != null ? ` ${formatModifier(s.modifier)}` : '')).join(' · '));

  const attacks = derived?.attacks ?? [];
  if (attacks.length) {
    section('Attacks');
    for (const a of attacks) {
      const parts = [
        a.bonus != null ? `${formatModifier(a.bonus)} to hit` : null,
        a.damage,
        a.reach != null ? `reach ${a.reach} ft` : null,
        a.range,
        a.notes,
      ].filter(Boolean);
      bullet(`**${a.name}**: ${parts.join('; ')}`);
    }
  }

  const buckets = actionBuckets(sheet.combatActions);
  if (buckets.length) {
    section('Turn options');
    for (const [bucket, entries] of buckets) {
      const visible = entries.filter((e) => includeSecrets || !e.secret);
      if (!visible.length) continue;
      line(`**${bucket}**`);
      visible.forEach((e) => bullet(`${e.name}: ${e.summary}`));
    }
  }

  const r = sheet.runes;
  if (r && ((r.known?.length ?? 0) > 0 || r.saveDC != null)) {
    section('Runes');
    if (r.saveDC != null) bullet(`Rune save DC: ${r.saveDC}`);
    if (r.known?.length) bullet(`Known: ${r.known.join(', ')}`);
    for (const [item, rune] of Object.entries(r.inscribed ?? {})) bullet(`${rune} rune: inscribed on ${humanizeKey(item)}`);
  }

  const sp = sheet.spells;
  if (sp && ((sp.cantrips?.length ?? 0) > 0 || (sp.known?.length ?? 0) > 0 || (sp.prepared?.length ?? 0) > 0)) {
    section('Spells');
    if (sp.ability) bullet(`Spellcasting ability: ${sp.ability}`);
    const slots = Object.entries(sp.slots ?? {});
    if (slots.length) bullet('Slots: ' + slots.map(([k, v]) => `L${k}: ${v}`).join(', '));
    if (sp.cantrips?.length) bullet(`Cantrips: ${sp.cantrips.join(', ')}`);
    if (sp.prepared?.length) bullet(`Prepared: ${sp.prepared.join(', ')}`);
    if (sp.known?.length) bullet(`Known: ${sp.known.join(', ')}`);
  }

  section('Inventory');
  if (sheet.magicItems.length) {
    line('**Magic items**');
    for (const m of sheet.magicItems) {
      const extra = [m.rarity, m.notes].filter(Boolean).join('; ');
      bullet(m.name + (extra ? ` (${extra})` : ''));
    }
  }
  if (sheet.consumables.length) {
    line('**Consumables**');
    sheet.consumables.forEach((c) => bullet(`${c.name} ×${c.quantity}`));
  }
  if (sheet.equipment.length) {
    line('**Carried**');
    sheet.equipment.forEach((e) => bullet(equipmentLabel(e)));
  }
  for (const loc of resolvedEquipmentLocations(sheet).filter((l) => l.equipment.length)) {
    line(`**Stored: ${loc.location}**`);
    loc.equipment.forEach((e) => bullet(equipmentLabel(e)));
  }

  section('Roleplay');
  if (identity?.publicPersona) line(`**Public persona:** ${identity.publicPersona}`);
  const p = sheet.personality;
  if (p) {
    if (p.traits?.length) line(`**Traits:** ${p.traits.join(' ')}`);
    if (p.ideals?.length) line(`**Ideals:** ${p.ideals.join(' ')}`);
    if (p.bonds?.length) line(`**Bonds:** ${p.bonds.join(' ')}`);
    if (p.flaws?.length) line(`**Flaws:** ${p.flaws.join(' ')}`);
    // Free-form notes often hold identity secrets; DM copy only.
    if (includeSecrets && p.notes) line(p.notes);
  }
  const bites = (sheet.cosmology?.soundBites ?? []).filter((b) => includeSecrets || !isSecretBite(b));
  if (bites.length) {
    line();
    line('**In character**');
    for (const b of bites) bullet(`*${b.prompt}*${isSecretBite(b) ? ' [DM only]' : ''}: ${b.answer}`);
  }

  if (includeSecrets) {
    const secrets = [
      trueName && alias ? `True name is ${trueName}; the party knows the character as ${alias}.` : null,
      identity?.presentationNotes ?? null,
    ].filter((s): s is string => !!s);
    if (secrets.length) {
      section('DM only');
      secrets.forEach(bullet);
    }
  }

  section('Features (full rules text)');
  for (const f of sheet.features) {
    const uses = f.uses ? ` (${f.uses.max}/${restLabel(f.uses.per)})` : '';
    line(`**${f.name}**${uses}`);
    line(f.rulesText.trim());
    line();
  }
  if (sheet.feats.length) {
    line('**Feats**');
    sheet.feats.forEach((feat) => bullet(feat.name + (feat.rulesText ? `: ${feat.rulesText}` : '')));
  }

  let text = out.map((l) => l + '\n').join('');
  // Safety net for the player-safe copy: no line may reveal a concealed true name.
  if (!includeSecrets && trueName && alias) {
    const named = new RegExp(`\\b${escapeRegex(trueName)}\\b`, 'i');
    text = text.split('\n').filter((l) => !named.test(l)).join('\n');
  }
  return text.trimEnd() + '\n';
}

export function handoffFileName(sheet: CharacterSheet, includeSecrets: boolean): string {
  const alias = sheet.identity?.cultAlias?.trim() ?? '';
  const base =
    !includeSecrets && alias ? alias.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : slugHint(sheet);
  return `${base}-handoff.txt`;
}
