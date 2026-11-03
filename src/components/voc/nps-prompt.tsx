"use client";
import { useEffect, useState } from "react";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { shouldPromptNps, NPS_KEY } from "@/lib/analytics/nps";

/** After the 3rd visit, at most once every 30 days. */
export function NpsPrompt() {
  const { t } = useI18n();
  const { track, deviceId } = useAnalytics();
  const [show, setShow] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      const state = JSON.parse(localStorage.getItem(NPS_KEY) || "{}") as { visits?: number; lastVisitDay?: string; promptedAt?: number };
      const today = new Date().toISOString().slice(0, 10);
      const visits = (state.visits ?? 0) + (state.lastVisitDay === today ? 0 : 1);
      localStorage.setItem(NPS_KEY, JSON.stringify({ ...state, visits, lastVisitDay: today }));
      if (shouldPromptNps({ visits, promptedAt: state.promptedAt ?? null }, Date.now())) {
        const timer = setTimeout(() => setShow(true), 20_000);
        return () => clearTimeout(timer);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  const close = () => {
    try {
      const state = JSON.parse(localStorage.getItem(NPS_KEY) || "{}");
      localStorage.setItem(NPS_KEY, JSON.stringify({ ...state, promptedAt: Date.now() }));
    } catch {}
    setShow(false);
  };

  async function submit() {
    if (score == null) return;
    await fetch("/api/nps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ score, comment: comment || undefined, deviceId: deviceId() }),
    }).catch(() => null);
    track("nps_submit", { score });
    setDone(true);
    setTimeout(close, 1500);
  }

  if (!show) return null;
  return (
    <div role="dialog" aria-labelledby="nps-q" className="fixed inset-x-0 bottom-[calc(var(--consent-h,0px)+4rem)] z-40 p-3">
      <div className="panel rise mx-auto max-w-md space-y-3 p-4">
        {done ? (
          <p className="text-go">{t("nps.thanks")}</p>
        ) : (
          <>
            <p id="nps-q" className="text-sm font-semibold">
              {t("nps.question")}
            </p>
            <div className="grid grid-cols-11 gap-1">
              {Array.from({ length: 11 }, (_, n) => (
                <button key={n} type="button" onClick={() => setScore(n)} aria-pressed={score === n} className={`rounded-md border py-1 text-xs ${score === n ? "border-led bg-led text-black" : "border-line"}`}>
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted">
              <span>{t("nps.low")}</span>
              <span>{t("nps.high")}</span>
            </div>
            {score != null && (
              <input className="field text-sm" placeholder={t("nps.comment")} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} data-clarity-mask="True" />
            )}
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary flex-1" disabled={score == null} onClick={() => void submit()}>
                {t("feedback.send")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={close}>
                {t("install.dismiss")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
