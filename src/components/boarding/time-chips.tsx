"use client";
import { MAX_BACKDATE_MIN, TIME_CHIPS, resolveTime, type TimeChoice } from "@/lib/sightings/client";
import { clock } from "@/lib/format";
import { MINUTE } from "@/lib/time";
import { useI18n } from "../i18n";

/**
 * When it happened, as clock times: 10:14 · 10:13 · 10:12 · 10:09 · Other
 * time (SGT; up to 12 h back for the owner, 30 min for everyone else).
 * Before the clock is known (server render) the chips read Now · −1 min …
 */
export function TimeChips({
  value,
  onChange,
  now,
  label,
  maxBackMin = MAX_BACKDATE_MIN,
}: {
  value: TimeChoice;
  onChange: (c: TimeChoice) => void;
  now: number;
  label?: string;
  maxBackMin?: number;
}) {
  const { t } = useI18n();
  const picking = value.kind === "pick";
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm tabular ${on ? "border-led bg-led font-semibold text-black" : "border-line text-muted"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label ?? t("time.when")}>
      {TIME_CHIPS.map((m) => {
        const on = value.kind === "ago" && value.minutes === m;
        const at = now > 0 ? clock(now - m * MINUTE) : null;
        const words = m === 0 ? t("time.now") : t("time.minus", { n: m });
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            aria-label={at ? (m === 0 ? t("time.nowAt", { time: at }) : t("time.agoAt", { n: m, time: at })) : words}
            className={chip(on)}
            onClick={() => onChange({ kind: "ago", minutes: m })}
          >
            {at ?? words}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={picking}
        className={chip(picking)}
        onClick={() => onChange({ kind: "pick", clock: clock(value.kind === "pick" || !now ? now || 0 : resolveTime(value, now, maxBackMin)) })}
      >
        {t("time.other")}
      </button>
      {picking && now > 0 && (
        <input
          type="time"
          className="field w-28 py-1"
          aria-label={t(maxBackMin < MAX_BACKDATE_MIN ? "time.pickLabelShort" : "time.pickLabel")}
          value={value.clock}
          onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && onChange({ kind: "pick", clock: e.target.value })}
        />
      )}
      {picking && now > 0 && <span className="text-xs text-muted tabular">{t("time.at", { time: clock(resolveTime(value, now, maxBackMin)) })}</span>}
    </div>
  );
}
