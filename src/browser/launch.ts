import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

export interface LaunchOptions {
  proxy?: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  headless?: boolean;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
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
  const context = await browser.newContext({
    viewport: opts.viewport ?? DEFAULT_VIEWPORT,
    userAgent: opts.userAgent,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout ?? DEFAULT_TIMEOUT);

  await page.goto(url, { waitUntil: "networkidle" });

  return { context, page };
}
