"use client";
import type { DirectionView, BoardReason } from "@/lib/predict/board-view";
import type { T } from "@/lib/i18n";
import { stationForCode } from "@/lib/network";
import { useI18n } from "../i18n";

export function boardReasonText(t: T, r: BoardReason, locale: "en" | "zh-Hant" = "en"): string {
  switch (r.code) {
    case "reading_ago":
      return t("reason.reading_ago", { minutes: r.minutes });
    case "boarded_ago":
      return t("reason.boarded_ago", { minutes: r.minutes });
    case "seen_elsewhere":
      return t("reason.seen_elsewhere", { minutes: r.minutes, station: stationForCode(r.station)?.name[locale] ?? r.station });
    case "repeats":
      return t("reason.repeats", { days: r.days });
    case "historical_anchor":
      return t("boardReason.historical", { clock: r.clock });
    case "typical_gap":
      return t("boardReason.typical", { n: r.headway });
    case "unstable_gap":
      return t("boardReason.unstable", { n: r.headway });
  }
}

/**
 * Next three trains as SGT clock times with a live countdown. Exact times
 * are solid; estimates read "≈10:24" (± band) with an "estimate" chip and
 * the plain reason. Never an interval on its own.
 */
export function DirectionTimes({ view, now }: { view: DirectionView; now: number }) {
  const { t, locale } = useI18n();
  if (view.state === "closed") return <p className="mt-2 text-muted">{t("board.notRunning")}</p>;
  const est = view.state === "estimate";
  const approx = est ? "≈" : "";
  const inText = (at: number) => {
    const n = Math.max(0, Math.floor((at - now) / 60_000));
    return n === 0 ? t("board.due") : t("board.in", { n });
  };
  const [first, ...rest] = view.arrivals;
  return (
    <div className="mt-2" data-board-state={view.state}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        {first && (
          <div>
            <div className="text-[11px] tracking-wide text-muted uppercase">{t("board.next")}</div>
            <div className={`led tabular text-4xl leading-none font-bold ${est ? "opacity-80" : ""}`}>
              {approx}
              {first.clock}
              {est && view.plusMinus != null && <span className="ml-1 text-base font-normal text-muted">±{view.plusMinus}</span>}
            </div>
            <div className="tabular mt-1 text-sm">{inText(first.at)}</div>
          </div>
        )}
        {rest.map((a) => (
          <div key={a.at}>
            <div className="text-[11px] tracking-wide text-muted uppercase">{t("board.then")}</div>
            <div className={`led tabular text-2xl leading-none ${est ? "opacity-70" : "opacity-90"}`}>
              {approx}
              {a.clock}
            </div>
            <div className="tabular mt-1 text-xs text-muted">{inText(a.at)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip ${est ? "bg-warn/15 text-warn" : "bg-go/15 text-go"}`}>{t(est ? "board.estimate" : "board.exact")}</span>
        <span className="text-muted">{boardReasonText(t, view.reason, locale)}</span>
      </div>
    </div>
  );
}
