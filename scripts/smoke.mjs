#!/usr/bin/env node
/**
 * Post-deploy smoke check (no browser): hits the main pages and APIs and
 * asserts status codes and key JSON shapes.
 *
 *   pnpm smoke https://mrt.91208274.xyz
 *   pnpm smoke http://localhost:3000
 *
 * Exits non-zero when any check fails. Read-only: only GET requests.
 */
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: pnpm smoke <baseUrl>   e.g. pnpm smoke https://mrt.91208274.xyz");
  process.exit(2);
}

const TIMEOUT_MS = 20_000;
const results = [];

async function get(path, accept = "text/html") {
  const started = Date.now();
  const res = await fetch(base + path, {
    headers: { accept, "user-agent": "mrt-smoke/1.0" },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { res, ms: Date.now() - started };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

const page = (path, mustContain) =>
  check(`GET ${path}`, async () => {
    const { res, ms } = await get(path);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.text();
    if (mustContain) assert(body.includes(mustContain), `body lacks ${JSON.stringify(mustContain)}`);
    return `${res.status} · ${ms} ms`;
  });

async function getJson(path) {
  const { res, ms } = await get(path, "application/json");
  assert(res.status === 200, `status ${res.status}`);
  assert((res.headers.get("content-type") || "").includes("json"), "not JSON");
  return { body: await res.json(), ms };
}

// Pages
await page("/", "MRT Time");
await page("/plan");
await page("/station/tiong-bahru", "Tiong Bahru");
await page("/station/outram-park", "Outram Park");
await page("/accuracy");
await page("/about");
await page("/privacy");
await page("/terms");
await page("/media-kit");
await page("/zh-Hant");
await page("/sign-in");
await page("/add", "Add a board reading");
await check("GET /submit → /add", async () => {
  const { res } = await get("/submit");
  assert([301, 308].includes(res.status), `status ${res.status}`);
  assert((res.headers.get("location") || "").endsWith("/add"), `location ${res.headers.get("location")}`);
  return `${res.status} → /add`;
});
await check("GET /ads.txt", async () => {
  const { res } = await get("/ads.txt", "text/plain");
  if (res.status === 404) return "404 (AdSense not configured)";
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.text();
  assert(/^google\.com, pub-\d+, DIRECT, f08c47fec0942fa0$/m.test(body), "bad ads.txt line");
  return body.trim();
});
await page("/robots.txt", "Sitemap");
await page("/sitemap.xml", "/station/tiong-bahru");
await check("GET /manifest.webmanifest", async () => {
  const { body, ms } = await getJson("/manifest.webmanifest");
  assert(body.display === "standalone", "display is not standalone");
  assert(Array.isArray(body.icons) && body.icons.length > 0, "no icons");
  return `200 · ${ms} ms`;
});

// APIs
await check("GET /api/version", async () => {
  const { body, ms } = await getJson("/api/version");
  assert(/^\d+\.\d+\.\d+$/.test(body.version), `bad version ${body.version}`);
  assert(typeof body.sha === "string" && body.sha.length > 0, "no sha");
  assert(typeof body.buildId === "string" && body.buildId.length > 0, "no buildId");
  return `v${body.version} · ${body.sha} · ${ms} ms`;
});

await check("GET /api/board?station=tiong-bahru", async () => {
  const { body, ms } = await getJson("/api/board?station=tiong-bahru");
  const board = body.board;
  assert(board && board.station === "tiong-bahru", "board.station is not tiong-bahru");
  assert(typeof board.now === "number", "board.now missing");
  assert(Array.isArray(board.platforms) && board.platforms.length > 0, "no platforms");
  for (const p of board.platforms) {
    assert(typeof p.code === "string" && typeof p.line === "string", "platform without code/line");
    assert(Array.isArray(p.directions) && p.directions.length > 0, `${p.code}: no directions`);
    for (const d of p.directions) {
      const pr = d.prediction;
      assert(pr && ["times", "range", "closed"].includes(pr.kind), `${p.code} ${d.key}: bad prediction kind`);
      assert(["high", "medium", "low"].includes(pr.confidence), `${p.code} ${d.key}: bad confidence`);
      assert(pr.reason && typeof pr.reason.code === "string", `${p.code} ${d.key}: no reason`);
      assert(d.board && typeof d.board.en === "string", `${p.code} ${d.key}: no board destination name`);
      if (pr.kind === "times") assert(pr.arrivals.length > 0, `${p.code} ${d.key}: times without arrivals`);
      if (pr.kind === "range") assert(pr.waitMin.max > 0, `${p.code} ${d.key}: range without wait`);
    }
  }
  assert("alerts" in body && "crowd" in body, "alerts/crowd keys missing");
  const kinds = board.platforms.flatMap((p) => p.directions.map((d) => `${p.code} ${d.key}=${d.prediction.kind}/${d.prediction.confidence}`));
  return `${kinds.join(", ")} · ${ms} ms`;
});

await check("GET /api/board?station=nowhere → 404", async () => {
  const { res } = await get("/api/board?station=nowhere", "application/json");
  assert(res.status === 404, `status ${res.status}`);
  return "404";
});

await check("GET /api/plan tiong-bahru → shenton-way (list)", async () => {
  const { body, ms } = await getJson("/api/plan?from=tiong-bahru&to=shenton-way&mode=list");
  assert(Array.isArray(body.legs) && body.legs.length > 0, "no legs");
  assert(Array.isArray(body.plans), "no plans");
  assert(body.plans.length === 6, `expected 6 options, got ${body.plans.length}`);
  const transfers = body.legs.filter((l) => l.kind === "transfer");
  assert(transfers.length === 1, `expected 1 transfer, got ${transfers.length}`);
  const outram = transfers.find((l) => l.at === "outram-park");
  assert(outram, "transfer is not at Outram Park");
  assert(outram.min <= 2, `Outram transfer is ${outram.min} min (expected ≤ 2)`);
  for (let i = 0; i < body.plans.length; i++) {
    const p = body.plans[i];
    assert(typeof p.departAt === "number" && typeof p.arriveAt === "number", `plan ${i}: no times`);
    assert(p.arriveAt > p.departAt, `plan ${i}: arrives before leaving`);
    assert(p.best <= p.arriveAt && p.worst >= p.arriveAt, `plan ${i}: best/worst don't bracket arrival`);
    if (i > 0) assert(p.departAt > body.plans[i - 1].departAt, `plan ${i}: departures not increasing`);
    const planTransfer = p.legs.find((l) => l.leg.kind === "transfer");
    assert(planTransfer && planTransfer.leg.min <= 2, `plan ${i}: transfer > 2 min`);
  }
  return `6 options · Outram transfer ${outram.min} min · ${ms} ms`;
});

await check("GET /api/commute without sign-in → 401", async () => {
  const { res } = await get("/api/commute?journey=home_to_office", "application/json");
  assert(res.status === 401, `status ${res.status} (owner API must require auth)`);
  return "401";
});

// Report
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.name.padEnd(width)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${base}`);
process.exit(failed.length ? 1 : 0);
