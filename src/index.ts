#!/usr/bin/env bun
import { Command } from "commander";
import { get } from "./commands/get.js";
import { exec } from "./commands/exec.js";
import { inspect } from "./commands/inspect.js";
import { session } from "./commands/session.js";

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

// Default: show help
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
