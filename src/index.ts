#!/usr/bin/env bun
import { Command } from "commander";
import { get } from "./commands/get.js";
import { exec } from "./commands/exec.js";
import { inspect } from "./commands/inspect.js";
import { session } from "./commands/session.js";
import { search } from "./commands/search.js";
import { summarize } from "./commands/summarize.js";

const program = new Command();

program
  .name("clawbrowser")
  .description("CLI browser for AI agents — curl for the modern web")
  .version("0.1.0");

// --- GET ---
program
  .command("get <url>")
  .description("Fetch page content (default: markdown)")
  .option("-f, --format <type>", "output format: md|json|html|text", "md")
  .option("-s, --selector <css>", "extract only matching selector")
  .option("-w, --wait-for <css>", "wait for selector before extracting")
  .option("-t, --timeout <ms>", "navigation timeout in ms", "30000")
  .option("--proxy <url>", "proxy server URL")
  .action(async (url, opts) => {
    await get(url, {
      format: opts.format,
      selector: opts.selector,
      waitFor: opts.waitFor,
      timeout: parseInt(opts.timeout),
      proxy: opts.proxy,
    });
  });

// --- EXEC ---
program
  .command("exec <url> <js>")
  .description("Execute JavaScript on page, print result")
  .option("-w, --wait-for <css>", "wait for selector before executing")
  .option("-t, --timeout <ms>", "navigation timeout in ms", "30000")
  .option("--proxy <url>", "proxy server URL")
  .action(async (url, js, opts) => {
    await exec(url, js, {
      waitFor: opts.waitFor,
      timeout: parseInt(opts.timeout),
      proxy: opts.proxy,
    });
  });

// --- INSPECT ---
program
  .command("inspect <url>")
  .description("DevTools inspection — DOM, network, console, storage, perf, a11y")
  .option("-d, --dom [selector]", "DOM tree overview or query selector")
  .option("-n, --network", "capture network requests")
  .option("-c, --console", "capture console output")
  .option("--storage", "dump cookies + localStorage + sessionStorage")
  .option("-p, --perf", "performance metrics and timing")
  .option("--a11y", "accessibility tree")
  .option("--headers", "response headers")
  .option("--css <selector>", "computed CSS styles for selector")
  .option("-a, --all", "capture everything")
  .option("-w, --wait-for <css>", "wait for selector")
  .option("-t, --timeout <ms>", "navigation timeout in ms", "30000")
  .option("--proxy <url>", "proxy server URL")
  .action(async (url, opts) => {
    // If no specific flag given, default to --all
    const hasFlag = opts.dom !== undefined || opts.network || opts.console ||
      opts.storage || opts.perf || opts.a11y || opts.headers || opts.css;

    await inspect(url, {
      dom: opts.dom,
      network: opts.network,
      console: opts.console,
      storage: opts.storage,
      perf: opts.perf,
      a11y: opts.a11y,
      headers: opts.headers,
      css: opts.css,
      all: !hasFlag || opts.all,
      waitFor: opts.waitFor,
      timeout: parseInt(opts.timeout),
      proxy: opts.proxy,
    });
  });

// --- SEARCH ---
program
  .command("search <query>")
  .description("Search the web — structured results, no API keys needed")
  .option("-m, --max <n>", "max results to return", "10")
  .option("-e, --engine <name>", "search engine: auto|duckduckgo|startpage", "auto")
  .option("-t, --timeout <ms>", "timeout per engine in ms", "15000")
  .option("--proxy <url>", "proxy server URL")
  .action(async (query, opts) => {
    await search(query, {
      max: parseInt(opts.max),
      engine: opts.engine,
      timeout: parseInt(opts.timeout),
      proxy: opts.proxy,
    });
  });

// --- SUMMARIZE ---
program
  .command("summarize <url>")
  .description("Extract and summarize page content — key points, structure, reading time")
  .option("-f, --format <type>", "output format: md|json|text", "md")
  .option("-s, --selector <css>", "extract only matching selector")
  .option("-w, --wait-for <css>", "wait for selector before extracting")
  .option("-l, --max-length <chars>", "max content length in chars", "4000")
  .option("-t, --timeout <ms>", "navigation timeout in ms", "30000")
  .option("--proxy <url>", "proxy server URL")
  .action(async (url, opts) => {
    await summarize(url, {
      format: opts.format,
      selector: opts.selector,
      waitFor: opts.waitFor,
      maxLength: parseInt(opts.maxLength),
      timeout: parseInt(opts.timeout),
      proxy: opts.proxy,
    });
  });

// --- SESSION ---
program
  .command("session [url]")
  .description("Interactive REPL — browse, fill forms, inspect, extract")
  .option("-t, --timeout <ms>", "default timeout in ms", "30000")
  .option("--proxy <url>", "proxy server URL")
  .action(async (url, opts) => {
    await session(url, {
      timeout: parseInt(opts.timeout),
      proxy: opts.proxy,
    });
  });

// --- DAEMON ---
const daemon = program
  .command("daemon")
  .description("Background Chrome daemon — 10x faster browsing");

daemon
  .command("start")
  .description("Start the daemon (Chrome stays alive in background)")
  .action(async () => {
    const { getDaemonInfo } = await import("./daemon/client.js");
    const existing = getDaemonInfo();
    if (existing) {
      console.log(`Daemon already running (PID ${existing.pid}, started ${existing.startedAt})`);
      process.exit(0);
    }

    const { spawn } = await import("child_process");
    // Use node (not bun) — Bun WebSocket doesn't work with Playwright CDP
    const child = spawn("node", [`${import.meta.dir}/daemon/server.ts`], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });

    child.unref();

    let started = false;
    child.stdout?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !started) {
        console.log(msg);
        started = true;
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg.includes("already running")) {
        console.log(msg);
        process.exit(0);
      }
    });

    await new Promise((r) => setTimeout(r, 4000));
    if (!started) {
      console.log("Daemon starting... (check 'clawbrowser daemon status')");
    }
  });

daemon
  .command("stop")
  .description("Stop the daemon")
  .action(async () => {
    const { getDaemonInfo, daemonRequest } = await import("./daemon/client.js");
    const info = getDaemonInfo();
    if (!info) {
      console.log("No daemon running");
      process.exit(0);
    }
    // Graceful stop via HTTP
    await daemonRequest("/stop", {}, 3000).catch(() => {});
    // Fallback: kill process
    try { process.kill(info.pid, "SIGTERM"); } catch {}
    console.log(`Daemon stopped (PID ${info.pid})`);
    const { unlinkSync } = await import("fs");
    const { join } = await import("path");
    try { unlinkSync(join(process.env.HOME || "/root", ".clawbrowser", "daemon.json")); } catch {}
  });

daemon
  .command("status")
  .description("Check daemon status")
  .action(async () => {
    const { getDaemonInfo, daemonRequest } = await import("./daemon/client.js");
    const info = getDaemonInfo();
    if (info) {
      const status = await daemonRequest("/status", {}, 3000).catch(() => null);
      // /status is GET but daemonRequest sends POST — use fetch directly
      let statusData: any = null;
      try {
        const res = await fetch(`http://127.0.0.1:${info.port}/status`, { signal: AbortSignal.timeout(2000) });
        statusData = await res.json();
      } catch {}

      console.log(`Daemon running (PID ${info.pid})`);
      console.log(`  Port: ${info.port}`);
      console.log(`  Started: ${info.startedAt}`);
      if (statusData) {
        console.log(`  Uptime: ${statusData.uptime}s`);
        console.log(`  Requests served: ${statusData.requests}`);
        console.log(`  Chrome: ${statusData.chrome}`);
      }
    } else {
      console.log("No daemon running");
    }
  });

// Default: show help
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
