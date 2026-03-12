import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, BrowserContext } from "playwright";

// Stealth plugin — 11 evasion techniques:
// navigator.webdriver, chrome.runtime, permissions, WebGL fingerprint,
// plugins/mimeTypes, languages, iframe.contentWindow, etc.
chromium.use(StealthPlugin());

export interface LaunchOptions {
  proxy?: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  headless?: boolean;
  stealth?: boolean;  // default: true
}

// Real Chrome User-Agents (rotated randomly)
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
];

// Realistic viewport sizes (common desktop resolutions)
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1680, height: 1050 },
  { width: 2560, height: 1440 },
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const DEFAULT_TIMEOUT = 30_000;

export async function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  const launchOpts: any = {
    headless: opts.headless ?? true,
  };

  if (opts.proxy) {
    launchOpts.proxy = { server: opts.proxy };
  }

  return chromium.launch(launchOpts);
}

export async function openPage(
  browser: Browser,
  url: string,
  opts: LaunchOptions = {}
): Promise<{ context: BrowserContext; page: Page }> {
  const useStealth = opts.stealth !== false;

  const contextOpts: any = {
    viewport: opts.viewport ?? (useStealth ? randomFrom(VIEWPORTS) : { width: 1280, height: 720 }),
    userAgent: opts.userAgent ?? (useStealth ? randomFrom(USER_AGENTS) : undefined),
  };

  if (useStealth) {
    contextOpts.locale = "en-US";
    contextOpts.timezoneId = "America/New_York";
    contextOpts.geolocation = undefined;
    contextOpts.permissions = [];
    contextOpts.extraHTTPHeaders = {
      "Accept-Language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    };
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout ?? DEFAULT_TIMEOUT);

  if (useStealth) {
    // Additional stealth: override navigator properties via addInitScript
    await page.addInitScript(() => {
      // Ensure webdriver is false
      Object.defineProperty(navigator, "webdriver", { get: () => false });

      // Chrome object
      if (!(window as any).chrome) {
        (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
      }

      // Realistic plugins
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });

      // Realistic hardware concurrency
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 8,
      });

      // Device memory
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8,
      });

      // Permissions query override
      const origQuery = window.Permissions?.prototype?.query;
      if (origQuery) {
        window.Permissions.prototype.query = (parameters: any) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : origQuery.call(window.navigator.permissions, parameters);
      }
    });
  }

  // Navigate with smart fallback
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeout ?? DEFAULT_TIMEOUT });
  } catch (e: any) {
    if (e.message?.includes("Timeout")) {
      // Fallback: if networkidle times out, try domcontentloaded + extra wait
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeout ?? DEFAULT_TIMEOUT });
        await page.waitForTimeout(3000); // give SPA time to render
      } catch {
        // If even domcontentloaded fails, throw original error
        throw e;
      }
    } else {
      throw e;
    }
  }

  return { context, page };
}
