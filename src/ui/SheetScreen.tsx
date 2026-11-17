/** One character: Combat / Non-combat / Full tabs. Mirrors android/.../ui/CharacterSheetScreen.kt. */
import { useState } from 'preact/hooks';
import { displayName, normalizedForSave, slugHint } from '../data/model';
import { buildHandoff, handoffFileName } from '../data/handoff';
import { type SheetViewContext, type SheetViewMode, redactForView, sheetTitle, shouldHideSecretIdentity, visibleNameOptions } from '../data/viewContext';
import { deleteCharacter, importCharacterJson } from '../data/db';
import { copyText, dateStamp, shareOrDownload, shareText } from './files';
import { useCharacter, type CharacterHandle, type CharacterState } from './useCharacter';
import { CombatView } from './CombatView';
import { ExploreBoard } from './ExploreBoard';
import { InventorySection } from './Inventory';
import { Dialog } from './common';
import { HpCard, TrackerCard } from './Tracker';
import {
  AbilitiesSection, ActionChecklist, AppearanceSection, BackstorySection, CombatStatsSection, CosmologySection,
  FeaturesSection, FeatsSection, PersonalitySection, ProficienciesSection, RunesSection, SoundBitesSection,
  SourcesSection, SpellsSection, SummarySection, TableNotesSection, visibleFeatures,
} from './Sections';

export interface SheetSettings {
  ctx: SheetViewContext;
  mode: SheetViewMode;
  trackEncumbrance: boolean;
}

interface Props {
  slug: string;
  settings: SheetSettings;
  onSettings: (s: SheetSettings) => void;
  onBack: () => void;
  toast: (msg: string) => void;
}

export function SheetScreen({ slug, settings, onSettings, onBack, toast }: Props) {
  const h = useCharacter(slug);
  const [menu, setMenu] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const c = h.state;
  const { ctx, mode } = settings;
  // What the screen shows: in alias / player-safe views, text naming the true identity is left out.
  const v = c && redactForView(c.sheet, ctx) !== c.sheet ? { ...c, sheet: redactForView(c.sheet, ctx) } : c;
  const setMode = (m: SheetViewMode) => {
    onSettings({ ...settings, mode: m });
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header class="topbar">
        <div class="topbar-row">
          <button class="icon ghost" aria-label="Back to characters" onClick={onBack}>←</button>
          <h1>{c ? sheetTitle(c.sheet, ctx) : 'Loading…'}</h1>
          <button class="icon ghost" aria-label="Character menu" onClick={() => setMenu(true)}>⋯</button>
        </div>
        <div class="tabs" role="tablist">
          {(['combat', 'noncombat', 'full'] as SheetViewMode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'combat' ? 'Combat' : m === 'noncombat' ? 'Non-combat' : 'Full'}
            </button>
          ))}
        </div>
        {mode === 'full' && c && <FullNav c={c} ctx={ctx} />}
      </header>
      <main>
        {h.error && <div class="banner warn">{h.error}</div>}
        {c && v && mode === 'combat' && <CombatView c={v} h={h} ctx={ctx} trackEncumbrance={settings.trackEncumbrance} />}
        {c && v && mode === 'noncombat' && <NonCombatView c={c} v={v} h={h} settings={settings} onSettings={onSettings} />}
        {c && v && mode === 'full' && <FullView c={c} v={v} h={h} settings={settings} onSettings={onSettings} />}
      </main>
      {menu && c && (
        <CharacterMenu
          c={c}
          h={h}
          slug={slug}
          settings={settings}
          onSettings={onSettings}
          onClose={() => setMenu(false)}
          onHandoff={() => {
            setMenu(false);
            setHandoff(true);
          }}
          onDeleted={onBack}
          toast={toast}
        />
      )}
      {handoff && c && <HandoffDialog c={c} onClose={() => setHandoff(false)} toast={toast} />}
    </>
  );
}

function NonCombatView({ c, v, h, settings, onSettings }: { c: CharacterState; v: CharacterState; h: CharacterHandle; settings: SheetSettings; onSettings: (s: SheetSettings) => void }) {
  const { ctx } = settings;
  return (
    <>
      <SummarySection sheet={v.sheet} ctx={ctx} />
      <ExploreBoard c={v} h={h} hideSecret={shouldHideSecretIdentity(ctx, c.sheet.identity)} />
      <ProficienciesSection sheet={v.sheet} />
      <InventorySection c={c} h={h} trackEncumbrance={settings.trackEncumbrance} onSetTrackEncumbrance={(on) => onSettings({ ...settings, trackEncumbrance: on })} />
      <PersonalitySection sheet={v.sheet} ctx={ctx} />
      <SoundBitesSection sheet={v.sheet} ctx={ctx} />
      <FeaturesSection title="Passive features" features={visibleFeatures(v.sheet, ctx, true)} />
    </>
  );
}

function FullView({ c, v, h, settings, onSettings }: { c: CharacterState; v: CharacterState; h: CharacterHandle; settings: SheetSettings; onSettings: (s: SheetSettings) => void }) {
  const { ctx } = settings;
  const s = v.sheet;
  return (
    <>
      <div id="tracker" class="stack">
        <HpCard c={c} h={h} />
        <TrackerCard c={c} h={h} />
      </div>
      <SummarySection sheet={s} ctx={ctx} />
      <AbilitiesSection sheet={s} detailed />
      <CombatStatsSection sheet={s} />
      <ActionChecklist sheet={s} ctx={ctx} />
      <FeatsSection sheet={s} />
      <RunesSection sheet={s} ctx={ctx} />
      <ProficienciesSection sheet={s} />
      <InventorySection c={c} h={h} trackEncumbrance={settings.trackEncumbrance} onSetTrackEncumbrance={(on) => onSettings({ ...settings, trackEncumbrance: on })} />
      <SoundBitesSection sheet={s} ctx={ctx} />
      <BackstorySection sheet={s} ctx={ctx} />
      <PersonalitySection sheet={s} ctx={ctx} />
      <CosmologySection sheet={s} ctx={ctx} />
      <AppearanceSection sheet={s} ctx={ctx} />
      <TableNotesSection sheet={s} ctx={ctx} />
      <SpellsSection sheet={s} />
      <FeaturesSection features={visibleFeatures(s, ctx)} full />
      <SourcesSection sheet={s} />
    </>
  );
}

const NAV: [string, string][] = [
  ['tracker', 'Tracker'], ['summary', 'Summary'], ['abilities', 'Abilities'], ['combat', 'Combat'], ['actions', 'Actions'],
  ['feats', 'Feats'], ['runes', 'Runes'], ['proficiencies', 'Skills'], ['inventory', 'Inventory'], ['soundbites', 'Sound bites'],
  ['personality', 'Personality'], ['appearance', 'Appearance'], ['spells', 'Spells'], ['features', 'Features'], ['sources', 'Sources'],
];

function FullNav(_: { c: CharacterState; ctx: SheetViewContext }) {
  return (
    <div class="chips">
      {NAV.map(([id, label]) => (
        <button
          key={id}
          onClick={() => {
            const el = document.getElementById(id);
            if (!el) return;
            const top = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.clientHeight ?? 0) - 8;
            window.scrollTo({ top, behavior: 'smooth' });
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CharacterMenu(props: {
  c: CharacterState;
  h: CharacterHandle;
  slug: string;
  settings: SheetSettings;
  onSettings: (s: SheetSettings) => void;
  onClose: () => void;
  onHandoff: () => void;
  onDeleted: () => void;
  toast: (m: string) => void;
}) {
  const { c, settings, onSettings, toast } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const names = visibleNameOptions({ ...settings.ctx, playerSafeMode: false }, c.sheet.identity);
  const exportJson = async () => {
    const text = JSON.stringify(normalizedForSave(c.sheet), null, 2);
    const r = await shareOrDownload(text, `${slugHint(c.sheet)}-character.json`, 'application/json', displayName(c.sheet));
    if (r !== 'cancelled') toast(r === 'shared' ? 'Shared character.json.' : 'Downloaded character.json.');
  };
  const updateFromFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(async (text) => {
      try {
        await importCharacterJson(text, props.slug);
        props.h.reload();
        toast('Sheet updated. HP, uses and slots carried over.');
        props.onClose();
      } catch (e) {
        toast(`Couldn't read that file: ${(e as Error).message}`);
      }
    });
  };
  return (
    <Dialog title={displayName(c.sheet) === sheetTitle(c.sheet, settings.ctx) ? sheetTitle(c.sheet, settings.ctx) : 'Character'} onClose={props.onClose}>
      {names.length > 1 && (
        <div class="stack" style={{ gap: 4 }}>
          <div class="small muted">Show as</div>
          <div class="seg">
            {names.map((n) => (
              <button
                key={n.choice}
                aria-pressed={settings.ctx.displayNameChoice === n.choice}
                disabled={settings.ctx.playerSafeMode && n.isSecret}
                onClick={() => onSettings({ ...settings, ctx: { ...settings.ctx, displayNameChoice: n.choice } })}
              >
                {n.label}{n.isSecret ? ' (secret)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <label class="check small">
        <input
          type="checkbox"
          checked={settings.ctx.playerSafeMode}
          onChange={(e) => onSettings({ ...settings, ctx: { ...settings.ctx, playerSafeMode: (e.target as HTMLInputElement).checked } })}
        />
        Player-safe view (hide secrets when showing the screen to others)
      </label>
      <button class="wide" onClick={props.onHandoff}>DM handoff…</button>
      <button class="wide" onClick={() => void exportJson()}>Export character.json</button>
      <label class="btn wide">
        Update from a newer character.json…
        <input type="file" accept=".json,application/json,text/plain" class="hidden" onChange={(e) => updateFromFile((e.target as HTMLInputElement).files?.[0])} />
      </label>
      {!confirmDelete ? (
        <button class="danger wide" onClick={() => setConfirmDelete(true)}>Delete from this device…</button>
      ) : (
        <div class="banner warn stack">
          <div class="small">Delete {displayName(c.sheet)} and its tracker from this device? This can't be undone. Export first if you want a copy.</div>
          <div class="row">
            <button class="danger fill small" onClick={() => void deleteCharacter(props.slug).then(() => { toast('Character deleted.'); props.onDeleted(); })}>Delete</button>
            <button class="small" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function HandoffDialog({ c, onClose, toast }: { c: CharacterState; onClose: () => void; toast: (m: string) => void }) {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [notes, setNotes] = useState('');
  const text = buildHandoff({
    sheet: c.sheet,
    tracker: c.tracker,
    combat: c.combat,
    dateLabel: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    includeSecrets,
    playerNotes: notes,
  });
  const fileName = handoffFileName(c.sheet, includeSecrets).replace('.txt', `-${dateStamp()}.txt`);
  return (
    <Dialog
      title="DM handoff"
      onClose={onClose}
      actions={
        <>
          <button onClick={() => void copyText(text).then((ok) => toast(ok ? 'Copied.' : 'Copy failed.'))}>Copy</button>
          <button onClick={() => void shareOrDownload(text, fileName, 'text/plain').then((r) => r === 'downloaded' && toast(`Saved ${fileName}.`))}>File</button>
          <button class="primary" onClick={() => void shareText(text, fileName, 'Session handoff').then((r) => r === 'downloaded' && toast(`Saved ${fileName}.`))}>Share</button>
        </>
      }
    >
      <p class="small muted" style={{ margin: 0 }}>A play-ready snapshot (HP, uses, slots, effects, gear, full feature text) for whoever runs your character while you're away.</p>
      <label class="check small">
        <input type="checkbox" checked={includeSecrets} onChange={(e) => setIncludeSecrets((e.target as HTMLInputElement).checked)} />
        DM copy: include secrets (true name, secret lines and notes)
      </label>
      <label class="field">
        Notes for this session (optional)
        <textarea style={{ minHeight: 70, fontFamily: 'var(--font)' }} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
      </label>
      <textarea readOnly value={text} style={{ minHeight: 220 }} />
    </Dialog>
  );
}
