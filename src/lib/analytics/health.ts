/**
 * Health telemetry: client error logging, breadcrumb ring buffer for unclean exits,
 * and main-thread jank tracking.
 */
import { cleanRoute } from "./events";
import { randomId, deviceId, sessionId, isStandalone, send, readConsent } from "./client";

export const BREADCRUMB_KEY = "mrt_breadcrumbs";
export const EXIT_STATE_KEY = "mrt_exit_state";
export const MAX_BREADCRUMBS = 20;
export const MAX_ERRORS_PER_PAGE = 5;

/**
 * Pure scrubber for error messages:
 * - Drops URL queries (e.g. ?token=abc)
 * - Drops email addresses
 * - Drops any run of 4 or more digits
 * - Collapses spaces and caps at 200 characters.
 */
export function scrubErrorMessage(msg: string): string {
  if (!msg || !msg.trim()) return "unknown_error";
  return (
    msg
      // Drop URL queries: ?... until whitespace, quote, or closing paren
      .replace(/\?[^\s"'`<>)]*/g, "")
      // Drop emails
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "")
      // Drop runs of 4 or more digits
      .replace(/\d{4,}/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "unknown_error"
  );
}

/** Extracts file basename only (no paths, max 100 chars, safe chars). */
export function extractFileBasename(file?: string | null): string | undefined {
  if (!file) return undefined;
  const noQuery = file.split(/[?#]/)[0];
  const base = noQuery.split("/").filter(Boolean).pop();
  if (!base) return undefined;
  const cleaned = base.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 100);
  return cleaned || undefined;
}

/** Pure ring buffer helper for breadcrumbs. */
export function pushBreadcrumb(current: string[], item: string, max = MAX_BREADCRUMBS): string[] {
  const token = item.replace(/[^a-zA-Z0-9_:/-]/g, "").slice(0, 60);
  if (!token) return current;
  const next = [...current, token];
  return next.slice(-max);
}

/** Pure dedupe and per-page cap helper. */
export function canReportClientError(
  seen: Set<string>,
  errorCount: number,
  errorKey: string,
  max = MAX_ERRORS_PER_PAGE,
): { allowed: boolean; nextCount: number } {
  if (seen.has(errorKey)) return { allowed: false, nextCount: errorCount };
  if (errorCount >= max) return { allowed: false, nextCount: errorCount };
  seen.add(errorKey);
  return { allowed: true, nextCount: errorCount + 1 };
}

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const getLocalStorage = (): StorageLike | null => {
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
};

/** Reads breadcrumbs from localStorage synchronously. */
export function readBreadcrumbs(storage: StorageLike | null = getLocalStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(BREADCRUMB_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Appends a breadcrumb to localStorage synchronously (names only, no free text). */
export function addBreadcrumb(token: string, storage: StorageLike | null = getLocalStorage()) {
  if (!storage) return;
  try {
    const current = readBreadcrumbs(storage);
    const updated = pushBreadcrumb(current, token, MAX_BREADCRUMBS);
    storage.setItem(BREADCRUMB_KEY, JSON.stringify(updated));
  } catch {
    /* storage quota or disabled */
  }
}

/** Exit state stored between page loads. */
export type ExitState = {
  clean: boolean;
  visible: boolean;
};

export function readExitState(storage: StorageLike | null = getLocalStorage()): ExitState | null {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(EXIT_STATE_KEY) || "null");
    if (raw && typeof raw.clean === "boolean" && typeof raw.visible === "boolean") {
      return raw as ExitState;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeExitState(state: ExitState, storage: StorageLike | null = getLocalStorage()) {
  if (!storage) return;
  try {
    storage.setItem(EXIT_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

type DomEnv = {
  storage?: StorageLike | null;
  visibilityState?: () => string;
  addDocListener?: (type: string, fn: EventListenerOrEventListenerObject) => void;
  removeDocListener?: (type: string, fn: EventListenerOrEventListenerObject) => void;
  addWinListener?: (type: string, fn: EventListenerOrEventListenerObject) => void;
  removeWinListener?: (type: string, fn: EventListenerOrEventListenerObject) => void;
};

/** Checks for unclean exit on page start, then arms exit tracking. */
export function checkAndArmExitState(
  onUncleanExit: (data: { breadcrumbs: string[]; visible: boolean }) => void,
  domEnv?: DomEnv,
) {
  const storage = domEnv?.storage !== undefined ? domEnv.storage : getLocalStorage();
  const getVisibility =
    domEnv?.visibilityState ?? (() => (typeof document !== "undefined" ? document.visibilityState : "visible"));
  const addDoc =
    domEnv?.addDocListener ??
    ((t, fn) => typeof document !== "undefined" && document.addEventListener(t, fn));
  const removeDoc =
    domEnv?.removeDocListener ??
    ((t, fn) => typeof document !== "undefined" && document.removeEventListener(t, fn));
  const addWin =
    domEnv?.addWinListener ??
    ((t, fn) => typeof window !== "undefined" && window.addEventListener(t, fn));
  const removeWin =
    domEnv?.removeWinListener ??
    ((t, fn) => typeof window !== "undefined" && window.removeEventListener(t, fn));

  const prev = readExitState(storage);
  if (prev && !prev.clean && prev.visible) {
    const crumbs = readBreadcrumbs(storage);
    onUncleanExit({ breadcrumbs: crumbs, visible: true });
  }

  // Mark currently open page as not cleanly exited yet
  writeExitState({ clean: false, visible: getVisibility() === "visible" }, storage);

  const onVisibilityChange = () => {
    const visible = getVisibility() === "visible";
    const cur = readExitState(storage) ?? { clean: false, visible };
    writeExitState({ ...cur, visible }, storage);
  };

  const onPageHide = () => {
    writeExitState({ clean: true, visible: getVisibility() === "visible" }, storage);
  };

  addDoc("visibilitychange", onVisibilityChange);
  addWin("pagehide", onPageHide);
  addWin("beforeunload", onPageHide);

  return () => {
    removeDoc("visibilitychange", onVisibilityChange);
    removeWin("pagehide", onPageHide);
    removeWin("beforeunload", onPageHide);
  };
}

/** Observes long tasks on the main thread and reports on hide/pagehide. */
export function initLongTaskObserver(onReport: (data: { count: number; max_ms: number; route: string }) => void) {
  if (typeof window === "undefined") return () => {};
  let count = 0;
  let maxMs = 0;
  let observer: PerformanceObserver | null = null;

  try {
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          count++;
          if (entry.duration > maxMs) {
            maxMs = Math.round(entry.duration);
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    }
  } catch {
    /* PerformanceObserver not supported */
  }

  const flush = () => {
    if (count > 0) {
      onReport({
        count,
        max_ms: maxMs,
        route: cleanRoute(location.pathname),
      });
      count = 0;
      maxMs = 0;
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);

  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
}

// In-memory dedupe state for the current page view
let seenErrors = new Set<string>();
let pageErrorCount = 0;

export function resetPageErrors() {
  seenErrors = new Set<string>();
  pageErrorCount = 0;
}

export type ClientErrorInput = {
  kind: "error" | "rejection" | "boundary";
  msg?: string;
  file?: string;
  line?: number;
  col?: number;
  route?: string;
};

/** Direct reporting helper for client errors (works even if React is unmounted/failing). */
export function reportClientError(input: ClientErrorInput) {
  if (typeof window === "undefined") return;
  const scrubbedMsg = scrubErrorMessage(input.msg || "unknown_error");
  const baseFile = extractFileBasename(input.file);
  const route = cleanRoute(input.route || location.pathname);

  const errorKey = `${input.kind}:${scrubbedMsg}:${baseFile ?? ""}:${input.line ?? ""}:${input.col ?? ""}`;
  const check = canReportClientError(seenErrors, pageErrorCount, errorKey);
  if (!check.allowed) return;
  pageErrorCount = check.nextCount;

  const c = readConsent();
  send({
    name: "client_error",
    props: {
      kind: input.kind,
      msg: scrubbedMsg,
      ...(baseFile ? { file: baseFile } : {}),
      ...(input.line != null ? { line: input.line } : {}),
      ...(input.col != null ? { col: input.col } : {}),
      route,
    },
    event_id: randomId(),
    device_id: deviceId(c.analytics),
    session_id: sessionId(c.analytics).id,
    route,
    referrer: document.referrer || null,
    utm: null,
    kol_handle: null,
    viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
    standalone: isStandalone(),
    consent: { analytics: c.analytics, marketing: c.marketing },
  });
}

/** Installs global error and rejection handlers on window. */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent | Event, source?: string, lineno?: number, colno?: number, error?: unknown) => {
    let msg = "unknown_error";
    let file = source;
    let line = lineno;
    let col = colno;

    if (event instanceof ErrorEvent) {
      msg = event.message || (event.error?.message ?? "unknown_error");
      file = file || event.filename;
      line = line ?? event.lineno;
      col = col ?? event.colno;
    } else if (error instanceof Error) {
      msg = error.message;
    }

    reportClientError({
      kind: "error",
      msg,
      file,
      line,
      col,
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    let msg = "unhandled_rejection";
    let file: string | undefined;
    let line: number | undefined;
    let col: number | undefined;

    const reason = event.reason;
    if (reason instanceof Error) {
      msg = reason.message;
      if (reason.stack) {
        const match = reason.stack.match(/at\s+(?:.*?\s+\()?([^\s)]+):(\d+):(\d+)\)?/);
        if (match) {
          file = match[1];
          line = Number(match[2]);
          col = Number(match[3]);
        }
      }
    } else if (typeof reason === "string") {
      msg = reason;
    }

    reportClientError({
      kind: "rejection",
      msg,
      file,
      line,
      col,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

/** Intercepts fetch failures to record breadcrumbs synchronously. */
export function installFetchBreadcrumbTracker() {
  if (typeof window === "undefined" || !window.fetch) return () => {};
  const orig = window.fetch;
  const wrapped: typeof window.fetch = async function (this: unknown, ...args) {
    try {
      const res = await orig.apply(this, args);
      if (!res.ok && res.status >= 400) {
        const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : "";
        const clean = cleanRoute(url);
        addBreadcrumb(`fetch_fail:${clean}`);
      }
      return res;
    } catch (err) {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : "";
      const clean = cleanRoute(url);
      addBreadcrumb(`fetch_fail:${clean}`);
      throw err;
    }
  };
  window.fetch = wrapped;
  return () => {
    window.fetch = orig;
  };
}
