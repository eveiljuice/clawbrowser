import { launchBrowser, openPage, closeBrowser, type LaunchOptions } from "../browser/launch.js";
import { extractReadable } from "../extract/readability.js";
import { htmlToMarkdown } from "../extract/markdown.js";
import { daemonRequest } from "../daemon/client.js";

export interface SummarizeOptions extends LaunchOptions {
  format?: "md" | "json" | "text";
  selector?: string;
  waitFor?: string;
  maxLength?: number;
}

export async function summarize(url: string, opts: SummarizeOptions = {}) {
  const maxLen = opts.maxLength ?? 4000;

  // Get HTML — try daemon first
  let html: string;
  let pageUrl = url;
  let pageTitle = "";

  const daemonResult = await daemonRequest("/get", {
    url, selector: opts.selector, waitFor: opts.waitFor, timeout: opts.timeout,
  }, (opts.timeout ?? 30000) + 5000);

  if (daemonResult && !daemonResult.error) {
    html = daemonResult.html;
    pageUrl = daemonResult.url || url;
    pageTitle = daemonResult.title || "";
  } else {
    const handle = await launchBrowser(opts);
    try {
      const { context, page } = await openPage(handle, url, opts);
      if (opts.waitFor) await page.waitForSelector(opts.waitFor);
      html = opts.selector
        ? await page.$(opts.selector).then(el => el?.innerHTML() ?? "")
        : await page.content();
      pageUrl = page.url();
      pageTitle = await page.title();
      await context.close();
    } finally {
      await closeBrowser(handle);
    }
  }

  // Extract readable content
  const article = extractReadable(html, pageUrl);
  const content = article?.textContent ?? html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const title = article?.title ?? pageTitle;

  // Build summary from extracted content
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 500);

  // Extract key info
  const wordCount = content.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / 200); // ~200 wpm

  // Key sentences — first, some from middle, last
  const keySentences: string[] = [];
  if (sentences.length <= 5) {
    keySentences.push(...sentences);
  } else {
    // First 2
    keySentences.push(sentences[0], sentences[1]);
    // Middle samples
    const mid = Math.floor(sentences.length / 2);
    keySentences.push(sentences[mid - 1], sentences[mid]);
    // Last
    keySentences.push(sentences[sentences.length - 1]);
  }

  // Headings as structure
  const headings = (article?.content ?? html)
    .match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi)
    ?.map(h => h.replace(/<[^>]*>/g, "").trim())
    .filter(h => h.length > 0)
    .slice(0, 15) ?? [];

  // Truncated full text
  const truncatedContent = content.slice(0, maxLen) + (content.length > maxLen ? "…" : "");

  const format = opts.format ?? "md";

  switch (format) {
    case "md": {
      let out = `# ${title}\n\n`;
      out += `> **Source:** ${pageUrl}\n`;
      out += `> **Words:** ${wordCount} (~${readingTime} min read)\n\n`;

      if (headings.length > 0) {
        out += `## Structure\n\n`;
        out += headings.map(h => `- ${h}`).join("\n") + "\n\n";
      }

      out += `## Key Points\n\n`;
      out += keySentences.map(s => `- ${s}`).join("\n") + "\n\n";

      out += `## Content\n\n`;
      out += truncatedContent + "\n";

      console.log(out);
      break;
    }
    case "json": {
      console.log(JSON.stringify({
        url: pageUrl,
        title,
        wordCount,
        readingTime,
        headings,
        keyPoints: keySentences,
        content: truncatedContent,
        excerpt: article?.excerpt ?? keySentences[0] ?? "",
      }, null, 2));
      break;
    }
    case "text": {
      console.log(`${title}\n${pageUrl}\n${wordCount} words (~${readingTime} min)\n`);
      console.log(`Key points:`);
      keySentences.forEach(s => console.log(`• ${s}`));
      console.log(`\n${truncatedContent}`);
      break;
    }
  }
}
