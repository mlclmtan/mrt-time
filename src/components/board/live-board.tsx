"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Users } from "lucide-react";
import type { Board, BoardDirection, BoardPlatform } from "@/lib/server/board";
import type { CrowdLevel, LineAlerts } from "@/lib/server/lta";
import type { Observation } from "@/lib/predict/types";
import { directionView, lastSeenAt, withLocalReading } from "@/lib/predict/board-view";
import { myReadingFor, myReadings } from "@/lib/readings/entry";
import { BUS_APP_URL } from "@/lib/push/disruptions";
import { clock } from "@/lib/format";
import { nowMs } from "@/lib/time";
import type { LineCode } from "@/lib/network/data";
import { orderStationPlatforms, recordStationUse } from "@/lib/stations/usage";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { getSnapshot, saveSnapshot, ageLabel } from "@/lib/snapshot-cache";
import { DirectionTimes } from "./direction-times";
import { QuickEntry } from "./quick-entry";
import { SeenToday } from "./seen-today";
import { BoardingButtons } from "../boarding/boarding-buttons";

type Payload = { board: Board | null; alerts: LineAlerts | null; crowd: Record<string, CrowdLevel> | null };
const POLL_MS = 30_000;
/** Away at least this long before coming back counts as a `refresh` (resume). */
const RESUME_AFTER_MS = 60_000;

export function LiveBoard({ slug, initial }: { slug: string; initial: Payload }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Payload>(() =>
    initial.board ? initial : (getSnapshot<Payload>(`board:${slug}`)?.data ?? initial),
  );
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<number | null>(() =>
    initial.board ? Date.now() : (getSnapshot<Payload>(`board:${slug}`)?.savedAt ?? null),
  );
  const [revalidating, setRevalidating] = useState(false);
  const [now, setNow] = useState(() => initial.board?.now ?? 0);
  const [mine, setMine] = useState<Observation[]>([]);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const { track } = useAnalytics();
  const trackRef = useRef(track);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    recordStationUse(slug, Date.now(), "view");
  }, [slug]);

  useEffect(() => {
    if (initial.board) {
      saveSnapshot(`board:${slug}`, initial);
    }
  }, [slug, initial]);

  useEffect(() => {
    let stopped = false;
    let hiddenAt: number | null = null;
    const load = async () => {
      setRevalidating(true);
      try {
        const res = await fetch(`/api/board?station=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Payload;
        if (stopped) return;
        setData(body);
        setOfflineAt(null);
        saveSnapshot(`board:${slug}`, body);
        setSnapshotSavedAt(Date.now());
      } catch {
        // Offline: render the last snapshot we saved.
        const snap = getSnapshot<Payload>(`board:${slug}`);
        if (snap && !stopped) {
          setData(snap.data);
          setOfflineAt(snap.savedAt);
          setSnapshotSavedAt(snap.savedAt);
        }
      } finally {
        if (!stopped) setRevalidating(false);
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
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt = Date.now();
        return;
      }
      // Back after a while = the rider checking the board again.
      if (hiddenAt !== null && Date.now() - hiddenAt >= RESUME_AFTER_MS) trackRef.current("refresh", { surface: "board", trigger: "resume" });
      hiddenAt = null;
      void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  // Saved: show exact times at once (own reading), then re-fetch for everyone's view.
  const onSaved = useCallback(() => {
    recordStationUse(slug, Date.now(), "reading");
    const at = nowMs();
    setNow(at);
    setMine(myReadings(at));
    void loadRef.current();
  }, [slug]);

  const refresh = useCallback(async () => {
    track("refresh", { surface: "board", trigger: "manual" });
    setRefreshing(true);
    setNow(nowMs());
    setMine(myReadings(nowMs()));
    await loadRef.current();
    setRefreshing(false);
  }, [track]);

  const board = data.board;
  const orderedPlatforms = useMemo(() => {
    return orderStationPlatforms(board?.platforms ?? [], slug, now || board?.now);
  }, [board?.platforms, slug, now, board?.now]);

  if (!board) return <p className="text-muted">{t("board.loading")}</p>;
  const lines = orderedPlatforms.map((p) => p.line);
  const alerts = data.alerts?.segments.filter((s) => lines.includes(s.line as BoardPlatform["line"])) ?? [];

  return (
    <section aria-label={t("board.title")} className="space-y-3">
      {revalidating && (
        <p className="text-xs font-medium text-muted animate-pulse">
          {t("snap.updating")}
        </p>
      )}
      {!revalidating && snapshotSavedAt && ageLabel(snapshotSavedAt, now, locale) && (
        <p role="status" className="rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">
          {ageLabel(snapshotSavedAt, now, locale)}
        </p>
      )}
      {offlineAt && !snapshotSavedAt && (
        <p role="status" className="rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">
          {t("board.offline", { time: clock(offlineAt) })}
        </p>
      )}
      {alerts.length > 0 && data.alerts && <AlertBanner alerts={data.alerts} lines={[...new Set(alerts.map((a) => a.line))]} />}
      {orderedPlatforms.map((p) => (
        <PlatformCard
          key={p.code}
          platform={p}
          now={now || board.now}
          crowd={data.crowd?.[p.code]}
          mine={mine}
          onSaved={onSaved}
          defaultCollapsed={slug === "outram-park" && p.line === "NEL"}
        />
      ))}
      <div className="flex items-center gap-3 text-xs text-muted">
        <p>
          {t("board.updated", { time: clock(board.now) })}
          {revalidating ? ` · ${t("snap.updating")}` : ""}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-semibold disabled:opacity-60"
        >
          <RefreshCw size={12} aria-hidden className={refreshing ? "animate-spin" : undefined} /> {t("board.refresh")}
        </button>
      </div>
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
  defaultCollapsed = false,
}: {
  platform: BoardPlatform;
  now: number;
  crowd?: CrowdLevel;
  mine: Observation[];
  onSaved: () => void;
  defaultCollapsed?: boolean;
}) {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const sent = useRef(false);
  useEffect(() => {
    if (crowd && !sent.current) {
      sent.current = true;
      track("crowd_view", { station: platform.code, line: platform.line, level: crowd });
    }
  }, [crowd, platform.code, platform.line, track]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="panel flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 text-left font-semibold transition-colors hover:bg-panel-2/50 active:scale-95"
      >
        <span className="flex items-center gap-2">
          <span className="chip text-white text-xs font-semibold" style={{ background: platform.color }}>
            {platform.code}
          </span>
          <span className="text-sm font-semibold">
            {t("station.line.tapToExpand", { line: platform.lineName[locale] })}
          </span>
        </span>
        <ChevronDown size={18} className="text-muted" aria-hidden />
      </button>
    );
  }

  return (
    <article className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="chip text-white" style={{ background: platform.color }}>
            {platform.code}
          </span>
          <span className="text-sm font-semibold">{platform.lineName[locale]}</span>
          {crowd && crowd !== "NA" && (
            <span className={`chip ml-2 ${crowd === "h" ? "bg-bad/15 text-bad" : crowd === "m" ? "bg-warn/15 text-warn" : "bg-go/15 text-go"}`}>
              <Users size={12} aria-hidden /> {t(`crowd.${crowd}`)}
            </span>
          )}
        </div>
        {defaultCollapsed && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-xs text-muted hover:text-foreground active:scale-95"
            aria-label={t("station.line.tapToCollapse", { line: platform.lineName[locale] })}
          >
            <ChevronUp size={18} aria-hidden />
          </button>
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
  const [screenOpen, setScreenOpen] = useState(false);
  const p = withLocalReading(direction.prediction, mine, { line: platform.line, direction: direction.key, station: platform.code, now });
  const view = directionView(p, now, platform.line, lastSeenAt(direction.seenToday, now));
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("prediction_view", { station: platform.code, line: platform.line, direction: direction.key, confidence: p.confidence, basis: p.basis });
  }, [direction.key, p.basis, p.confidence, platform.code, platform.line, track]);

  const destination = (direction.board ?? direction.label)[locale];
  return (
    <div className="px-3.5 py-2 sm:px-4 sm:py-2.5" data-direction-row={`${platform.code}:${direction.key}`}>
      <DirectionTimes view={view} now={now} destination={destination} />
      {view.state === "exact" && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
          {voted ? (
            <span className="text-go">{t("board.thanks")}</span>
          ) : (
            (["accurate", "early", "late"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="min-h-[44px] px-3.5 py-2 inline-flex items-center justify-center rounded-full border border-line text-sm text-muted hover:text-foreground active:scale-95"
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
          <BoardingButtons
            station={platform.code}
            line={platform.line}
            direction={direction.key}
            destination={destination}
            onSaved={onSaved}
            onUndone={onSaved}
            onScreenSays={() => setScreenOpen((open) => !open)}
            showScreenSays={true}
          />
          {screenOpen && (
            <div className="mt-2 space-y-2 rounded-xl border border-line bg-panel p-3">
              <QuickEntry
                station={platform.code}
                line={platform.line}
                direction={direction.key}
                destination={destination}
                startOpen={true}
                onSaved={() => {
                  setScreenOpen(false);
                  onSaved();
                }}
                onUndone={onSaved}
              />
              <button
                type="button"
                onClick={() => setScreenOpen(false)}
                className="min-h-[44px] px-3 text-xs text-muted hover:text-foreground active:scale-95 flex items-center"
              >
                {locale === "zh-Hant" ? "取消" : "Cancel"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
