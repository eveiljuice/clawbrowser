import { chromium } from "playwright";
import type { Page, BrowserContext, Browser } from "playwright";
import { applyStealthScripts, stealthContextOptions } from "../browser/stealth.js";
import * as readline from "readline";
import { extractReadable } from "../extract/readability.js";
import { htmlToMarkdown } from "../extract/markdown.js";

export interface SessionOptions {
  proxy?: string;
  timeout?: number;
}

const HELP = `
Commands:
  nav <url>                Navigate to URL
  back / forward / reload  Navigation
  fill <selector> <value>  Fill input field
  click <selector>         Click element
  type <selector> <text>   Type text into element
  select <selector> <val>  Select option
  extract [--format md]    Extract page content (md|json|text)
  dom [selector]           DOM inspection
  js <expression>          Evaluate JavaScript
  screenshot [file]        Save screenshot (default: screenshot.png)
  cookies                  Show cookies
  cookies save <file>      Save cookies to JSON file
  cookies load <file>      Load cookies from JSON file
  storage                  Show localStorage + sessionStorage
  network on/off           Toggle network logging
  console on/off           Toggle console logging
  url                      Show current URL
  title                    Show page title
  help                     Show this help
  quit / exit              Exit session
`.trim();

export async function session(startUrl: string | undefined, opts: SessionOptions = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  const context = await browser.newContext(stealthContextOptions());
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout ?? 30_000);
  await applyStealthScripts(page);

  let networkLogging = false;
  let consoleLogging = false;

  page.on("request", (req) => {
    if (networkLogging) {
      process.stderr.write(`  → ${req.method()} ${req.url().slice(0, 120)}\n`);
    }
  });

  page.on("console", (msg) => {
    if (consoleLogging) {
      process.stderr.write(`  [${msg.type()}] ${msg.text().slice(0, 200)}\n`);
    }
  });

  if (startUrl) {
    await page.goto(startUrl, { waitUntil: "networkidle" });
    console.log(`[session] loaded ${page.url()}`);
  } else {
    console.log("[session] started (no URL — use 'nav <url>' to navigate)");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    const host = page.url() !== "about:blank" ? new URL(page.url()).hostname : "blank";
    rl.question(`[${host}]> `, async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return prompt();

      const [cmd, ...args] = trimmed.split(/\s+/);

      try {
        switch (cmd) {
          case "nav":
          case "goto":
          case "go":
            await page.goto(args.join(" "), { waitUntil: "networkidle" });
            console.log(`→ ${page.url()}`);
            break;

          case "back":
            await page.goBack();
            console.log(`→ ${page.url()}`);
            break;

          case "forward":
            await page.goForward();
            console.log(`→ ${page.url()}`);
            break;

          case "reload":
            await page.reload();
            console.log("reloaded");
            break;

          case "fill":
            await page.fill(args[0], args.slice(1).join(" "));
            console.log("ok");
            break;

          case "click":
            await page.click(args.join(" "));
            console.log("ok");
            break;

          case "type":
            await page.type(args[0], args.slice(1).join(" "));
            console.log("ok");
            break;

          case "select":
            await page.selectOption(args[0], args[1]);
            console.log("ok");
            break;

          case "extract": {
            const format = args.includes("--format") ? args[args.indexOf("--format") + 1] : "md";
            const html = await page.content();
            const article = extractReadable(html, page.url());
            if (format === "json") {
              console.log(JSON.stringify(article, null, 2));
            } else if (format === "text") {
              console.log(article?.textContent ?? "");
            } else {
              const md = article ? htmlToMarkdown(article.content) : htmlToMarkdown(html);
              console.log(article ? `# ${article.title}\n\n${md}` : md);
            }
            break;
          }

          case "dom": {
            const sel = args[0];
            if (sel) {
              const elements = await page.$$eval(sel, (els) =>
                els.map((el) => ({
                  tag: el.tagName.toLowerCase(),
                  id: el.id || undefined,
                  class: el.className || undefined,
                  text: el.textContent?.slice(0, 150)?.trim(),
                }))
              );
              console.log(JSON.stringify(elements, null, 2));
            } else {
              const overview = await page.evaluate(() => ({
                title: document.title,
                headings: Array.from(document.querySelectorAll("h1,h2,h3")).map((h) =>
                  `${h.tagName}: ${h.textContent?.trim().slice(0, 80)}`
                ),
                forms: document.querySelectorAll("form").length,
                links: document.querySelectorAll("a").length,
                inputs: document.querySelectorAll("input,select,textarea").length,
              }));
              console.log(JSON.stringify(overview, null, 2));
            }
            break;
          }

          case "js":
          case "eval": {
            const expr = args.join(" ");
            const result = await page.evaluate(expr);
            console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
            break;
          }

          case "screenshot": {
            const path = args[0] || "screenshot.png";
            await page.screenshot({ path, fullPage: true });
            console.log(`saved → ${path}`);
            break;
          }

          case "cookies":
            if (args[0] === "save") {
              const cookies = await context.cookies();
              await Bun.write(args[1], JSON.stringify(cookies, null, 2));
              console.log(`saved ${cookies.length} cookies → ${args[1]}`);
            } else if (args[0] === "load") {
              const data = await Bun.file(args[1]).json();
              await context.addCookies(data);
              console.log(`loaded cookies from ${args[1]}`);
            } else {
              const cookies = await context.cookies();
              console.log(JSON.stringify(cookies.map((c) => ({ name: c.name, domain: c.domain, value: c.value.slice(0, 50) })), null, 2));
            }
            break;

          case "storage": {
            const s = await page.evaluate(() => {
              const ls: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i)!;
                ls[k] = localStorage.getItem(k)?.slice(0, 200) ?? "";
              }
              return { localStorage: ls, localStorageCount: localStorage.length };
            });
            console.log(JSON.stringify(s, null, 2));
            break;
          }

          case "network":
            networkLogging = args[0] === "on";
            console.log(`network logging ${networkLogging ? "ON" : "OFF"}`);
            break;

          case "console":
            consoleLogging = args[0] === "on";
            console.log(`console logging ${consoleLogging ? "ON" : "OFF"}`);
            break;

          case "url":
            console.log(page.url());
            break;

          case "title":
            console.log(await page.title());
            break;

          case "help":
            console.log(HELP);
            break;

          case "quit":
          case "exit":
            await browser.close();
            rl.close();
            return;

          default:
            console.log(`unknown command: ${cmd}. Type 'help' for available commands.`);
        }
      } catch (err: any) {
        console.error(`error: ${err.message}`);
      }

      prompt();
    });
  };

  prompt();
}
