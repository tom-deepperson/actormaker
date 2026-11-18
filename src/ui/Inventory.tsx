/** Inventory and coin purse. Mirrors archive/android/.../ui/InventorySection.kt and ui/CoinPurse.kt. */
import { useState } from 'preact/hooks';
import {
  type CharacterSheet, type ConsumableEntry, type EquipmentEntry, type MagicItem, equipmentLabel, formatWeightLb,
  normalizedForSave, resolvedEquipmentLocations,
} from '../data/model';
import { type Coin, COINS, type Coins, coinCount, coinLabel, coins as mkCoins, gain, spend, valueGpLabel, wealthCoins, withCoins } from '../data/coins';
import { coinWeightLb, penaltyDescription, statusLabel, summarize } from '../data/encumbrance';
import type { CharacterHandle, CharacterState } from './useCharacter';
import { Card, Dialog, RulesLink } from './common';

const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);
const parseNum = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function CoinPurse({ value, onChange }: { value: Coins; onChange: (c: Coins) => void }) {
  const [amount, setAmount] = useState('');
  const [coin, setCoin] = useState<Coin>('gp');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const n = Math.floor(Number(amount));
  const valid = amount.trim() !== '' && n > 0;
  return (
    <div class="stack">
      <div>
        <div class="strong" style={{ fontSize: '1.1rem' }}>{coinLabel(value)}</div>
        <div class="tiny muted">
          Worth {valueGpLabel(value)} · {coinCount(value)} coins weigh {formatWeightLb(coinWeightLb(value))} (50 coins = 1 lb)
        </div>
      </div>
      <div class="seg" role="group" aria-label="Coin">
        {COINS.map(({ coin: c }) => (
          <button key={c} aria-pressed={coin === c} onClick={() => setCoin(c)}>{c}</button>
        ))}
      </div>
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        <input
          aria-label={`Amount (${coin})`}
          placeholder={`Amount (${coin})`}
          inputMode="numeric"
          value={amount}
          onInput={(e) => {
            setAmount((e.target as HTMLInputElement).value.replace(/[^\d]/g, '').slice(0, 7));
            setError(null);
          }}
        />
        <button class="primary" disabled={!valid} onClick={() => { onChange(gain(value, n, coin)); setAmount(''); }}>Gain</button>
        <button
          disabled={!valid}
          onClick={() => {
            const paid = spend(value, n, coin);
            if (!paid) setError(`Not enough coins (you have ${valueGpLabel(value)}).`);
            else {
              onChange(paid);
              setAmount('');
            }
          }}
        >
          Spend
        </button>
      </div>
      {error && <div class="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div class="tiny muted">Spending makes change: it uses that coin first, then smaller ones, then breaks a larger coin.</div>
      <div><button class="small ghost" onClick={() => setEditing(true)}>Set exact amounts…</button></div>
      {editing && <ExactCoins value={value} onClose={() => setEditing(false)} onSave={(c) => { onChange(c); setEditing(false); }} />}
    </div>
  );
}

function ExactCoins({ value, onClose, onSave }: { value: Coins; onClose: () => void; onSave: (c: Coins) => void }) {
  const [draft, setDraft] = useState<Record<Coin, string>>({ pp: String(value.pp), gp: String(value.gp), ep: String(value.ep), sp: String(value.sp), cp: String(value.cp) });
  return (
    <Dialog
      title="Coins"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button class="primary" onClick={() => onSave(mkCoins(Object.fromEntries(COINS.map(({ coin }) => [coin, Math.max(0, Math.floor(Number(draft[coin])) || 0)]))))}>Save</button>
        </>
      }
    >
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        {COINS.map(({ coin }) => (
          <label class="field" key={coin}>
            {coin}
            <input inputMode="numeric" value={draft[coin]} onInput={(e) => setDraft({ ...draft, [coin]: (e.target as HTMLInputElement).value.replace(/[^\d]/g, '') })} />
          </label>
        ))}
      </div>
    </Dialog>
  );
}

type AddKind = null | 'equipment' | 'consumable' | 'magic' | 'location' | { location: number };

export function InventorySection({ c, h, trackEncumbrance, onSetTrackEncumbrance }: {
  c: CharacterState;
  h: CharacterHandle;
  trackEncumbrance: boolean;
  onSetTrackEncumbrance: (v: boolean) => void;
}) {
  const s = c.sheet;
  const [adding, setAdding] = useState<AddKind>(null);
  const [stashing, setStashing] = useState<number | null>(null);
  const enc = summarize(s, trackEncumbrance);
  const rule = s.constraints?.encumbranceRule?.trim().toLowerCase();
  const locations = resolvedEquipmentLocations(s);
  const update = (fn: (x: CharacterSheet) => CharacterSheet) => h.updateSheet(fn);
  const updateLocations = (fn: (locs: ReturnType<typeof resolvedEquipmentLocations>) => ReturnType<typeof resolvedEquipmentLocations>) =>
    update((x) => ({ ...normalizedForSave(x), equipmentLocations: fn(resolvedEquipmentLocations(x).map((l) => ({ ...l, equipment: [...l.equipment] }))) }));

  return (
    <Card title="Inventory" id="inventory">
      <h3 style={{ marginTop: 0 }}>Coins</h3>
      <CoinPurse value={wealthCoins(s.wealth)} onChange={(cn) => update((x) => ({ ...x, wealth: withCoins(x.wealth ?? {}, cn) }))} />
      {s.wealth?.notes && <div class="tiny muted" style={{ marginTop: 6 }}>{s.wealth.notes}</div>}

      <h3>Encumbrance</h3>
      {rule === 'none' || rule === 'variant' ? (
        <div class="tiny muted">Table rule on this sheet: {rule === 'none' ? 'encumbrance not used' : 'variant encumbrance'}.</div>
      ) : (
        <label class="check small">
          <input type="checkbox" checked={trackEncumbrance} onChange={(e) => onSetTrackEncumbrance((e.target as HTMLInputElement).checked)} />
          Track encumbrance (optional rule)
        </label>
      )}
      <div class={`banner ${enc.status !== 'normal' ? 'warn' : ''}`} style={{ marginTop: 6 }}>
        Carrying {formatWeightLb(enc.totalKnownLb)} (coins {formatWeightLb(enc.coinLb)})
        {enc.unknownCount > 0 && <span class="muted"> + {enc.unknownCount} item{enc.unknownCount > 1 ? 's' : ''} without a weight</span>}
        {enc.trackingEnabled && (
          <div class="small">
            {statusLabel(enc.status)} · STR {enc.strength}: {enc.encumberedThresholdLb} / {enc.heavilyEncumberedThresholdLb} / {enc.maxCapacityLb} lb
            {penaltyDescription(enc.status) && <div class="strong">{penaltyDescription(enc.status)}</div>}
          </div>
        )}
      </div>

      <h3>Consumables</h3>
      <ul class="plain">
        {s.consumables.map((item, i) => (
          <li key={i} class="row between">
            <div class="grow">
              <RulesLink name={item.name} text={item.rulesText} />
              {item.weightLb != null && <span class="tiny muted"> — {formatWeightLb(item.weightLb * Math.max(1, item.quantity))}</span>}
              {item.totalPriceGp != null && <div class="tiny muted">{item.totalPriceGp} gp total</div>}
            </div>
            <div class="row" style={{ flexWrap: 'nowrap' }}>
              <button class="small icon" aria-label={`Use one ${item.name}`} onClick={() => update((x) => setConsumableQty(x, i, item.quantity - 1))}>−</button>
              <span class="strong" style={{ minWidth: 24, textAlign: 'center' }}>{item.quantity}</span>
              <button class="small icon" aria-label={`Add one ${item.name}`} onClick={() => update((x) => setConsumableQty(x, i, item.quantity + 1))}>+</button>
            </div>
          </li>
        ))}
      </ul>
      <button class="small ghost" onClick={() => setAdding('consumable')}>+ Add consumable</button>

      <h3>Carried</h3>
      <ul class="plain">
        {s.equipment.map((e, i) => (
          <li key={i} class="row between">
            <span class="grow small">{equipmentLabel(e)}</span>
            {locations.length > 0 && <button class="small ghost" onClick={() => setStashing(i)}>Stash</button>}
            <RemoveButton label={e.name} onRemove={() => update((x) => ({ ...x, equipment: without(x.equipment, i) }))} />
          </li>
        ))}
      </ul>
      <button class="small ghost" onClick={() => setAdding('equipment')}>+ Add carried item</button>

      {locations.map((loc, li) => (
        <div key={li}>
          <div class="row between">
            <h3>Stored: {loc.location}</h3>
            <RemoveButton label={`location ${loc.location}`} onRemove={() => updateLocations((l) => without(l, li))} />
          </div>
          {loc.notes && <div class="tiny muted">{loc.notes}</div>}
          <ul class="plain">
            {loc.equipment.map((e, ei) => (
              <li key={ei} class="row between">
                <span class="grow small">{equipmentLabel(e)}</span>
                <button
                  class="small ghost"
                  onClick={() =>
                    update((x) => {
                      const locs = resolvedEquipmentLocations(x).map((l) => ({ ...l, equipment: [...l.equipment] }));
                      const [item] = locs[li].equipment.splice(ei, 1);
                      return { ...normalizedForSave(x), equipment: [...x.equipment, item], equipmentLocations: locs };
                    })
                  }
                >
                  Take
                </button>
                <RemoveButton label={e.name} onRemove={() => updateLocations((l) => { l[li].equipment.splice(ei, 1); return l; })} />
              </li>
            ))}
          </ul>
          <button class="small ghost" onClick={() => setAdding({ location: li })}>+ Add item here</button>
        </div>
      ))}
      <div><button class="small ghost" onClick={() => setAdding('location')}>+ Add storage location</button></div>

      <h3>Magic items</h3>
      <ul class="plain">
        {s.magicItems.map((m, i) => (
          <li key={i} class="row between">
            <div class="grow">
              <RulesLink name={m.name} text={m.rulesText ?? m.notes} meta={[m.rarity, m.source].filter(Boolean).join(' · ')} />
              <div class="tiny muted">{[m.rarity, m.notes, m.weightLb != null ? formatWeightLb(m.weightLb) : null].filter(Boolean).join(' · ')}</div>
            </div>
            <RemoveButton label={m.name} onRemove={() => update((x) => ({ ...x, magicItems: without(x.magicItems, i) }))} />
          </li>
        ))}
      </ul>
      <button class="small ghost" onClick={() => setAdding('magic')}>+ Add magic item</button>

      {adding === 'equipment' && <ItemDialog kind="equipment" onClose={() => setAdding(null)} onAdd={(e) => update((x) => ({ ...x, equipment: [...x.equipment, e as EquipmentEntry] }))} />}
      {adding === 'consumable' && <ItemDialog kind="consumable" onClose={() => setAdding(null)} onAdd={(e) => update((x) => ({ ...x, consumables: [...x.consumables, e as ConsumableEntry] }))} />}
      {adding === 'magic' && <ItemDialog kind="magic" onClose={() => setAdding(null)} onAdd={(e) => update((x) => ({ ...x, magicItems: [...x.magicItems, e as MagicItem] }))} />}
      {typeof adding === 'object' && adding !== null && (
        <ItemDialog kind="equipment" onClose={() => setAdding(null)} onAdd={(e) => updateLocations((l) => { l[adding.location].equipment.push(e as EquipmentEntry); return l; })} />
      )}
      {adding === 'location' && <LocationDialog onClose={() => setAdding(null)} onAdd={(loc) => updateLocations((l) => [...l, loc])} />}
      {stashing !== null && (
        <Dialog title="Stash at location" onClose={() => setStashing(null)}>
          {locations.map((loc, li) => (
            <button
              key={li}
              class="wide"
              onClick={() => {
                update((x) => {
                  const locs = resolvedEquipmentLocations(x).map((l) => ({ ...l, equipment: [...l.equipment] }));
                  const item = x.equipment[stashing];
                  if (!item) return x;
                  locs[li].equipment.push(item);
                  return { ...normalizedForSave(x), equipment: without(x.equipment, stashing), equipmentLocations: locs };
                });
                setStashing(null);
              }}
            >
              {loc.location}
            </button>
          ))}
        </Dialog>
      )}
    </Card>
  );
}

function setConsumableQty(x: CharacterSheet, i: number, qty: number): CharacterSheet {
  if (qty <= 0) return { ...x, consumables: without(x.consumables, i) };
  return {
    ...x,
    consumables: x.consumables.map((c, j) =>
      j === i ? { ...c, quantity: qty, totalPriceGp: c.unitPriceGp != null ? c.unitPriceGp * qty : c.totalPriceGp } : c,
    ),
  };
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  const [ask, setAsk] = useState(false);
  if (ask)
    return (
      <span class="row" style={{ flexWrap: 'nowrap' }}>
        <button class="small danger" onClick={() => { onRemove(); setAsk(false); }}>Remove</button>
        <button class="small ghost" onClick={() => setAsk(false)}>Keep</button>
      </span>
    );
  return <button class="small ghost icon" aria-label={`Remove ${label}`} onClick={() => setAsk(true)}>✕</button>;
}

function ItemDialog({ kind, onClose, onAdd }: { kind: 'equipment' | 'consumable' | 'magic'; onClose: () => void; onAdd: (e: EquipmentEntry | ConsumableEntry | MagicItem) => void }) {
  const [f, setF] = useState({ name: '', qty: '1', weight: '', notes: '', price: '', rarity: '' });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const title = kind === 'equipment' ? 'Add equipment' : kind === 'consumable' ? 'Add consumable' : 'Add magic item';
  const qty = Math.max(1, Math.floor(Number(f.qty)) || 1);
  const weight = parseNum(f.weight);
  const submit = () => {
    const name = f.name.trim();
    if (!name) return;
    const notes = f.notes.trim() || null;
    if (kind === 'equipment') onAdd({ name, quantity: qty, weightLb: weight, notes });
    else if (kind === 'consumable') {
      const unit = parseNum(f.price);
      onAdd({ name, quantity: qty, unitPriceGp: unit, totalPriceGp: unit != null ? unit * qty : null, weightLb: weight, rulesText: notes });
    } else onAdd({ name, rarity: f.rarity.trim() || null, weightLb: weight, notes });
    onClose();
  };
  return (
    <Dialog title={title} onClose={onClose} actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!f.name.trim()} onClick={submit}>Add</button></>}>
      <label class="field">Name<input value={f.name} onInput={set('name')} /></label>
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        {kind !== 'magic' && <label class="field">Quantity<input inputMode="numeric" value={f.qty} onInput={set('qty')} /></label>}
        <label class="field">{kind === 'magic' ? 'Weight (lb)' : 'Weight each (lb)'}<input inputMode="decimal" value={f.weight} onInput={set('weight')} /></label>
        {kind === 'consumable' && <label class="field">Unit price (gp)<input inputMode="numeric" value={f.price} onInput={set('price')} /></label>}
      </div>
      {kind === 'magic' && <label class="field">Rarity<input value={f.rarity} onInput={set('rarity')} /></label>}
      <label class="field">{kind === 'consumable' ? 'Effect / rules' : 'Notes (optional)'}<input value={f.notes} onInput={set('notes')} /></label>
    </Dialog>
  );
}

function LocationDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (l: { location: string; notes?: string; equipment: EquipmentEntry[] }) => void }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Dialog
      title="Add storage location"
      onClose={onClose}
      actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!name.trim()} onClick={() => { onAdd({ location: name.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}), equipment: [] }); onClose(); }}>Add</button></>}
    >
      <label class="field">Location name<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <label class="field">Notes (optional)<input value={notes} onInput={(e) => setNotes((e.target as HTMLInputElement).value)} /></label>
    </Dialog>
  );
}
