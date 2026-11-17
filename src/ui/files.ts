/** Getting files out of the app: Web Share (with files) when available, else a download link. */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Share a file with the system sheet (iOS/Android), or download it on desktop. */
export async function shareOrDownload(text: string, fileName: string, mime: string, title?: string): Promise<ShareOutcome> {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], fileName, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] }) && isTouchDevice()) {
    try {
      await nav.share({ files: [file], title: title ?? fileName });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // Fall through to a download.
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
}

/** Share plain text (e.g. the DM handoff) as a message; download as a file when sharing isn't there. */
export async function shareText(text: string, fileName: string, title: string): Promise<ShareOutcome> {
  if (navigator.share && isTouchDevice()) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(new Blob([text], { type: 'text/plain' }), fileName);
  return 'downloaded';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const isTouchDevice = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const isIos = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export const dateStamp = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
