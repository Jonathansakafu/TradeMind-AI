import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// Module-level store keyed by resource name (e.g. "market-prices"). Several
// components polling the same endpoint (PriceTicker + a page's own price
// fetch, SessionBanner + a page's own session fetch, etc.) previously each
// ran their own axios call and setInterval — same data, N redundant
// requests and N timers. Here, the first subscriber to a key starts the
// fetch+interval; later subscribers to the same key just read the shared
// result; the interval clears once the last subscriber unmounts.
const store = new Map();

function getEntry(key) {
  let entry = store.get(key);
  if (!entry) {
    entry = {
      snapshot: { data: undefined, error: null, isLoading: false, updatedAt: 0 },
      listeners: new Set(),
      intervalId: null,
      subscriberCount: 0,
    };
    store.set(key, entry);
  }
  return entry;
}

// useSyncExternalStore requires getSnapshot to return a *new* reference
// only when something actually changed — mutating the previous snapshot
// in place would make React think nothing changed and skip re-rendering.
function patchSnapshot(key, patch) {
  const entry = getEntry(key);
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((listener) => listener());
}

// Returns the fetched data (or throws) so callers that need the freshest
// value right after a manual refetch — e.g. TradeHistory's "Fetch Live
// Price" flow — don't have to read it back out of a stale render closure.
async function runFetch(key, fetcher) {
  patchSnapshot(key, { isLoading: true });
  try {
    const data = await fetcher();
    patchSnapshot(key, { data, error: null, isLoading: false, updatedAt: Date.now() });
    return data;
  } catch (error) {
    patchSnapshot(key, { error, isLoading: false });
    throw error;
  }
}

export function useResource(key, fetcher, intervalMs) {
  // Callers pass a fresh closure every render; captured via ref instead of
  // a subscribe dependency so a new closure doesn't tear down and restart
  // the shared interval — only an actual key/intervalMs change should.
  // Written in an effect, not during render, since refs aren't meant to be
  // mutated as part of rendering.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback(
    (onStoreChange) => {
      const entry = getEntry(key);
      entry.listeners.add(onStoreChange);
      entry.subscriberCount++;

      if (entry.subscriberCount === 1) {
        // Error already lands in the snapshot via patchSnapshot above —
        // these two call sites don't consume the resolved value, so swallow
        // the rethrow here rather than leaving an unhandled rejection.
        runFetch(key, () => fetcherRef.current()).catch(() => {});
        entry.intervalId = setInterval(
          () => runFetch(key, () => fetcherRef.current()).catch(() => {}),
          intervalMs
        );
      }

      return () => {
        entry.listeners.delete(onStoreChange);
        entry.subscriberCount--;
        if (entry.subscriberCount === 0 && entry.intervalId) {
          clearInterval(entry.intervalId);
          entry.intervalId = null;
        }
      };
    },
    [key, intervalMs]
  );

  const getSnapshot = useCallback(() => getEntry(key).snapshot, [key]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  // Callers use this directly as an event handler in several places (a
  // bare onClick={refetch}) — never throws, mirroring the try/catch every
  // component's own fetch function used to do internally. The error is
  // still available on the returned snapshot's `error` field; the
  // resolved data is returned for the few callers (e.g. TradeHistory's
  // "Fetch Live Price") that need the freshest value immediately.
  const refetch = useCallback(
    () => runFetch(key, () => fetcherRef.current()).catch(() => undefined),
    [key]
  );

  return { ...snapshot, refetch };
}
