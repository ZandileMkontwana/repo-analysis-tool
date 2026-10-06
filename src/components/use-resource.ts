"use client";

import { useCallback, useEffect, useState } from "react";

export async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      body?.error || `Request failed (${response.status}). Please try again.`,
    );
  if (body === null)
    throw new Error(
      "The server returned an unreadable response. Please try again.",
    );
  return body as T;
}

/** Abort stale requests; serial polling never overlaps with the previous request. */
export function useResource<T>(
  url: string | null,
  pollMs = 0,
  keepPolling?: (data: T) => boolean,
) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ url: string; data?: T; error?: string }>(
    { url: "" },
  );
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      let again = true;
      try {
        const data = await requestJson<T>(url!, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState({ url: url!, data });
        again = keepPolling ? keepPolling(data) : true;
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          url: url!,
          data: previous.url === url ? previous.data : undefined,
          error:
            error instanceof Error
              ? error.message
              : "Unable to reach the server.",
        }));
      }
      if (pollMs && again && !controller.signal.aborted)
        timer = setTimeout(load, pollMs);
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, pollMs, version, keepPolling]);

  const current = state.url === url ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: Boolean(url && !current),
    reload,
  };
}
