/**
 * Portrait mode and Play mode. A portrait is one static picture with its background painted in,
 * shown the way Mild Gilding shows its painted portraits: big on a dark vignette, a tap shows it
 * full size over everything.
 *
 * Portrait mode: the face, and a grid of the character's pictures to pick the face from, add and
 * delete. A character with an alias has two faces, picked separately: the one shown as the alias
 * (and in player-safe view) and the one shown under the true name. Each picture says whether the
 * alias may show it.
 * Play mode: the face with an Explore / Combat / AI HUD underneath.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BACKGROUNDS_OWNER, clearImages, deleteImage, listImages, putImages, type StoredImage } from '../data/db';
import type { CharacterSheet } from '../data/model';
import {
  allPortraits, chosenFace, faceFor, type FaceSlot, forgetFile, IMAGE_EXT, MANIFEST_FILE, manifestSecrets, migratePrefs, parseJsonText,
  type Portrait, type PortraitPrefs, resolveFace, revealPair, setFace, setSecret, slotFor, storedPrefs, visiblePortraits, withPrefs,
} from '../data/portraits';
import { autoEnterEffects, enterCombat, exitCombat, advanceTurn, type ActiveEffect } from '../data/combat';
import { summarize } from '../data/encumbrance';
import { type SheetViewContext, redactForView, sheetTitle, shouldHideSecretIdentity } from '../data/viewContext';
import { useCharacter, type CharacterHandle, type CharacterState } from './useCharacter';
import type { SheetSettings } from './SheetScreen';
import { Dialog } from './common';
import { HpCard } from './Tracker';
import { AddEffectDialog, Economy, EffectDetailDialog, EffectList, ExitCombat } from './CombatView';

// ---------------------------------------------------------------- stored pictures → URLs

interface PortraitFiles {
  rows: StoredImage[];
  /** Image file names, oldest first. */
  files: string[];
  manifest: string | null;
  url: (name: string) => string | undefined;
  loaded: boolean;
  reload: () => void;
}

function usePortraitFiles(slug: string): PortraitFiles {
  const [state, setState] = useState<{ rows: StoredImage[]; manifest: string | null; urls: Map<string, string>; loaded: boolean }>({
    rows: [], manifest: null, urls: new Map(), loaded: false,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    void (async () => {
      const rows = (await listImages(slug)).sort((a, b) => a.addedAt - b.addedAt || a.name.localeCompare(b.name));
      const m = rows.find((r) => r.name.toLowerCase() === MANIFEST_FILE);
      const manifest = m ? await m.blob.text() : null;
      if (cancelled) return;
      const urls = new Map<string, string>();
      for (const r of rows) {
        if (!IMAGE_EXT.test(r.name)) continue;
        const u = URL.createObjectURL(r.blob);
        made.push(u);
        urls.set(r.name, u);
      }
      setState({ rows, manifest, urls, loaded: true });
    })();
    return () => {
      cancelled = true;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [slug, nonce]);
  return {
    rows: state.rows,
    files: state.rows.map((r) => r.name).filter((n) => IMAGE_EXT.test(n)),
    manifest: state.manifest,
    url: (n) => state.urls.get(n),
    loaded: state.loaded,
    reload: () => setNonce((x) => x + 1),
  };
}

/** Saved prefs, else what an old layered-portrait manifest implies, else none. */
const effectivePrefs = (sheet: CharacterSheet, manifest: string | null): PortraitPrefs => storedPrefs(sheet) ?? migratePrefs(sheet, manifest) ?? {};

/** A reveal at the table: the alias picture first, then, on a tap, the true-name one. */
export interface Reveal { maskUrl: string; maskName: string; trueUrl: string; trueName: string }

function revealFor(sheet: CharacterSheet, prefs: PortraitPrefs, pics: PortraitFiles, ctx: SheetViewContext): Reveal | null {
  const pair = revealPair(sheet, prefs, pics.files, ctx);
  const maskUrl = pair && pics.url(pair.alias.file);
  const trueUrl = pair && pics.url(pair.primary.file);
  if (!maskUrl || !trueUrl) return null;
  return { maskUrl, trueUrl, maskName: sheet.identity?.cultAlias?.trim() ?? '', trueName: sheet.identity?.name?.trim() ?? '' };
}

/**
 * The face to show for this view (never a secret picture in alias or player-safe view), as a URL,
 * and the reveal its full-size view offers, if any.
 */
export function useFace(slug: string, sheet: CharacterSheet | undefined, ctx: SheetViewContext): { url: string; label: string; reveal: Reveal | null } | null {
  const pics = usePortraitFiles(slug);
  if (!sheet || !pics.loaded) return null;
  const prefs = effectivePrefs(sheet, pics.manifest);
  const face = faceFor(sheet, prefs, pics.files, ctx);
  const url = face ? pics.url(face.file) : undefined;
  return face && url ? { url, label: face.label, reveal: revealFor(sheet, prefs, pics, ctx) } : null;
}

const isJson = (f: File) => /\.json$/i.test(f.name) || f.type === 'application/json';
const isImage = (f: File) => IMAGE_EXT.test(f.name) || /^image\/(png|jpeg|webp)$/.test(f.type);
const extFor = (type: string) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg');

/**
 * Pictures keep their original bytes. A manifest.json from the old layered portraits is read only
 * for which pictures are secret; it is not stored.
 */
async function importPictures(slug: string, sheet: CharacterSheet, files: File[]): Promise<{ message: string; secret: string[]; added: string[] }> {
  const out: { name: string; blob: Blob }[] = [];
  const skipped: string[] = [];
  let manifest: string | null = null;
  for (const f of files) {
    if (isJson(f)) {
      const text = await f.text();
      try {
        const j = parseJsonText(text) as { sets?: unknown };
        if (!Array.isArray(j?.sets)) throw new Error('no sets');
        manifest = text;
      } catch {
        skipped.push(f.name);
      }
    } else if (isImage(f)) {
      const name = IMAGE_EXT.test(f.name) ? f.name : `portrait_${Date.now()}_${out.length}.${extFor(f.type)}`;
      out.push({ name, blob: new Blob([await f.arrayBuffer()], { type: f.type || 'image/png' }) });
    } else skipped.push(f.name);
  }
  if (out.length) await putImages(slug, out);
  return {
    message: [
      `Added ${out.length} picture${out.length === 1 ? '' : 's'}.`,
      manifest ? 'Read the secret pictures from manifest.json.' : '',
      skipped.length ? `Skipped: ${skipped.join(', ')}.` : '',
    ].filter(Boolean).join(' '),
    secret: manifest ? manifestSecrets(manifest, sheet) : [],
    added: out.map((o) => o.name),
  };
}

// ---------------------------------------------------------------- screen

interface Props {
  slug: string;
  play: boolean;
  settings: SheetSettings;
  onSettings: (s: SheetSettings) => void;
  onBack: () => void;
  onAi: () => void;
  toast: (m: string) => void;
}

type Hud = 'explore' | 'combat' | 'ai';

export function PortraitScreen(props: Props) {
  const h = useCharacter(props.slug);
  if (h.error) {
    return (
      <div class="art">
        <div class="art-top">
          <button class="icon ghost" aria-label="Back" onClick={props.onBack}>←</button>
          <h1>Not found</h1>
        </div>
        <div class="art-stage"><div class="portrait-empty">{h.error}</div></div>
      </div>
    );
  }
  if (!h.state) return <div class="art" />;
  return <ArtScreen {...props} h={h} c={h.state} />;
}

function ArtScreen({ slug, play, settings, onSettings, onBack, onAi, toast, h, c }: Props & { h: CharacterHandle; c: CharacterState }) {
  const pics = usePortraitFiles(slug);
  const { ctx } = settings;
  const sheet = c.sheet;
  const stored = storedPrefs(sheet);
  const prefs = effectivePrefs(sheet, pics.manifest);

  // Save what an old manifest implied once, so later edits build on it.
  useEffect(() => {
    if (!pics.loaded || stored) return;
    const migrated = migratePrefs(sheet, pics.manifest);
    if (migrated) h.updateSheet((s) => (storedPrefs(s) ? s : withPrefs(s, migrated)));
  }, [pics.loaded, pics.manifest, !!stored]);

  const hiding = shouldHideSecretIdentity(ctx, sheet.identity);
  const all = useMemo(() => allPortraits(sheet, prefs, pics.files), [sheet, pics.files.join('|'), JSON.stringify(prefs)]);
  const visible = useMemo(() => visiblePortraits(sheet, prefs, pics.files, ctx), [all, hiding]);
  const publicPics = useMemo(() => all.filter((p) => !p.secret), [all]);
  const hiddenCount = all.length - visible.length;

  // Two faces only for a character with an alias, and both are offered only under the true name:
  // in alias or player-safe view the true name (and its face) must not appear at all.
  const aliasName = sheet.identity?.cultAlias?.trim() ?? '';
  const trueName = sheet.identity?.name?.trim() ?? '';
  const twoFaces = !!aliasName && !!trueName && aliasName.toLowerCase() !== trueName.toLowerCase();
  const choosing = !hiding && twoFaces;
  const [pick, setPick] = useState<FaceSlot>('primary');
  const slot: FaceSlot = choosing ? pick : slotFor(sheet, ctx);
  const faceOf = (s: FaceSlot) => resolveFace(s === 'alias' ? publicPics : all, prefs, s);
  const aliasFace = twoFaces || hiding ? faceOf('alias') : null;
  const primaryFace = hiding ? null : faceOf('primary');
  const face = slot === 'alias' ? aliasFace : primaryFace;
  const faceUrl = face ? pics.url(face.file) : undefined;
  const reveal = revealFor(sheet, prefs, pics, ctx);

  const updatePrefs = (f: (p: PortraitPrefs) => PortraitPrefs) => h.updateSheet((s) => withPrefs(s, f(effectivePrefs(s, pics.manifest))));

  const [zoom, setZoom] = useState(false);
  const [manage, setManage] = useState(false);
  const [hud, setHud] = useState<Hud>(c.combat.active ? 'combat' : 'explore');
  const [hpOpen, setHpOpen] = useState(false);
  const [addEffect, setAddEffect] = useState(false);
  const [selected, setSelected] = useState<ActiveEffect | null>(null);

  const shown = redactForView(sheet, ctx);
  const title = sheetTitle(shown, ctx);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      const r = await importPictures(slug, sheet, files);
      updatePrefs((p) => {
        let next = p;
        for (const f of r.secret) next = setSecret(next, f, true);
        // The first picture added becomes the true-name face if there is none yet.
        if (!chosenFace(next, 'primary') && r.added.length) next = setFace(next, 'primary', r.added[0]);
        return next;
      });
      toast(r.message);
    } catch (e) {
      toast(`Couldn't save those pictures: ${(e as Error).message}`);
    }
    pics.reload();
  };

  const remove = async (p: Portrait) => {
    await deleteImage(slug, p.file);
    updatePrefs((x) => forgetFile(x, p.file));
    pics.reload();
  };

  const empty = pics.loaded && !faceUrl
    ? all.length
      ? 'No picture to show in this view.'
      : 'No portrait on this device yet. Use “+ Add pictures” to pick one from your files.'
    : null;

  const dialogs = (
    <>
      {zoom && faceUrl && <PortraitZoom url={faceUrl} name={title} reveal={reveal} onClose={() => setZoom(false)} />}
      {manage && (
        <ManageDialog
          slug={slug}
          rows={pics.rows}
          visible={new Set(visible.map((p) => p.file))}
          hiddenCount={hiddenCount}
          onChanged={() => {
            pics.reload();
            updatePrefs((p) => ({ ...p, face: null, faces: {} }));
          }}
          onClose={() => setManage(false)}
          toast={toast}
        />
      )}
      {hpOpen && (
        <Dialog title="Hit points" onClose={() => setHpOpen(false)}>
          <HpCard c={c} h={h} />
        </Dialog>
      )}
      {addEffect && (
        <AddEffectDialog
          onClose={() => setAddEffect(false)}
          onAdd={(e) => {
            h.updateCombat((s) => ({ ...s, effects: [...s.effects, e] }));
            setAddEffect(false);
          }}
        />
      )}
      {selected && (
        <EffectDetailDialog
          effect={selected}
          onClose={() => setSelected(null)}
          onRemove={() => {
            h.updateCombat((s) => ({ ...s, effects: s.effects.filter((e) => e.id !== selected.id) }));
            setSelected(null);
          }}
        />
      )}
    </>
  );

  const enter = () => {
    h.updateCombat((s, sh) => enterCombat(s.slug, s, autoEnterEffects(sh)));
    setHud('combat');
  };
  const enc = summarize(sheet, settings.trackEncumbrance);
  const tr = c.tracker;

  return (
    <>
      <div class="art">
        <div class="art-top">
          <button class="icon ghost" aria-label="Back" onClick={onBack}>←</button>
          <div class="grow">
            <h1>{title}</h1>
            <div class="sub">
              {play ? (hud === 'combat' ? `Combat · Round ${c.combat.active ? c.combat.round : '—'}` : hud === 'ai' ? 'AI' : 'Explore') : 'Portrait'}
            </div>
          </div>
        </div>
        <div class="art-stage">
          {faceUrl ? (
            <button class="portrait-frame" aria-label="Show the portrait full size" onClick={() => setZoom(true)}>
              <img src={faceUrl} alt={`${title}'s portrait`} draggable={false} />
            </button>
          ) : (
            empty && <div class="portrait-empty">{empty}</div>
          )}
        </div>
        <div class="art-panel">
          {!play && (
            <>
              {choosing && (
                <div class="face-slots" role="tablist" aria-label="Whose portrait to choose">
                  {(['alias', 'primary'] as FaceSlot[]).map((sl) => {
                    const f = sl === 'alias' ? aliasFace : primaryFace;
                    const u = f ? pics.url(f.file) : undefined;
                    return (
                      <button key={sl} role="tab" class="face-slot" aria-pressed={pick === sl} onClick={() => setPick(sl)}>
                        <span class="face-slot-thumb">{u && <img src={u} alt="" draggable={false} />}</span>
                        <span class="face-slot-text">
                          <span class="tiny dim">{sl === 'alias' ? 'As the alias' : 'As the true name'}</span>
                          <span class="ellipsis">{sl === 'alias' ? aliasName : trueName}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {(choosing ? all : visible).length > 0 && (
                <div class="variants">
                  {(choosing ? all : visible).map((p) => {
                    const u = pics.url(p.file);
                    const chosen = face?.file === p.file;
                    const usedBy = [aliasFace?.file === p.file && (choosing ? 'Alias' : 'Portrait'), choosing && primaryFace?.file === p.file && 'True name'].filter(Boolean);
                    const forName = slot === 'alias' ? aliasName || 'player-safe view' : trueName || 'the portrait';
                    return (
                      <div class="variant-tile" key={p.file}>
                        <button
                          class={`variant${chosen ? ' selected' : ''}`}
                          aria-pressed={chosen}
                          aria-label={`Use ${p.label} for ${forName}`}
                          onClick={() => updatePrefs((x) => setFace(x, slot, p.file))}
                        >
                          {u && <img src={u} alt="" draggable={false} loading="lazy" />}
                          {usedBy.length > 0 && <span class="variant-used">{usedBy.join(' · ')}</span>}
                        </button>
                        <button class="variant-corner right" aria-label={`Delete ${p.label}`} onClick={() => { if (confirm(`Delete ${p.label} from this device?`)) void remove(p); }}>
                          ✕
                        </button>
                        {choosing && (
                          <button
                            class={`variant-shown${p.secret ? ' off' : ''}`}
                            aria-pressed={!p.secret}
                            aria-label={`${p.label}: ${p.secret ? `hidden as ${aliasName}. Tap to show it as ${aliasName} too` : `shown as ${aliasName}. Tap to keep it to the true name`}`}
                            onClick={() => updatePrefs((x) => setSecret(x, p.file, !p.secret))}
                          >
                            {p.secret ? 'Alias: hidden' : 'Alias: shown'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {hiding && hiddenCount > 0 && <div class="tiny dim">{hiddenCount} more not shown in this view.</div>}
              <div class="tiny dim">
                {choosing
                  ? 'Choose the alias or the true name above, then tap its picture. “Alias: hidden” pictures only appear under the true name.'
                  : 'Tap a picture to make it the portrait.'}
              </div>
              <div class="row" style={{ flexWrap: 'nowrap' }}>
                <FilePick label="+ Add pictures" onFiles={(f) => void onFiles(f)} />
                <button class="small" onClick={() => setManage(true)}>Manage</button>
              </div>
            </>
          )}
          {play && hud === 'explore' && (
            <>
              <button class="hud-hp" onClick={() => setHpOpen(true)}>
                <span>HP {tr.currentHp}/{tr.maxHp}{tr.tempHp > 0 ? ` +${tr.tempHp}` : ''}</span>
                <span class="dim">AC {sheet.derived?.armorClass ?? '—'}</span>
              </button>
              {enc.trackingEnabled && <div class="tiny dim">Load {Math.round(enc.totalKnownLb)} / {enc.maxCapacityLb} lb</div>}
              <label class="check small">
                <input type="checkbox" checked={settings.trackEncumbrance} onChange={(e) => onSettings({ ...settings, trackEncumbrance: (e.target as HTMLInputElement).checked })} />
                Track encumbrance
              </label>
              <button class="start-combat" onClick={enter}>⚔ Enter combat</button>
            </>
          )}
          {play && hud === 'combat' && (
            c.combat.active ? (
              <>
                <div class="row between">
                  <span class="strong">Round {c.combat.round}</span>
                  <button class="small" onClick={() => setHpOpen(true)}>HP {tr.currentHp}/{tr.maxHp}{tr.tempHp > 0 ? ` +${tr.tempHp}` : ''} · AC {sheet.derived?.armorClass ?? '—'}</button>
                </div>
                <Economy c={c} h={h} />
                <div class="row" style={{ flexWrap: 'nowrap' }}>
                  <button class="grow end-turn" onClick={() => h.updateCombat(advanceTurn)}>End turn</button>
                  <button class="grow" onClick={() => setAddEffect(true)}>+ Effect</button>
                </div>
                {c.combat.effects.length > 0 && <EffectList effects={c.combat.effects} onPick={setSelected} />}
                <ExitCombat
                  onExit={(clear) => {
                    h.updateCombat((s) => exitCombat(s, clear));
                    setHud('explore');
                  }}
                />
              </>
            ) : (
              <>
                <div>Not in combat</div>
                <button class="start-combat" onClick={enter}>⚔ Enter combat</button>
              </>
            )
          )}
          {play && hud === 'ai' && (
            <>
              <div class="small">Level up, table events, or rules research. You accept or reject every change before it touches the sheet.</div>
              <button class="wide" onClick={onAi}>Open AI assistant</button>
            </>
          )}
          {play && (
            <div class="hud-modes" role="tablist">
              {(['explore', 'combat', 'ai'] as Hud[]).map((m) => (
                <button key={m} class={m} aria-pressed={hud === m} onClick={() => setHud(m)}>
                  {m === 'explore' ? 'Explore' : m === 'combat' ? 'Combat' : 'AI'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {dialogs}
    </>
  );
}

// ---------------------------------------------------------------- pieces

/**
 * The portrait full size over everything, to look at or turn round and show the table. A tap, ✕ or
 * Escape closes it. With a reveal it always opens on the alias picture and name, whatever view the
 * sheet is in, and "Reveal" fades to the true-name picture and name. The true name is not on the
 * page until then.
 */
export function PortraitZoom({ url, name, reveal, onClose }: { url: string; name: string; reveal?: Reveal | null; onClose: () => void }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shownName = reveal ? (revealed ? reveal.trueName : reveal.maskName) : name;
  return (
    <div class="portrait-zoom" role="dialog" aria-label={`${shownName}'s portrait`} onClick={onClose}>
      <div class="portrait-zoom-pic">
        <img src={reveal ? reveal.maskUrl : url} alt={revealed ? '' : `${shownName}'s portrait`} draggable={false} />
        {reveal && revealed && <img class="revealed" src={reveal.trueUrl} alt={`${shownName}'s portrait`} draggable={false} />}
      </div>
      <div class={`portrait-zoom-name${revealed ? ' revealed' : ''}`} key={shownName}>{shownName}</div>
      {reveal && (
        <button
          class="portrait-zoom-reveal"
          aria-pressed={revealed}
          onClick={(e) => {
            e.stopPropagation();
            setRevealed(!revealed);
          }}
        >
          {revealed ? 'Hide again' : 'Reveal'}
        </button>
      )}
      <button class="portrait-zoom-close" aria-label="Close">✕</button>
    </div>
  );
}

function FilePick({ label, onFiles }: { label: string; onFiles: (f: File[]) => void }) {
  return (
    <label class="btn grow small-btn">
      {label}
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.json,application/json"
        class="hidden"
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const files = [...(input.files ?? [])];
          input.value = '';
          onFiles(files);
        }}
      />
    </label>
  );
}

function ManageDialog({ slug, rows, visible, hiddenCount, onChanged, onClose, toast }: {
  slug: string;
  rows: StoredImage[];
  visible: Set<string>;
  hiddenCount: number;
  onChanged: () => void;
  onClose: () => void;
  toast: (m: string) => void;
}) {
  const [confirm, setConfirm] = useState<'all' | 'bg' | null>(null);
  const [oldBg, setOldBg] = useState<StoredImage[]>([]);
  useEffect(() => {
    void listImages(BACKGROUNDS_OWNER).then(setOldBg);
  }, []);
  const mb = (list: StoredImage[]) => `${(list.reduce((n, r) => n + r.blob.size, 0) / 1024 / 1024).toFixed(1)} MB`;
  // In alias / player-safe view only the visible pictures are named (a file name can give the secret away).
  const pictures = rows.filter((r) => IMAGE_EXT.test(r.name));
  const shownRows = pictures.filter((r) => visible.has(r.name));
  return (
    <Dialog title="Portrait pictures" onClose={onClose}>
      <p class="small muted" style={{ margin: 0 }}>
        Pictures are stored on this device only. They are <b>not</b> in “Back up all” files (they would make backups huge), so keep the
        originals on your computer or in Files. Adding a file with the same name replaces it.
      </p>
      <div class="strong">This character · {pictures.length} picture{pictures.length === 1 ? '' : 's'} · {mb(rows)}</div>
      {shownRows.length ? (
        <ul class="plain">
          {shownRows.map((r) => <li key={r.id} class="small ellipsis">{r.name}</li>)}
        </ul>
      ) : (
        <div class="small muted">{rows.length ? 'None shown.' : 'None yet.'}</div>
      )}
      {hiddenCount > 0 && <div class="small muted">{hiddenCount} more not listed in this view. Switch to the true name (not player-safe) to see them.</div>}
      {rows.length > 0 &&
        (confirm === 'all' ? (
          <div class="row">
            <button class="small danger fill" onClick={() => void clearImages(slug).then(() => { onChanged(); setConfirm(null); toast('Pictures removed.'); })}>Remove all pictures</button>
            <button class="small" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        ) : (
          <button class="small danger" onClick={() => setConfirm('all')}>Remove all pictures…</button>
        ))}
      {oldBg.length > 0 && (
        <>
          <div class="strong">Old backgrounds (no longer used) · {mb(oldBg)}</div>
          <div class="small muted">Portraits now carry their own background. These scene files from the earlier layered portraits can go.</div>
          {confirm === 'bg' ? (
            <div class="row">
              <button class="small danger fill" onClick={() => void clearImages(BACKGROUNDS_OWNER).then(() => { setOldBg([]); setConfirm(null); toast('Old backgrounds removed.'); })}>Remove old backgrounds</button>
              <button class="small" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          ) : (
            <button class="small danger" onClick={() => setConfirm('bg')}>Remove old backgrounds…</button>
          )}
        </>
      )}
    </Dialog>
  );
}
