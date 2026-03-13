import { launchBrowser, openPage, closeBrowser, type LaunchOptions } from "../browser/launch.js";
import { daemonRequest } from "../daemon/client.js";

export interface SearchOptions extends LaunchOptions {
  max?: number;
  engine?: "auto" | "duckduckgo" | "startpage";
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface EngineConfig {
  name: string;
  buildUrl: (query: string) => string;
  parseResults: string; // JS to evaluate in page
}

const ENGINES: EngineConfig[] = [
  {
    name: "duckduckgo",
    buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    parseResults: `
      [...document.querySelectorAll('article')].map(el => {
        const titleEl = el.querySelector('[data-testid="result-title-a"]');
        const spans = [...el.querySelectorAll('span')].filter(s => s.textContent.length > 30);
        return {
          title: titleEl?.textContent?.trim() || '',
          url: titleEl?.href || '',
          snippet: spans[spans.length-1]?.textContent?.trim() || '',
        };
      }).filter(r => r.title && r.url)
    `,
  },
  {
    name: "startpage",
    buildUrl: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
    parseResults: `
      [...document.querySelectorAll('.result')].map(el => ({
        title: el.querySelector('h2, h3')?.textContent?.trim() || '',
        url: el.querySelector('a')?.href || '',
        snippet: el.querySelector('p')?.textContent?.trim() || '',
      })).filter(r => r.title && r.url && !r.url.includes('startpage.com'))
    `,
  },
];

function getEngines(engine: string): EngineConfig[] {
  if (engine === "duckduckgo") return [ENGINES[0]];
  if (engine === "startpage") return [ENGINES[1]];
  // auto: try in order
  return ENGINES;
}

export async function search(query: string, opts: SearchOptions = {}) {
  const max = opts.max ?? 10;
  const engines = getEngines(opts.engine ?? "auto");

  // Try daemon first
  for (const engine of engines) {
    const daemonResult = await daemonRequest("/exec", {
      url: engine.buildUrl(query),
      js: engine.parseResults,
      timeout: opts.timeout ?? 15000,
    }, (opts.timeout ?? 15000) + 5000);

    if (daemonResult && !daemonResult.error && Array.isArray(daemonResult.value) && daemonResult.value.length > 0) {
      const results = daemonResult.value.slice(0, max);
      outputResults(results, engine.name, query);
      return;
    }
  }

  // Fallback: direct browser
  const handle = await launchBrowser(opts);
  try {
    for (const engine of engines) {
      try {
        const { context, page } = await openPage(handle, engine.buildUrl(query), {
          ...opts,
          timeout: opts.timeout ?? 15000,
        });

        const results: SearchResult[] = await page.evaluate(engine.parseResults);
        await context.close();

        if (results.length > 0) {
          outputResults(results.slice(0, max), engine.name, query);
          return;
        }
      } catch {
        // Engine failed, try next
        continue;
      }
    }

    // All engines failed
    console.error(JSON.stringify({ error: "all search engines failed or returned no results", query }));
    process.exit(1);
  } finally {
    await closeBrowser(handle);
  }
}

function outputResults(results: SearchResult[], engine: string, query: string) {
  console.log(JSON.stringify({
    query,
    engine,
    count: results.length,
    results: results.map((r, i) => ({
      rank: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.snippet.slice(0, 300),
    })),
  }, null, 2));
}
