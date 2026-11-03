import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { getUnstableWindows } from "@/lib/server/observations";
import { saveUnstableWindows } from "../actions";

export default async function AdminSettings() {
  const session = await getSession();
  if (session?.user.role !== "owner") redirect("/admin");
  const { t } = await getT();
  const windows = await getUnstableWindows();
  const text = windows.map((w) => `${w.dayType} ${w.start}-${w.end}${w.line ? ` ${w.line}` : ""}`).join("\n");
  return (
    <form action={saveUnstableWindows} className="panel max-w-xl space-y-3 p-4">
      <h2 className="font-semibold">{t("admin.unstable")}</h2>
      <p className="text-xs text-muted">{t("admin.unstable.help")}</p>
      <textarea name="windows" rows={6} defaultValue={text} className="field font-mono text-sm" />
      <button className="btn btn-primary">{t("common.save")}</button>
    </form>
  );
}
