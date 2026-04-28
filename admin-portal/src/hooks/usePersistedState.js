// v3.5.7 — useState replacement that persists to localStorage.
//
// Drop-in for any state that should survive a page refresh (active
// tab, filter dropdown, expansion map, etc.). Same API as useState
// but with a unique storage key as the second argument.
//
// Usage:
//   const [tab, setTab] = usePersistedState("new", "lcs_booking_tab");
//   const [filter, setFilter] = usePersistedState("all", "lcs_users_filter");
//
// The hook:
//   - Reads localStorage on mount; falls back to `initial` if missing
//     or invalid JSON.
//   - Writes localStorage on every state change.
//   - Wraps reads/writes in try/catch — Safari private mode and
//     storage-quota errors never bubble up to the component.
//
// Choose unique keys per page+state combo. Convention:
//   "lcs_<page>_<concept>"  e.g. "lcs_booking_tab", "lcs_users_filter".

import { useState, useEffect } from "react";

export function usePersistedState(initial, storageKey) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return initial;
      return JSON.parse(raw);
    } catch (_) {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (_) {
      // Quota exceeded / private mode — silently swallow. The state
      // still works in-memory; only persistence is lost.
    }
  }, [value, storageKey]);

  return [value, setValue];
}
