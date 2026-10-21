/**
 * Small data-fetching hook.
 *
 * Gives every page the same loading / error / empty handling and cancels the
 * in-flight request when the component unmounts or the dependency list changes,
 * so a fast filter change cannot render a stale response.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @template T
 * @param {() => Promise<T>} loader
 * @param {unknown[]} deps
 * @param {{ enabled?: boolean }} [options]
 */
export function useAsyncData(loader, deps = [], options = {}) {
  const { enabled = true } = options;
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const controllerRef = useRef(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current(controller.signal);
      if (controller.signal.aborted) return;
      if (result && typeof result === 'object' && 'data' in result) {
        setData(result.data);
        setMeta(result.meta ?? null);
      } else {
        setData(result);
        setMeta(null);
      }
    } catch (caught) {
      if (caught.name === 'AbortError') return;
      setError(caught);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    run();
    return () => controllerRef.current?.abort();
    // `deps` is the caller's dependency list; `run` is stable and intentionally
    // excluded so callers control re-fetching precisely.
  }, deps);

  return { data, meta, error, loading, reload: run, setData };
}

export default useAsyncData;
