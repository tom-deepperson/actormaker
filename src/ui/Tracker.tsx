/** Live tracker. Mirrors android/.../ui/TrackerControls.kt. */
import { useState } from 'preact/hooks';
import { abilityModifier, type Feature, formatModifier, restLabel } from '../data/model';
import {
  adjustHp, afterRest, applyDamage, applyHealing, hitDiceRemainingByDie, hitDiceTotals, PACT, restoreSpellSlot,
  setFeatureUses, setHp, slotLabel, slotsRemaining, spellSlotMax, spendHitDie, useFeature, useSpellSlot,
} from '../data/tracker';
import type { CharacterHandle, CharacterState } from './useCharacter';
import { Card, Dialog, RulesLink } from './common';

export function HpCard({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  const t = c.tracker;
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState(false);
  const n = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(n) && n > 0;
  const pct = t.maxHp > 0 ? Math.max(0, Math.min(100, (t.currentHp / t.maxHp) * 100)) : 0;
  const apply = (fn: (v: number) => void) => {
    if (!valid) return;
    fn(Math.floor(n));
    setAmount('');
  };
  return (
    <Card title="Hit points" right={<button class="small ghost" onClick={() => setEditing(true)}>Set…</button>}>
      <div class="row between">
        <div>
          <span class="hp-big">{t.currentHp}</span>
          <span class="muted"> / {t.maxHp}</span>
          {t.tempHp > 0 && <span class="tag" style={{ marginLeft: 8 }}>+{t.tempHp} temp</span>}
        </div>
        <div class="row" style={{ flexWrap: 'nowrap' }}>
          <button class="icon" aria-label="Lose 1 HP" onClick={() => h.updateTracker((x) => adjustHp(x, -1))}>−</button>
          <button class="icon" aria-label="Gain 1 HP" onClick={() => h.updateTracker((x) => adjustHp(x, 1))}>+</button>
        </div>
      </div>
      <div class="hp-bar"><div class={pct <= 25 ? 'low' : ''} style={{ width: `${pct}%` }} /></div>
      <div class="hp-entry">
        <input
          aria-label="Amount"
          inputMode="numeric"
          placeholder="Amount"
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))}
        />
        <button class="danger" disabled={!valid} onClick={() => apply((v) => h.updateTracker((x) => applyDamage(x, v)))}>Damage</button>
        <button disabled={!valid} onClick={() => apply((v) => h.updateTracker((x) => applyHealing(x, v)))}>Heal</button>
        <button disabled={!valid} onClick={() => apply((v) => h.updateTracker((x) => setHp(x, null, null, Math.max(x.tempHp, v))))}>Temp</button>
      </div>
      <div class="tiny muted" style={{ marginTop: 6 }}>Damage uses temp HP first. Temp HP doesn't stack: you keep the higher value.</div>
      {editing && <SetHpDialog c={c} h={h} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function SetHpDialog({ c, h, onClose }: { c: CharacterState; h: CharacterHandle; onClose: () => void }) {
  const t = c.tracker;
  const [cur, setCur] = useState(String(t.currentHp));
  const [temp, setTemp] = useState(String(t.tempHp));
  const [max, setMax] = useState(String(t.maxHp));
  const num = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.floor(Number(s)) || 0));
  return (
    <Dialog
      title="Set HP"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            class="primary"
            onClick={() => {
              h.updateTracker((x) => setHp(x, num(cur), num(max), num(temp)));
              onClose();
            }}
          >
            Apply HP
          </button>
        </>
      }
    >
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        <label class="field">Current HP<input inputMode="numeric" value={cur} onInput={(e) => setCur((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Temp HP<input inputMode="numeric" value={temp} onInput={(e) => setTemp((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Max HP<input inputMode="numeric" value={max} onInput={(e) => setMax((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="tiny muted">Max HP is normally {c.sheet.derived?.hitPoints?.total ?? '—'} from the sheet; change it only for effects like a reduced maximum.</div>
      <div class="row">
        <button class="small" onClick={() => setCur(String(t.maxHp))}>Full HP</button>
        <button class="small" onClick={() => setTemp('0')}>Clear temp HP</button>
      </div>
    </Dialog>
  );
}

export function TrackerCard({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  const [confirm, setConfirm] = useState<null | 'short' | 'long'>(null);
  const edition = c.sheet.edition?.trim() === '2024' ? '2024' : '2014';
  return (
    <Card title="Live tracker">
      <HitDice c={c} h={h} />
      <SpellSlots c={c} h={h} />
      <h3>Rests</h3>
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        <button class="grow" onClick={() => setConfirm('short')}>Short rest</button>
        <button class="grow" onClick={() => setConfirm('long')}>Long rest</button>
      </div>
      <FeatureUses c={c} h={h} />
      {confirm && (
        <Dialog
          title={confirm === 'short' ? 'Take a short rest?' : 'Take a long rest?'}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button
                class="primary"
                onClick={() => {
                  h.updateTracker((t, s) => afterRest(t, s, confirm, Date.now()));
                  setConfirm(null);
                }}
              >
                Rest
              </button>
            </>
          }
        >
          {confirm === 'short' ? (
            <p class="small">Short-rest features and pact slots come back. Spend hit dice yourself above to heal.</p>
          ) : (
            <p class="small">
              HP to max, temp HP gone, all features and spell slots back.{' '}
              {edition === '2024' ? 'All spent hit dice come back (2024 rules).' : 'Up to half your hit dice come back, largest first (2014 rules).'}
            </p>
          )}
        </Dialog>
      )}
    </Card>
  );
}

function HitDice({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  const totals = hitDiceTotals(c.sheet);
  const left = hitDiceRemainingByDie(c.tracker, c.sheet);
  const con = c.sheet.abilityScores?.final?.CON;
  const conMod = con !== undefined ? abilityModifier(con) : 0;
  return (
    <>
      <h3>Hit dice</h3>
      {[...totals].map(([die, total]) => {
        const l = left.get(die) ?? 0;
        return (
          <div class="row between" key={die} style={{ padding: '2px 0' }}>
            <span>
              <b>{die}</b>: {l} / {total}
            </span>
            <button class="small" disabled={l <= 0} onClick={() => h.updateTracker((t, s) => spendHitDie(t, s, die))}>
              Spend {die}
            </button>
          </div>
        );
      })}
      <div class="tiny muted">Spending a die doesn't heal by itself: roll it, add CON ({formatModifier(conMod)}), then Heal above.</div>
    </>
  );
}

function SpellSlots({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  const max = spellSlotMax(c.sheet);
  if (max.size === 0) return null;
  return (
    <>
      <h3>Spell slots</h3>
      {[...max].map(([key, count]) => {
        const left = slotsRemaining(c.tracker, c.sheet, key);
        return (
          <div class="row" key={key} style={{ flexWrap: 'nowrap', padding: '3px 0' }}>
            <div style={{ width: 120, flexShrink: 0 }}>
              <div class="small">{slotLabel(c.sheet, key)}</div>
              <div class="tiny muted">{left} / {count}{key === PACT ? ' · short rest' : ''}</div>
            </div>
            <div class="pips">
              {Array.from({ length: count }, (_, i) => {
                const available = i < left;
                return (
                  <button
                    key={i}
                    class={`pip ${available ? 'full' : ''}`}
                    aria-label={available ? `Spend ${slotLabel(c.sheet, key)} slot` : 'Restore slot'}
                    onClick={() => h.updateTracker((t, s) => (available ? useSpellSlot(t, s, key) : restoreSpellSlot(t, key)))}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <div class="tiny muted">Tap a filled circle to spend a slot, an empty one to give it back.</div>
    </>
  );
}

function FeatureUses({ c, h }: { c: CharacterState; h: CharacterHandle }) {
  const limited = c.sheet.features.filter((f): f is Feature & { uses: NonNullable<Feature['uses']> } => !!f.uses);
  if (!limited.length) return null;
  return (
    <>
      <h3>Feature uses</h3>
      <ul class="plain">
        {limited.map((f) => {
          const left = c.tracker.featureUses[f.id] ?? f.uses.max;
          return (
            <li key={f.id} class="row between">
              <div class="grow">
                <RulesLink name={f.name} text={f.rulesText} meta={f.source ?? undefined} />
                <div class="tiny muted">
                  {left} / {f.uses.max} per {restLabel(f.uses.per).replace('per ', '')}
                </div>
              </div>
              <div class="row" style={{ flexWrap: 'nowrap' }}>
                <button class="small" disabled={left <= 0} onClick={() => h.updateTracker((t) => useFeature(f.id in t.featureUses ? t : setFeatureUses(t, f.id, f.uses.max), f.id))}>Use</button>
                <button class="small ghost" onClick={() => h.updateTracker((t) => setFeatureUses(t, f.id, f.uses.max))}>Reset</button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
