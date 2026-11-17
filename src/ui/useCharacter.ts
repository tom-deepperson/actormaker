/** Loads one character with its tracker and combat session; every change is saved to IndexedDB. */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { CharacterSheet } from '../data/model';
import type { TrackerState } from '../data/tracker';
import type { CombatSession } from '../data/combat';
import { loadCharacter, loadCombat, loadTracker, saveCharacter, saveCombat, saveTracker } from '../data/db';

export interface CharacterState {
  sheet: CharacterSheet;
  tracker: TrackerState;
  combat: CombatSession;
}

export interface CharacterHandle {
  state: CharacterState | null;
  error: string | null;
  /** Change the tracker; returning null means "not allowed", nothing is saved. */
  updateTracker: (fn: (t: TrackerState, s: CharacterSheet) => TrackerState | null) => void;
  updateCombat: (fn: (c: CombatSession, s: CharacterSheet) => CombatSession) => void;
  updateSheet: (fn: (s: CharacterSheet) => CharacterSheet) => void;
  reload: () => void;
}

export function useCharacter(slug: string): CharacterHandle {
  const [state, setState] = useState<CharacterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<CharacterState | null>(null);
  latest.current = state;

  const load = useCallback(async () => {
    try {
      const row = await loadCharacter(slug);
      if (!row) {
        setError('Character not found on this device.');
        return;
      }
      const [tracker, combat] = await Promise.all([loadTracker(slug, row.sheet), loadCombat(slug)]);
      setState({ sheet: row.sheet, tracker, combat });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [slug]);

  useEffect(() => {
    setState(null);
    void load();
  }, [load]);

  const updateTracker = useCallback((fn: (t: TrackerState, s: CharacterSheet) => TrackerState | null) => {
    const cur = latest.current;
    if (!cur) return;
    const next = fn(cur.tracker, cur.sheet);
    if (!next) return;
    const ns = { ...cur, tracker: next };
    latest.current = ns;
    setState(ns);
    void saveTracker(next);
  }, []);

  const updateCombat = useCallback((fn: (c: CombatSession, s: CharacterSheet) => CombatSession) => {
    const cur = latest.current;
    if (!cur) return;
    const next = fn(cur.combat, cur.sheet);
    const ns = { ...cur, combat: next };
    latest.current = ns;
    setState(ns);
    void saveCombat(next);
  }, []);

  const updateSheet = useCallback(
    (fn: (s: CharacterSheet) => CharacterSheet) => {
      const cur = latest.current;
      if (!cur) return;
      const next = fn(cur.sheet);
      const ns = { ...cur, sheet: next };
      latest.current = ns;
      setState(ns);
      void saveCharacter(slug, next);
    },
    [slug],
  );

  return { state, error, updateTracker, updateCombat, updateSheet, reload: () => void load() };
}
