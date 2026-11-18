/**
 * Portrait mode and Play mode: a 9:16 scene with a character cutout over a background.
 * Port of archive/android/.../portrait/PortraitModeScreen.kt and PlayModeScreen.kt.
 *
 * Portrait mode: browse outfits, expressions, facings and scenes; unlock to drag/pinch the cutout
 * into place (saved per outfit in sheet.appearance.portraitPrefs, the same shape Android wrote).
 * Play mode: the same scene with an Explore / Combat / AI HUD underneath.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BACKGROUNDS_OWNER, clearImages, deleteImage, getSetting, listImages, putImages, setSetting, type StoredImage,
} from '../data/db';
import {
  clampTransform, DEFAULT_TRANSFORM, IMAGE_EXT, initialExpression, initialFacing, MANIFEST_FILE, type Outfit, outfitKey,
  outfitLabel, parseJsonText, parsePortraitLibrary, PLACEHOLDER_BACKGROUNDS, portraitPrefs, orderBackgrounds, resolveExpression,
  savedTransform, stem, type Transform, transformPrefs, visibleOutfits, withSetPrefs, wrapIndex,
} from '../data/portraits';
import { autoEnterEffects, enterCombat, exitCombat, advanceTurn, type ActiveEffect } from '../data/combat';
import { summarize } from '../data/encumbrance';
import { redactForView, sheetTitle, shouldHideSecretIdentity } from '../data/viewContext';
import { shrinkToJpeg } from '../ai/scanLoader';
import { useCharacter, type CharacterHandle, type CharacterState } from './useCharacter';
import type { SheetSettings } from './SheetScreen';
import { Dialog } from './common';
import { HpCard } from './Tracker';
import { AddEffectDialog, Economy, EffectDetailDialog, EffectList, ExitCombat } from './CombatView';

// ---------------------------------------------------------------- stored images → URLs

interface ArtFiles {
  portraits: StoredImage[];
  backgrounds: StoredImage[];
  portraitManifest: string | null;
  backgroundManifest: string | null;
  portraitUrl: (name: string) => string | undefined;
  backgroundUrl: (name: string) => string | undefined;
  loaded: boolean;
  reload: () => void;
}

function useArtFiles(slug: string): ArtFiles {
  const [state, setState] = useState<{
    portraits: StoredImage[]; backgrounds: StoredImage[]; pm: string | null; bm: string | null;
    pUrls: Map<string, string>; bUrls: Map<string, string>; loaded: boolean;
  }>({ portraits: [], backgrounds: [], pm: null, bm: null, pUrls: new Map(), bUrls: new Map(), loaded: false });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    void (async () => {
      const [p, b] = await Promise.all([listImages(slug), listImages(BACKGROUNDS_OWNER)]);
      const manifest = async (rows: StoredImage[]) => {
        const m = rows.find((r) => r.name.toLowerCase() === MANIFEST_FILE);
        return m ? m.blob.text() : null;
      };
      const [pm, bm] = await Promise.all([manifest(p), manifest(b)]);
      if (cancelled) return;
      const urls = (rows: StoredImage[]) => {
        const m = new Map<string, string>();
        for (const r of rows) {
          if (!IMAGE_EXT.test(r.name)) continue;
          const u = URL.createObjectURL(r.blob);
          made.push(u);
          m.set(r.name, u);
        }
        return m;
      };
      setState({ portraits: p, backgrounds: b, pm, bm, pUrls: urls(p), bUrls: urls(b), loaded: true });
    })();
    return () => {
      cancelled = true;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [slug, nonce]);

  return {
    portraits: state.portraits,
    backgrounds: state.backgrounds,
    portraitManifest: state.pm,
    backgroundManifest: state.bm,
    portraitUrl: (n) => state.pUrls.get(n),
    backgroundUrl: (n) => state.bUrls.get(n),
    loaded: state.loaded,
    reload: () => setNonce((x) => x + 1),
  };
}

const isJson = (f: File) => /\.json$/i.test(f.name) || f.type === 'application/json';
const isImage = (f: File) => IMAGE_EXT.test(f.name) || /^image\/(png|jpeg|webp)$/.test(f.type);
const extFor = (type: string) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg');

/** Portraits keep their original bytes (transparent cutouts need the alpha channel). */
async function importPortraits(slug: string, files: File[]): Promise<string> {
  const out: { name: string; blob: Blob }[] = [];
  const skipped: string[] = [];
  let manifest = false;
  for (const f of files) {
    if (isJson(f)) {
      const text = await f.text();
      try {
        const j = parseJsonText(text) as { sets?: unknown };
        if (!Array.isArray(j?.sets)) throw new Error('no sets');
        out.push({ name: MANIFEST_FILE, blob: new Blob([text], { type: 'application/json' }) });
        manifest = true;
      } catch {
        skipped.push(f.name);
      }
    } else if (isImage(f)) {
      const name = IMAGE_EXT.test(f.name) ? f.name : `portrait_${Date.now()}_${out.length}.${extFor(f.type)}`;
      out.push({ name, blob: new Blob([await f.arrayBuffer()], { type: f.type || 'image/png' }) });
    } else skipped.push(f.name);
  }
  if (out.length) await putImages(slug, out);
  const n = out.length - (manifest ? 1 : 0);
  return [
    `Added ${n} portrait image${n === 1 ? '' : 's'}${manifest ? ' and manifest.json' : ''}.`,
    skipped.length ? `Skipped: ${skipped.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

/** Backgrounds are opaque scenes, so they're shrunk to 1920 px JPEG to save space (about 2 MB → 300 KB). */
async function importBackgrounds(files: File[]): Promise<string> {
  const out: { name: string; blob: Blob }[] = [];
  const skipped: string[] = [];
  let manifest = false;
  for (const f of files) {
    if (isJson(f)) {
      const text = await f.text();
      try {
        const j = parseJsonText(text) as { items?: unknown };
        if (!Array.isArray(j?.items)) throw new Error('no items');
        out.push({ name: MANIFEST_FILE, blob: new Blob([text], { type: 'application/json' }) });
        manifest = true;
      } catch {
        skipped.push(f.name);
      }
    } else if (isImage(f)) {
      try {
        out.push({ name: `${stem(f.name) || `scene_${Date.now()}_${out.length}`}.jpg`, blob: await shrinkToJpeg(f, 1920) });
      } catch {
        skipped.push(f.name);
      }
    } else skipped.push(f.name);
  }
  if (out.length) await putImages(BACKGROUNDS_OWNER, out);
  const n = out.length - (manifest ? 1 : 0);
  return [
    `Added ${n} background${n === 1 ? '' : 's'}${manifest ? ' and manifest.json' : ''}.`,
    skipped.length ? `Skipped: ${skipped.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- screen

interface SceneSetting { builtin: boolean; index: number }

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
        <div class="art-stage"><div class="scene-empty">{h.error}</div></div>
      </div>
    );
  }
  if (!h.state) return <div class="art" />;
  return <ArtScreen {...props} h={h} c={h.state} />;
}

function ArtScreen({ slug, play, settings, onSettings, onBack, onAi, toast, h, c }: Props & { h: CharacterHandle; c: CharacterState }) {
  const art = useArtFiles(slug);
  const { ctx } = settings;
  const sheet = c.sheet;
  const prefs = portraitPrefs(sheet);

  const lib = useMemo(() => parsePortraitLibrary(art.portraitManifest, art.portraits.map((p) => p.name)), [art.portraitManifest, art.portraits]);
  const outfits = useMemo(() => visibleOutfits(lib, sheet, ctx), [lib, sheet.identity, ctx.displayNameChoice, ctx.playerSafeMode]);
  const bgItems = useMemo(() => orderBackgrounds(art.backgroundManifest, art.backgrounds.map((b) => b.name)), [art.backgroundManifest, art.backgrounds]);

  // Outfit / expression / facing.
  const [outfitIdx, setOutfitIdx] = useState<number | null>(null);
  const [expression, setExpression] = useState<string | null>(null);
  const [facing, setFacing] = useState(0);

  const pickOutfit = useCallback(
    (i: number, list: Outfit[] = outfits) => {
      const o = list[wrapIndex(i, list.length)];
      setOutfitIdx(wrapIndex(i, list.length));
      if (o?.kind === 'set') {
        const e = initialExpression(o.set, prefs);
        setExpression(e);
        setFacing(initialFacing(o.set, e, prefs));
      } else {
        setExpression(null);
        setFacing(0);
      }
    },
    [outfits, prefs],
  );

  // First pick, and again whenever the visible list changes (alias / player-safe switch, new import).
  const outfitIds = outfits.map(outfitKey).join('|');
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    if (!art.loaded) return;
    // Keep showing the same outfit if it's still visible; otherwise fall back to the saved one, then the first.
    const same = shownKey.current ? outfits.findIndex((o) => outfitKey(o) === shownKey.current) : -1;
    if (same >= 0) {
      setOutfitIdx(same);
      return;
    }
    const active = prefs.activeSetId ? outfits.findIndex((o) => outfitKey(o) === prefs.activeSetId) : -1;
    pickOutfit(active >= 0 ? active : 0);
  }, [art.loaded, outfitIds]);

  const outfit: Outfit | undefined = outfitIdx != null ? outfits[outfitIdx] : undefined;
  const key = outfit ? outfitKey(outfit) : null;
  shownKey.current = key;
  const set = outfit?.kind === 'set' ? outfit.set : null;
  const expr = set ? resolveExpression(set, expression) : null;
  const views = set && expr ? set.expressions[expr] : [];
  const view = views[wrapIndex(facing, views.length)];
  const spriteFile = set ? view?.file : outfit?.kind === 'flat' ? outfit.portrait.file : undefined;
  const spriteUrl = spriteFile ? art.portraitUrl(spriteFile) : undefined;
  const exprNames = set ? Object.keys(set.expressions) : [];
  const spriteLabel = outfit ? (set && expr ? `${outfitLabel(outfit)} — ${humanize(expr)}${views.length > 1 && view ? ` · ${view.label}` : ''}` : outfitLabel(outfit)) : 'No portrait';

  const stepOutfit = (d: number) => {
    if (outfits.length < 2 || outfitIdx == null) return;
    const next = wrapIndex(outfitIdx + d, outfits.length);
    pickOutfit(next);
    const k = outfitKey(outfits[next]);
    h.updateSheet((s) => {
      const appearance = { ...((s.appearance as Record<string, unknown> | null) ?? {}) };
      appearance.portraitPrefs = { ...portraitPrefs(s), activeSetId: k };
      return { ...s, appearance };
    });
  };
  const stepExpression = (d: number) => {
    if (!set || exprNames.length < 2 || !expr) return;
    const next = exprNames[wrapIndex(exprNames.indexOf(expr) + d, exprNames.length)];
    setExpression(next);
    setFacing(initialFacing(set, next, prefs));
  };
  const rotate = (d: number) => views.length > 1 && setFacing((f) => wrapIndex(f + d, views.length));
  const makeDefault = () => {
    if (!set || !expr) return;
    h.updateSheet((s) => withSetPrefs(s, set.id, { defaultExpression: expr, defaultFacing: view?.profile ?? 'front' }));
    toast(`Default expression set to ${humanize(expr)}.`);
  };

  // Scene background.
  const [scene, setScene] = useState<SceneSetting | null>(null);
  useEffect(() => {
    void getSetting<SceneSetting>('scene').then((s) => setScene(s ?? { builtin: false, index: 0 }));
  }, []);
  const saveScene = (s: SceneSetting) => {
    setScene(s);
    void setSetting('scene', s);
  };
  const useImages = !!scene && !scene.builtin && bgItems.length > 0;
  const bgCount = useImages ? bgItems.length : PLACEHOLDER_BACKGROUNDS.length;
  const bgIndex = wrapIndex(scene?.index ?? 0, bgCount);
  const bgItem = useImages ? bgItems[bgIndex] : null;
  const placeholder = PLACEHOLDER_BACKGROUNDS[bgIndex % PLACEHOLDER_BACKGROUNDS.length];
  const bgUrl = bgItem ? art.backgroundUrl(bgItem.file) : undefined;
  const bgLabel = bgItem ? bgItem.label : `${placeholder.label} (built-in)`;
  const stepBg = (d: number) => saveScene({ builtin: !useImages, index: wrapIndex(bgIndex + d, bgCount) });

  // Pan / zoom (Portrait mode only), kept locally while dragging and saved when the gesture ends.
  const [locked, setLocked] = useState(true);
  const [t, setT] = useState<Transform>(DEFAULT_TRANSFORM);
  useEffect(() => setT(savedTransform(sheet, key)), [key]);
  const commit = (next: Transform) => {
    if (!key) return;
    h.updateSheet((s) => withSetPrefs(s, key, transformPrefs(next)));
  };
  const resetTransform = () => {
    setT(DEFAULT_TRANSFORM);
    commit(DEFAULT_TRANSFORM);
    toast('Portrait position reset.');
  };

  // Presentation mode: browser fullscreen where it exists (not iPhone Safari), else just hide the chrome.
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setPresent(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const enterPresent = () => {
    setPresent(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const exitPresent = () => {
    setPresent(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };

  // Play HUD.
  const [hud, setHud] = useState<Hud>(c.combat.active ? 'combat' : 'explore');
  const [showArt, setShowArt] = useState(!play);
  const [manage, setManage] = useState(false);
  const [hpOpen, setHpOpen] = useState(false);
  const [addEffect, setAddEffect] = useState(false);
  const [selected, setSelected] = useState<ActiveEffect | null>(null);

  const shown = redactForView(sheet, ctx);
  // In alias / player-safe view the file list only shows files of visible outfits (names can give the secret away).
  const hiding = shouldHideSecretIdentity(ctx, sheet.identity);
  const visibleFiles = useMemo(
    () => new Set([MANIFEST_FILE, ...outfits.flatMap((o) => (o.kind === 'set' ? Object.values(o.set.expressions).flat().map((v) => v.file) : [o.portrait.file]))]),
    [outfits],
  );
  const title = sheetTitle(shown, ctx);

  const onPortraitFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      toast(await importPortraits(slug, files));
    } catch (e) {
      toast(`Couldn't save those images: ${(e as Error).message}`);
    }
    art.reload();
  };
  const onBackgroundFiles = async (files: File[]) => {
    if (!files.length) return;
    toast('Saving backgrounds…');
    try {
      toast(await importBackgrounds(files));
      if (scene?.builtin) saveScene({ builtin: false, index: 0 });
    } catch (e) {
      toast(`Couldn't save those images: ${(e as Error).message}`);
    }
    art.reload();
  };

  const empty = !spriteUrl
    ? art.loaded
      ? lib.rotationSets.length + lib.flat.length > 0
        ? 'No portrait to show in this view.'
        : 'No portrait on this device yet. Use “+ Portraits” to pick the PNG cutouts (and manifest.json) from your files.'
      : null
    : null;

  const sceneEl = (
    <Scene
      bgUrl={bgUrl}
      bgLabel={bgLabel}
      gradient={useImages ? null : placeholder}
      spriteUrl={spriteUrl}
      spriteLabel={spriteLabel}
      transform={t}
      locked={play || locked}
      onTransform={setT}
      onCommit={commit}
      canRotate={views.length > 1}
      onRotate={rotate}
      empty={present ? null : empty}
    />
  );

  const artControls = (
    <ArtControls
      bgLabel={bgLabel}
      imagesCount={bgItems.length}
      useImages={useImages}
      onSource={(images) => saveScene({ builtin: !images, index: 0 })}
      outfits={outfits.length}
      outfitName={outfit ? outfitLabel(outfit) : 'none'}
      onOutfit={stepOutfit}
      onBg={stepBg}
      bgCount={bgCount}
      exprNames={exprNames}
      facings={views.length}
      expr={expr}
      onExpr={stepExpression}
      onDefault={makeDefault}
      onPortraitFiles={onPortraitFiles}
      onBackgroundFiles={onBackgroundFiles}
      onManage={() => setManage(true)}
    />
  );

  const dialogs = (
    <>
      {manage && <ManageDialog slug={slug} art={art} visible={hiding ? visibleFiles : null} onClose={() => setManage(false)} toast={toast} />}
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

  if (present) {
    return (
      <>
        <div class="art present">
          <div class="art-stage">{sceneEl}</div>
          <div class="pres-chrome">
            <button aria-label="Exit presentation mode" onClick={exitPresent}>✕</button>
            {!play && (
              <>
                <button aria-label={locked ? 'Unlock position' : 'Lock position'} onClick={() => setLocked((l) => !l)}>{locked ? '🔒' : '🔓'}</button>
                <button aria-label="Reset position and scale" onClick={resetTransform}>↺</button>
              </>
            )}
          </div>
        </div>
        {dialogs}
      </>
    );
  }

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
              {play ? (hud === 'combat' ? `Combat · Round ${c.combat.active ? c.combat.round : '—'}` : hud === 'ai' ? 'AI' : 'Explore') : spriteLabel}
            </div>
          </div>
          {!play && (
            <>
              <button class="icon ghost" aria-label={locked ? 'Unlock position to drag and pinch' : 'Lock position'} aria-pressed={!locked} onClick={() => setLocked((l) => !l)}>
                {locked ? '🔒' : '🔓'}
              </button>
              <button class="icon ghost" aria-label="Reset position and scale" onClick={resetTransform}>↺</button>
            </>
          )}
          <button class="icon ghost" aria-label="Presentation mode" onClick={enterPresent}>⛶</button>
        </div>
        <div class="art-stage">{sceneEl}</div>
        <div class="art-panel">
          {!play && (
            <>
              {!locked && <div class="tiny dim">Drag to move, pinch (or mouse wheel) to resize. Lock when done.</div>}
              {artControls}
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
              <div class="row" style={{ flexWrap: 'nowrap' }}>
                <button class="grow" onClick={onAi}>✨ AI</button>
                <button class="grow" aria-pressed={showArt} onClick={() => setShowArt((s) => !s)}>{showArt ? 'Hide art' : 'Portrait'}</button>
              </div>
              {showArt && artControls}
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

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---------------------------------------------------------------- scene with drag / pinch

function Scene(props: {
  bgUrl?: string;
  bgLabel: string;
  gradient: { from: string; to: string } | null;
  spriteUrl?: string;
  spriteLabel: string;
  transform: Transform;
  locked: boolean;
  onTransform: (t: Transform) => void;
  onCommit: (t: Transform) => void;
  canRotate: boolean;
  onRotate: (d: number) => void;
  empty: string | null;
}) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const base = useRef<{ t: Transform; pts: Map<number, { x: number; y: number }>; w: number; h: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef(props.transform);
  // Follow outside changes (outfit switch, reset) but not mid-gesture, where the handlers update it first.
  if (pointers.current.size === 0) latest.current = props.transform;
  const wheelTimer = useRef<number | undefined>(undefined);

  const rebase = () => {
    const r = el.current?.getBoundingClientRect();
    base.current = { t: latest.current, pts: new Map(pointers.current), w: r?.width || 1, h: r?.height || 1 };
  };
  const onDown = (e: PointerEvent) => {
    if (props.locked || (e.target as HTMLElement).closest('button')) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (e.g. a pointer that already ended); dragging still works inside the scene.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };
  const onMove = (e: PointerEvent) => {
    if (props.locked || !pointers.current.has(e.pointerId) || !base.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ids = [...base.current.pts.keys()].filter((id) => pointers.current.has(id));
    const b = base.current;
    let next: Transform;
    if (ids.length >= 2) {
      const [a0, b0] = [b.pts.get(ids[0])!, b.pts.get(ids[1])!];
      const [a1, b1] = [pointers.current.get(ids[0])!, pointers.current.get(ids[1])!];
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      next = { offsetX: b.t.offsetX + (mid1.x - mid0.x) / b.w, offsetY: b.t.offsetY + (mid1.y - mid0.y) / b.h, scale: b.t.scale * (d1 / d0) };
    } else if (ids.length === 1) {
      const p0 = b.pts.get(ids[0])!;
      const p1 = pointers.current.get(ids[0])!;
      next = { ...b.t, offsetX: b.t.offsetX + (p1.x - p0.x) / b.w, offsetY: b.t.offsetY + (p1.y - p0.y) / b.h };
    } else return;
    latest.current = clampTransform(next);
    props.onTransform(latest.current);
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) {
      base.current = null;
      props.onCommit(latest.current);
    } else rebase();
  };
  const onWheel = (e: WheelEvent) => {
    if (props.locked) return;
    e.preventDefault();
    latest.current = clampTransform({ ...latest.current, scale: latest.current.scale * Math.exp(-e.deltaY * 0.0015) });
    props.onTransform(latest.current);
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => props.onCommit(latest.current), 400);
  };

  const t = props.transform;
  const style: Record<string, string> = props.gradient ? { background: `linear-gradient(${props.gradient.from}, ${props.gradient.to})` } : {};
  return (
    <div
      ref={el}
      class={`scene${props.locked ? '' : ' unlocked'}`}
      style={style}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={onWheel}
    >
      {props.bgUrl && <img class="bg" src={props.bgUrl} alt={props.bgLabel} draggable={false} />}
      {props.spriteUrl && (
        <img
          class="sprite"
          src={props.spriteUrl}
          alt={props.spriteLabel}
          draggable={false}
          style={{ transform: `translate(${(t.offsetX * 100).toFixed(2)}%, ${(t.offsetY * 100).toFixed(2)}%) scale(${t.scale})` }}
        />
      )}
      {props.empty && <div class="scene-empty">{props.empty}</div>}
      {props.canRotate && (
        <>
          <button class="rot left" aria-label="Turn left" onClick={() => props.onRotate(-1)}>‹</button>
          <button class="rot right" aria-label="Turn right" onClick={() => props.onRotate(1)}>›</button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- controls

function FilePick({ label, accept, onFiles }: { label: string; accept: string; onFiles: (f: File[]) => void }) {
  return (
    <label class="btn grow small-btn">
      {label}
      <input
        type="file"
        multiple
        accept={accept}
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

const ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.json,application/json';

function Stepper({ label, value, onStep, disabled }: { label: string; value: string; onStep: (d: number) => void; disabled?: boolean }) {
  return (
    <div class="stepper">
      <button class="small" aria-label={`Previous ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(-1)}>‹</button>
      <div class="grow">
        <div class="tiny dim">{label}</div>
        <div class="small ellipsis">{value}</div>
      </div>
      <button class="small" aria-label={`Next ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(1)}>›</button>
    </div>
  );
}

function ArtControls(p: {
  bgLabel: string;
  imagesCount: number;
  useImages: boolean;
  onSource: (images: boolean) => void;
  outfits: number;
  outfitName: string;
  onOutfit: (d: number) => void;
  onBg: (d: number) => void;
  bgCount: number;
  exprNames: string[];
  facings: number;
  expr: string | null;
  onExpr: (d: number) => void;
  onDefault: () => void;
  onPortraitFiles: (f: File[]) => void;
  onBackgroundFiles: (f: File[]) => void;
  onManage: () => void;
}) {
  return (
    <div class="stack" style={{ gap: 6 }}>
      <div class="seg">
        <button aria-pressed={p.useImages} disabled={p.imagesCount === 0} onClick={() => p.onSource(true)}>Images ({p.imagesCount})</button>
        <button aria-pressed={!p.useImages} onClick={() => p.onSource(false)}>Built-in ({PLACEHOLDER_BACKGROUNDS.length})</button>
      </div>
      <div class="steppers">
        <Stepper label="Outfit" value={p.outfits > 1 ? `${p.outfitName} (${p.outfits})` : p.outfitName} onStep={p.onOutfit} disabled={p.outfits < 2} />
        <Stepper label="Scene" value={p.bgLabel} onStep={p.onBg} disabled={p.bgCount < 2} />
      </div>
      {(p.exprNames.length > 1 || p.facings > 1) && (
        <div class="row" style={{ flexWrap: 'nowrap' }}>
          <div class="grow">
            <Stepper label="Expression" value={p.expr ? humanize(p.expr) : '—'} onStep={p.onExpr} disabled={p.exprNames.length < 2} />
          </div>
          <button class="small" onClick={p.onDefault}>Make default</button>
        </div>
      )}
      <div class="row" style={{ flexWrap: 'nowrap' }}>
        <FilePick label="+ Portraits" accept={ACCEPT} onFiles={p.onPortraitFiles} />
        <FilePick label="+ Backgrounds" accept={ACCEPT} onFiles={p.onBackgroundFiles} />
        <button class="small" onClick={p.onManage}>Manage</button>
      </div>
    </div>
  );
}

function ManageDialog({ slug, art, visible, onClose, toast }: { slug: string; art: ArtFiles; visible: Set<string> | null; onClose: () => void; toast: (m: string) => void }) {
  const shownPortraits = visible ? art.portraits.filter((r) => visible.has(r.name)) : art.portraits;
  const hiddenCount = art.portraits.length - shownPortraits.length;
  const [confirm, setConfirm] = useState<'p' | 'b' | null>(null);
  const size = (rows: StoredImage[]) => `${(rows.reduce((n, r) => n + r.blob.size, 0) / 1024 / 1024).toFixed(1)} MB`;
  const list = (owner: string, rows: StoredImage[]) => (
    <ul class="plain">
      {rows.map((r) => (
        <li key={r.id} class="row between">
          <span class="small ellipsis">{r.name}</span>
          <button class="small ghost danger" aria-label={`Remove ${r.name}`} onClick={() => void deleteImage(owner, r.name).then(art.reload)}>✕</button>
        </li>
      ))}
    </ul>
  );
  return (
    <Dialog title="Portraits and backgrounds" onClose={onClose}>
      <p class="small muted" style={{ margin: 0 }}>
        Images are stored on this device only. They are <b>not</b> in “Back up all” files (they would make backups huge), so keep the
        originals on your computer or in Files. Adding a file with the same name replaces it.
      </p>
      <div class="strong">This character's portraits · {size(art.portraits)}</div>
      {shownPortraits.length ? list(slug, shownPortraits) : <div class="small muted">{hiddenCount ? 'None shown.' : 'None yet.'}</div>}
      {hiddenCount > 0 && <div class="small muted">{hiddenCount} more not listed in this view. Switch to the true name (not player-safe) to see them.</div>}
      {art.portraits.length > 0 &&
        (confirm === 'p' ? (
          <div class="row">
            <button class="small danger fill" onClick={() => void clearImages(slug).then(() => { art.reload(); setConfirm(null); toast('Portraits removed.'); })}>Remove all portraits</button>
            <button class="small" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        ) : (
          <button class="small danger" onClick={() => setConfirm('p')}>Remove all portraits…</button>
        ))}
      <div class="strong">Backgrounds (all characters) · {size(art.backgrounds)}</div>
      {art.backgrounds.length ? list(BACKGROUNDS_OWNER, art.backgrounds) : <div class="small muted">None yet. The built-in gradient scenes are used.</div>}
      {art.backgrounds.length > 0 &&
        (confirm === 'b' ? (
          <div class="row">
            <button class="small danger fill" onClick={() => void clearImages(BACKGROUNDS_OWNER).then(() => { art.reload(); setConfirm(null); toast('Backgrounds removed.'); })}>Remove all backgrounds</button>
            <button class="small" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        ) : (
          <button class="small danger" onClick={() => setConfirm('b')}>Remove all backgrounds…</button>
        ))}
    </Dialog>
  );
}
