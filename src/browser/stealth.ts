/**
 * Manual stealth implementation — replaces playwright-extra + stealth plugin.
 * Works with bun build --compile without dependency issues.
 */
import type { BrowserContext, Page } from "playwright";

// Real Chrome User-Agents
export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

export const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1680, height: 1050 },
];

export function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Apply stealth scripts to a page — hides headless Chrome indicators.
 */
export async function applyStealthScripts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // 1. navigator.webdriver = false
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // 2. Chrome runtime object
    if (!(window as any).chrome) {
      const chrome = {
        runtime: {
          onConnect: { addListener: () => {}, removeListener: () => {} },
          onMessage: { addListener: () => {}, removeListener: () => {} },
          connect: () => {},
          sendMessage: () => {},
        },
        loadTimes: () => ({}),
        csi: () => ({}),
      };
      Object.defineProperty(window, "chrome", { get: () => chrome, configurable: true });
    }

    // 3. Realistic plugins array
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        plugins.length = 3;
        return plugins;
      },
    });

    // 4. Languages
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });

    // 5. Hardware concurrency
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });

    // 6. Device memory
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });

    // 7. Permissions query override
    const origQuery = window.Permissions?.prototype?.query;
    if (origQuery) {
      window.Permissions.prototype.query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : origQuery.call(navigator.permissions, parameters);
    }

    // 8. WebGL vendor/renderer
    const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      if (param === 37445) return "Intel Inc."; // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER_WEBGL
      return getParameterOrig.call(this, param);
    };

    // 9. Notification permission
    if (Notification.permission === "denied") {
      Object.defineProperty(Notification, "permission", { get: () => "default" });
    }

    // 10. Connection rtt
    if ((navigator as any).connection) {
      Object.defineProperty((navigator as any).connection, "rtt", { get: () => 50 });
    }
  });
}

/**
 * Create stealth context options for browser.newContext()
 */
export function stealthContextOptions() {
  return {
    viewport: randomFrom(VIEWPORTS),
    userAgent: randomFrom(USER_AGENTS),
    locale: "en-US",
    timezoneId: "America/New_York",
    permissions: [] as string[],
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
  };
}
