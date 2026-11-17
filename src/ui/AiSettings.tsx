/** Provider, API keys and models for the AI assistant. The model list comes live from the provider. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { type AiProvider, type AiSettings, type ModelInfo, DEFAULT_AI_SETTINGS, DEFAULT_MODELS, PROVIDER_NAME, listModels } from '../ai/client';
import { loadAiSettings, loadModelCache, saveAiSettings, saveModelCache } from '../ai/assistant';
import { Dialog } from './common';

const KEY_FIELD: Record<AiProvider, 'geminiKey' | 'openaiKey' | 'anthropicKey'> = { gemini: 'geminiKey', openai: 'openaiKey', anthropic: 'anthropicKey' };
const MODEL_FIELD: Record<AiProvider, 'geminiModel' | 'openaiModel' | 'anthropicModel'> = { gemini: 'geminiModel', openai: 'openaiModel', anthropic: 'anthropicModel' };
const KEY_HELP: Record<AiProvider, string> = {
  gemini: 'Google AI Studio → Get API key',
  openai: 'platform.openai.com → API keys',
  anthropic: 'console.anthropic.com → API keys',
};
const CUSTOM = '__custom__';

interface ListState { models: ModelInfo[] | null; fetchedAt: number | null; loading: boolean; error: string | null }
const EMPTY: ListState = { models: null, fetchedAt: null, loading: false, error: null };

export function AiSettingsDialog({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [s, setS] = useState<AiSettings | null>(null);
  const [show, setShow] = useState(false);
  const [lists, setLists] = useState<Record<AiProvider, ListState>>({ gemini: EMPTY, openai: EMPTY, anthropic: EMPTY });
  const [custom, setCustom] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    void Promise.all([loadAiSettings(), loadModelCache('gemini'), loadModelCache('openai'), loadModelCache('anthropic')]).then(([settings, g, o, a]) => {
      setLists({
        gemini: { ...EMPTY, models: g?.models ?? null, fetchedAt: g?.fetchedAt ?? null },
        openai: { ...EMPTY, models: o?.models ?? null, fetchedAt: o?.fetchedAt ?? null },
        anthropic: { ...EMPTY, models: a?.models ?? null, fetchedAt: a?.fetchedAt ?? null },
      });
      setS(settings);
      // A cached list for this provider: fetch fresh only when asked. No list yet: fetch now if there's a key.
      if (!{ gemini: g, openai: o, anthropic: a }[settings.provider] && settings[KEY_FIELD[settings.provider]].trim()) {
        refresh(settings.provider, settings[KEY_FIELD[settings.provider]]);
      }
    });
    return () => {
      abort.current?.abort();
      window.clearTimeout(debounce.current);
    };
  }, []);

  const patchList = (p: AiProvider, patch: Partial<ListState>) => setLists((l) => ({ ...l, [p]: { ...l[p], ...patch } }));

  function refresh(p: AiProvider, key: string) {
    abort.current?.abort();
    if (!key.trim()) return patchList(p, { loading: false, error: null });
    const ctl = new AbortController();
    abort.current = ctl;
    patchList(p, { loading: true, error: null });
    listModels(p, key, ctl.signal).then(
      (models) => {
        if (ctl.signal.aborted) return;
        patchList(p, { models, fetchedAt: Date.now(), loading: false, error: null });
        void saveModelCache(p, models);
      },
      (e) => {
        if (ctl.signal.aborted) return;
        patchList(p, { loading: false, error: (e as Error).message || 'Could not load the model list.' });
      },
    );
  }

  if (!s) return null;
  const p = s.provider;
  const key = s[KEY_FIELD[p]];
  const model = s[MODEL_FIELD[p]].trim() || DEFAULT_MODELS[p];
  const list = lists[p];
  // Live list when we have one; otherwise the built-in default so the picker is never empty.
  const options: ModelInfo[] = list.models?.length ? list.models : [{ id: DEFAULT_MODELS[p], label: `${DEFAULT_MODELS[p]} (default)` }];
  const inList = options.some((m) => m.id === model);
  const set = (patch: Partial<AiSettings>) => setS({ ...s, ...patch });

  const switchProvider = (x: AiProvider) => {
    setCustom(false);
    set({ provider: x });
    if (!lists[x].models && s[KEY_FIELD[x]].trim()) refresh(x, s[KEY_FIELD[x]]);
  };
  const onKey = (value: string) => {
    set({ [KEY_FIELD[p]]: value });
    window.clearTimeout(debounce.current);
    // Fetch once typing or pasting stops.
    if (value.trim().length >= 20) debounce.current = window.setTimeout(() => refresh(p, value), 700);
  };

  return (
    <Dialog
      title="AI assistant"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            class="primary"
            onClick={() => {
              const clean = { ...DEFAULT_AI_SETTINGS, ...s };
              for (const k of Object.keys(clean) as (keyof AiSettings)[]) if (k !== 'provider') clean[k] = clean[k].trim();
              void saveAiSettings(clean).then(() => {
                toast('AI settings saved on this device.');
                onClose();
              });
            }}
          >
            Save
          </button>
        </>
      }
    >
      <p class="small muted" style={{ margin: 0 }}>
        Level-up, table events, rules research and sheet scanning use your own API key. Pick a provider and paste its key.
      </p>
      <div class="seg">
        {(['gemini', 'openai', 'anthropic'] as AiProvider[]).map((x) => (
          <button key={x} aria-pressed={p === x} onClick={() => switchProvider(x)}>{PROVIDER_NAME[x]}</button>
        ))}
      </div>
      <label class="field">
        {PROVIDER_NAME[p]} API key
        <input
          type={(show ? 'text' : 'password') as 'password'}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={key}
          placeholder="Paste key"
          onInput={(e) => onKey((e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="row between">
        <span class="tiny muted">{KEY_HELP[p]}</span>
        <button class="small ghost" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
      </div>

      <div class="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }}>
        <label class="field grow">
          Model
          <select
            value={custom || !inList ? CUSTOM : model}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === CUSTOM) return setCustom(true);
              setCustom(false);
              set({ [MODEL_FIELD[p]]: v });
            }}
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>{m.label.startsWith(m.id) ? m.label : `${m.label} (${m.id})`}</option>
            ))}
            <option value={CUSTOM}>{!inList && !custom ? `Custom: ${model}` : 'Custom…'}</option>
          </select>
        </label>
        <button class="small" disabled={!key.trim() || list.loading} onClick={() => refresh(p, key)} aria-label="Refresh the model list">
          {list.loading ? '…' : '↻ Refresh'}
        </button>
      </div>
      {(custom || !inList) && (
        <label class="field">
          Model id
          <input
            autocapitalize="off"
            spellcheck={false}
            value={s[MODEL_FIELD[p]]}
            placeholder={DEFAULT_MODELS[p]}
            onInput={(e) => set({ [MODEL_FIELD[p]]: (e.target as HTMLInputElement).value })}
          />
        </label>
      )}
      <div class="tiny muted" role="status">
        {list.loading
          ? `Loading ${PROVIDER_NAME[p]} models…`
          : list.models
            ? `${list.models.length} models from ${PROVIDER_NAME[p]}, newest first${list.fetchedAt ? ` · updated ${new Date(list.fetchedAt).toLocaleDateString()}` : ''}.`
            : key.trim() ? '' : 'Enter a key to load the models it can use.'}
      </div>
      {list.error && (
        <div class="tiny err" role="alert">
          {list.error} {list.models ? 'Showing the last list loaded.' : `Using the default, ${DEFAULT_MODELS[p]}.`}
        </div>
      )}

      <div class="tiny muted">
        Keys are kept only in this browser on this device. They are never put in backups, exports or handoffs.
        When you use the assistant, the character sheet (or the pages you scan) is sent to {PROVIDER_NAME[p]} with your key. Web search is on for every request.
      </div>
    </Dialog>
  );
}
