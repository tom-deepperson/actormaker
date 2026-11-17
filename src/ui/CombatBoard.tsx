/**
 * Game-style turn board: economy orbs on top, then every option the character has as tappable cards,
 * filtered by cost. Tapping a card shows the full text, dice, and a Use button.
 * Mirrors android/.../ui/CombatBoard.kt.
 */
import { useMemo, useState } from 'preact/hooks';
import {
  type ActionCostId, type BoardOption, COST_ORDER, COSTS, availability, buildBoard, sessionAfterUse, usesLeft,
} from '../data/actionBoard';
import { type EconomySlot, advanceTurn, autoEnterEffects, enterCombat, isUsed, toggleEconomy } from '../data/combat';
import { exprLabel, parseDice } from '../data/dice';
import { formatModifier, restLabel } from '../data/model';
import { slotLabel, slotsRemaining, spellSlotMax, useSpellSlot } from '../data/tracker';
import type { CharacterHandle, CharacterState } from './useCharacter';
import { Dialog } from './common';
import { type RollRequest, RollDialog } from './RollDialog';

const ICON: Record<ActionCostId, string> = { action: '⚔', bonus: '⚡', reaction: '🛡', move: '➜', free: '✦', trigger: '✦' };

interface Props {
  c: CharacterState;
  h: CharacterHandle;
  hideSecret: boolean;
  boosts: string[];
}

export function CombatBoard({ c, h, hideSecret, boosts }: Props) {
  const options = useMemo(() => buildBoard(c.sheet, hideSecret), [c.sheet, hideSecret]);
  const [filter, setFilter] = useState<ActionCostId | null>(null);
  const [showStandard, setShowStandard] = useState(false);
  const [selected, setSelected] = useState<BoardOption | null>(null);
  const [rollReq, setRollReq] = useState<RollRequest | null>(null);
  const session = c.combat;
  const inCombat = session.active;

  const costs = COST_ORDER.filter((id) => options.some((o) => o.cost === id));
  const visible = options.filter((o) => filter === null || o.cost === filter);
  const own = visible.filter((o) => o.kind !== 'standard');
  const standard = visible.filter((o) => o.kind === 'standard');

  /** A card was used: one feature use, a spell slot if chosen, and its economy slot. */
  const useOption = (option: BoardOption, slotKey: string | null) => {
    if (option.featureId && option.uses) {
      const left = c.tracker.featureUses[option.featureId] ?? option.uses.max;
      if (left <= 0) return;
    }
    h.updateTracker((t, sheet) => {
      let next = t;
      if (option.featureId && option.uses) {
        const left = next.featureUses[option.featureId] ?? option.uses.max;
        next = { ...next, featureUses: { ...next.featureUses, [option.featureId]: left - 1 } };
      }
      if (slotKey) next = useSpellSlot(next, sheet, slotKey) ?? next;
      return next === t ? null : next;
    });
    if (session.active) h.updateCombat((s) => sessionAfterUse(s, option));
  };

  return (
    <>
      {inCombat ? (
        <TurnHud c={c} h={h} />
      ) : (
        <button
          class="start-combat"
          onClick={() => {
            h.updateCombat((s, sheet) => enterCombat(s.slug, s, autoEnterEffects(sheet)));
            setRollReq({ kind: 'check', title: 'Initiative', modifier: c.sheet.derived?.initiative ?? 0 });
          }}
        >
          ⚔ Roll initiative · start combat
        </button>
      )}

      {boosts.map((b) => (
        <div class="small boost" key={b}>{b}</div>
      ))}

      <div class="chips board-chips">
        <button aria-pressed={filter === null} onClick={() => setFilter(null)}>All</button>
        {costs.map((id) => (
          <button key={id} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? null : id)}>
            <span class="dot" style={{ background: `var(--c-${id})` }} /> {COSTS[id].short}
          </button>
        ))}
      </div>

      <CardGrid options={own} c={c} onPick={setSelected} />
      {standard.length > 0 && (
        <>
          <button class="wide" onClick={() => setShowStandard((v) => !v)}>
            {showStandard ? 'Hide standard actions' : `Standard actions anyone can take (${standard.length})`}
          </button>
          {showStandard && <CardGrid options={standard} c={c} onPick={setSelected} />}
        </>
      )}

      {selected && (
        <OptionSheet
          option={selected}
          c={c}
          onClose={() => setSelected(null)}
          onRoll={setRollReq}
          onUse={(slot) => {
            useOption(selected, slot);
            setSelected(null);
          }}
        />
      )}
      {rollReq && <RollDialog request={rollReq} onClose={() => setRollReq(null)} />}
    </>
  );
}

const ORBS: [EconomySlot, ActionCostId][] = [['action', 'action'], ['bonus', 'bonus'], ['reaction', 'reaction'], ['move', 'move']];

function TurnHud({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  return (
    <section class="card">
      <div class="row between">
        <div class="round-title">Round {c.combat.round}</div>
        <button class="end-turn" onClick={() => h.updateCombat(advanceTurn)}>End turn</button>
      </div>
      <div class="orbs">
        {ORBS.map(([slot, cost]) => {
          const used = isUsed(c.combat, slot);
          return (
            <button key={slot} class={`orb ${used ? 'used' : ''}`} style={{ '--c': `var(--c-${cost})` }} aria-pressed={used} onClick={() => h.updateCombat((s) => toggleEconomy(s, slot))}>
              <span class="orb-ball" aria-hidden="true">{ICON[cost]}</span>
              <span class="tiny strong">{COSTS[cost].short}{used ? ' ✓' : ''}</span>
            </button>
          );
        })}
      </div>
      <div class="tiny muted">Tap an orb to mark it spent or get it back. Using a card spends its orb for you.</div>
    </section>
  );
}

function CardGrid({ options, c, onPick }: { options: BoardOption[]; c: CharacterState; onPick: (o: BoardOption) => void }) {
  if (!options.length) return null;
  return (
    <div class="board">
      {options.map((o) => {
        const a = availability(o, c.tracker, c.combat);
        const left = usesLeft(o, c.tracker);
        return (
          <button key={o.id} class={`opt ${a !== 'ready' ? 'off' : ''}`} style={{ '--c': `var(--c-${o.cost})` }} onClick={() => onPick(o)}>
            <span class="opt-head">
              <span class="opt-cost">{ICON[o.cost]} {COSTS[o.cost].short}</span>
              {left != null && o.uses && <UsePips left={left} max={o.uses.max} />}
            </span>
            <span class="opt-name">{o.name}</span>
            <span class="opt-sum">{o.summary}</span>
            {a === 'noUses' && <span class="tiny" style={{ color: 'var(--danger)' }}>No uses left</span>}
            {a === 'economySpent' && <span class="tiny">{COSTS[o.cost].short} spent</span>}
          </button>
        );
      })}
    </div>
  );
}

function UsePips({ left, max }: { left: number; max: number }) {
  if (max > 6) return <span class="tiny strong" style={{ color: 'var(--c)' }}>{left}/{max}</span>;
  return (
    <span class="use-pips" aria-label={`${left} of ${max} uses left`}>
      {Array.from({ length: max }, (_, i) => <span key={i} class={i < left ? 'on' : ''} />)}
    </span>
  );
}

function OptionSheet(props: { option: BoardOption; c: CharacterState; onClose: () => void; onRoll: (r: RollRequest) => void; onUse: (slot: string | null) => void }) {
  const { option, c } = props;
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const cost = COSTS[option.cost];
  const a = availability(option, c.tracker, c.combat);
  const left = usesLeft(option, c.tracker);
  const slots = spellSlotMax(c.sheet);
  const inCombat = c.combat.active;
  const attack = option.attack;
  const damage = attack?.damage ? parseDice(attack.damage) : null;

  let useLabel = 'Use';
  if (option.grantsAction && inCombat) useLabel += ' · get your action back';
  else if (inCombat && cost.slot) useLabel += ` · spends ${cost.short}`;
  if (option.uses) useLabel += ' · 1 use';
  if (slotKey) useLabel += ` · ${slotLabel(c.sheet, slotKey)} slot`;
  const canTrack = !!option.uses || inCombat || slotKey !== null;

  return (
    <Dialog title={option.name} onClose={props.onClose}>
      <div class="row" style={{ marginTop: -6 }}>
        <span class="opt-cost" style={{ '--c': `var(--c-${option.cost})` }}>{ICON[option.cost]} {cost.label}</span>
      </div>
      {left != null && option.uses && (
        <div class="small">Uses left: {left} / {option.uses.max} ({restLabel(option.uses.per)})</div>
      )}
      <div>{option.summary}</div>

      {attack && (
        <>
          <div class="row">
            {attack.bonus != null && (
              <button class="primary" onClick={() => props.onRoll({ kind: 'check', title: `${attack.name}: to hit`, modifier: attack.bonus! })}>
                Roll to hit ({formatModifier(attack.bonus)})
              </button>
            )}
            {damage && (
              <button onClick={() => props.onRoll({ kind: 'damage', title: `${attack.name}: damage`, expr: damage })}>
                Roll damage ({exprLabel(damage)})
              </button>
            )}
          </div>
          {attack.notes && <div class="small muted">{attack.notes}</div>}
        </>
      )}

      {option.needsSlot && slots.size > 0 && (
        <>
          <div class="strong small">Cast with a slot</div>
          <div class="seg">
            {[...slots.keys()].map((key) => {
              const n = slotsRemaining(c.tracker, c.sheet, key);
              return (
                <button key={key} aria-pressed={slotKey === key} disabled={n <= 0} onClick={() => setSlotKey(slotKey === key ? null : key)}>
                  {slotLabel(c.sheet, key)} ({n})
                </button>
              );
            })}
          </div>
          <div class="tiny muted">Leave unselected for a ritual or a free cast.</div>
        </>
      )}

      {option.rulesText && option.rulesText.trim() && option.rulesText !== option.summary && (
        <>
          <div class="strong small">Rules</div>
          <div class="pre small">{option.rulesText}</div>
        </>
      )}

      {canTrack ? (
        <>
          <button class="use-btn" style={{ '--c': `var(--c-${option.cost})` }} disabled={a === 'noUses'} onClick={() => props.onUse(slotKey)}>
            {useLabel}
          </button>
          {a === 'economySpent' && <div class="tiny" style={{ color: 'var(--danger)' }}>Your {cost.label.toLowerCase()} is already spent this turn.</div>}
        </>
      ) : (
        <div class="tiny muted">Start combat to track your action economy.</div>
      )}
    </Dialog>
  );
}
