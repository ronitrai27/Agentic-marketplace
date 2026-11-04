import { useSyncExternalStore } from "react";

/**
 * Which run's sheet is open, for the whole /space area. Lives outside React so any button, pill or palette entry can
 * open it, and mirrored into `?run=` so a refresh brings the same sheet back.
 */
let current: string | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function writeUrl(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id && id !== EMPTY_RUN) url.searchParams.set("run", id);
  else url.searchParams.delete("run");
  // Keep Next's own history state, or its router loses track of the page
  window.history.replaceState(window.history.state, "", url);
}

let last: string | null = null;

/** Sentinel for the empty sheet ("No runs right now"). Never written to the URL. */
export const EMPTY_RUN = "__empty__";

/** "Clear": show the empty sheet instead of the run. The run itself is untouched. */
export function clearRun() {
  current = EMPTY_RUN;
  last = EMPTY_RUN;
  writeUrl(null);
  emit();
}

/** Ctrl+Shift+B: closes the sheet if open, else reopens the last view (or `fallbackId`, the latest run; empty if none). */
export function toggleRun(fallbackId?: string) {
  if (current) return closeRun();
  openRun(last ?? fallbackId ?? EMPTY_RUN);
}

export function openRun(id: string) {
  current = id;
  last = id;
  writeUrl(id);
  emit();
}

export function closeRun() {
  current = null;
  writeUrl(null);
  emit();
}

/** Reads `?run=` once on load. */
export function startFromUrl() {
  if (started) return;
  started = true;
  const id = new URLSearchParams(window.location.search).get("run");
  if (id) {
    current = id;
    emit();
  }
}

/** Client-side navigation drops the query string; put the open run back so a refresh still finds it. */
export function keepRunInUrl() {
  if (current) writeUrl(current);
}

export function useOpenRunId() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
