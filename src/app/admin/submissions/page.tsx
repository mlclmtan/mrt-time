import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { observation, trainSighting } from "@/lib/db/schema";
import { clock } from "@/lib/format";
import { sgtDate } from "@/lib/time";
import { moderateReading, moderateSighting } from "../actions";

export default async function Submissions() {
  const session = await getSession();
  if (session?.user.role !== "owner") redirect("/admin");
  const { t } = await getT();
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const [rows, sightings] = await Promise.all([
    getDb().select().from(observation).where(eq(observation.status, "pending")).orderBy(desc(observation.createdAt)).limit(100),
    getDb().select().from(trainSighting).where(eq(trainSighting.status, "pending")).orderBy(desc(trainSighting.createdAt)).limit(100),
  ]);
  return (
    <div className="space-y-4">
    <section className="panel p-4">
      <h2 className="mb-3 font-semibold">{t("admin.queue")}</h2>
      {rows.length === 0 && <p className="text-sm text-muted">{t("common.none")}</p>}
      <ul className="divide-y divide-line">
        {rows.map((o) => {
          const at = new Date(o.capturedAt).getTime();
          return (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="chip bg-panel-2">{o.station}</span>
              <span>{o.direction}</span>
              <span className="led">{o.minutes.join(" / ")}</span>
              <span className="text-muted">
                {sgtDate(at)} {clock(at)} · {o.source}
              </span>
              <form action={moderateReading} className="ml-auto flex gap-2">
                <input type="hidden" name="id" value={o.id} />
                <button name="status" value="approved" className="btn btn-primary py-1 text-xs">
                  {t("common.approve")}
                </button>
                <button name="status" value="rejected" className="btn btn-secondary py-1 text-xs">
                  {t("common.reject")}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
    <section className="panel p-4">
      <h2 className="mb-3 font-semibold">{t("admin.sightingQueue")}</h2>
      {sightings.length === 0 && <p className="text-sm text-muted">{t("common.none")}</p>}
      <ul className="divide-y divide-line">
        {sightings.map((s) => {
          const at = new Date(s.at).getTime();
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="chip bg-panel-2">{s.station}</span>
              <span>{s.direction}</span>
              <span>{t(s.kind === "alighted" ? "boarding.gotOff" : "boarding.boarded")}</span>
              <span className="text-muted">
                {sgtDate(at)} {clock(at)}
              </span>
              <form action={moderateSighting} className="ml-auto flex gap-2">
                <input type="hidden" name="id" value={s.id} />
                <button name="status" value="approved" className="btn btn-primary py-1 text-xs">
                  {t("common.approve")}
                </button>
                <button name="status" value="rejected" className="btn btn-secondary py-1 text-xs">
                  {t("common.reject")}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
    </div>
  );
}
