import { useCallback, useSyncExternalStore } from "react";

// Drives conditional rendering off the actual viewport instead of relying
// on CSS to hide an already-mounted duplicate layout (TradeHistory used to
// render both a mobile card list and a desktop table on every load, with
// only `lg:hidden`/`hidden lg:block` picking which one showed).
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
