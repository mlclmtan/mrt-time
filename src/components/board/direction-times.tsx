"use client";
import type { ReactNode } from "react";
import type { DirectionView, BoardReason, EstimateBasis } from "@/lib/predict/board-view";
import type { T } from "@/lib/i18n";
import { stationForCode } from "@/lib/network";
import { clock, dayText, formatCountdownMin, plusMinusText } from "@/lib/format";
import { useI18n } from "../i18n";

/** "the platform screen at 10:21 on Mon 2 Nov" / "the typical gap (~6 min)" (after "estimated from"). */
function basisText(t: T, b: EstimateBasis, locale: "en" | "zh-Hant"): string {
  switch (b.code) {
    case "historical_anchor":
      return t("basis.historical", { clock: b.clock, day: dayText(t, b.date, locale) });
    case "repeats":
      return t("basis.repeats", { days: b.days });
    case "typical_gap":
      return t("basis.typical", { n: b.headway });
    case "unstable_gap":
      return t("basis.unstable", { n: b.headway });
  }
}

export function boardReasonText(t: T, r: BoardReason, locale: "en" | "zh-Hant" = "en"): string {
  switch (r.code) {
    case "reading_ago":
      return t("reason.reading_ago", { minutes: r.minutes });
    case "boarded_ago":
      return t("reason.boarded_ago", { minutes: r.minutes });
    case "seen_elsewhere":
      return t("reason.seen_elsewhere", { minutes: r.minutes, station: stationForCode(r.station)?.name[locale] ?? r.station });
    case "seen_ago":
      return t("reason.seen_ago", { minutes: r.minutes });
    case "repeats":
      return t("reason.repeats", { days: r.days });
    case "historical_anchor":
      return t("boardReason.historical", { clock: r.clock, day: dayText(t, r.date, locale) });
    case "typical_gap":
      return t("boardReason.typical", { n: r.headway });
    case "unstable_gap":
      return t("boardReason.unstable", { n: r.headway });
    case "stale_today":
      return t("boardReason.staleToday", { time: clock(r.seenAt), basis: basisText(t, r.basis, locale) });
  }
}

/**
 * Compact direction block: destination + next three trains on one row.
 * "in N min" is the MAIN time (≥ 32px, bold, LED style), clock time is secondary (≥ 15px).
 * The next two trains: "in 10 min · 15:33" at ≥ 17px.
 * Estimate chip + source note collapsed into one line.
 */
export function DirectionTimes({
  view,
  now,
  destination,
}: {
  view: DirectionView;
  now: number;
  destination?: ReactNode;
}) {
  const { t, locale } = useI18n();
  if (view.state === "closed") return <p className="mt-2 text-muted">{t("board.notRunning")}</p>;
  const est = view.state === "estimate";
  const approx = (a: { plusMinus: number | null }) => (a.plusMinus != null ? "≈" : "");

  const [first, ...rest] = view.arrivals;
  const firstRemainingMs = first ? Math.max(0, first.at - now) : 0;
  const firstMainTime = first ? formatCountdownMin(firstRemainingMs, locale) : "";

  return (
    <div className="mt-0.5" data-board-state={view.state}>
      {destination && (
        <div className="flex items-baseline gap-1.5 py-0.5">
          <span className="text-xs text-muted uppercase tracking-wider shrink-0">{t("board.towards")}</span>
          <span className="font-semibold text-base sm:text-lg text-foreground">{destination}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2.5 sm:gap-4">
          {first && (
            <div className="flex items-baseline gap-1.5 shrink-0">
              <span className="text-[11px] font-semibold tracking-wider text-muted uppercase shrink-0">{t("board.next")}</span>
              {/* BIG "N min" (>= 32px, bold, LED style) */}
              <span className={`led tabular text-[32px] sm:text-4xl font-bold leading-none ${est ? "opacity-80" : ""}`}>
                {firstMainTime}
              </span>
              {/* small clock "15:27" beside or under it (>= 15px), +- uncertainty tiny */}
              <span className="text-[15px] font-medium text-muted tabular shrink-0 ml-0.5">
                {approx(first)}{first.clock}
                {first.plusMinus != null && (
                  <span className="ml-0.5 text-[11px] font-normal text-muted">{plusMinusText(t, first.plusMinus)}</span>
                )}
              </span>
            </div>
          )}
          {rest.slice(0, 2).map((a) => {
            const restMs = Math.max(0, a.at - now);
            const restMin = Math.floor(restMs / 60_000);
            const inStr = restMin === 0 ? t("board.due") : t("board.in", { n: restMin });
            return (
              <div key={a.at} className="flex items-baseline gap-1 shrink-0 hidden sm:flex">
                <span className="text-[11px] tracking-wider text-muted uppercase shrink-0">{t("board.then")}</span>
                {/* The next two trains: "in 10 min · 15:33" at >= 17px */}
                <span className={`tabular text-[17px] font-semibold text-muted ${a.plusMinus != null ? "opacity-75" : "opacity-90"}`}>
                  {inStr} · {approx(a)}{a.clock}
                  {a.plusMinus != null && (
                    <span className="ml-0.5 text-[11px] font-normal text-muted">{plusMinusText(t, a.plusMinus)}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Estimate chip + source note collapsed into one line */}
      <div className="mt-1 flex items-start gap-1.5 text-xs">
        <span className={`shrink-0 chip py-0 px-1.5 text-[11px] font-semibold ${est ? "bg-warn/15 text-warn" : "bg-go/15 text-go"}`}>
          {t(est ? "board.estimate" : "board.exact")}
        </span>
        <span className="text-muted text-xs min-w-0">{boardReasonText(t, view.reason, locale)}</span>
      </div>
    </div>
  );
}
