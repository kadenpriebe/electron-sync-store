/**
 * The React surface: two hooks over the mirror, and nothing else.
 *
 * The core is framework-free on purpose, so this file is thin by design. It
 * exists because `useSyncExternalStore` is the API React added for exactly
 * this problem — a value that lives outside React and changes on its own —
 * and using anything else here would be answering a solved question badly.
 *
 * React is a peer dependency. Import this file only from a renderer that has
 * one; the rest of the library never touches it.
 */
import { useCallback, useDebugValue, useEffect, useRef, useSyncExternalStore } from "react";
import type { Selector } from "../core/store";
import type { DispatchResult, RendererStore } from "../renderer";

/**
 * Watch one slice of the shared state.
 *
 * The subscription is the store's own, so the selecting and the equality check
 * happen where they already happen and a component is re-rendered only when
 * its own slice moves. That is also why this does not need
 * `use-sync-external-store/shim/with-selector`, which exists to add exactly
 * that behaviour to stores that lack it.
 *
 * `getSnapshot` must return the same value while nothing has changed, or React
 * re-renders forever — this is a documented trap, not a performance note. The
 * value is therefore cached in a ref and replaced only by the subscription
 * callback, never recomputed during a render.
 *
 * The selector is read through a ref so an inline arrow function does not
 * resubscribe on every render; if the selector's identity changes and it now
 * selects something different, the effect below catches up.
 */
export function useStore<S, A, T>(store: RendererStore<S, A>, selector: Selector<S, T>): T {
  const selectorRef = useRef(selector);
  const cache = useRef<{ value: T }>(undefined);
  cache.current ??= { value: selector(store.getState()) };

  const wake = useRef<(() => void) | undefined>(undefined);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      wake.current = onStoreChange;
      return store.subscribe(
        (state: S) => selectorRef.current(state),
        (value: T) => {
          if (cache.current) cache.current.value = value;
          onStoreChange();
        },
      );
    },
    [store],
  );

  const getSnapshot = useCallback((): T => {
    // Non-null: the ref is filled on the first render, before React can read it.
    return (cache.current as { value: T }).value;
  }, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // A different selector may now be looking at a different slice. Re-select
  // once and, only if the answer changed, ask React for another render.
  useEffect(() => {
    selectorRef.current = selector;
    const next = selector(store.getState());
    if (cache.current && !Object.is(next, cache.current.value)) {
      cache.current.value = next;
      wake.current?.();
    }
  }, [selector, store]);

  useDebugValue(value);
  return value;
}

/**
 * Propose a change. Stable for the life of the store, so it is safe in a
 * dependency array and in a memoised child's props.
 *
 * The returned promise says whether main agreed; ignoring it is fine, and is
 * what most callers should do. The page has already changed either way.
 */
export function useDispatch<S, A>(store: RendererStore<S, A>): (action: A) => Promise<DispatchResult> {
  return useCallback((action: A) => store.dispatch(action), [store]);
}
