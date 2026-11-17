"use client";
import { useState } from "react";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { telegramChannelUrl } from "@/lib/telegram";

const TELEGRAM = telegramChannelUrl(process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL);

/** "Or follow on Telegram" when a channel is configured. */
function TelegramLink() {
  const { t } = useI18n();
  const { track } = useAnalytics();
  if (!TELEGRAM) return null;
  return (
    <a
      href={TELEGRAM}
      target="_blank"
      rel="noopener"
      className="inline-block text-sm font-semibold text-accent underline"
      onClick={() => track("outbound_click", { domain: "t.me", link_type: "telegram" })}
    >
      {t("newsletter.telegram")}
    </a>
  );
}

export function NewsletterForm({ source = "landing" }: { source?: string }) {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "check" | "error">("idle");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const res = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, consent, language: locale, source }),
    }).catch(() => null);
    if (!res?.ok) return setState("error");
    const body = (await res.json()) as { doubleOptIn: boolean };
    track("newsletter_signup", { double_opt_in: body.doubleOptIn });
    setState(body.doubleOptIn ? "check" : "done");
  }
  if (state === "done" || state === "check")
    return (
      <div className="space-y-2">
        <p className="text-go">{t(state === "check" ? "newsletter.check" : "newsletter.done")}</p>
        <TelegramLink />
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input type="email" required className="field" placeholder={t("newsletter.email")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-clarity-mask="True" />
        <button className="btn btn-primary shrink-0" disabled={!consent || state === "busy"}>
          {t("newsletter.cta")}
        </button>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" /> {t("newsletter.consent")}
      </label>
      {state === "error" && <p className="text-sm text-bad">{t("reading.error")}</p>}
      <TelegramLink />
    </form>
  );
}
