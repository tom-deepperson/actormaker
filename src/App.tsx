import { useCallback, useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting } from './data/db';
import { defaultViewContext } from './data/viewContext';
import { HomeScreen, type Theme } from './ui/HomeScreen';
import { SheetScreen, type SheetSettings } from './ui/SheetScreen';

/** Hash routing (#/c/<slug>) so the back button works and GitHub Pages needs no server rewrites. */
function readRoute(): string | null {
  const m = /^#\/c\/([^/]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

const DEFAULT_SHEET: SheetSettings = { ctx: defaultViewContext, mode: 'combat', trackEncumbrance: false };

export function App() {
  const [slug, setSlug] = useState<string | null>(readRoute());
  const [theme, setTheme] = useState<Theme>('system');
  const [sheetSettings, setSheetSettings] = useState<SheetSettings>(DEFAULT_SHEET);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setSlug(readRoute());
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

  const open = (s: string) => {
    location.hash = `#/c/${encodeURIComponent(s)}`;
  };
  const back = () => {
    if (history.length > 1 && readRoute()) history.back();
    else location.hash = '';
    setTimeout(() => setSlug(readRoute()), 0);
  };

  return (
    <>
      {slug ? (
        <SheetScreen
          key={slug}
          slug={slug}
          settings={sheetSettings}
          onSettings={(s) => {
            setSheetSettings(s);
            void setSetting('sheet', s);
          }}
          onBack={back}
          toast={toast}
        />
      ) : (
        <HomeScreen
          onOpen={open}
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
