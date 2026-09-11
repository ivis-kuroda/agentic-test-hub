import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import type {
  BrowserDriver,
  BrowserSession,
  ConsoleMessage,
  NetworkExchange,
} from "../executor/browser.ts";

/** Settings for the browser this driver opens. */
export interface PlaywrightOptions {
  /** Run without a visible window. On by default; off is for debugging. */
  readonly headless?: boolean;
  /** Path to a browser executable, when the bundled lookup is not wanted. */
  readonly executablePath?: string;
  /** A saved signed-in session to start from. */
  readonly storageState?: string;
  /** How long to wait for an element before giving up. */
  readonly defaultTimeoutMs?: number;
}

/**
 * A session backed by one Playwright page.
 *
 * Console output and network traffic are subscribed to before anything is
 * navigated to, and accumulated for the life of the session. That ordering
 * matters: a listener attached after the first navigation misses exactly the
 * errors a page throws while loading, which are the ones worth catching.
 */
class PlaywrightSession implements BrowserSession {
  private readonly page: Page;
  private readonly context: BrowserContext;
  private readonly browser: Browser;
  private readonly console: ConsoleMessage[] = [];
  private readonly network: NetworkExchange[] = [];

  constructor(browser: Browser, context: BrowserContext, page: Page) {
    this.browser = browser;
    this.context = context;
    this.page = page;

    page.on("console", (message) => {
      const type = message.type();
      const where = message.location();
      this.console.push({
        level:
          type === "error"
            ? "error"
            : type === "warning"
              ? "warn"
              : type === "info"
                ? "info"
                : "log",
        text: message.text(),
        ...(where.url === "" ? {} : { location: `${where.url}:${where.lineNumber}` }),
      });
    });

    // An uncaught exception never reaches the console listener, and it is the
    // single strongest signal that a page is broken.
    page.on("pageerror", (error) => {
      this.console.push({ level: "error", text: `uncaught: ${error.message}` });
    });

    page.on("response", (response) => {
      this.network.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    });

    page.on("requestfailed", (request) => {
      this.network.push({
        method: request.method(),
        url: request.url(),
        status: 0,
        failed: true,
      });
    });
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async select(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value);
  }

  async upload(selector: string, file: string): Promise<void> {
    await this.page.setInputFiles(selector, file);
  }

  async waitFor(selector: string, timeoutMs: number): Promise<void> {
    await this.page.waitForSelector(selector, { timeout: timeoutMs });
  }

  async textOf(selector: string): Promise<string | null> {
    return this.page.textContent(selector);
  }

  async screenshot(): Promise<Uint8Array> {
    return this.page.screenshot({ fullPage: true });
  }

  consoleMessages(): readonly ConsoleMessage[] {
    return this.console;
  }

  networkExchanges(): readonly NetworkExchange[] {
    return this.network;
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }
}

/**
 * Opens real browser sessions through Playwright.
 *
 * This is the only place in the hub that knows Playwright exists. Everything
 * else works against {@link BrowserDriver}, so the hub's own tests run
 * without a browser and a different automation tool would be a second
 * implementation of one small interface.
 */
export class PlaywrightDriver implements BrowserDriver {
  private readonly options: PlaywrightOptions;

  constructor(options: PlaywrightOptions = {}) {
    this.options = options;
  }

  async open(baseUrl: string): Promise<BrowserSession> {
    const browser = await chromium.launch({
      headless: this.options.headless ?? true,
      ...(this.options.executablePath === undefined
        ? {}
        : { executablePath: this.options.executablePath }),
    });
    const context = await browser.newContext({
      baseURL: baseUrl,
      ...(this.options.storageState === undefined
        ? {}
        : { storageState: this.options.storageState }),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(this.options.defaultTimeoutMs ?? 10_000);
    return new PlaywrightSession(browser, context, page);
  }
}
