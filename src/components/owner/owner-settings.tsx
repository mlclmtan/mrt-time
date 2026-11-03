"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { defaultPasskeyName, passkeyFailure } from "@/lib/auth/passkey";
import { useI18n } from "../i18n";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function OwnerSettings({ isOwner, pushReady, vapidKey }: { isOwner: boolean; pushReady: boolean; vapidKey: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);

  async function enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const res = await fetch("/api/push/subscription", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (res.ok) {
        setEndpoint(sub.endpoint);
        setMessage(t("settings.push.enabled"));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Push failed");
    }
  }
  async function testPush() {
    if (!endpoint) return;
    await fetch("/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint }) });
  }
  async function addPasskey() {
    try {
      const existing = await authClient.passkey.listUserPasskeys().catch(() => ({ data: [] as { name?: string | null }[] }));
      const name = defaultPasskeyName(navigator.userAgent, navigator.maxTouchPoints, Date.now(), (existing.data ?? []).map((p) => p.name));
      const result = await authClient.passkey.addPasskey({ name });
      if (result?.error) throw result.error;
      setMessage(t("common.saved"));
    } catch (e) {
      setMessage(passkeyFailure(e, navigator.onLine).message);
    }
  }
  async function signOut() {
    await authClient.signOut().catch(() => null);
    router.push("/");
    router.refresh();
  }
  return (
    <section className="panel space-y-3 p-4">
      {isOwner && (
        <div className="space-y-2">
          <h2 className="font-semibold">{t("settings.push")}</h2>
          {pushReady ? (
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary py-2 text-sm" onClick={() => void enablePush()}>
                {t("settings.push.enable")}
              </button>
              {endpoint && (
                <button type="button" className="btn btn-secondary py-2 text-sm" onClick={() => void testPush()}>
                  {t("settings.push.test")}
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">{t("settings.push.unavailable")}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary py-2 text-sm" onClick={() => void addPasskey()}>
          {t("settings.passkey")}
        </button>
        <button type="button" className="btn btn-secondary py-2 text-sm" onClick={() => void signOut()}>
          {t("settings.signOut")}
        </button>
      </div>
      {message && <p className="text-sm text-muted">{message}</p>}
    </section>
  );
}
