"use client";
import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { FEEDBACK_CATEGORIES } from "@/lib/analytics/events";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";

/** Rating + category + optional text. Text goes to Neon only; analytics gets rating+category. */
export function FeedbackWidget() {
  const { t, locale } = useI18n();
  const { track, deviceId } = useAnalytics();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<(typeof FEEDBACK_CATEGORIES)[number]>("accuracy");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return;
    setState("sending");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating, category, text: text || undefined, route: location.pathname, language: locale, deviceId: deviceId() }),
    }).catch(() => null);
    if (res?.ok) {
      track("feedback_submit", { rating, category });
      setState("done");
      setTimeout(() => setOpen(false), 1500);
    } else setState("error");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setState("idle");
        }}
        className="float-bottom fixed right-3 z-40 flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-2 text-xs shadow-lg"
      >
        <MessageSquare size={14} aria-hidden /> {t("feedback.cta")}
      </button>
      {open && (
        <div role="dialog" aria-labelledby="fb-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center">
          <form onSubmit={submit} className="panel rise w-full max-w-md space-y-3 p-4">
            <div className="flex items-center">
              <h2 id="fb-title" className="font-semibold">
                {t("feedback.title")}
              </h2>
              <button type="button" className="ml-auto p-1 text-muted" onClick={() => setOpen(false)} aria-label={t("common.cancel")}>
                <X size={18} />
              </button>
            </div>
            {state === "done" ? (
              <p className="text-go">{t("feedback.thanks")}</p>
            ) : (
              <>
                <fieldset>
                  <legend className="text-sm text-muted">{t("feedback.rating")}</legend>
                  <div className="mt-1 flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={rating === n}
                        onClick={() => setRating(n)}
                        className={`h-10 w-10 rounded-full border ${rating >= n ? "border-led bg-led text-black" : "border-line"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="block text-sm text-muted">
                  {t("feedback.category")}
                  <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                    {FEEDBACK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`feedback.cat.${c}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-muted">
                  {t("feedback.text")}
                  <textarea className="field mt-1" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} data-clarity-mask="True" />
                </label>
                <button className="btn btn-primary w-full" disabled={!rating || state === "sending"}>
                  {t("feedback.send")}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
