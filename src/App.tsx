import { useCallback, useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting } from './data/db';
import { defaultViewContext } from './data/viewContext';
import { HomeScreen, type Theme } from './ui/HomeScreen';
import { SheetScreen, type SheetSettings } from './ui/SheetScreen';
import { AiScreen } from './ui/AiScreen';
import { ScanScreen } from './ui/ScanScreen';

/**
 * Hash routing so the back button works and GitHub Pages needs no server rewrites:
 * #/c/<slug> (sheet), #/c/<slug>/ai (AI assistant), #/scan (build from photos), anything else is home.
 */
type Route = { screen: 'home' } | { screen: 'sheet'; slug: string } | { screen: 'ai'; slug: string } | { screen: 'scan' };

function readRoute(): Route {
  const h = location.hash;
  if (/^#\/scan\/?$/.test(h)) return { screen: 'scan' };
  const m = /^#\/c\/([^/]+)(\/ai)?\/?$/.exec(h);
  if (!m) return { screen: 'home' };
  const slug = decodeURIComponent(m[1]);
  return m[2] ? { screen: 'ai', slug } : { screen: 'sheet', slug };
}

const DEFAULT_SHEET: SheetSettings = { ctx: defaultViewContext, mode: 'combat', trackEncumbrance: false };

export function App() {
  const [route, setRoute] = useState<Route>(readRoute());
  const [theme, setTheme] = useState<Theme>('system');
  const [sheetSettings, setSheetSettings] = useState<SheetSettings>(DEFAULT_SHEET);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    void Promise.all([getSetting<Theme>('theme'), getSetting<SheetSettings>('sheet'), getSetting<number>('lastBackupAt')]).then(([t, s, b]) => {
      if (t) setTheme(t);
      if (s) setSheetSettings({ ...DEFAULT_SHEET, ...s, ctx: { ...DEFAULT_SHEET.ctx, ...s.ctx } });
      if (b) setLastBackupAt(b);
    });
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3500);
  }, []);

  const go = (hash: string) => {
    location.hash = hash;
  };
  const open = (s: string) => go(`#/c/${encodeURIComponent(s)}`);
  /** Back within the app; falls back to an explicit parent when there's no history (opened from a link). */
  const back = (parent: string) => {
    if (history.length > 1 && route.screen !== 'home') history.back();
    else go(parent);
    setTimeout(() => setRoute(readRoute()), 0);
  };
  const saveSheetSettings = (s: SheetSettings) => {
    setSheetSettings(s);
    void setSetting('sheet', s);
  };

  return (
    <>
      {route.screen === 'sheet' ? (
        <SheetScreen
          key={route.slug}
          slug={route.slug}
          settings={sheetSettings}
          onSettings={saveSheetSettings}
          onBack={() => back('')}
          onAi={() => go(`#/c/${encodeURIComponent(route.slug)}/ai`)}
          toast={toast}
        />
      ) : route.screen === 'ai' ? (
        <AiScreen key={route.slug} slug={route.slug} settings={sheetSettings} onBack={() => back(`#/c/${encodeURIComponent(route.slug)}`)} toast={toast} />
      ) : route.screen === 'scan' ? (
        <ScanScreen
          onBack={() => back('')}
          onOpen={(s) => {
            // Replace the scan page in history so Back from the new sheet goes home.
            history.replaceState(null, '', `#/c/${encodeURIComponent(s)}`);
            setRoute(readRoute());
          }}
          toast={toast}
        />
      ) : (
        <HomeScreen
          onOpen={open}
          onScan={() => go('#/scan')}
          toast={toast}
          theme={theme}
          onTheme={(t) => {
            setTheme(t);
            void setSetting('theme', t);
          }}
          lastBackupAt={lastBackupAt}
          onBackedUp={() => {
            const now = Date.now();
            setLastBackupAt(now);
            void setSetting('lastBackupAt', now);
          }}
        />
      )}
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
    </>
  );
}
