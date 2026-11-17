/** Character list, import, backup/restore, app sharing and settings. */
import { useEffect, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import {
  type CharacterIndexEntry, exportAll, findBySheetName, importCharacterJson, isBackupBundle, listCharacters,
  requestPersistence, restoreAll,
} from '../data/db';
import { dateStamp, isIos, isStandalone, shareOrDownload } from './files';
import { Card, Dialog } from './common';
import { AiSettingsDialog } from './AiSettings';

export type Theme = 'system' | 'light' | 'dark';

interface Props {
  onOpen: (slug: string) => void;
  onScan: () => void;
  toast: (msg: string) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  lastBackupAt: number | null;
  onBackedUp: () => void;
}

export function HomeScreen({ onOpen, onScan, toast, theme, onTheme, lastBackupAt, onBackedUp }: Props) {
  const [chars, setChars] = useState<CharacterIndexEntry[] | null>(null);
  const [paste, setPaste] = useState(false);
  const [shareApp, setShareApp] = useState(false);
  const [about, setAbout] = useState(false);
  const [pending, setPending] = useState<{ text: string; existing: CharacterIndexEntry } | null>(null);
  const refresh = () => void listCharacters().then(setChars);
  useEffect(refresh, []);

  /** Accepts a character.json or a backup file. */
  const importText = async (text: string, opts: { replaceSlug?: string; asNew?: boolean } = {}) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast("That isn't valid JSON. Pick a character.json or an Actormaker backup.");
      return;
    }
    try {
      if (isBackupBundle(parsed)) {
        const n = await restoreAll(parsed);
        toast(`Restored ${n} character${n === 1 ? '' : 's'} from backup.`);
        refresh();
        return;
      }
      if (!opts.replaceSlug && !opts.asNew) {
        const existing = await findBySheetName(text);
        if (existing) {
          setPending({ text, existing });
          return;
        }
      }
      const r = await importCharacterJson(text, opts.replaceSlug);
      void requestPersistence();
      toast(r.replaced ? 'Character updated; live tracker kept.' : 'Character imported.');
      refresh();
      setPaste(false);
      onOpen(r.slug);
    } catch (e) {
      toast(`Couldn't import: ${(e as Error).message}`);
    }
  };

  const backup = async () => {
    const bundle = await exportAll();
    const r = await shareOrDownload(JSON.stringify(bundle, null, 2), `actormaker-backup-${dateStamp()}.json`, 'application/json', 'Actormaker backup');
    if (r !== 'cancelled') {
      onBackedUp();
      toast(r === 'shared' ? 'Backup shared. Save it somewhere safe (Files, Drive).' : 'Backup downloaded.');
    }
  };

  const stale = chars && chars.length > 0 && (!lastBackupAt || Date.now() - lastBackupAt > 7 * 864e5);

  return (
    <>
      <header class="topbar">
        <div class="topbar-row">
          <img src="./icons/icon.svg" alt="" width="30" height="30" style={{ borderRadius: 8 }} />
          <h1>Actormaker</h1>
          <button class="icon ghost" aria-label="Share this app" onClick={() => setShareApp(true)}>⤴</button>
          <button class="icon ghost" aria-label="Settings and about" onClick={() => setAbout(true)}>⚙</button>
        </div>
      </header>
      <main>
        {isIos() && !isStandalone() && (
          <div class="banner small">
            <b>On iPhone/iPad:</b> tap Share, then <b>Add to Home Screen</b>, and import your character from the home-screen app.
            Safari and the home-screen app keep separate storage.
          </div>
        )}
        {chars === null ? null : chars.length === 0 ? (
          <Card title="Welcome">
            <p class="small" style={{ marginTop: 0 }}>
              Import a <code>character.json</code> to get your sheet, a live HP/uses/slots tracker, combat turns, coins and a DM handoff.
              Everything stays on this device and works offline.
            </p>
          </Card>
        ) : (
          <div class="stack">
            {chars.map((c) => (
              <button class="list-item" key={c.slug} onClick={() => onOpen(c.slug)}>
                <div class="grow">
                  <div class="title">{c.displayName}</div>
                  <div class="small muted">{[c.className, `Level ${c.level}`].filter(Boolean).join(' · ')}</div>
                </div>
                <span class="muted">›</span>
              </button>
            ))}
          </div>
        )}

        <Card title="Add a character">
          <div class="row">
            <label class="btn primary grow">
              Import character.json
              <input
                type="file"
                accept=".json,application/json,text/plain"
                class="hidden"
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  const f = input.files?.[0];
                  input.value = '';
                  if (f) void f.text().then((t) => importText(t));
                }}
              />
            </label>
            <button class="grow" onClick={() => setPaste(true)}>Paste JSON</button>
          </div>
          <button class="wide" style={{ marginTop: 8 }} onClick={onScan}>📷 Scan a paper sheet or PDF (AI)</button>
        </Card>

        <Card title="Backup">
          <p class="small" style={{ marginTop: 0 }}>
            Saves every character with its tracker and combat state in one file. Phones can clear website storage (iPhones especially),
            so back up after each session.
          </p>
          {stale && <div class="banner warn small" style={{ marginBottom: 8 }}>{lastBackupAt ? `Last backup ${new Date(lastBackupAt).toLocaleDateString()}.` : 'No backup yet.'}</div>}
          <div class="row">
            <button class="primary grow" disabled={!chars?.length} onClick={() => void backup()}>Back up all</button>
            <label class="btn grow">
              Restore…
              <input
                type="file"
                accept=".json,application/json,text/plain"
                class="hidden"
                onChange={(e) => {
                  const input = e.target as HTMLInputElement;
                  const f = input.files?.[0];
                  input.value = '';
                  if (f) void f.text().then((t) => importText(t));
                }}
              />
            </label>
          </div>
        </Card>
      </main>

      {paste && <PasteDialog onClose={() => setPaste(false)} onImport={(t) => void importText(t)} />}
      {pending && (
        <Dialog
          title={`${pending.existing.displayName} is already here`}
          onClose={() => setPending(null)}
          actions={
            <>
              <button onClick={() => { const p = pending; setPending(null); void importText(p.text, { asNew: true }); }}>Add as new</button>
              <button class="primary" onClick={() => { const p = pending; setPending(null); void importText(p.text, { replaceSlug: p.existing.slug }); }}>Update</button>
            </>
          }
        >
          <p class="small">Update the existing character with this sheet (keeps current HP, used features and slots, like a level-up), or add it as a separate character?</p>
        </Dialog>
      )}
      {shareApp && <ShareAppDialog onClose={() => setShareApp(false)} toast={toast} />}
      {about && <AboutDialog theme={theme} onTheme={onTheme} onClose={() => setAbout(false)} toast={toast} />}
    </>
  );
}

function PasteDialog({ onClose, onImport }: { onClose: () => void; onImport: (t: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog title="Paste character.json" onClose={onClose} actions={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!text.trim()} onClick={() => onImport(text)}>Import</button></>}>
      <textarea placeholder='{ "ruleset": "dnd5e", ... }' value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} style={{ minHeight: 240 }} />
    </Dialog>
  );
}

export function appUrl(): string {
  const u = new URL(location.href);
  u.hash = '';
  u.search = '';
  return u.toString();
}

function ShareAppDialog({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const url = appUrl();
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  return (
    <Dialog
      title="Share this app"
      onClose={onClose}
      actions={
        <>
          <button onClick={() => void navigator.clipboard?.writeText(url).then(() => toast('Link copied.'), () => toast('Copy failed.'))}>Copy link</button>
          {'share' in navigator && (
            <button class="primary" onClick={() => void navigator.share({ title: 'Actormaker', text: 'D&D 5e character companion: works offline on iPhone and Android.', url }).catch(() => undefined)}>
              Share link
            </button>
          )}
        </>
      }
    >
      <p class="small" style={{ margin: 0 }}>Scan with a phone camera, then use <b>Add to Home Screen</b> (Safari) or <b>Install app</b> (Chrome).</p>
      <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} />
      <div class="tiny muted" style={{ textAlign: 'center', wordBreak: 'break-all' }}>{url}</div>
      {local && <div class="banner warn tiny">This is a local address; other phones can't open it. Share the GitHub Pages link once it's deployed.</div>}
    </Dialog>
  );
}

function AboutDialog({ theme, onTheme, onClose, toast }: { theme: Theme; onTheme: (t: Theme) => void; onClose: () => void; toast: (m: string) => void }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [aiSettings, setAiSettings] = useState(false);
  useEffect(() => void navigator.storage?.persisted?.().then(setPersisted), []);
  if (aiSettings) return <AiSettingsDialog onClose={() => setAiSettings(false)} toast={toast} />;
  return (
    <Dialog title="Settings" onClose={onClose}>
      <div class="small muted">Theme</div>
      <div class="seg">
        {(['system', 'light', 'dark'] as Theme[]).map((t) => (
          <button key={t} aria-pressed={theme === t} onClick={() => onTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <div class="small">
        Storage: {persisted === null ? 'checking…' : persisted ? 'kept by the browser (persistent)' : 'may be cleared by the browser when space is low; keep backups'}
        {!persisted && (
          <div><button class="small" style={{ marginTop: 6 }} onClick={() => void requestPersistence().then(setPersisted)}>Ask to keep storage</button></div>
        )}
      </div>
      <button class="wide" onClick={() => setAiSettings(true)}>AI assistant: provider and API key…</button>
      <p class="small muted" style={{ marginBottom: 0 }}>
        Actormaker is a D&amp;D 5e (2014 and 2024) character companion. Your characters live only on this device. The sheet
        format is the same <code>character.json</code> the Android app uses, so files move freely between them.
      </p>
      <div class="tiny muted">Version {__APP_VERSION__}</div>
    </Dialog>
  );
}
