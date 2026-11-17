/**
 * Raw HTTP calls to Gemini, OpenAI (Responses API) and Anthropic, straight from the browser.
 * Port of android/.../ai/AiAssistantClient.kt (transport only; the flows live in ./assistant.ts).
 * All three APIs allow browser calls (CORS); Anthropic needs the direct-browser-access header.
 */

export type AiProvider = 'gemini' | 'openai' | 'anthropic';

export interface AiSettings {
  provider: AiProvider;
  geminiKey: string;
  geminiModel: string;
  openaiKey: string;
  openaiModel: string;
  anthropicKey: string;
  anthropicModel: string;
}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

export const PROVIDER_NAME: Record<AiProvider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic' };

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: DEFAULT_MODELS.gemini,
  openaiKey: '',
  openaiModel: DEFAULT_MODELS.openai,
  anthropicKey: '',
  anthropicModel: DEFAULT_MODELS.anthropic,
};

export const apiKey = (s: AiSettings): string =>
  (s.provider === 'gemini' ? s.geminiKey : s.provider === 'openai' ? s.openaiKey : s.anthropicKey).trim();

export const modelId = (s: AiSettings): string => {
  const m = (s.provider === 'gemini' ? s.geminiModel : s.provider === 'openai' ? s.openaiModel : s.anthropicModel).trim();
  return m || DEFAULT_MODELS[s.provider];
};

/** A photo or PDF sent to the model, already base64-encoded (no data: prefix). */
export interface AiAttachment { mimeType: string; base64: string; fileName: string }
export const isImage = (a: AiAttachment) => a.mimeType.startsWith('image/');

export const ANTHROPIC_MAX_TOKENS = 32000;
const ANTHROPIC_MAX_CONTINUATIONS = 3;
const TIMEOUT_MS = 360_000;

type Json = Record<string, unknown>;

// ---------------------------------------------------------------- request bodies (pure, tested)

export function geminiBody(prompt: string, webSearch: boolean, attachments: AiAttachment[] = []): Json {
  const parts: Json[] = attachments.map((a) => ({ inline_data: { mime_type: a.mimeType, data: a.base64 } }));
  parts.push({ text: prompt });
  const body: Json = { contents: [{ parts }] };
  if (webSearch) body.tools = [{ google_search: {} }];
  return body;
}

export function openAiBody(model: string, prompt: string, webSearch: boolean, attachments: AiAttachment[] = []): Json {
  const content: Json[] = attachments.map((a) => {
    const dataUrl = `data:${a.mimeType};base64,${a.base64}`;
    return isImage(a)
      ? { type: 'input_image', image_url: dataUrl }
      : { type: 'input_file', filename: a.fileName, file_data: dataUrl };
  });
  content.push({ type: 'input_text', text: prompt });
  const body: Json = { model, input: [{ role: 'user', content }] };
  if (webSearch) body.tools = [{ type: 'web_search' }];
  return body;
}

/** Images and PDFs go before the text, as the API recommends. */
export function anthropicUserContent(prompt: string, attachments: AiAttachment[] = []): Json[] {
  const content: Json[] = attachments.map((a) => ({
    type: isImage(a) ? 'image' : 'document',
    source: { type: 'base64', media_type: a.mimeType, data: a.base64 },
  }));
  content.push({ type: 'text', text: prompt });
  return content;
}

export function anthropicBody(model: string, messages: Json[], webSearch: boolean): Json {
  const body: Json = { model, max_tokens: ANTHROPIC_MAX_TOKENS, messages };
  if (webSearch) body.tools = [{ type: anthropicWebSearchType(model), name: 'web_search', max_uses: 5 }];
  return body;
}

/**
 * The dynamic-filtering search tool only exists on newer model families; Haiku and anything
 * unrecognized get the basic version, which every model with web search accepts.
 */
export function anthropicWebSearchType(model: string): string {
  const id = model.toLowerCase();
  const newer = [
    'claude-fable', 'claude-mythos', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7',
    'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6',
  ];
  return newer.some((p) => id.startsWith(p)) ? 'web_search_20260209' : 'web_search_20250305';
}

// ---------------------------------------------------------------- responses (pure, tested)

const parse = (body: string): Json | null => {
  try {
    const v = JSON.parse(body);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};
const objs = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => typeof x === 'object' && x !== null) : []);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

export const isGeminiTruncated = (body: string) => objs(parse(body)?.candidates)[0]?.finishReason === 'MAX_TOKENS';
export function isOpenAiTruncated(body: string): boolean {
  const root = parse(body);
  return root?.status === 'incomplete' && (root.incomplete_details as Json | undefined)?.reason === 'max_output_tokens';
}
export const isAnthropicTruncated = (body: string) => parse(body)?.stop_reason === 'max_tokens';

export function extractGeminiText(body: string): string | null {
  const parts = objs((objs(parse(body)?.candidates)[0]?.content as Json | undefined)?.parts);
  // Join raw: parts can split inside a JSON string, so no trim or inserted newline.
  const out = parts.filter((p) => !p.thought).map((p) => text(p.text)).join('').trim();
  return out || null;
}

export function extractOpenAiText(body: string): string | null {
  const root = parse(body);
  if (!root) return null;
  const direct = text(root.output_text).trim();
  if (direct) return direct;
  const out = objs(root.output).flatMap((item) => objs(item.content).map((c) => text(c.text))).join('').trim();
  return out || null;
}

export function extractAnthropicText(body: string): string | null {
  const content = objs(parse(body)?.content);
  // With web search, the answer follows the last search result; earlier text is commentary.
  let start = 0;
  content.forEach((b, i) => {
    if (b.type === 'web_search_tool_result') start = i + 1;
  });
  const out = content.slice(start).filter((b) => b.type === 'text').map((b) => text(b.text)).join('').trim();
  return out || null;
}

// ---------------------------------------------------------------- transport

export class AiError extends Error {}

async function post(url: string, headers: Record<string, string>, body: Json, label: string, signal?: AbortSignal): Promise<string> {
  // One controller for both the player's Cancel and the timeout (AbortSignal.any is too new for older iPhones).
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TIMEOUT_MS);
  const onCancel = () => ctl.abort();
  signal?.addEventListener('abort', onCancel);
  let res: Response;
  let raw: string;
  try {
    if (signal?.aborted) ctl.abort();
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    raw = await res.text();
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new AiError(`${label} took longer than ${TIMEOUT_MS / 1000}s to answer. Try again or use a faster model.`);
    throw new AiError(navigator.onLine === false ? 'No network connection.' : `Couldn't reach ${label}.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  if (!res.ok) {
    const msg = (parse(raw)?.error as Json | undefined)?.message;
    throw new AiError(`${label} HTTP ${res.status}: ${typeof msg === 'string' ? msg : raw.slice(0, 300) || res.statusText}`);
  }
  if (!raw.trim()) throw new AiError(`Empty ${label} response.`);
  return raw;
}

function checkAndExtract(raw: string, label: string, truncated: (b: string) => boolean, extract: (b: string) => string | null): string {
  if (truncated(raw)) {
    throw new AiError(`${label} response was cut off before the JSON finished (output token limit). Try a model with a larger output limit.`);
  }
  const out = extract(raw);
  if (!out) throw new AiError(`Could not read model text from ${label}.`);
  return out;
}

export interface CallOptions { webSearch?: boolean; attachments?: AiAttachment[]; signal?: AbortSignal }

/** Send one prompt to the chosen provider and return the model's text. Web search is on unless turned off. */
export async function callModel(settings: AiSettings, prompt: string, opts: CallOptions = {}): Promise<string> {
  const { webSearch = true, attachments = [], signal } = opts;
  const key = apiKey(settings);
  const label = PROVIDER_NAME[settings.provider];
  if (!key) throw new AiError(`Missing ${label} API key. Add it in Settings.`);
  const model = modelId(settings);

  if (settings.provider === 'gemini') {
    // Key in a header, not the URL, so it can't end up in logs or error messages.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const raw = await post(url, { 'x-goog-api-key': key }, geminiBody(prompt, webSearch, attachments), label, signal);
    return checkAndExtract(raw, label, isGeminiTruncated, extractGeminiText);
  }

  if (settings.provider === 'openai') {
    const raw = await post('https://api.openai.com/v1/responses', { authorization: `Bearer ${key}` }, openAiBody(model, prompt, webSearch, attachments), label, signal);
    return checkAndExtract(raw, label, isOpenAiTruncated, extractOpenAiText);
  }

  const messages: Json[] = [{ role: 'user', content: anthropicUserContent(prompt, attachments) }];
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  // Server-side search can pause a long turn (stop_reason "pause_turn"): send the partial
  // assistant content back unchanged and the API continues where it left off.
  for (let i = 0; i <= ANTHROPIC_MAX_CONTINUATIONS; i++) {
    const raw = await post('https://api.anthropic.com/v1/messages', headers, anthropicBody(model, messages, webSearch), label, signal);
    const root = parse(raw);
    if (root?.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: root.content });
      continue;
    }
    if (root?.stop_reason === 'refusal') throw new AiError('Anthropic declined this request.');
    return checkAndExtract(raw, label, isAnthropicTruncated, extractAnthropicText);
  }
  throw new AiError('Anthropic web search did not finish. Try again.');
}
