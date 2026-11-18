/**
 * Build a character from photos of a paper sheet, a PDF, or a text file. A real character.json imports directly.
 * Mirrors archive/android/.../ui/ScanSheetScreen.kt and CompanionViewModel.scanCharacterSheet.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { importCharacterJson, requestPersistence } from '../data/db';
import { normalizedForSave } from '../data/model';
import { type AiSettings, PROVIDER_NAME, apiKey } from '../ai/client';
import { importCharacter, loadAiSettings } from '../ai/assistant';
import { fileMime, loadScan } from '../ai/scanLoader';
import { Card, WorkingRow } from './common';
import { AiSettingsDialog } from './AiSettings';

interface Props { onBack: () => void; onOpen: (slug: string) => void; toast: (m: string) => void }

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function ScanScreen({ onBack, onOpen, toast }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const [edition, setEdition] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => void loadAiSettings().then(setAi), [showSettings]);
  useEffect(() => () => abort.current?.abort(), []);

  const add = (list: FileList | null | undefined) => {
    if (!list?.length) return;
    const incoming = [...list];
    setFiles((cur) => [...cur, ...incoming.filter((f) => !cur.some((c) => c.name === f.name && c.size === f.size && c.lastModified === f.lastModified))]);
  };

  const scan = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    setStage('Reading the files');
    try {
      const input = await loadScan(files);
      if (ctl.signal.aborted) return;
      let sheet = input.directSheet;
      if (!sheet) {
        const settings = ai ?? (await loadAiSettings());
        if (!apiKey(settings)) {
          setError(`Save a ${PROVIDER_NAME[settings.provider]} API key first.`);
          setShowSettings(true);
          return;
        }
        setStage(`Building the character with ${PROVIDER_NAME[settings.provider]}`);
        sheet = await importCharacter(settings, input.attachments, input.text, edition, notes, ctl.signal);
      }
      const r = await importCharacterJson(JSON.stringify(normalizedForSave(sheet)));
      void requestPersistence();
      toast(input.directSheet ? 'Character imported.' : 'Character built. Check the numbers against your sheet.');
      onOpen(r.slug);
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message || 'Scan failed.');
    } finally {
      if (abort.current === ctl) abort.current = null;
      setStage(null);
    }
  };

  const busy = stage !== null;
  return (
    <>
      <header class="topbar">
        <div class="topbar-row">
          <button class="icon ghost" aria-label="Back" disabled={busy} onClick={onBack}>←</button>
          <h1>Scan a character sheet</h1>
          <button class="icon ghost" aria-label="AI settings" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>
      <main>
        <Card>
          <p class="small" style={{ marginTop: 0 }}>
            Take a photo of each page of a paper sheet, or pick photos, a PDF (a D&amp;D Beyond export works), or a text file.
            The AI reads it and builds the character. A <code>character.json</code> imports directly, without the AI.
          </p>
          <p class="tiny muted">Tips: flat page, good light, whole page in frame. Include the back pages for features and spells.</p>
          <div class="row" style={{ flexWrap: 'nowrap' }}>
            <label class={`btn primary grow ${busy ? 'disabled' : ''}`}>
              📷 {files.length ? 'Add page' : 'Take photo'}
              <input type="file" accept="image/*" capture="environment" class="hidden" disabled={busy}
                onChange={(e) => { const i = e.target as HTMLInputElement; add(i.files); i.value = ''; }} />
            </label>
            <label class={`btn grow ${busy ? 'disabled' : ''}`}>
              Choose files
              <input type="file" multiple accept="image/*,application/pdf,.pdf,.json,application/json,.txt,text/plain" class="hidden" disabled={busy}
                onChange={(e) => { const i = e.target as HTMLInputElement; add(i.files); i.value = ''; }} />
            </label>
          </div>
        </Card>

        {files.length > 0 && (
          <Card title={`${files.length} page${files.length === 1 ? '' : 's'}`}>
            <div class="pages">
              {files.map((f, i) => (
                <PageThumb key={`${f.name}-${f.size}-${f.lastModified}`} file={f} disabled={busy} onRemove={() => setFiles((cur) => cur.filter((_, j) => j !== i))} />
              ))}
            </div>
          </Card>
        )}

        <Card title="Rules edition">
          <div class="seg">
            {([[null, 'Detect'], ['2014', '2014'], ['2024', '2024']] as [string | null, string][]).map(([v, label]) => (
              <button key={label} aria-pressed={edition === v} onClick={() => setEdition(v)}>{label}</button>
            ))}
          </div>
          <label class="field" style={{ marginTop: 10 }}>
            Notes for the AI (optional)
            <textarea style={{ fontFamily: 'var(--font)', minHeight: 70 }} placeholder="e.g. Level 5 now; ignore the pencil notes on page 2" value={notes} readOnly={busy}
              onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
          </label>
        </Card>

        {error && <div class="banner warn small" role="alert">{error}</div>}
        {busy ? (
          <Card>
            <WorkingRow label={stage} onCancel={() => { abort.current?.abort(); abort.current = null; setStage(null); toast('Scan cancelled.'); }} />
            <div class="tiny muted">A full sheet can take a minute or two.</div>
          </Card>
        ) : (
          <button class="primary wide" style={{ minHeight: 52 }} disabled={!files.length} onClick={() => void scan()}>Build character</button>
        )}
        {ai && !apiKey(ai) && (
          <div class="tiny muted">
            Photos and PDFs need an AI key ({PROVIDER_NAME[ai.provider]}, OpenAI or Anthropic). <button class="link" onClick={() => setShowSettings(true)}>Add a key</button>
          </div>
        )}
      </main>
      {showSettings && <AiSettingsDialog onClose={() => setShowSettings(false)} toast={toast} />}
    </>
  );
}

function PageThumb({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const image = fileMime(file).startsWith('image/');
  const url = useMemo(() => (image ? URL.createObjectURL(file) : null), [file, image]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <div class="page">
      <span>{image ? '🖼' : '📄'}<br />{file.name}</span>
      {/* HEIC previews don't show on every browser; the name underneath stays visible then. */}
      {url && <img src={url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      {!disabled && <button class="rm" aria-label={`Remove ${file.name}`} onClick={onRemove}>✕</button>}
    </div>
  );
}
