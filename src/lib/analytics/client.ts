"use client";
/** Browser-side ids and transport. Device id exists only with analytics consent. */
import { CONSENT_COOKIE, parseConsent, serializeConsent, type Consent } from "./consent";
import type { Utm } from "./utm";

const DEVICE_KEY = "mrt_device";
const SESSION_KEY = "mrt_session";
const UTM_FIRST = "mrt_utm_first";
const UTM_LAST = "mrt_utm_last";
const KOL_KEY = "mrt_kol";
const SESSION_IDLE_MS = 30 * 60_000;

export function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readCookie(name: string) {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1];
}
function writeCookie(name: string, value: string, maxAgeDays: number) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeDays * 86400}; SameSite=Lax${secure}`;
}
function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readConsent(): Consent {
  return parseConsent(readCookie(CONSENT_COOKIE));
}
export function writeConsent(c: { analytics: boolean; marketing: boolean }) {
  writeCookie(CONSENT_COOKIE, serializeConsent(c, Date.now()), 365);
  if (!c.analytics) forgetDevice();
}

/** Random device id in localStorage + a first-party cookie (analytics consent only). */
export function deviceId(consented: boolean): string | null {
  if (!consented) return null;
  let id = localStorage.getItem(DEVICE_KEY) || readCookie(DEVICE_KEY) || "";
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) id = randomId();
  localStorage.setItem(DEVICE_KEY, id);
  writeCookie(DEVICE_KEY, id, 400);
  return id;
}
export function forgetDevice() {
  for (const key of [DEVICE_KEY, SESSION_KEY, UTM_FIRST, UTM_LAST, KOL_KEY]) localStorage.removeItem(key);
  clearCookie(DEVICE_KEY);
}

/** Session id with 30-minute inactivity timeout. */
export function sessionId(consented: boolean, now = Date.now()): { id: string | null; isNew: boolean } {
  if (!consented) return { id: null, isNew: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as { id: string; last: number } | null;
    if (saved && now - saved.last < SESSION_IDLE_MS) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: saved.id, last: now }));
      return { id: saved.id, isNew: false };
    }
  } catch {
    /* new session */
  }
  const id = randomId();
  localStorage.setItem(SESSION_KEY, JSON.stringify({ id, last: now }));
  return { id, isNew: true };
}

/** First-touch and last-touch UTM per device (persisted with consent). */
export function rememberUtm(utm: Utm | null, consented: boolean): Utm | null {
  if (!consented) return utm;
  if (utm) {
    if (!localStorage.getItem(UTM_FIRST)) localStorage.setItem(UTM_FIRST, JSON.stringify(utm));
    localStorage.setItem(UTM_LAST, JSON.stringify(utm));
    return utm;
  }
  try {
    return JSON.parse(localStorage.getItem(UTM_LAST) || "null");
  } catch {
    return null;
  }
}
export function rememberKol(handle: string | null, consented: boolean): string | null {
  if (handle && consented) localStorage.setItem(KOL_KEY, handle);
  return handle ?? (consented ? localStorage.getItem(KOL_KEY) : null);
}

export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function cookieValue(name: string) {
  return readCookie(name) ?? null;
}

let queue: unknown[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
export function send(envelope: unknown) {
  queue.push(envelope);
  if (timer) return;
  timer = setTimeout(flush, 400);
}
export function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue.slice(0, 20) });
  queue = queue.slice(20);
  const blob = new Blob([body], { type: "application/json" });
  if (!navigator.sendBeacon?.("/api/events", blob))
    void fetch("/api/events", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  if (queue.length) timer = setTimeout(flush, 400);
}
