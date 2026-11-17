/**
 * IndexedDB storage. One object store per kind, keyed by character slug, plus a key/value
 * settings store. Mirrors the Android CharacterRepository / TrackerStore / CombatSessionStore.
 */
import { type CharacterSheet, displayName, level, normalizedForSave, parseSheet, slugHint } from './model';
import { classLabel } from './classes';
import { type TrackerState, afterLevelUp, normalizeTracker, trackerFromCharacter } from './tracker';
import { type CombatSession, inactiveSession } from './combat';

const DB_NAME = 'actormaker';
const DB_VERSION = 2;

/** Owner of the shared scene backgrounds in the images store (character slugs own their portraits). */
export const BACKGROUNDS_OWNER = '_backgrounds';

export interface StoredCharacter {
  slug: string;
  sheet: CharacterSheet;
  importedAt: number;
  updatedAt: number;
}

export interface CharacterIndexEntry {
  slug: string;
  displayName: string;
  className: string;
  level: number;
  importedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['characters', 'trackers', 'combat']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'slug' });
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      // v2: portrait cutouts, scene backgrounds and their manifest.json, as Blobs.
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' }).createIndex('owner', 'owner');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version opened in another tab: let it upgrade, and reconnect on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // An older tab still holds the previous version open; it closes itself (above) once it has this code.
    req.onblocked = () => console.warn('Actormaker storage upgrade is waiting for another open tab of the app to close.');
  });
  return dbPromise;
}

type StoreName = 'characters' | 'trackers' | 'combat' | 'settings' | 'images';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  const t = db.transaction(store, mode);
  const result = await wrap(fn(t.objectStore(store)));
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

const get = <T>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key));
const put = (store: StoreName, value: unknown, key?: string) => tx(store, 'readwrite', (s) => s.put(value, key));
const del = (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
const all = <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll());

// ---------------------------------------------------------------- characters

export async function listCharacters(): Promise<CharacterIndexEntry[]> {
  const rows = await all<StoredCharacter>('characters');
  return rows
    .map((r) => ({
      slug: r.slug,
      displayName: displayName(r.sheet),
      className: classLabel(r.sheet),
      level: level(r.sheet),
      importedAt: r.importedAt,
    }))
    .sort((a, b) => b.importedAt - a.importedAt);
}

export async function loadCharacter(slug: string): Promise<StoredCharacter | undefined> {
  const row = await get<StoredCharacter>('characters', slug);
  return row ? { ...row, sheet: parseSheet(row.sheet) } : undefined;
}

export async function saveCharacter(slug: string, sheet: CharacterSheet, importedAt?: number): Promise<void> {
  const prev = await get<StoredCharacter>('characters', slug);
  const now = Date.now();
  const row: StoredCharacter = {
    slug,
    sheet: normalizedForSave(sheet),
    importedAt: importedAt ?? prev?.importedAt ?? now,
    updatedAt: now,
  };
  await put('characters', row);
}

export async function deleteCharacter(slug: string): Promise<void> {
  await del('characters', slug);
  await del('trackers', slug);
  await del('combat', slug);
  await clearImages(slug);
}

async function uniqueSlug(base: string): Promise<string> {
  const existing = new Set((await all<StoredCharacter>('characters')).map((r) => r.slug));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export interface ImportResult { slug: string; replaced: boolean }

/**
 * Import character.json text. `replaceSlug` updates an existing character in place and carries
 * its live tracker forward (like a level-up); otherwise a new slug is made, as on Android.
 */
export async function importCharacterJson(text: string, replaceSlug?: string): Promise<ImportResult> {
  const sheet = parseSheet(text);
  if (replaceSlug) {
    const prev = await loadCharacter(replaceSlug);
    await saveCharacter(replaceSlug, sheet);
    const t = await loadTrackerRaw(replaceSlug);
    if (t) await saveTracker(afterLevelUp(t, prev?.sheet ?? null, sheet));
    return { slug: replaceSlug, replaced: true };
  }
  const slug = await uniqueSlug(slugHint(sheet));
  await saveCharacter(slug, sheet, Date.now());
  return { slug, replaced: false };
}

/** Existing character with the same true name, if any, so import can offer to update it. */
export async function findBySheetName(text: string): Promise<CharacterIndexEntry | undefined> {
  const name = displayName(parseSheet(text));
  return (await listCharacters()).find((c) => c.displayName === name);
}

// ---------------------------------------------------------------- tracker & combat

async function loadTrackerRaw(slug: string): Promise<TrackerState | undefined> {
  const t = await get<TrackerState>('trackers', slug);
  return t ? normalizeTracker(t) : undefined;
}

export async function loadTracker(slug: string, sheet: CharacterSheet): Promise<TrackerState> {
  const t = await loadTrackerRaw(slug);
  if (t) return t;
  const created = trackerFromCharacter(slug, sheet);
  await saveTracker(created);
  return created;
}

export const saveTracker = (t: TrackerState) => put('trackers', t);

export async function loadCombat(slug: string): Promise<CombatSession> {
  return (await get<CombatSession>('combat', slug)) ?? inactiveSession(slug);
}

export const saveCombat = (s: CombatSession) => put('combat', s);

// ---------------------------------------------------------------- images (portraits and backgrounds)

/** One imported file. `owner` is a character slug, or BACKGROUNDS_OWNER for the shared scenes. */
export interface StoredImage {
  id: string;
  owner: string;
  name: string;
  blob: Blob;
  addedAt: number;
}

const imageId = (owner: string, name: string) => `${owner}/${name.toLowerCase()}`;

export async function listImages(owner: string): Promise<StoredImage[]> {
  return tx<StoredImage[]>('images', 'readonly', (s) => s.index('owner').getAll(owner));
}

/** Add or replace files by name (case-insensitive), in one transaction. */
export async function putImages(owner: string, files: { name: string; blob: Blob }[]): Promise<void> {
  const db = await open();
  const t = db.transaction('images', 'readwrite');
  const store = t.objectStore('images');
  const now = Date.now();
  for (const f of files) store.put({ id: imageId(owner, f.name), owner, name: f.name, blob: f.blob, addedAt: now } satisfies StoredImage);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Saving images failed (storage may be full).'));
  });
}

export const deleteImage = (owner: string, name: string) => del('images', imageId(owner, name));

export async function clearImages(owner: string): Promise<void> {
  const rows = await listImages(owner);
  for (const r of rows) await del('images', r.id);
}

// ---------------------------------------------------------------- settings

export const getSetting = <T>(key: string) => get<T>('settings', key);
export const setSetting = (key: string, value: unknown) => put('settings', value, key);

// ---------------------------------------------------------------- backup

export interface BackupBundle {
  format: 'actormaker-backup';
  version: 1;
  exportedAt: string;
  characters: { slug: string; importedAt: number; sheet: CharacterSheet; tracker?: TrackerState; combat?: CombatSession }[];
}

export async function exportAll(): Promise<BackupBundle> {
  const chars = await all<StoredCharacter>('characters');
  const trackers = new Map((await all<TrackerState>('trackers')).map((t) => [t.slug, t]));
  const combat = new Map((await all<CombatSession>('combat')).map((c) => [c.slug, c]));
  return {
    format: 'actormaker-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    characters: chars.map((c) => ({
      slug: c.slug,
      importedAt: c.importedAt,
      sheet: c.sheet,
      tracker: trackers.get(c.slug),
      combat: combat.get(c.slug),
    })),
  };
}

export const isBackupBundle = (v: unknown): v is BackupBundle =>
  typeof v === 'object' && v !== null && (v as BackupBundle).format === 'actormaker-backup' && Array.isArray((v as BackupBundle).characters);

/** Restore a backup: same slugs are overwritten with the backed-up sheet, tracker and combat state. */
export async function restoreAll(bundle: BackupBundle): Promise<number> {
  for (const c of bundle.characters) {
    const sheet = parseSheet(c.sheet);
    await saveCharacter(c.slug, sheet, c.importedAt);
    if (c.tracker) await saveTracker(normalizeTracker({ ...c.tracker, slug: c.slug }));
    if (c.combat) await saveCombat({ ...c.combat, slug: c.slug });
  }
  return bundle.characters.length;
}

/** Ask the browser not to evict our storage (helps on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
