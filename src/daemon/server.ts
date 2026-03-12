#!/usr/bin/env node
/**
 * ClawBrowser Daemon — HTTP API server with persistent Chrome.
 * 
 * Uses Node (not Bun) because Bun's WebSocket has issues with Playwright CDP.
 * Chrome stays alive between requests → no cold start penalty.
 * 
 * API:
 *   POST /get     { url, format?, selector?, waitFor?, timeout? }
 *   POST /exec    { url, js, waitFor?, timeout? }
 *   POST /inspect { url, dom?, network?, console?, storage?, perf?, a11y?, headers?, css?, all?, waitFor?, timeout? }
 *   GET  /status  → { uptime, chrome, requests }
 *   POST /stop    → shuts down daemon
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const DAEMON_DIR = join(process.env.HOME || "/root", ".clawbrowser");
const DAEMON_FILE = join(DAEMON_DIR, "daemon.json");
const PORT = 9333;

let browser;
let requestCount = 0;
const startTime = Date.now();

async function main() {
  mkdirSync(DAEMON_DIR, { recursive: true });

  // Check existing
  if (existsSync(DAEMON_FILE)) {
    try {
      const existing = JSON.parse(readFileSync(DAEMON_FILE, "utf-8"));
      try { process.kill(existing.pid, 0); console.error(`Daemon already running (PID ${existing.pid})`); process.exit(1); }
      catch { unlinkSync(DAEMON_FILE); }
    } catch { try { unlinkSync(DAEMON_FILE); } catch {} }
  }

  // Launch Chrome
  browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  console.log(`Chrome launched`);

  // Stealth init script applied to every new context
  async function createStealthPage(timeout = 30000) {
    const UA = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ];
    const VP = [
      { width: 1920, height: 1080 }, { width: 1536, height: 864 },
      { width: 1440, height: 900 }, { width: 1366, height: 768 },
    ];
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const context = await browser.newContext({
      viewport: pick(VP),
      userAgent: pick(UA),
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      if (!window.chrome) window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    });

    return { context, page };
  }

  // Navigate with fallback
  async function navigate(page, url, timeout = 30000) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout });
    } catch (e) {
      if (e.message?.includes("Timeout")) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        await page.waitForTimeout(3000);
      } else throw e;
    }
  }

  // --- HTTP Server ---
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    if (req.method === "GET" && url.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        uptime: Math.round((Date.now() - startTime) / 1000),
        requests: requestCount,
        chrome: browser?.isConnected() ? "alive" : "dead",
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/stop") {
      res.writeHead(200); res.end("stopping");
      cleanup();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(404); res.end("not found"); return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    let params;
    try { params = JSON.parse(body); } catch { res.writeHead(400); res.end("invalid json"); return; }

    requestCount++;
    const startReq = Date.now();

    try {
      const { context, page } = await createStealthPage(params.timeout || 30000);

      try {
        let result;

        if (url.pathname === "/get") {
          await navigate(page, params.url, params.timeout);
          if (params.waitFor) await page.waitForSelector(params.waitFor);

          const html = params.selector
            ? await page.$(params.selector).then(el => el?.innerHTML() ?? "")
            : await page.content();

          // Readability + Markdown done client-side to keep daemon lightweight
          result = { html, url: page.url(), title: await page.title() };

        } else if (url.pathname === "/exec") {
          await navigate(page, params.url, params.timeout);
          if (params.waitFor) await page.waitForSelector(params.waitFor);
          const val = await page.evaluate(params.js);
          result = { value: val };

        } else if (url.pathname === "/inspect") {
          // Set up collectors before navigation
          const networkLog = [];
          const consoleLog = [];

          if (params.network || params.all) {
            page.on("request", r => networkLog.push({ method: r.method(), url: r.url(), type: r.resourceType() }));
            page.on("response", r => {
              const e = networkLog.find(x => x.url === r.url());
              if (e) { e.status = r.status(); e.size = Number(r.headers()["content-length"] || 0); }
            });
          }
          if (params.console || params.all) {
            page.on("console", m => consoleLog.push({ type: m.type(), text: m.text() }));
          }

          const navResp = await page.goto(params.url, { waitUntil: "networkidle", timeout: params.timeout || 30000 }).catch(async () => {
            return page.goto(params.url, { waitUntil: "domcontentloaded", timeout: params.timeout || 30000 });
          });

          if (params.waitFor) await page.waitForSelector(params.waitFor);

          result = { url: params.url };

          if (params.dom || params.all) {
            const sel = typeof params.dom === "string" ? params.dom : null;
            if (sel) {
              result.dom = await page.$$eval(sel, els => els.map(el => ({
                tag: el.tagName.toLowerCase(), id: el.id || undefined,
                class: el.className || undefined, text: el.textContent?.slice(0, 200)?.trim(),
              })));
            } else {
              result.dom = await page.evaluate(() => ({
                title: document.title,
                headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => ({ level: +h.tagName[1], text: h.textContent?.trim().slice(0, 100) })),
                links: [...document.querySelectorAll("a[href]")].slice(0, 50).map(a => ({ text: a.textContent?.trim().slice(0, 80), href: a.href })),
                forms: [...document.querySelectorAll("form")].map(f => ({ action: f.action, method: f.method, inputs: [...f.querySelectorAll("input,select,textarea")].map(i => ({ type: i.type, name: i.name })) })),
              }));
            }
          }
          if (params.network || params.all) result.network = { total: networkLog.length, requests: networkLog.slice(0, 100) };
          if (params.console || params.all) result.console = { total: consoleLog.length, errors: consoleLog.filter(c => c.type === "error"), all: consoleLog };
          if (params.storage || params.all) {
            result.storage = {
              cookies: (await context.cookies()).map(c => ({ name: c.name, domain: c.domain, value: c.value.slice(0, 100) })),
              localStorage: await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k)?.slice(0, 200); } return o; }),
            };
          }
          if (params.perf || params.all) {
            result.performance = await page.evaluate(() => {
              const nav = performance.getEntriesByType("navigation")[0];
              return { ttfb: Math.round(nav.responseStart - nav.requestStart), domReady: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart), load: Math.round(nav.loadEventEnd - nav.fetchStart) };
            });
          }
          if (params.headers || params.all) {
            result.headers = navResp ? await navResp.allHeaders() : {};
          }
          if (params.a11y || params.all) {
            const cdp = await context.newCDPSession(page);
            const { nodes } = await cdp.send("Accessibility.getFullAXTree");
            result.a11y = nodes.filter(n => n.role?.value !== "none" && n.role?.value !== "generic" && n.name?.value).slice(0, 200).map(n => ({ role: n.role?.value, name: n.name?.value?.slice(0, 100) }));
            await cdp.detach();
          }

        } else {
          res.writeHead(404); res.end("unknown command"); await context.close(); return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...result, _ms: Date.now() - startReq }));
      } finally {
        await context.close();
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, _ms: Date.now() - startReq }));
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    const info = { pid: process.pid, port: PORT, startedAt: new Date().toISOString() };
    writeFileSync(DAEMON_FILE, JSON.stringify(info, null, 2));
    console.log(`Daemon listening on http://127.0.0.1:${PORT} (PID ${process.pid})`);
  });

  function cleanup() {
    console.log("\nShutting down...");
    try { browser?.close(); } catch {}
    try { server.close(); } catch {}
    try { unlinkSync(DAEMON_FILE); } catch {}
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
