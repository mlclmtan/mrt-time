"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Users } from "lucide-react";
import type { Board, BoardDirection, BoardPlatform } from "@/lib/server/board";
import type { CrowdLevel, LineAlerts } from "@/lib/server/lta";
import type { Observation } from "@/lib/predict/types";
import { directionView, withLocalReading } from "@/lib/predict/board-view";
import { myReadingFor, myReadings } from "@/lib/readings/entry";
import { BUS_APP_URL } from "@/lib/push/disruptions";
import { clock } from "@/lib/format";
import { nowMs } from "@/lib/time";
import type { LineCode } from "@/lib/network/data";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { DirectionTimes } from "./direction-times";
import { QuickEntry } from "./quick-entry";
import { SeenToday } from "./seen-today";
import { BoardingButtons } from "../boarding/boarding-buttons";

type Payload = { board: Board | null; alerts: LineAlerts | null; crowd: Record<string, CrowdLevel> | null };
const POLL_MS = 30_000;

export function LiveBoard({ slug, initial }: { slug: string; initial: Payload }) {
  const { t } = useI18n();
  const [data, setData] = useState<Payload>(initial);
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => initial.board?.now ?? 0);
  const [mine, setMine] = useState<Observation[]>([]);
  const key = `mrt_board_${slug}`;
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/board?station=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Payload;
        if (stopped) return;
        setData(body);
        setOfflineAt(null);
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), body }));
      } catch {
        // Offline: render the last snapshot we saved.
        try {
          const saved = JSON.parse(localStorage.getItem(key) || "null") as { at: number; body: Payload } | null;
          if (saved && !stopped) {
            setData(saved.body);
            setOfflineAt(saved.at);
          }
        } catch {}
      }
    };
    loadRef.current = load;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const first = setTimeout(() => {
      setNow(Date.now());
      setMine(myReadings(Date.now()));
      void load();
    }, 0);
    const poll = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug, key]);

  // Saved: show exact times at once (own reading), then re-fetch for everyone's view.
  const onSaved = useCallback(() => {
    const at = nowMs();
    setNow(at);
    setMine(myReadings(at));
    void loadRef.current();
  }, []);

  const board = data.board;
  if (!board) return <p className="text-muted">{t("board.loading")}</p>;
  const lines = board.platforms.map((p) => p.line);
  const alerts = data.alerts?.segments.filter((s) => lines.includes(s.line as BoardPlatform["line"])) ?? [];

  return (
    <section aria-label={t("board.title")} className="space-y-4">
      {offlineAt && (
        <p role="status" className="rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">
          {t("board.offline", { time: clock(offlineAt) })}
        </p>
      )}
      {alerts.length > 0 && data.alerts && <AlertBanner alerts={data.alerts} lines={[...new Set(alerts.map((a) => a.line))]} />}
      {board.platforms.map((p) => (
        <PlatformCard key={p.code} platform={p} now={now || board.now} crowd={data.crowd?.[p.code]} mine={mine} onSaved={onSaved} />
      ))}
      <p className="text-xs text-muted">{t("board.updated", { time: clock(board.now) })}</p>
    </section>
  );
}

function AlertBanner({ alerts, lines }: { alerts: LineAlerts; lines: string[] }) {
  const { t } = useI18n();
  const { track } = useAnalytics();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    for (const line of lines) track("alert_view", { line: line as LineCode, status: alerts.status });
  }, [alerts.status, lines, track]);
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-bad">
        <AlertTriangle size={16} aria-hidden /> {t("alert.title")} · {lines.join(", ")}
      </p>
      {alerts.messages[0] && <p className="mt-1">{alerts.messages[0].content}</p>}
      <a
        href={BUS_APP_URL}
        className="mt-2 inline-block font-semibold text-accent underline"
        onClick={() => track("outbound_click", { domain: "bus.91208274.xyz", link_type: "bus" })}
      >
        {t("alert.bus")}
      </a>
    </div>
  );
}

function PlatformCard({
  platform,
  now,
  crowd,
  mine,
  onSaved,
}: {
  platform: BoardPlatform;
  now: number;
  crowd?: CrowdLevel;
  mine: Observation[];
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const sent = useRef(false);
  useEffect(() => {
    if (crowd && !sent.current) {
      sent.current = true;
      track("crowd_view", { station: platform.code, line: platform.line, level: crowd });
    }
  }, [crowd, platform.code, platform.line, track]);
  return (
    <article className="panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="chip text-white" style={{ background: platform.color }}>
          {platform.code}
        </span>
        <span className="text-sm font-semibold">{platform.lineName[locale]}</span>
        {crowd && crowd !== "NA" && (
          <span className={`chip ml-auto ${crowd === "h" ? "bg-bad/15 text-bad" : crowd === "m" ? "bg-warn/15 text-warn" : "bg-go/15 text-go"}`}>
            <Users size={12} aria-hidden /> {t(`crowd.${crowd}`)}
          </span>
        )}
      </header>
      <div className="divide-y divide-line">
        {platform.directions.map((d) => (
          <DirectionRow key={d.key} platform={platform} direction={d} now={now} mine={myReadingFor(mine, platform.code, d.key)} onSaved={onSaved} />
        ))}
      </div>
    </article>
  );
}

function DirectionRow({
  platform,
  direction,
  now,
  mine,
  onSaved,
}: {
  platform: BoardPlatform;
  direction: BoardDirection;
  now: number;
  mine: Observation | null;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const [voted, setVoted] = useState(false);
  const p = withLocalReading(direction.prediction, mine, { line: platform.line, direction: direction.key, station: platform.code, now });
  const view = directionView(p, now, platform.line);
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("prediction_view", { station: platform.code, line: platform.line, direction: direction.key, confidence: p.confidence, basis: p.basis });
  }, [direction.key, p.basis, p.confidence, platform.code, platform.line, track]);

  const destination = (direction.board ?? direction.label)[locale];
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted">{t("board.towards")}</span>
        <span className="font-semibold">{destination}</span>
      </div>
      <DirectionTimes view={view} now={now} />
      {view.state === "exact" && (
        <div className="mt-2 flex gap-2 text-xs">
          {voted ? (
            <span className="text-go">{t("board.thanks")}</span>
          ) : (
            (["accurate", "early", "late"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="rounded-full border border-line px-2.5 py-1 text-muted"
                onClick={() => {
                  track("prediction_feedback", { station: platform.code, line: platform.line, direction: direction.key, verdict: v });
                  setVoted(true);
                }}
              >
                {t(`board.${v}`)}
              </button>
            ))
          )}
        </div>
      )}
      <SeenToday trains={direction.seenToday ?? []} />
      {view.state !== "closed" && (
        <>
          <QuickEntry station={platform.code} line={platform.line} direction={direction.key} destination={destination} onSaved={onSaved} onUndone={onSaved} />
          <BoardingButtons station={platform.code} line={platform.line} direction={direction.key} destination={destination} onSaved={onSaved} onUndone={onSaved} />
        </>
      )}
    </div>
  );
}
