import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { getWindowSettings } from "@/lib/server/observations";
import { saveEngine, saveUnstableWindows } from "../actions";

export default async function AdminSettings() {
  const session = await getSession();
  if (session?.user.role !== "owner") redirect("/admin");
  const { t } = await getT();
  const { windows, engine } = await getWindowSettings();
  const text = windows.map((w) => `${w.dayType} ${w.start}-${w.end}${w.line ? ` ${w.line}` : ""}`).join("\n");
  return (
    <div className="space-y-4">
      {/* Kill switch: back to the v1 predictor everywhere (boards, planner, Home) without a deploy. */}
      <form action={saveEngine} className="panel max-w-xl space-y-3 p-4" data-engine={engine}>
        <h2 className="font-semibold">{t("admin.engine")}</h2>
        <p className="text-xs text-muted">{t("admin.engine.help")}</p>
        <fieldset className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="engine" value="v2" defaultChecked={engine === "v2"} /> {t("admin.engine.v2")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="engine" value="v1" defaultChecked={engine === "v1"} /> {t("admin.engine.v1")}
          </label>
        </fieldset>
        <button className="btn btn-primary">{t("common.save")}</button>
      </form>
      <form action={saveUnstableWindows} className="panel max-w-xl space-y-3 p-4">
        <h2 className="font-semibold">{t("admin.unstable")}</h2>
        <p className="text-xs text-muted">{t("admin.unstable.help")}</p>
        <textarea name="windows" rows={6} defaultValue={text} className="field font-mono text-sm" />
        <button className="btn btn-primary">{t("common.save")}</button>
      </form>
    </div>
  );
}
