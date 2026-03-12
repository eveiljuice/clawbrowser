import { launchBrowser, openPage, type LaunchOptions } from "../browser/launch.js";
import { extractReadable } from "../extract/readability.js";
import { htmlToMarkdown } from "../extract/markdown.js";

export interface GetOptions extends LaunchOptions {
  format?: "md" | "json" | "html" | "text";
  selector?: string;
  waitFor?: string;
}

export async function get(url: string, opts: GetOptions = {}) {
  const browser = await launchBrowser(opts);

  try {
    const { page } = await openPage(browser, url, opts);

    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor);
    }

    let html: string;
    if (opts.selector) {
      const el = await page.$(opts.selector);
      html = el ? await el.innerHTML() : "";
    } else {
      html = await page.content();
    }

    const format = opts.format ?? "md";
    const article = extractReadable(html, url);

    switch (format) {
      case "md": {
        if (article) {
          const md = htmlToMarkdown(article.content);
          console.log(`# ${article.title}\n\n${md}`);
        } else {
          console.log(htmlToMarkdown(html));
        }
        break;
      }
      case "json": {
        const result = article
          ? {
              url,
              title: article.title,
              excerpt: article.excerpt,
              byline: article.byline,
              siteName: article.siteName,
              content: htmlToMarkdown(article.content),
              length: article.length,
            }
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
  } finally {
    await browser.close();
  }
}
