/** Combat view. Mirrors android/.../ui/CondensedCombatView.kt and combat/EffectsSheet.kt. */
import { useState } from 'preact/hooks';
import { formatModifier } from '../data/model';
import {
  type ActiveEffect, type EconomySlot, advanceTurn, autoEnterEffects, CONDITIONS, conditionToEffect, createEffect, EndsOn,
  enterCombat, exitCombat, isUsed, toggleEconomy,
} from '../data/combat';
import { effectiveSpeed, summarize } from '../data/encumbrance';
import { type SheetViewContext, sheetTitle, shouldHideSecretIdentity } from '../data/viewContext';
import type { CharacterHandle, CharacterState } from './useCharacter';
import { Card, Dialog } from './common';
import { CombatBoard } from './CombatBoard';
import { HpCard, TrackerCard } from './Tracker';

interface Props {
  c: CharacterState;
  h: CharacterHandle;
  ctx: SheetViewContext;
  trackEncumbrance: boolean;
}

export function CombatView({ c, h, ctx, trackEncumbrance }: Props) {
  const [turnMenu, setTurnMenu] = useState(false);
  const [addEffect, setAddEffect] = useState(false);
  const [selected, setSelected] = useState<ActiveEffect | null>(null);
  const session = c.combat;
  const inCombat = session.active;
  const giantsMight = session.effects.some((e) => /giant/i.test(e.name) && /might/i.test(e.name));
  const inscribed = c.sheet.runes?.inscribed ?? {};

  const hideSecret = shouldHideSecretIdentity(ctx, c.sheet.identity);
  const boosts = [
    ...(giantsMight ? ["Giant's Might active: Large; +1d6 once per turn on a weapon hit; advantage on STR checks and saves."] : []),
    ...Object.entries(inscribed)
      .filter(([, rune]) => !(hideSecret && /eclipse/i.test(rune)))
      .map(([item, rune]) => `${rune} rune on ${humanizeKey(item)}`),
  ];

  return (
    <>
      <VitalsCard c={c} ctx={ctx} trackEncumbrance={trackEncumbrance} />
      <CombatBoard c={c} h={h} hideSecret={hideSecret} boosts={boosts} />
      {inCombat && session.effects.length > 0 && (
        <Card title="Active effects">
          <EffectList effects={session.effects} onPick={setSelected} />
        </Card>
      )}
      <HpCard c={c} h={h} />
      <TrackerCard c={c} h={h} />

      <button class={`fab ${inCombat ? 'combat' : ''}`} onClick={() => setTurnMenu(true)}>
        {inCombat ? `⚔ Round ${session.round}` : '⚔ Turn'}
      </button>

      {turnMenu && (
        <Dialog title="Turn" onClose={() => setTurnMenu(false)}>
          {inCombat ? (
            <>
              <div class="strong">Round {session.round}</div>
              <Economy c={c} h={h} />
              <div class="row" style={{ flexWrap: 'nowrap' }}>
                <button class="grow primary" onClick={() => h.updateCombat(advanceTurn)}>End turn</button>
                <button class="grow" onClick={() => setAddEffect(true)}>+ Effect</button>
              </div>
              {session.effects.length > 0 && <EffectList effects={session.effects} onPick={setSelected} />}
              <ExitCombat
                onExit={(clear) => {
                  h.updateCombat((s) => exitCombat(s, clear));
                  setTurnMenu(false);
                }}
              />
            </>
          ) : (
            <>
              <p class="small">Not in combat. Start a session to track your action economy, rounds and effect timers.</p>
              <button
                class="primary wide"
                onClick={() => h.updateCombat((s, sheet) => enterCombat(s.slug, s, autoEnterEffects(sheet)))}
              >
                Enter combat
              </button>
            </>
          )}
        </Dialog>
      )}
      {addEffect && (
        <AddEffectDialog
          onClose={() => setAddEffect(false)}
          onAdd={(e) => {
            h.updateCombat((s) => ({ ...s, effects: [...s.effects, e] }));
            setAddEffect(false);
          }}
        />
      )}
      {selected && (
        <Dialog
          title={selected.name}
          onClose={() => setSelected(null)}
          actions={
            <>
              <button
                class="danger"
                onClick={() => {
                  h.updateCombat((s) => ({ ...s, effects: s.effects.filter((e) => e.id !== selected.id) }));
                  setSelected(null);
                }}
              >
                Remove
              </button>
              <button onClick={() => setSelected(null)}>Close</button>
            </>
          }
        >
          <div class="small">Kind: {selected.kind}</div>
          <div class="small">Ends: {selected.endsOn.replace(/_/g, ' ')}</div>
          {selected.roundsRemaining != null && <div class="small">Rounds left: {selected.roundsRemaining}</div>}
          {selected.source && <div class="small">Source: {selected.source}</div>}
          {selected.notes && <div class="small">{selected.notes}</div>}
        </Dialog>
      )}
    </>
  );
}

function VitalsCard({ c, ctx, trackEncumbrance }: { c: CharacterState; ctx: SheetViewContext; trackEncumbrance: boolean }) {
  const d = c.sheet.derived;
  const enc = summarize(c.sheet, trackEncumbrance);
  const speed = enc.trackingEnabled ? effectiveSpeed(d?.speed, enc.status) : d?.speed;
  return (
    <Card>
      <div class="strong" style={{ marginBottom: 8 }}>{sheetTitle(c.sheet, ctx)}</div>
      <div class="stats">
        <div class="stat"><b>{d?.armorClass ?? '—'}</b><span>AC</span></div>
        <div class="stat"><b>{d?.initiative != null ? formatModifier(d.initiative) : '—'}</b><span>Init</span></div>
        <div class="stat"><b>{speed ?? '—'}</b><span>Speed</span></div>
        <div class="stat"><b>{d?.passivePerception ?? '—'}</b><span>Passive</span></div>
      </div>
      {d?.stealth && <div class="small muted" style={{ marginTop: 8 }}>Stealth: {d.stealth}</div>}
    </Card>
  );
}

const SLOTS: [EconomySlot, string][] = [['action', 'Action'], ['bonus', 'Bonus'], ['reaction', 'Reaction'], ['move', 'Move']];

function Economy({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  return (
    <div class="econ">
      {SLOTS.map(([slot, label]) => {
        const used = isUsed(c.combat, slot);
        return (
          <button key={slot} class={used ? 'used' : ''} aria-pressed={used} onClick={() => h.updateCombat((s) => toggleEconomy(s, slot))}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function EffectList({ effects, onPick }: { effects: ActiveEffect[]; onPick: (e: ActiveEffect) => void }) {
  return (
    <div class="row">
      {effects.map((e) => (
        <button class="small" key={e.id} onClick={() => onPick(e)}>
          {e.name} · {e.roundsRemaining != null ? `${e.roundsRemaining} rd` : e.endsOn.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}

function ExitCombat({ onExit }: { onExit: (clearTimed: boolean) => void }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button class="danger wide" onClick={() => setAsk(true)}>Exit combat</button>;
  return (
    <div class="banner stack">
      <div class="small">Exit combat: clear timed buffs and debuffs, or keep them?</div>
      <div class="row">
        <button class="small danger" onClick={() => onExit(true)}>Clear timed</button>
        <button class="small" onClick={() => onExit(false)}>Keep effects</button>
        <button class="small ghost" onClick={() => setAsk(false)}>Cancel</button>
      </div>
    </div>
  );
}

function AddEffectDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (e: ActiveEffect) => void }) {
  const [name, setName] = useState('');
  const [rounds, setRounds] = useState('10');
  return (
    <Dialog title="Add status effect" onClose={onClose}>
      <h3 class="muted small" style={{ margin: 0 }}>Custom</h3>
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        <label class="field">Name<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="field" style={{ maxWidth: 110 }}>Rounds<input inputMode="numeric" placeholder="until cleared" value={rounds} onInput={(e) => setRounds((e.target as HTMLInputElement).value)} /></label>
      </div>
      <button
        disabled={!name.trim()}
        onClick={() => {
          const r = rounds.trim() === '' ? null : Math.floor(Number(rounds)) || null;
          onAdd(createEffect({ name: name.trim(), kind: 'buff', source: 'manual', roundsRemaining: r, endsOn: r != null ? EndsOn.END_OF_YOUR_TURN : EndsOn.PERMANENT }));
        }}
      >
        Add custom
      </button>
      <h3 class="muted small" style={{ margin: '8px 0 0' }}>Typical conditions and buffs</h3>
      <ul class="plain">
        {CONDITIONS.map((t) => (
          <li key={t.id}>
            <button class="link" onClick={() => onAdd(conditionToEffect(t))}>{t.name}</button>
            {t.notes && <div class="tiny muted">{t.notes}</div>}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** "halfPlate" / "half_plate" -> "half plate". */
const humanizeKey = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
