"use client";
import type { ReactNode } from "react";
import type { DirectionView, BoardReason, EstimateBasis } from "@/lib/predict/board-view";
import type { T } from "@/lib/i18n";
import { stationForCode } from "@/lib/network";
import { clock, dayText, plusMinusText } from "@/lib/format";
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
 * Compact direction block: destination + next three trains on one row as SGT
 * clock times with a live countdown. Exact times are solid; every estimate
 * reads "≈10:24 ±1 min" (each train its own ±, always with the unit) with an
 * "estimate" chip and the plain reason. Glanceable countdown "in N min" is ≥ 17px
 * and "then" times are ≥ 15px.
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
  const inText = (at: number) => {
    const n = Math.max(0, Math.floor((at - now) / 60_000));
    return n === 0 ? t("board.due") : t("board.in", { n });
  };
  const [first, ...rest] = view.arrivals;
  return (
    <div className="mt-1" data-board-state={view.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {destination && (
          <div className="flex items-baseline gap-1.5 min-w-fit py-0.5">
            <span className="text-xs text-muted uppercase tracking-wider">{t("board.towards")}</span>
            <span className="font-semibold text-base sm:text-lg text-foreground">{destination}</span>
          </div>
        )}
        <div className="flex flex-wrap items-baseline gap-x-4 sm:gap-x-5 gap-y-1">
          {first && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t("board.next")}</span>
              <span className={`led tabular text-2xl sm:text-3xl font-bold leading-none ${est ? "opacity-80" : ""}`}>
                {approx(first)}
                {first.clock}
                {first.plusMinus != null && <span className="ml-0.5 text-xs font-normal text-muted">{plusMinusText(t, first.plusMinus)}</span>}
              </span>
              <span className="tabular text-[17px] font-semibold text-foreground">{inText(first.at)}</span>
            </div>
          )}
          {rest.map((a) => (
            <div key={a.at} className="flex items-baseline gap-1.5">
              <span className="text-[11px] tracking-wider text-muted uppercase">{t("board.then")}</span>
              <span className={`led tabular text-[17px] leading-none ${a.plusMinus != null ? "opacity-70" : "opacity-90"}`}>
                {approx(a)}
                {a.clock}
                {a.plusMinus != null && <span className="ml-0.5 text-xs font-normal text-muted">{plusMinusText(t, a.plusMinus)}</span>}
              </span>
              <span className="tabular text-[15px] text-muted">{inText(a.at)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip ${est ? "bg-warn/15 text-warn" : "bg-go/15 text-go"}`}>{t(est ? "board.estimate" : "board.exact")}</span>
        <span className="text-muted">{boardReasonText(t, view.reason, locale)}</span>
      </div>
    </div>
  );
}
