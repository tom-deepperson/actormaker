/** Dice roller. Mirrors archive/android/.../ui/RollDialog.kt. */
import { useMemo, useState } from 'preact/hooks';
import { type DiceExpr, type RollMode, breakdown, d20, isNatural1, isNatural20, roll } from '../data/dice';
import { Dialog } from './common';

/** What to roll: a d20 check with a modifier, or a damage formula. */
export type RollRequest =
  | { kind: 'check'; title: string; modifier: number }
  | { kind: 'damage'; title: string; expr: DiceExpr };

const MODES: [RollMode, string][] = [['normal', 'Normal'], ['advantage', 'Adv'], ['disadvantage', 'Dis']];

export function RollDialog({ request, onClose }: { request: RollRequest; onClose: () => void }) {
  const [mode, setMode] = useState<RollMode>('normal');
  const [critical, setCritical] = useState(false);
  const [count, setCount] = useState(0);
  const result = useMemo(
    () => (request.kind === 'check' ? d20(request.modifier, mode) : roll(request.expr, undefined, critical)),
    [request, mode, critical, count],
  );
  const tone = isNatural20(result) ? 'nat20' : isNatural1(result) ? 'nat1' : '';
  return (
    <Dialog
      title={request.title}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Done</button>
          <button class="primary" onClick={() => setCount((n) => n + 1)}>Roll again</button>
        </>
      }
    >
      <div class={`roll ${tone}`}>
        <div class="roll-total" key={count + mode + String(critical)}>{result.total}</div>
        <div class="strong">{isNatural20(result) ? 'Natural 20!' : isNatural1(result) ? 'Natural 1' : result.label}</div>
        <div class="small muted">{breakdown(result)}</div>
      </div>
      <div class="seg" style={{ justifyContent: 'center' }}>
        {request.kind === 'check' ? (
          MODES.map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setCount((n) => n + 1); }}>{label}</button>
          ))
        ) : (
          <button aria-pressed={critical} onClick={() => { setCritical((c) => !c); setCount((n) => n + 1); }}>Critical hit</button>
        )}
      </div>
    </Dialog>
  );
}
