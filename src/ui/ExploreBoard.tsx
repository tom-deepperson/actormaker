/** Out-of-combat board: tap a skill, check or save to roll it; traits with uses; rests. Mirrors archive/android/.../ui/ExploreBoardView.kt. */
import { useState } from 'preact/hooks';
import { type Feature, formatModifier } from '../data/model';
import { abilities, passives, skills, utilityFeatures } from '../data/exploreBoard';
import { afterRest, useFeature } from '../data/tracker';
import type { CharacterHandle, CharacterState } from './useCharacter';
import { Card, Dialog } from './common';
import { type RollRequest, RollDialog } from './RollDialog';

type Tab = 'skills' | 'checks' | 'traits' | 'rest';
const TABS: [Tab, string][] = [['skills', 'Skills'], ['checks', 'Checks & saves'], ['traits', 'Traits'], ['rest', 'Rest']];

const abilityVar = (a: string) => `var(--a-${a.toLowerCase()})`;

export function ExploreBoard({ c, h, hideSecret }: { c: CharacterState; h: CharacterHandle; hideSecret: boolean }) {
  const [tab, setTab] = useState<Tab>('skills');
  const [bestFirst, setBestFirst] = useState(false);
  const [rollReq, setRollReq] = useState<RollRequest | null>(null);
  const [detail, setDetail] = useState<Feature | null>(null);
  const [confirmRest, setConfirmRest] = useState<'short' | 'long' | null>(null);
  const s = c.sheet;
  const check = (title: string, modifier: number) => setRollReq({ kind: 'check', title, modifier });

  return (
    <>
      <Card title="Senses (passive)">
        <div class="senses">
          {passives(s).map(([name, value]) => (
            <div key={name}><b>{value}</b><span class="tiny">{name}</span></div>
          ))}
        </div>
        {s.derived?.speed != null && (
          <div class="tiny muted" style={{ marginTop: 8 }}>
            Speed {s.derived.speed} ft · travel pace: fast 4 mi/hr (−5 passive Perception), normal 3, slow 2 (can sneak)
          </div>
        )}
      </Card>

      <div class="chips board-chips">
        {TABS.map(([t, label]) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {tab === 'skills' && (
        <>
          <button class="small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setBestFirst((b) => !b)}>
            {bestFirst ? 'Sort: A to Z' : 'Sort: best first'}
          </button>
          <div class="board">
            {(bestFirst ? [...skills(s)].sort((a, b) => b.modifier - a.modifier) : skills(s)).map((sk) => (
              <button key={sk.name} class={`tile ${sk.proficient ? 'hi' : ''}`} style={{ '--c': abilityVar(sk.ability) }} onClick={() => check(`${sk.name} check`, sk.modifier)}>
                <span class="grow">
                  <span class="t-title" style={{ display: 'block' }}>{sk.name}</span>
                  <span class="t-sub">{sk.ability}{sk.proficient ? ' · proficient' : ''}</span>
                </span>
                <span class="t-val">{formatModifier(sk.modifier)}</span>
              </button>
            ))}
          </div>
          <div class="tiny muted">Tap a skill to roll it.</div>
        </>
      )}

      {tab === 'checks' && (
        <div class="stack">
          {abilities(s).map((a) => (
            <div class="ab-row" key={a.ability} style={{ '--c': abilityVar(a.ability) }}>
              <div class="ab-badge"><span><small>{a.ability}</small><b>{a.score}</b></span></div>
              <button class="tile" onClick={() => check(`${a.ability} check`, a.check)}>
                <span class="t-title">Check</span>
                <span class="t-val">{formatModifier(a.check)}</span>
              </button>
              <button class={`tile ${a.saveProficient ? 'hi' : ''}`} onClick={() => check(`${a.ability} saving throw`, a.save)}>
                <span class="grow">
                  <span class="t-title" style={{ display: 'block' }}>Save</span>
                  {a.saveProficient && <span class="t-sub">proficient</span>}
                </span>
                <span class="t-val">{formatModifier(a.save)}</span>
              </button>
            </div>
          ))}
          {s.derived?.initiative != null && (
            <button class="wide" onClick={() => check('Initiative', s.derived!.initiative!)}>Roll initiative ({formatModifier(s.derived.initiative)})</button>
          )}
        </div>
      )}

      {tab === 'traits' && <Traits c={c} h={h} hideSecret={hideSecret} onDetail={setDetail} />}

      {tab === 'rest' && (
        <Card>
          <p class="small" style={{ marginTop: 0 }}>
            Short rest: at least 1 hour; spend hit dice to heal (tracker on the Combat tab). Long rest: 8 hours; HP back to full plus hit dice and features.
          </p>
          <div class="strong small">HP {c.tracker.currentHp}/{c.tracker.maxHp} · hit dice {c.tracker.hitDiceRemaining}/{c.tracker.hitDiceTotal}</div>
          <div class="row" style={{ flexWrap: 'nowrap', marginTop: 8 }}>
            <button class="grow" onClick={() => setConfirmRest('short')}>Short rest</button>
            <button class="grow" onClick={() => setConfirmRest('long')}>Long rest</button>
          </div>
        </Card>
      )}

      {rollReq && <RollDialog request={rollReq} onClose={() => setRollReq(null)} />}
      {detail && (
        <Dialog title={detail.name} onClose={() => setDetail(null)}>
          {detail.source && <div class="muted small">{detail.source}</div>}
          <div class="pre">{detail.rulesText}</div>
        </Dialog>
      )}
      {confirmRest && (
        <Dialog
          title={confirmRest === 'long' ? 'Take a long rest?' : 'Take a short rest?'}
          onClose={() => setConfirmRest(null)}
          actions={
            <>
              <button onClick={() => setConfirmRest(null)}>Cancel</button>
              <button
                class="primary"
                onClick={() => {
                  h.updateTracker((t, sheet) => afterRest(t, sheet, confirmRest, Date.now()));
                  setConfirmRest(null);
                }}
              >
                Rest
              </button>
            </>
          }
        >
          <div class="small">{confirmRest === 'long' ? 'Restores HP, hit dice, spell slots and features.' : 'Restores short-rest features and pact slots.'}</div>
        </Dialog>
      )}
    </>
  );
}

function Traits({ c, h, hideSecret, onDetail }: { c: CharacterState; h: CharacterHandle; hideSecret: boolean; onDetail: (f: Feature) => void }) {
  const features = utilityFeatures(c.sheet, hideSecret);
  const prof = c.sheet.proficiencies;
  return (
    <div class="stack">
      {features.map((f) => {
        const max = f.uses?.max;
        const left = max != null ? c.tracker.featureUses[f.id] ?? max : null;
        return (
          <section class="card row" key={f.id} style={{ flexWrap: 'nowrap', margin: 0 }}>
            <button class="link grow" style={{ textAlign: 'left', color: 'var(--text)' }} onClick={() => onDetail(f)}>
              <span class="strong" style={{ display: 'block' }}>{f.name}</span>
              <span class="small muted opt-sum">{f.rulesText}</span>
            </button>
            {left != null && max != null && (
              <button
                class="small primary"
                disabled={left <= 0}
                onClick={() => h.updateTracker((t) => useFeature({ ...t, featureUses: { [f.id]: t.featureUses[f.id] ?? max, ...t.featureUses } }, f.id))}
              >
                Use {left}/{max}
              </button>
            )}
          </section>
        );
      })}
      {prof && ((prof.tools ?? []).length > 0 || (prof.languages ?? []).length > 0) && (
        <Card>
          {(prof.tools ?? []).length > 0 && <div class="small">Tools: {prof.tools!.join(', ')}</div>}
          {(prof.languages ?? []).length > 0 && <div class="small">Languages: {prof.languages!.join(', ')}</div>}
        </Card>
      )}
      {features.length === 0 && <div class="muted">No out-of-combat traits listed.</div>}
    </div>
  );
}
