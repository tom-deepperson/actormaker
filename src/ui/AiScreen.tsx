/**
 * AI assistant for one character: Level up (look up options, choose, build, review), table Event, rules Research.
 * Mirrors android/.../ui/AiAssistantScreen.kt, LevelUpPanel.kt and the AI parts of CompanionViewModel.kt.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { type CharacterSheet, level, maxHp } from '../data/model';
import { CLASSES, classLevels, classSummary, findClass, multiclassProblems, prerequisiteLabel } from '../data/classes';
import { afterLevelUp } from '../data/tracker';
import { sheetTitle } from '../data/viewContext';
import { type AiSettings, PROVIDER_NAME, apiKey } from '../ai/client';
import {
  type EventProposal, type ResearchAnswer, loadAiSettings, proposeEvent, proposeLevelUp, proposeLevelUpPlan, research, safeUrl,
} from '../ai/assistant';
import {
  type HpMode, type LevelUpPlan, type PlanChoice, type Selection, chosenNames, choiceWarnings, classTargetText, decisionsText,
  describeHp, hpGain, isComplete, recommendedPicks, requiredPicks, swappedOut, togglePick, toggleSwap,
} from '../ai/levelUp';
import { blockingProblem, levelUpWarnings } from '../ai/sheetMerge';
import { useCharacter } from './useCharacter';
import type { SheetSettings } from './SheetScreen';
import { Card, WorkingRow } from './common';
import { AiSettingsDialog } from './AiSettings';

type Mode = 'levelup' | 'event' | 'research';

interface Draft {
  plan: LevelUpPlan | null;
  picks: Selection;
  swaps: Selection;
  hpMode: HpMode;
  hpRoll: number | null;
  notes: string;
  /** Class gaining the level; null = the character's first class. */
  levelClass: string | null;
  newClass: boolean;
  dmApproved: boolean;
  maxHpOverride: number | null;
}
const EMPTY_DRAFT: Draft = { plan: null, picks: {}, swaps: {}, hpMode: 'average', hpRoll: null, notes: '', levelClass: null, newClass: false, dmApproved: false, maxHpOverride: null };

const className = (d: Draft, s: CharacterSheet) => d.levelClass ?? classLevels(s)[0]?.name ?? s.identity?.class ?? '';
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

interface Props { slug: string; settings: SheetSettings; onBack: () => void; toast: (m: string) => void }

export function AiScreen({ slug, settings, onBack, toast }: Props) {
  const h = useCharacter(slug);
  const c = h.state;
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<Mode>('levelup');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Level up
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<CharacterSheet | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Event and research
  const [eventText, setEventText] = useState('');
  const [proposal, setProposal] = useState<EventProposal | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<ResearchAnswer | null>(null);

  useEffect(() => void loadAiSettings().then(setAi), [showSettings]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async <T,>(label: string, work: (s: AiSettings, signal: AbortSignal) => Promise<T>, done: (r: T) => void) => {
    if (!ai) return;
    if (!apiKey(ai)) {
      setError(`Save a ${PROVIDER_NAME[ai.provider]} API key first.`);
      setShowSettings(true);
      return;
    }
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(label);
    setError(null);
    try {
      done(await work(ai, ctl.signal));
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || 'The request failed.');
    } finally {
      if (abort.current === ctl) {
        abort.current = null;
        setBusy(null);
      }
    }
  };
  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setBusy(null);
    toast('Request cancelled.');
  };

  const sheet = c?.sheet;
  const target = sheet ? level(sheet) + 1 : 2;

  const findOptions = () => {
    if (!sheet) return;
    const cls = className(draft, sheet);
    if (!cls) return setError('Pick which class gains this level.');
    if (draft.newClass && !draft.dmApproved && multiclassProblems(sheet, cls).length) {
      return setError('Ability scores don\'t meet the multiclass requirement. Tick "DM allows it" to continue anyway.');
    }
    setPreview(null);
    setWarnings([]);
    setDraft((d) => ({ ...d, plan: null, picks: {}, swaps: {}, hpRoll: null, maxHpOverride: null }));
    void run(`Looking up level ${target} options`, (s, sig) => proposeLevelUpPlan(s, sheet, target, classTargetText(sheet, cls, draft.newClass, target), sig), (plan) =>
      setDraft((d) => ({ ...d, plan, picks: recommendedPicks(plan) })),
    );
  };

  const build = () => {
    if (!sheet || !draft.plan) return;
    const plan = draft.plan;
    if (!isComplete(plan, draft.picks, draft.swaps)) return setError('Make every choice first.');
    if (draft.hpMode === 'rolled' && draft.hpRoll == null) return setError('Enter your HP roll, or switch to Average.');
    const cls = className(draft, sheet);
    const hp = hpGain(sheet, plan, draft.hpMode, draft.hpRoll, cls);
    const newMax = maxHp(sheet) + hp.total;
    const decisions = decisionsText(plan, draft.picks, draft.swaps, newMax, hp, draft.hpMode, draft.notes);
    void run(`Building level ${target}`, (s, sig) => proposeLevelUp(s, sheet, target, decisions, classTargetText(sheet, cls, draft.newClass, target), sig), (built) => {
      // HP is the player's call, not the AI's: apply the computed value.
      const p = withMaxHp(built, newMax);
      const problem = blockingProblem(sheet, p, target);
      if (problem) return setError(problem);
      setPreview(p);
      setWarnings([...choiceWarnings(p, chosenNames(plan, draft.picks), swappedOut(plan, draft.swaps)), ...levelUpWarnings(sheet, p)]);
      setDraft((d) => ({ ...d, maxHpOverride: newMax }));
    });
  };

  const acceptLevelUp = () => {
    if (!sheet || !preview) return;
    const final = draft.maxHpOverride && draft.maxHpOverride > 0 ? withMaxHp(preview, draft.maxHpOverride) : preview;
    const previous = sheet;
    h.updateSheet(() => final);
    h.updateTracker((t) => afterLevelUp(t, previous, final));
    setPreview(null);
    setWarnings([]);
    setDraft(EMPTY_DRAFT);
    toast(`Leveled up to ${level(final)}.`);
  };

  const clear = () => {
    setDraft(EMPTY_DRAFT);
    setPreview(null);
    setWarnings([]);
    setProposal(null);
    setAnswer(null);
    setEventText('');
    setQuestion('');
    setError(null);
  };

  return (
    <>
      <header class="topbar">
        <div class="topbar-row">
          <button class="icon ghost" aria-label="Back to the sheet" disabled={!!busy} onClick={onBack}>←</button>
          <h1>AI assistant{sheet ? ` · ${sheetTitle(sheet, settings.ctx)}` : ''}</h1>
          <button class="icon ghost" aria-label="AI settings" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
        <div class="tabs" role="tablist">
          {([['levelup', 'Level up'], ['event', 'Event'], ['research', 'Research']] as [Mode, string][]).map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} disabled={!!busy} onClick={() => { setMode(m); setError(null); }}>{label}</button>
          ))}
        </div>
      </header>
      <main>
        {h.error && <div class="banner warn">{h.error}</div>}
        {ai && !apiKey(ai) && (
          <div class="banner small">
            The assistant uses your own {PROVIDER_NAME[ai.provider]} (or OpenAI / Anthropic) API key.{' '}
            <button class="link" onClick={() => setShowSettings(true)}>Add a key</button>
          </div>
        )}
        {error && <div class="banner warn small" role="alert">{error}</div>}

        {sheet && mode === 'levelup' && (
          <LevelUpPanel
            sheet={sheet}
            target={target}
            draft={draft}
            setDraft={setDraft}
            preview={preview}
            warnings={warnings}
            busy={busy}
            onCancel={cancel}
            onFind={findOptions}
            onBuild={build}
            onBack={() => { setPreview(null); setWarnings([]); }}
            onAccept={acceptLevelUp}
            onClassChange={() => { setPreview(null); setWarnings([]); }}
          />
        )}

        {sheet && mode === 'event' && (
          <Card title="Table event">
            <p class="small" style={{ marginTop: 0 }}>Type what happened at the table. The AI proposes the sheet changes; nothing is saved until you accept.</p>
            <textarea
              style={{ fontFamily: 'var(--font)', minHeight: 140 }}
              placeholder="Example: got Boots of Elvenkind and equipped them"
              value={eventText}
              readOnly={!!busy}
              onInput={(e) => setEventText((e.target as HTMLTextAreaElement).value)}
            />
            {busy ? (
              <WorkingRow label={busy} onCancel={cancel} />
            ) : (
              <button class="primary wide" style={{ marginTop: 8 }} disabled={!eventText.trim()} onClick={() =>
                void run('Working out the changes', (s, sig) => proposeEvent(s, sheet, eventText.trim(), sig), setProposal)}
              >
                Propose changes
              </button>
            )}
            {proposal && (
              <>
                <h3>Proposed changes</h3>
                <ul class="small">{proposal.summary.map((l) => <li key={l}>{l}</li>)}</ul>
                <button
                  class="primary wide"
                  disabled={!!busy}
                  onClick={() => {
                    const next = proposal.sheet;
                    h.updateSheet(() => next);
                    setProposal(null);
                    setEventText('');
                    toast('Event changes accepted.');
                  }}
                >
                  Accept
                </button>
              </>
            )}
          </Card>
        )}

        {mode === 'research' && (
          <Card title="Rules research">
            <p class="small" style={{ marginTop: 0 }}>Ask a rules question. Answers include sources. Nothing is written to your sheet.</p>
            <textarea
              style={{ fontFamily: 'var(--font)', minHeight: 110 }}
              placeholder="Example: can I use Sentinel and Polearm Master together?"
              value={question}
              readOnly={!!busy}
              onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
            />
            {busy ? (
              <WorkingRow label={busy} onCancel={cancel} />
            ) : (
              <button class="primary wide" style={{ marginTop: 8 }} disabled={!question.trim()} onClick={() => {
                setAnswer(null);
                void run('Researching', (s, sig) => research(s, sheet ?? null, question.trim(), sig), setAnswer);
              }}>
                Ask
              </button>
            )}
            {answer && (
              <>
                <div class="pre" style={{ marginTop: 12 }}>{answer.answer}</div>
                {answer.sources.length > 0 && (
                  <>
                    <h3>Sources</h3>
                    <ul class="plain small">
                      {answer.sources.map((src, i) => {
                        const url = safeUrl(src.url);
                        return (
                          <li key={i}>
                            {url ? <a href={url} target="_blank" rel="noopener noreferrer">{src.topic || url}</a> : src.topic}
                            {src.edition && <span class="muted"> · {src.edition}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            )}
          </Card>
        )}

        <button class="wide" disabled={!!busy} onClick={clear}>Clear</button>
        <div class="tiny muted">Clear removes drafts and proposals. Use ← to go back to the sheet.</div>
      </main>
      {showSettings && <AiSettingsDialog onClose={() => setShowSettings(false)} toast={toast} />}
    </>
  );
}

function withMaxHp(sheet: CharacterSheet, total: number): CharacterSheet {
  if (!sheet.derived) return sheet;
  return { ...sheet, derived: { ...sheet.derived, hitPoints: { ...(sheet.derived.hitPoints ?? {}), total } } };
}

// ---------------------------------------------------------------- level up

interface PanelProps {
  sheet: CharacterSheet;
  target: number;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  preview: CharacterSheet | null;
  warnings: string[];
  busy: string | null;
  onCancel: () => void;
  onFind: () => void;
  onBuild: () => void;
  onBack: () => void;
  onAccept: () => void;
  onClassChange: () => void;
}

function LevelUpPanel(p: PanelProps) {
  const { sheet, draft, setDraft, preview, target } = p;
  const plan = draft.plan;
  return (
    <>
      <Card title={`Level up → ${target}`}>
        <div class="small">Now: {classSummary(sheet) || `level ${level(sheet)}`} · Max HP {maxHp(sheet)}</div>
        {p.busy && <WorkingRow label={p.busy} onCancel={p.onCancel} />}
      </Card>
      {!p.busy && !preview && <ClassPicker sheet={sheet} draft={draft} setDraft={setDraft} onChange={p.onClassChange} />}
      {!p.busy && preview && <Preview current={sheet} proposed={preview} warnings={p.warnings} draft={draft} setDraft={setDraft} onBack={p.onBack} onAccept={p.onAccept} />}
      {!p.busy && !preview && !plan && (
        <Card>
          <p class="small" style={{ marginTop: 0 }}>
            Step 1 of 2: look up what level {target} gives you. The AI searches the rules for your class, then you make the choices.
          </p>
          <button class="primary wide" onClick={p.onFind}>Find level-up options</button>
        </Card>
      )}
      {!p.busy && !preview && plan && (
        <>
          {plan.automatic.length > 0 && (
            <Card title="You gain automatically">
              <ul class="plain">
                {plan.automatic.map((g) => (
                  <li key={g.name}><div class="strong">{g.name}</div>{g.summary && <div class="small">{g.summary}</div>}</li>
                ))}
              </ul>
            </Card>
          )}
          <HitPoints sheet={sheet} draft={draft} setDraft={setDraft} />
          {plan.choices.map((choice, i) => (
            <ChoiceCard
              key={i}
              choice={choice}
              picked={draft.picks[i] ?? []}
              swapped={draft.swaps[i] ?? []}
              onPick={(j) => setDraft((d) => ({ ...d, picks: togglePick(plan, d.picks, d.swaps, i, j) }))}
              onSwap={(j) => setDraft((d) => ({ ...d, ...toggleSwap(plan, d.picks, d.swaps, i, j) }))}
            />
          ))}
          {plan.notes?.trim() && <div class="small muted">{plan.notes}</div>}
          <Card>
            <label class="field">
              Anything else for the AI (optional)
              <textarea style={{ fontFamily: 'var(--font)', minHeight: 70 }} placeholder="e.g. split the ASI as +1 STR, +1 CON" value={draft.notes}
                onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setDraft((d) => ({ ...d, notes: v })); }} />
            </label>
            {(() => {
              const complete = isComplete(plan, draft.picks, draft.swaps);
              const hpReady = draft.hpMode === 'average' || draft.hpRoll != null;
              return (
                <>
                  <button class="primary wide" style={{ marginTop: 8 }} disabled={!complete || !hpReady} onClick={p.onBuild}>Build level {target}</button>
                  {!complete && <div class="tiny muted">Make every choice above to continue.</div>}
                </>
              );
            })()}
            <button class="wide" style={{ marginTop: 8 }} onClick={p.onFind}>Look up options again</button>
          </Card>
        </>
      )}
    </>
  );
}

function HitPoints({ sheet, draft, setDraft }: { sheet: CharacterSheet; draft: Draft; setDraft: PanelProps['setDraft'] }) {
  const hp = hpGain(sheet, draft.plan, draft.hpMode, draft.hpRoll, className(draft, sheet));
  const out = draft.hpRoll != null && (draft.hpRoll < 1 || draft.hpRoll > hp.dieSize);
  const bonus = draft.plan?.hitPoints.bonusNotes?.trim() ? ` (${draft.plan.hitPoints.bonusNotes})` : '';
  return (
    <Card title="Hit points">
      <div class="seg">
        <button aria-pressed={draft.hpMode === 'average'} onClick={() => setDraft((d) => ({ ...d, hpMode: 'average' }))}>Average ({hp.average})</button>
        <button aria-pressed={draft.hpMode === 'rolled'} onClick={() => setDraft((d) => ({ ...d, hpMode: 'rolled' }))}>I rolled</button>
      </div>
      {draft.hpMode === 'rolled' && (
        <label class="field" style={{ marginTop: 8, maxWidth: 160 }}>
          Your d{hp.dieSize} roll
          <input inputMode="numeric" value={draft.hpRoll ?? ''} onInput={(e) => {
            const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 2);
            setDraft((d) => ({ ...d, hpRoll: v ? Number(v) : null }));
          }} />
          {out && <span class="tiny err">Must be 1 to {hp.dieSize}</span>}
        </label>
      )}
      <div class="small" style={{ marginTop: 8 }}>Gain +{hp.total}: {describeHp(hp, draft.hpMode)}{bonus}</div>
      <div class="strong">Max HP {maxHp(sheet)} → {maxHp(sheet) + hp.total}</div>
    </Card>
  );
}

function ChoiceCard({ choice, picked, swapped, onPick, onSwap }: { choice: PlanChoice; picked: number[]; swapped: number[]; onPick: (i: number) => void; onSwap: (i: number) => void }) {
  const required = requiredPicks(choice, swapped.length);
  return (
    <Card title={choice.title.trim() || choice.kind}>
      {choice.notes?.trim() && <div class="small muted">{choice.notes}</div>}
      {choice.current.length > 0 && (
        <>
          <h3>You have</h3>
          <div class="stack" style={{ gap: 6 }}>
            {choice.current.map((e, i) =>
              choice.allowReplace > 0 ? (
                <button key={i} class="pick" aria-pressed={swapped.includes(i)} onClick={() => onSwap(i)}>
                  <span class="box">{swapped.includes(i) ? '✓' : ''}</span>
                  <span><span class="strong">{e.name}{swapped.includes(i) ? '  (swapping out)' : ''}</span>{e.summary && <span class="small muted" style={{ display: 'block' }}>{e.summary}</span>}</span>
                </button>
              ) : (
                <div key={i}><span class="strong small">{e.name}</span>{e.summary && <div class="tiny muted">{e.summary}</div>}</div>
              ),
            )}
          </div>
          {choice.allowReplace > 0 && <div class="tiny muted" style={{ marginTop: 4 }}>Tick up to {choice.allowReplace} to swap out for a new pick.</div>}
        </>
      )}
      <h3>Choose {required} ({picked.length} chosen)</h3>
      {choice.options.length === 0 && <div class="small">No new options found. Use the notes box below to tell the AI what you want.</div>}
      <div class="stack" style={{ gap: 6 }}>
        {choice.options.map((o, i) => {
          const tags = [o.recommended ? 'Suggested' : null, o.source?.trim() || null].filter(Boolean).join(' · ');
          return (
            <button key={i} class="pick" aria-pressed={picked.includes(i)} onClick={() => onPick(i)}>
              <span class="box">{picked.includes(i) ? '✓' : ''}</span>
              <span>
                <span class="strong">{o.name}</span>
                {tags && <span class="tiny" style={{ display: 'block', color: 'var(--accent)' }}>{tags}</span>}
                {o.summary && <span class="small" style={{ display: 'block' }}>{o.summary}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function Preview({ current, proposed, warnings, draft, setDraft, onBack, onAccept }: {
  current: CharacterSheet; proposed: CharacterSheet; warnings: string[]; draft: Draft; setDraft: PanelProps['setDraft']; onBack: () => void; onAccept: () => void;
}) {
  const newFeats = proposed.feats.filter((f) => !current.feats.some((x) => x.name === f.name));
  const newRunes = (proposed.runes?.known ?? []).filter((r) => !(current.runes?.known ?? []).includes(r));
  const spells = (s: CharacterSheet) => [...(s.spells?.cantrips ?? []), ...(s.spells?.known ?? []), ...(s.spells?.prepared ?? [])];
  const oldSpells = new Set(spells(current));
  const newSpells = [...new Set(spells(proposed))].filter((x) => !oldSpells.has(x));
  const oldScores = current.abilityScores?.final ?? {};
  const scoreChanges = Object.entries(proposed.abilityScores?.final ?? {}).filter(([a, v]) => oldScores[a] !== v);
  const changed = proposed.features.filter((f) => {
    const old = current.features.find((x) => x.id === f.id);
    return !old || old.rulesText !== f.rulesText;
  });
  return (
    <Card title={`Step 2 of 2: review level ${level(proposed)}`}>
      {warnings.length > 0 && (
        <div class="banner warn small" style={{ marginBottom: 8 }}>
          <div class="strong">Check before accepting:</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <label class="field" style={{ maxWidth: 220 }}>
        New max HP (was {maxHp(current)})
        <input inputMode="numeric" value={draft.maxHpOverride ?? ''} onInput={(e) => {
          const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4);
          setDraft((d) => ({ ...d, maxHpOverride: v ? Number(v) : null }));
        }} />
        <span class="tiny muted">Edit if your table rolled or adjusted HP differently.</span>
      </label>
      {newFeats.length > 0 && (
        <>
          <h3>New feats</h3>
          {newFeats.map((f) => <div key={f.name}><div class="strong">{f.name}</div>{f.rulesText && <div class="small pre">{f.rulesText}</div>}</div>)}
        </>
      )}
      {newRunes.length > 0 && <div class="small" style={{ marginTop: 8 }}>New runes: {newRunes.join(', ')}</div>}
      {newSpells.length > 0 && <div class="small" style={{ marginTop: 8 }}>New spells: {newSpells.join(', ')}</div>}
      {scoreChanges.length > 0 && (
        <div class="small" style={{ marginTop: 8 }}>Ability scores: {scoreChanges.map(([a, v]) => `${a} ${oldScores[a] ?? '?'} → ${v}`).join(', ')}</div>
      )}
      <h3>New or changed features</h3>
      {changed.length === 0 && <div class="small muted">None.</div>}
      <ul class="plain">
        {changed.map((f) => <li key={f.id}><div class="strong">{f.name}</div><div class="small pre">{f.rulesText}</div></li>)}
      </ul>
      <button class="primary wide" style={{ marginTop: 8 }} disabled={!((draft.maxHpOverride ?? 0) > 0)} onClick={onAccept}>Accept level up</button>
      <button class="wide" style={{ marginTop: 8 }} onClick={onBack}>Back to choices</button>
    </Card>
  );
}

// ---------------------------------------------------------------- class picker

/** Which class gains this level: an existing one, or a new class (multiclass) with its prerequisite check. */
function ClassPicker({ sheet, draft, setDraft, onChange }: { sheet: CharacterSheet; draft: Draft; setDraft: PanelProps['setDraft']; onChange: () => void }) {
  const existing = classLevels(sheet);
  const selected = className(draft, sheet);
  const [showNew, setShowNew] = useState(draft.newClass);
  const [other, setOther] = useState('');
  // Choosing a different class invalidates looked-up options.
  const select = (name: string, isNew: boolean) => {
    onChange();
    setDraft((d) => ({ ...d, levelClass: name, newClass: isNew, dmApproved: false, plan: null, picks: {}, swaps: {}, maxHpOverride: null }));
  };
  const problems = draft.newClass ? multiclassProblems(sheet, selected) : [];
  return (
    <Card title="Which class gains this level?">
      <div class="seg">
        {existing.map((cl) => (
          <button key={cl.name} aria-pressed={!draft.newClass && selected.toLowerCase() === cl.name.toLowerCase()} onClick={() => { setShowNew(false); select(cl.name, false); }}>
            {cl.name} {cl.level} → {cl.level + 1}
          </button>
        ))}
        <button aria-pressed={showNew || draft.newClass} onClick={() => setShowNew(true)}>New class (multiclass)</button>
      </div>
      {(showNew || draft.newClass) && (
        <>
          <div class="tiny muted" style={{ marginTop: 8 }}>Multiclassing needs 13+ in the main ability of the new class and of each class you already have.</div>
          <div class="seg" style={{ marginTop: 6 }}>
            {CLASSES.filter((info) => !existing.some((e) => e.name.toLowerCase() === info.name.toLowerCase())).map((info) => {
              const ok = multiclassProblems(sheet, info.name).length === 0;
              return (
                <button key={info.name} aria-pressed={draft.newClass && selected.toLowerCase() === info.name.toLowerCase()} onClick={() => select(info.name, true)}>
                  {ok ? `${info.name} d${info.hitDie}` : `${info.name} (needs ${prerequisiteLabel(info)})`}
                </button>
              );
            })}
          </div>
          <div class="row" style={{ flexWrap: 'nowrap', marginTop: 8, alignItems: 'flex-end' }}>
            <label class="field grow">Other / homebrew class<input value={other} onInput={(e) => setOther((e.target as HTMLInputElement).value)} /></label>
            <button onClick={() => other.trim() && select(other.trim(), true)}>Use</button>
          </div>
          {draft.newClass && (problems.length > 0 ? (
            <>
              {problems.map((x) => <div key={x} class="small err">• {x}</div>)}
              <label class="check small">
                <input type="checkbox" checked={draft.dmApproved} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setDraft((d) => ({ ...d, dmApproved: v })); }} />
                DM allows it anyway
              </label>
            </>
          ) : findClass(selected) ? (
            <div class="small">{selected}: requirements met.</div>
          ) : (
            <div class="small">Homebrew class: requirements not checked.</div>
          ))}
        </>
      )}
    </Card>
  );
}
