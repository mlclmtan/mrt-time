#!/usr/bin/env node
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);

function findPlaywright() {
  const candidates = [
    "playwright-core",
    "/home/ubuntu/code/invest/node_modules/.pnpm/playwright-core@1.65.0/node_modules/playwright-core",
    "/home/ubuntu/code/paint/node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core",
    "/home/ubuntu/code/wt-53191/node_modules/.pnpm/playwright-core@1.61.0/node_modules/playwright-core",
    "/home/ubuntu/code/invest/node_modules/playwright-core",
    "/home/ubuntu/code/paint/node_modules/playwright-core",
    "/home/ubuntu/code/web-shipwatch-ui/node_modules/playwright-core",
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {}
  }
  throw new Error("playwright-core not found");
}

function findChromium() {
  const baseDir = path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(baseDir)) {
    const entries = fs.readdirSync(baseDir);
    for (const entry of entries) {
      if (entry.startsWith("chromium-")) {
        const p = path.join(baseDir, entry, "chrome-linux-arm64/chrome");
        if (fs.existsSync(p)) return p;
        const pHeadless = path.join(baseDir, entry, "chrome-headless-shell-linux-arm64/chrome-headless-shell");
        if (fs.existsSync(pHeadless)) return pHeadless;
      }
    }
  }
  return undefined;
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 404) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not respond within ${timeoutMs}ms`);
}

async function main() {
  const PORT = process.env.PORT || 3000;
  const BASE_URL = `http://localhost:${PORT}`;
  let spawnedServer = null;

  // Check if server is already running on port
  let serverRunning = false;
  try {
    const r = await fetch(BASE_URL);
    if (r.ok || r.status < 500) serverRunning = true;
  } catch {}

  if (!serverRunning) {
    console.log(`Starting server on port ${PORT}...`);
    spawnedServer = spawn("pnpm", ["start", "-p", String(PORT)], {
      stdio: "ignore",
      detached: false,
    });
    await waitForServer(BASE_URL);
    console.log(`Server ready at ${BASE_URL} (PID: ${spawnedServer.pid})`);
  } else {
    console.log(`Using existing server at ${BASE_URL}`);
  }

  const cleanup = () => {
    if (spawnedServer && spawnedServer.pid) {
      console.log(`Shutting down server PID ${spawnedServer.pid}...`);
      try {
        process.kill(spawnedServer.pid);
      } catch {}
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  try {
    const pw = findPlaywright();
    const executablePath = findChromium();
    console.log("Using Chromium binary:", executablePath || "default");

    const browser = await pw.chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
    });

    const page = await context.newPage();

    console.log(`\nNavigating to ${BASE_URL}/stations ...`);
    await page.goto(`${BASE_URL}/stations`, { waitUntil: "networkidle" });

    // 1. Check document scrollingElement vs viewport
    const docCheck = await page.evaluate(() => {
      return {
        scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        innerHeight: window.innerHeight,
        htmlOverflow: window.getComputedStyle(document.documentElement).overflow,
        bodyOverflow: window.getComputedStyle(document.body).overflow,
        scrollingElementEqualsInner:
          document.scrollingElement?.scrollHeight === window.innerHeight,
      };
    });

    console.log("\n=== Document vs Viewport Height Check ===");
    console.log(`document.scrollingElement.scrollHeight: ${docCheck.scrollHeight}px`);
    console.log(`window.innerHeight:                   ${docCheck.innerHeight}px`);
    console.log(`body overflow:                         ${docCheck.bodyOverflow}`);
    console.log(`html overflow:                         ${docCheck.htmlOverflow}`);
    console.log(
      `scrollHeight === innerHeight:          ${docCheck.scrollingElementEqualsInner ? "PASS (body does not scroll)" : "FAIL"}`,
    );

    // 2. Measure tab navigation latencies
    console.log("\n=== Tab Navigation Benchmark (393x852) ===");
    const tabs = [
      { name: "Plan", idx: 1, href: "/plan", selector: 'nav a[href$="/plan"]', contentSelector: 'form, input, [role="main"]' },
      { name: "Log", idx: 2, href: "/add", selector: 'nav a[href$="/add"]', contentSelector: 'form, button, select, h1, h2' },
      { name: "More", idx: 3, href: "/settings", selector: 'nav a[href$="/settings"]', contentSelector: 'section, h1, h2, a' },
      { name: "Stations", idx: 0, href: "/stations", selector: 'nav a[href$="/stations"]', contentSelector: 'input[type="search"]' },
    ];

    const results = [];

    for (const tab of tabs) {
      // Find tab button
      const link = page.locator(tab.selector).first();
      await link.waitFor({ state: "visible" });

      const t0 = performance.now();

      // Trigger pointerdown (instant optimistic switch)
      await link.dispatchEvent("pointerdown");

      // Measure ms until active pill / pending state updates
      let pillMs = null;
      try {
        await page.waitForFunction(
          (idx) => {
            const nav = document.querySelector("nav.site-tab-bar");
            return nav && nav.getAttribute("data-active-index") === String(idx);
          },
          tab.idx,
          { timeout: 500 },
        );
        pillMs = Math.round(performance.now() - t0);
      } catch {
        pillMs = Math.round(performance.now() - t0);
      }

      // Complete click navigation
      await link.click();

      // Measure ms until real content is visible
      let contentMs = null;
      try {
        await page.waitForSelector(tab.contentSelector, { state: "visible", timeout: 5000 });
        contentMs = Math.round(performance.now() - t0);
      } catch {
        contentMs = Math.round(performance.now() - t0);
      }

      const passPill = pillMs !== null && pillMs <= 100;
      const passContent = tab.name === "Stations" ? contentMs <= 600 : true;

      results.push({
        tab: tab.name,
        targetHref: tab.href,
        pillOrSkeletonMs: pillMs,
        contentMs,
        passPill,
        passContent,
      });

      console.log(
        `Tab [${tab.name.padEnd(8)}] -> Active-pill/skeleton: ${String(pillMs).padStart(3)} ms (target <= 100ms: ${passPill ? "PASS" : "FAIL"}) | Content: ${String(contentMs).padStart(4)} ms`,
      );

      // Brief settle before next tab
      await page.waitForTimeout(200);
    }

    console.log("\n=== Benchmark Summary ===");
    console.table(results);

    await browser.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("Bench failed:", err);
  process.exit(1);
});
