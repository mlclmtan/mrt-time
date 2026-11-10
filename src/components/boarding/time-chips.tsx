"use client";
import { TIME_CHIPS, resolveTime, type TimeChoice } from "@/lib/sightings/client";
import { clock } from "@/lib/format";
import { useI18n } from "../i18n";

/** Now · −1 · −2 · −5 min · Pick time (SGT, up to 12 h back). */
export function TimeChips({ value, onChange, now, label }: { value: TimeChoice; onChange: (c: TimeChoice) => void; now: number; label?: string }) {
  const { t } = useI18n();
  const picking = value.kind === "pick";
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm tabular ${on ? "border-led bg-led font-semibold text-black" : "border-line text-muted"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label ?? t("time.when")}>
      {TIME_CHIPS.map((m) => {
        const on = value.kind === "ago" && value.minutes === m;
        return (
          <button key={m} type="button" aria-pressed={on} className={chip(on)} onClick={() => onChange({ kind: "ago", minutes: m })}>
            {m === 0 ? t("time.now") : t("time.minus", { n: m })}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={picking}
        className={chip(picking)}
        onClick={() => onChange({ kind: "pick", clock: clock(value.kind === "pick" || !now ? now || 0 : resolveTime(value, now)) })}
      >
        {t("time.pick")}
      </button>
      {picking && now > 0 && (
        <input
          type="time"
          className="field w-28 py-1"
          aria-label={t("time.pickLabel")}
          value={value.clock}
          onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && onChange({ kind: "pick", clock: e.target.value })}
        />
      )}
      {now > 0 && <span className="text-xs text-muted tabular">{t("time.at", { time: clock(resolveTime(value, now)) })}</span>}
    </div>
  );
}
