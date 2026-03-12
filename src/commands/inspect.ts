import type { Page, Request, Response, ConsoleMessage } from "playwright";
import { launchBrowser, openPage, type LaunchOptions } from "../browser/launch.js";

export interface InspectOptions extends LaunchOptions {
  dom?: string | boolean;    // --dom or --dom "selector"
  network?: boolean;         // --network
  console?: boolean;         // --console
  storage?: boolean;         // --storage
  perf?: boolean;            // --perf
  a11y?: boolean;            // --a11y
  headers?: boolean;         // --headers
  css?: string;              // --css "selector"
  all?: boolean;             // --all (everything)
  waitFor?: string;
}

interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  type: string;
  size?: number;
  timing?: number;
  headers?: Record<string, string>;
}

interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
}

export async function inspect(url: string, opts: InspectOptions = {}) {
  const browser = await launchBrowser(opts);

  const wantAll = opts.all;
  const wantNetwork = wantAll || opts.network;
  const wantConsole = wantAll || opts.console;
  const wantDom = wantAll || opts.dom !== undefined;
  const wantStorage = wantAll || opts.storage;
  const wantPerf = wantAll || opts.perf;
  const wantA11y = wantAll || opts.a11y;
  const wantHeaders = wantAll || opts.headers;
  const wantCss = opts.css !== undefined;

  // For inspect, we need to set up listeners BEFORE navigation,
  // so we create context/page manually instead of using openPage()
  const { chromium } = await import("playwright-extra");
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout ?? 30_000);

  // Stealth init script
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    if (!(window as any).chrome) {
      (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    }
  });

  // --- Collectors (set up BEFORE navigation) ---
  const networkLog: NetworkEntry[] = [];
  const consoleLog: ConsoleEntry[] = [];
  let responseHeaders: Record<string, string> = {};

  if (wantNetwork) {
    page.on("request", (req: Request) => {
      networkLog.push({
        method: req.method(),
        url: req.url(),
        type: req.resourceType(),
      });
    });

    page.on("response", (res: Response) => {
      const entry = networkLog.find((e) => e.url === res.url());
      if (entry) {
        entry.status = res.status();
        entry.size = Number(res.headers()["content-length"] || 0);
      }
    });
  }

  if (wantConsole) {
    page.on("console", (msg: ConsoleMessage) => {
      consoleLog.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()
          ? `${msg.location().url}:${msg.location().lineNumber}`
          : undefined,
      });
    });
  }

  // --- Navigate with smart fallback ---
  let navResponse;
  try {
    navResponse = await page.goto(url, { waitUntil: "networkidle" });
  } catch (e: any) {
    if (e.message?.includes("Timeout")) {
      navResponse = await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
    } else {
      throw e;
    }
  }

  if (wantHeaders && navResponse) {
    responseHeaders = await navResponse.allHeaders();
  }

  if (opts.waitFor) {
    await page.waitForSelector(opts.waitFor);
  }

  // --- Collect post-navigation data ---
  const result: Record<string, any> = { url };

  // DOM
  if (wantDom) {
    const selector = typeof opts.dom === "string" ? opts.dom : undefined;
    if (selector) {
      // Query specific elements
      const elements = await page.$$eval(selector, (els) =>
        els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          class: el.className || undefined,
          text: el.textContent?.slice(0, 200)?.trim(),
          href: (el as HTMLAnchorElement).href || undefined,
          childCount: el.children.length,
        }))
      );
      result.dom = { selector, count: elements.length, elements };
    } else {
      // Page structure overview
      result.dom = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map(
          (h) => ({
            level: parseInt(h.tagName[1]),
            text: h.textContent?.trim().slice(0, 100),
          })
        );
        const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
          text: a.textContent?.trim().slice(0, 80),
          href: (a as HTMLAnchorElement).href,
        }));
        const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
          action: f.action,
          method: f.method,
          inputs: Array.from(f.querySelectorAll("input,select,textarea")).map((i) => ({
            type: (i as HTMLInputElement).type || i.tagName.toLowerCase(),
            name: (i as HTMLInputElement).name,
            id: i.id || undefined,
            placeholder: (i as HTMLInputElement).placeholder || undefined,
          })),
        }));
        const meta = Array.from(document.querySelectorAll("meta")).reduce(
          (acc, m) => {
            const name = m.getAttribute("name") || m.getAttribute("property");
            if (name) acc[name] = m.getAttribute("content") || "";
            return acc;
          },
          {} as Record<string, string>
        );

        return {
          title: document.title,
          headings,
          links: links.slice(0, 50),
          linkCount: links.length,
          forms,
          meta,
        };
      });
    }
  }

  // Network
  if (wantNetwork) {
    result.network = {
      total: networkLog.length,
      byType: networkLog.reduce(
        (acc, e) => {
          acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      requests: networkLog.slice(0, 100), // cap at 100
    };
  }

  // Console
  if (wantConsole) {
    result.console = {
      total: consoleLog.length,
      errors: consoleLog.filter((c) => c.type === "error"),
      warnings: consoleLog.filter((c) => c.type === "warning"),
      all: consoleLog,
    };
  }

  // Storage
  if (wantStorage) {
    const cookies = await context.cookies();
    const storage = await page.evaluate(() => {
      const ls: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) ls[key] = localStorage.getItem(key)?.slice(0, 500) ?? "";
      }
      const ss: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) ss[key] = sessionStorage.getItem(key)?.slice(0, 500) ?? "";
      }
      return { localStorage: ls, sessionStorage: ss };
    });

    result.storage = {
      cookies: cookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session",
        value: c.value.slice(0, 100) + (c.value.length > 100 ? "…" : ""),
      })),
      localStorage: storage.localStorage,
      sessionStorage: storage.sessionStorage,
    };
  }

  // Performance
  if (wantPerf) {
    result.performance = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByType("paint");

      return {
        timing: {
          dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcp: Math.round(nav.connectEnd - nav.connectStart),
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          download: Math.round(nav.responseEnd - nav.responseStart),
          domParse: Math.round(nav.domInteractive - nav.responseEnd),
          domReady: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
          load: Math.round(nav.loadEventEnd - nav.fetchStart),
        },
        paint: paint.map((p) => ({ name: p.name, time: Math.round(p.startTime) })),
        resources: {
          count: performance.getEntriesByType("resource").length,
          totalSize: performance
            .getEntriesByType("resource")
            .reduce((sum, r) => sum + ((r as PerformanceResourceTiming).transferSize || 0), 0),
        },
        memory: (performance as any).memory
          ? {
              usedJSHeap: ((performance as any).memory.usedJSHeapSize / 1048576).toFixed(1) + " MB",
              totalJSHeap:
                ((performance as any).memory.totalJSHeapSize / 1048576).toFixed(1) + " MB",
            }
          : undefined,
      };
    });
  }

  // Accessibility tree
  if (wantA11y) {
    const cdp = await context.newCDPSession(page);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");

    // Build a compact tree — filter out ignored/empty nodes
    const meaningful = nodes
      .filter(
        (n: any) =>
          n.role?.value !== "none" &&
          n.role?.value !== "generic" &&
          n.role?.value !== "InlineTextBox" &&
          (n.name?.value || n.role?.value)
      )
      .slice(0, 200)
      .map((n: any) => ({
        role: n.role?.value,
        name: n.name?.value?.slice(0, 100),
        description: n.description?.value?.slice(0, 100) || undefined,
        value: n.value?.value?.slice(0, 100) || undefined,
        focused: n.focused?.value || undefined,
        required: n.properties?.find((p: any) => p.name === "required")?.value?.value || undefined,
        disabled: n.properties?.find((p: any) => p.name === "disabled")?.value?.value || undefined,
      }));

    result.a11y = { nodeCount: nodes.length, meaningfulNodes: meaningful.length, tree: meaningful };
    await cdp.detach();
  }

  // Response headers
  if (wantHeaders) {
    result.headers = responseHeaders;
  }

  // CSS computed styles
  if (wantCss) {
    const styles = await page.$$eval(opts.css!, (els) =>
      els.slice(0, 10).map((el) => {
        const computed = window.getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          selector: el.id ? `#${el.id}` : el.className ? `.${el.className.split(" ")[0]}` : el.tagName.toLowerCase(),
          styles: {
            display: computed.display,
            position: computed.position,
            width: computed.width,
            height: computed.height,
            margin: computed.margin,
            padding: computed.padding,
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            fontSize: computed.fontSize,
            fontFamily: computed.fontFamily,
            fontWeight: computed.fontWeight,
            border: computed.border,
            overflow: computed.overflow,
            zIndex: computed.zIndex,
            opacity: computed.opacity,
          },
        };
      })
    );
    result.css = styles;
  }

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}
