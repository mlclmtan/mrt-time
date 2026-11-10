"use client";
import { ArrowRightLeft, LogIn, Monitor } from "lucide-react";
import type { SeenTrain } from "@/lib/predict/privacy";
import { stationForCode } from "@/lib/network";
import { clock, plusMinusText } from "@/lib/format";
import { useI18n } from "../i18n";

/**
 * "Trains seen today" at one platform direction, newest first. The signed-in
 * owner sees how each is known (icon + "Someone got on or off here" …);
 * visitors get `how: "seen"` from the server: the time and a plain "seen".
 */
export function SeenToday({ trains }: { trains: SeenTrain[] }) {
  const { t, locale } = useI18n();
  if (!trains?.length) return null;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-muted">{t("seen.title", { n: trains.length })}</summary>
      <ul className="mt-2 space-y-1">
        {trains.map((s) => {
          if (s.how === "seen")
            return (
              <li key={`${s.at}-seen`} className="flex items-center gap-2" data-seen="public">
                <span className="led tabular w-16">{clock(s.at)}</span>
                <span className="text-muted">{t("seen.seen")}</span>
              </li>
            );
          const Icon = s.how === "boarded" ? LogIn : s.how === "reading" ? Monitor : ArrowRightLeft;
          const how =
            s.how === "passed"
              ? t("seen.passed", { station: (s.from && stationForCode(s.from)?.name[locale]) || s.from || "" })
              : t(s.how === "boarded" ? "seen.boarded" : "seen.reading");
          return (
            <li key={`${s.at}-${s.how}`} className="flex items-center gap-2">
              <span className="led tabular w-16">
                {s.spreadMin > 0 ? "≈" : ""}
                {clock(s.at)}
              </span>
              <Icon size={14} aria-hidden className="text-muted" />
              <span className="text-muted">
                {how}
                {s.spreadMin > 0 ? ` (${plusMinusText(t, s.spreadMin)})` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
