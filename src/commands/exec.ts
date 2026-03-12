import { launchBrowser, openPage, type LaunchOptions } from "../browser/launch.js";

export interface ExecOptions extends LaunchOptions {
  waitFor?: string;
}

export async function exec(url: string, js: string, opts: ExecOptions = {}) {
  const browser = await launchBrowser(opts);

  try {
    const { page } = await openPage(browser, url, opts);

    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor);
    }

    const result = await page.evaluate(js);

    if (result === undefined || result === null) {
      // No output
    } else if (typeof result === "object") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(String(result));
    }
  } finally {
    await browser.close();
  }
}
