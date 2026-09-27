import fs from 'node:fs';
import type { BrowserContext, Page } from 'playwright-core';
import type { AppConfig } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * The automation browser: your installed Chrome (or Edge/Chromium) with its
 * own profile folder, visible on screen. You log in to LinkedIn / Naukri /
 * Indeed in it once; the app never sees or stores those passwords.
 *
 * Only one automation task drives the browser at a time (exclusive()),
 * and pages the automation leaves open (CAPTCHA, a question it could not
 * answer, a login wall) stay open for you to finish.
 */
export class BrowserManager {
  private ctx: BrowserContext | null = null;
  private starting: Promise<BrowserContext> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastError: string | null = null;

  constructor(private cfg: AppConfig['automation']) {}

  status() {
    return { available: this.lastError === null || !!this.ctx, open: !!this.ctx, channel: this.cfg.browserChannel, error: this.ctx ? null : this.lastError };
  }

  async context(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx;
    if (!this.starting) {
      this.starting = (async () => {
        const { chromium } = await import('playwright-core');
        fs.mkdirSync(this.cfg.browserProfileDir, { recursive: true });
        try {
          const ctx = await chromium.launchPersistentContext(this.cfg.browserProfileDir, {
            channel: this.cfg.browserChannel === 'chromium' ? undefined : this.cfg.browserChannel,
            headless: this.cfg.headless,
            viewport: null,
            acceptDownloads: false,
            args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check', '--start-maximized'],
          });
          ctx.on('close', () => {
            this.ctx = null;
          });
          this.ctx = ctx;
          this.lastError = null;
          logger.info('browser.started', { channel: this.cfg.browserChannel });
          return ctx;
        } catch (e) {
          this.lastError = /Executable doesn't exist|not found|ENOENT|channel/i.test(String((e as Error).message))
            ? `Could not start ${this.cfg.browserChannel}. Install Google Chrome or set BROWSER_CHANNEL=msedge in .env.`
            : `Could not start the automation browser: ${String((e as Error).message).split('\n')[0].slice(0, 200)}`;
          throw new Error(this.lastError);
        } finally {
          this.starting = null;
        }
      })();
    }
    return this.starting;
  }

  /** Runs `fn` with exclusive use of the browser (tasks queue up one after another). */
  exclusive<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
    const run = this.chain.then(
      () => this.context().then(fn),
      () => this.context().then(fn),
    );
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Opens a tab and navigates; the caller closes it (or leaves it open for you). */
  async newPage(ctx: BrowserContext, url: string): Promise<Page> {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    return page;
  }

  /** Reads a page with your logins (for sites that need JavaScript or a sign-in). */
  readPage(url: string): Promise<{ url: string; html: string; text: string } | null> {
    return this.exclusive(async (ctx) => {
      const page = await this.newPage(ctx, url);
      try {
        await page.waitForTimeout(1500);
        return { url: page.url(), html: await page.content(), text: await page.evaluate(() => document.body?.innerText || '') };
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }

  /** Opens a site so you can log in (Settings → Automation browser). The tab stays open. */
  async openForLogin(url: string): Promise<void> {
    const ctx = await this.context();
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    await page.bringToFront().catch(() => undefined);
  }

  async close(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    await ctx?.close().catch(() => undefined);
  }
}

/** Small random pause so actions are not machine-gun fast. */
export const humanPause = (min = 250, max = 800) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
