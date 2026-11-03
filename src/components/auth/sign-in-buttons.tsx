"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { passkeyFailure } from "@/lib/auth/passkey";
import { useI18n } from "../i18n";

export function SignInButtons() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "passkey" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function google() {
    setBusy("google");
    setMessage(null);
    const result = await authClient.signIn
      .social({ provider: "google", callbackURL: "/", errorCallbackURL: "/not-invited" })
      .catch((e: Error) => ({ error: { message: e.message } }));
    if (result?.error) {
      setMessage(result.error.message || "Couldn't start Google sign-in.");
      setBusy(null);
    }
  }
  async function passkey() {
    setBusy("passkey");
    setMessage(null);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) throw result.error;
      router.push("/");
      router.refresh();
    } catch (e) {
      setMessage(passkeyFailure(e, navigator.onLine).message);
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void google()}>
        {t("signIn.google")}
      </button>
      <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void passkey()}>
        {t("signIn.passkey")}
      </button>
      {message && (
        <p role="alert" className="text-sm text-bad">
          {message}
        </p>
      )}
    </div>
  );
}
