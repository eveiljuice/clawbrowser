import { chromium } from "playwright";
import type { Browser, Page, BrowserContext } from "playwright";
import { connectOrLaunch, type DaemonConnection } from "../daemon/client.js";
import { applyStealthScripts, stealthContextOptions } from "./stealth.js";

export interface LaunchOptions {
  proxy?: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  headless?: boolean;
  stealth?: boolean;
}

const DEFAULT_TIMEOUT = 30_000;

export interface BrowserHandle {
  browser: Browser;
  isDaemon: boolean;
}

export async function launchBrowser(opts: LaunchOptions = {}): Promise<BrowserHandle> {
  const conn = await connectOrLaunch({
    proxy: opts.proxy,
    headless: opts.headless,
  });
  return { browser: conn.browser, isDaemon: conn.isDaemon };
}

export async function closeBrowser(handle: BrowserHandle) {
  if (!handle.isDaemon) {
    await handle.browser.close();
  }
}

export async function openPage(
  handle: BrowserHandle,
  url: string,
  opts: LaunchOptions = {}
): Promise<{ context: BrowserContext; page: Page }> {
  const useStealth = opts.stealth !== false;

  const contextOpts: any = useStealth
    ? stealthContextOptions()
    : { viewport: { width: 1280, height: 720 } };

  // Allow overrides
  if (opts.viewport) contextOpts.viewport = opts.viewport;
  if (opts.userAgent) contextOpts.userAgent = opts.userAgent;

  const context = await handle.browser.newContext(contextOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout ?? DEFAULT_TIMEOUT);

  if (useStealth) {
    await applyStealthScripts(page);
  }

  // Navigate with smart fallback
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeout ?? DEFAULT_TIMEOUT });
  } catch (e: any) {
    if (e.message?.includes("Timeout")) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeout ?? DEFAULT_TIMEOUT });
        await page.waitForTimeout(3000);
      } catch {
        throw e;
      }
    } else {
      throw e;
    }
  }

  return { context, page };
}
