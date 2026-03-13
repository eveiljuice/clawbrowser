import { launchBrowser, openPage, closeBrowser, type LaunchOptions } from "../browser/launch.js";
import { daemonRequest } from "../daemon/client.js";

export interface SearchOptions extends LaunchOptions {
  max?: number;
  engine?: "auto" | "duckduckgo" | "startpage";
  type?: "web" | "images" | "videos" | "all";
}

// ---- Engine configs per search type ----

interface EngineConfig {
  name: string;
  buildUrl: (query: string) => string;
  parseResults: string;
}

// WEB
const WEB_ENGINES: EngineConfig[] = [
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

// IMAGES
const IMAGE_ENGINES: EngineConfig[] = [
  {
    name: "duckduckgo",
    buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
    parseResults: `
      [...document.querySelectorAll('img')]
        .filter(i => i.src.includes('external-content.duckduckgo.com') && !i.src.includes('.ico') && (i.naturalWidth > 60 || i.width > 60))
        .map(i => {
          const srcUrl = new URL(i.src);
          const originalUrl = decodeURIComponent(srcUrl.searchParams.get('u') || i.src);
          return {
            title: i.alt || '',
            thumbnail: i.src,
            source: originalUrl,
            width: i.naturalWidth || i.width,
            height: i.naturalHeight || i.height,
          };
        })
        .filter(r => r.title)
    `,
  },
];

// VIDEOS
const VIDEO_ENGINES: EngineConfig[] = [
  {
    name: "duckduckgo",
    buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=videos&ia=videos`,
    parseResults: `
      [...document.querySelectorAll('a')]
        .filter(a => {
          const h = a.href || '';
          return (h.includes('youtube.com/watch') || h.includes('youtu.be') || 
                  h.includes('vimeo.com') || h.includes('dailymotion.com') ||
                  h.includes('vk.com/video') || h.includes('rutube.ru')) &&
                 a.textContent.trim().length > 5;
        })
        .map(a => {
          const text = a.textContent.trim();
          // Parse duration and views from text like "15:46Title here15M viewsYouTube"
          const durationMatch = text.match(/^(\\d+:\\d+(?::\\d+)?)/);
          const viewsMatch = text.match(/(\\d+(?:\\.\\d+)?[KMB]?)\\s*views/i);
          const platformMatch = text.match(/(YouTube|Vimeo|DailyMotion|VK|RuTube)$/i);
          
          let title = text;
          if (durationMatch) title = title.replace(durationMatch[0], '').trim();
          if (viewsMatch) title = title.replace(viewsMatch[0], '').trim();
          if (platformMatch) title = title.replace(platformMatch[0], '').trim();
          // Clean remaining view count artifacts
          title = title.replace(/\\d+(?:\\.\\d+)?[KMB]?\\s*$/, '').trim();
          
          return {
            title,
            url: a.href,
            duration: durationMatch?.[1] || '',
            views: viewsMatch?.[1] ? viewsMatch[1] + ' views' : '',
            platform: platformMatch?.[1] || new URL(a.href).hostname.replace('www.', ''),
            thumbnail: a.querySelector('img')?.src || '',
          };
        })
        .filter((v, i, arr) => v.title && arr.findIndex(x => x.url === v.url) === i)
    `,
  },
];

function getEngines(type: string, engine: string): EngineConfig[] {
  let pool: EngineConfig[];
  switch (type) {
    case "images": pool = IMAGE_ENGINES; break;
    case "videos": pool = VIDEO_ENGINES; break;
    default: pool = WEB_ENGINES; break;
  }
  if (engine !== "auto") {
    const found = pool.filter(e => e.name === engine);
    if (found.length > 0) return found;
  }
  return pool;
}

export async function search(query: string, opts: SearchOptions = {}) {
  const max = opts.max ?? 10;
  const type = opts.type ?? "web";

  // --type all: run web + images + videos, merge results
  if (type === "all") {
    const allResults: Record<string, any> = { query, type: "all" };

    for (const t of ["web", "images", "videos"] as const) {
      try {
        // Capture output by temporarily redirecting
        const captured: any[] = [];
        const origLog = console.log;
        console.log = (data: string) => {
          try { captured.push(JSON.parse(data)); } catch {}
        };
        await search(query, { ...opts, type: t, max: Math.min(max, t === "web" ? max : 5) });
        console.log = origLog;

        if (captured[0]) {
          allResults[t] = captured[0].results;
        }
      } catch {
        allResults[t] = [];
      }
    }

    console.log(JSON.stringify(allResults, null, 2));
    return;
  }

  const engines = getEngines(type, opts.engine ?? "auto");

  // Try daemon first
  for (const engine of engines) {
    const daemonResult = await daemonRequest("/exec", {
      url: engine.buildUrl(query),
      js: engine.parseResults,
      timeout: opts.timeout ?? 15000,
    }, (opts.timeout ?? 15000) + 5000);

    if (daemonResult && !daemonResult.error && Array.isArray(daemonResult.value) && daemonResult.value.length > 0) {
      outputResults(daemonResult.value.slice(0, max), engine.name, query, type);
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

        const results = await page.evaluate(engine.parseResults);
        await context.close();

        if (Array.isArray(results) && results.length > 0) {
          outputResults(results.slice(0, max), engine.name, query, type);
          return;
        }
      } catch {
        continue;
      }
    }

    console.error(JSON.stringify({ error: "all search engines failed", query, type }));
    process.exit(1);
  } finally {
    await closeBrowser(handle);
  }
}

function outputResults(results: any[], engine: string, query: string, type: string) {
  console.log(JSON.stringify({
    query,
    type,
    engine,
    count: results.length,
    results: results.map((r, i) => ({ rank: i + 1, ...r })),
  }, null, 2));
}
