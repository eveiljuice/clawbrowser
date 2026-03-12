import { launchBrowser, openPage, closeBrowser, type LaunchOptions } from "../browser/launch.js";
import { daemonRequest } from "../daemon/client.js";

export interface ExecOptions extends LaunchOptions {
  waitFor?: string;
}

export async function exec(url: string, js: string, opts: ExecOptions = {}) {
  // Try daemon first
  const daemonResult = await daemonRequest("/exec", {
    url, js, waitFor: opts.waitFor, timeout: opts.timeout,
  }, (opts.timeout ?? 30000) + 5000);

  if (daemonResult && !daemonResult.error) {
    const val = daemonResult.value;
    if (val === undefined || val === null) return;
    console.log(typeof val === "object" ? JSON.stringify(val, null, 2) : String(val));
    return;
  }

  // Fallback
  const handle = await launchBrowser(opts);
  try {
    const { context, page } = await openPage(handle, url, opts);
    if (opts.waitFor) await page.waitForSelector(opts.waitFor);

    const result = await page.evaluate(js);
    if (result === undefined || result === null) return;
    console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
    await context.close();
  } finally {
    await closeBrowser(handle);
  }
}
