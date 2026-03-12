import { launchBrowser, openPage, closeBrowser, type LaunchOptions } from "../browser/launch.js";
import { extractReadable } from "../extract/readability.js";
import { htmlToMarkdown } from "../extract/markdown.js";
import { daemonRequest } from "../daemon/client.js";

export interface GetOptions extends LaunchOptions {
  format?: "md" | "json" | "html" | "text";
  selector?: string;
  waitFor?: string;
}

export async function get(url: string, opts: GetOptions = {}) {
  const format = opts.format ?? "md";

  // Try daemon first
  const daemonResult = await daemonRequest("/get", {
    url, selector: opts.selector, waitFor: opts.waitFor, timeout: opts.timeout,
  }, (opts.timeout ?? 30000) + 5000);

  if (daemonResult && !daemonResult.error) {
    outputResult(daemonResult.html, daemonResult.url || url, daemonResult.title, format);
    return;
  }

  // Fallback: launch browser directly
  const handle = await launchBrowser(opts);
  try {
    const { context, page } = await openPage(handle, url, opts);
    if (opts.waitFor) await page.waitForSelector(opts.waitFor);

    const html = opts.selector
      ? await page.$(opts.selector).then(el => el?.innerHTML() ?? "")
      : await page.content();

    outputResult(html, page.url(), await page.title(), format);
    await context.close();
  } finally {
    await closeBrowser(handle);
  }
}

function outputResult(html: string, url: string, title: string, format: string) {
  const article = extractReadable(html, url);

  switch (format) {
    case "md": {
      if (article) {
        console.log(`# ${article.title}\n\n${htmlToMarkdown(article.content)}`);
      } else {
        console.log(htmlToMarkdown(html));
      }
      break;
    }
    case "json": {
      const result = article
        ? { url, title: article.title, excerpt: article.excerpt, content: htmlToMarkdown(article.content), length: article.length }
        : { url, content: htmlToMarkdown(html) };
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "html": {
      console.log(article?.content ?? html);
      break;
    }
    case "text": {
      console.log(article?.textContent ?? html.replace(/<[^>]*>/g, ""));
      break;
    }
  }
}
