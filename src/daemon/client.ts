import { chromium } from "playwright";
import type { Browser } from "playwright";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";

const DAEMON_DIR = join(process.env.HOME || "/root", ".clawbrowser");
const DAEMON_FILE = join(DAEMON_DIR, "daemon.json");

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
}

export interface DaemonConnection {
  browser: Browser;
  isDaemon: boolean;
}

export function getDaemonInfo(): DaemonInfo | null {
  if (!existsSync(DAEMON_FILE)) return null;
  try {
    const info: DaemonInfo = JSON.parse(readFileSync(DAEMON_FILE, "utf-8"));
    try { process.kill(info.pid, 0); return info; }
    catch { try { unlinkSync(DAEMON_FILE); } catch {} return null; }
  } catch { return null; }
}

export async function daemonRequest(
  path: string,
  body: Record<string, any>,
  timeout = 60000
): Promise<any | null> {
  const info = getDaemonInfo();
  if (!info) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    return await res.json();
  } catch { return null; }
}

export async function connectOrLaunch(opts: {
  proxy?: string;
  headless?: boolean;
} = {}): Promise<DaemonConnection> {
  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
    ...(opts.proxy ? { proxy: { server: opts.proxy } } : {}),
  });
  return { browser, isDaemon: false };
}
