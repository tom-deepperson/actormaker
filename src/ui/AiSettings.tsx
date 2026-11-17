/** Provider, API keys and models for the AI assistant. Mirrors the AI part of android/.../ui/SettingsScreen.kt. */
import { useEffect, useState } from 'preact/hooks';
import { type AiProvider, type AiSettings, DEFAULT_AI_SETTINGS, DEFAULT_MODELS, PROVIDER_NAME } from '../ai/client';
import { loadAiSettings, saveAiSettings } from '../ai/assistant';
import { Dialog } from './common';

const KEY_FIELD: Record<AiProvider, 'geminiKey' | 'openaiKey' | 'anthropicKey'> = { gemini: 'geminiKey', openai: 'openaiKey', anthropic: 'anthropicKey' };
const MODEL_FIELD: Record<AiProvider, 'geminiModel' | 'openaiModel' | 'anthropicModel'> = { gemini: 'geminiModel', openai: 'openaiModel', anthropic: 'anthropicModel' };
const KEY_HELP: Record<AiProvider, string> = {
  gemini: 'Google AI Studio → Get API key',
  openai: 'platform.openai.com → API keys',
  anthropic: 'console.anthropic.com → API keys',
};

export function AiSettingsDialog({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [s, setS] = useState<AiSettings | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => void loadAiSettings().then(setS), []);
  if (!s) return null;
  const p = s.provider;
  const set = (patch: Partial<AiSettings>) => setS({ ...s, ...patch });
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
          <button key={x} aria-pressed={p === x} onClick={() => set({ provider: x })}>{PROVIDER_NAME[x]}</button>
        ))}
      </div>
      <label class="field">
        {PROVIDER_NAME[p]} API key
        <input
          type={(show ? 'text' : 'password') as 'password'}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={s[KEY_FIELD[p]]}
          placeholder="Paste key"
          onInput={(e) => set({ [KEY_FIELD[p]]: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="row between">
        <span class="tiny muted">{KEY_HELP[p]}</span>
        <button class="small ghost" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      <label class="field">
        Model
        <input
          autocapitalize="off"
          spellcheck={false}
          value={s[MODEL_FIELD[p]]}
          placeholder={DEFAULT_MODELS[p]}
          onInput={(e) => set({ [MODEL_FIELD[p]]: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="tiny muted">
        Keys are kept only in this browser on this device. They are never put in backups, exports or handoffs.
        When you use the assistant, the character sheet (or the pages you scan) is sent to {PROVIDER_NAME[p]} with your key. Web search is on for every request.
      </div>
    </Dialog>
  );
}
