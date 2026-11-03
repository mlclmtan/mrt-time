import type { T } from "@/lib/i18n";

/** GET form → ?from=YYYY-MM-DD&to=YYYY-MM-DD (SGT dates). */
export function RangeForm({ t, from, to }: { t: T; from: string; to: string }) {
  return (
    <form className="flex flex-wrap items-end gap-2 text-sm">
      <label className="text-muted">
        {t("common.from")}
        <input type="date" name="from" defaultValue={from} className="field mt-1" />
      </label>
      <label className="text-muted">
        {t("common.to")}
        <input type="date" name="to" defaultValue={to} className="field mt-1" />
      </label>
      <button className="btn btn-secondary py-2">{t("common.apply")}</button>
    </form>
  );
}
