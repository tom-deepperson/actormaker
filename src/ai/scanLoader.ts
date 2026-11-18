/**
 * Turns the files the player picked into what the model reads. Port of archive/android/.../data/SheetScanLoader.kt.
 * Photos are decoded by the browser (HEIC works where the browser can show it, as on iPhone Safari),
 * shrunk to an 1800px long edge and re-encoded as JPEG; PDFs go as they are; text is pasted into the prompt.
 */
import { type CharacterSheet, parseSheet } from '../data/model';
import type { AiAttachment } from './client';

export interface ScanInput {
  attachments: AiAttachment[];
  text: string;
  /** A complete character.json was picked: import it directly, no AI needed. */
  directSheet: CharacterSheet | null;
}

const MAX_EDGE = 1800;
// Base64 grows files by a third; Gemini caps inline requests at about 20 MB.
export const MAX_PDF_BYTES = 14 * 1024 * 1024;

export function guessMime(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': case 'heif': return 'image/heic';
    case 'pdf': return 'application/pdf';
    case 'json': return 'application/json';
    default: return 'text/plain';
  }
}

export const fileMime = (f: File) => f.type || guessMime(f.name);

/** A real character.json (it has the app's own structure), not just any JSON. */
export function directSheet(raw: string): CharacterSheet | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
    const looksComplete = typeof obj.identity === 'object' && obj.identity !== null &&
      ((typeof obj.derived === 'object' && obj.derived !== null) || (typeof obj.abilityScores === 'object' && obj.abilityScores !== null));
    return looksComplete ? parseSheet(obj) : null;
  } catch {
    return null;
  }
}

export async function loadScan(files: File[]): Promise<ScanInput> {
  const attachments: AiAttachment[] = [];
  let text = '';
  // One page at a time: decoding several large photos at once can crash a phone browser.
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = f.name || `page-${i + 1}`;
    const mime = fileMime(f);
    if (mime.startsWith('image/')) {
      attachments.push({ mimeType: 'image/jpeg', base64: await encodeImage(f, name), fileName: name });
    } else if (mime === 'application/pdf') {
      if (f.size > MAX_PDF_BYTES) throw new Error(`${name} is over 14 MB. Export fewer pages or take photos instead.`);
      attachments.push({ mimeType: 'application/pdf', base64: await toBase64(f), fileName: name });
    } else {
      const raw = await f.text();
      if (files.length === 1) {
        const sheet = directSheet(raw);
        if (sheet) return { attachments: [], text: '', directSheet: sheet };
      }
      text += `--- ${name} ---\n${raw.slice(0, 200_000)}\n`;
    }
  }
  return { attachments, text, directSheet: null };
}

/** Base64 without the data: prefix. FileReader avoids building a huge string by hand. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

type Drawable = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Drawable> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      // Fall through to <img>, which decodes more formats on some browsers.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Couldn't open ${file.name || 'the photo'} on this device. Take the photo again, or save it as JPEG and pick that.`);
  }
}

/** Decode (applying camera rotation), shrink to a readable size, and re-encode as JPEG. */
async function encodeImage(file: File, name: string): Promise<string> {
  return toBase64(await shrinkToJpeg(file, MAX_EDGE, name));
}

/** Shrink an image so its longest side is at most `maxEdge` and re-encode it as JPEG (drops transparency). */
export async function shrinkToJpeg(file: File, maxEdge: number, name = file.name): Promise<Blob> {
  const img = await decode(file);
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the photo.');
    ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) throw new Error(`Couldn't convert ${name} to JPEG.`);
    return blob;
  } finally {
    img.release();
    // Free the pixel memory right away (iOS keeps canvas memory until it's resized).
    canvas.width = 0;
    canvas.height = 0;
  }
}
