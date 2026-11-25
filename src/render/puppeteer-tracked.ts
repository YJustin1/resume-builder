// The module `resumed.pdf` loads Puppeteer from (its `moduleName` option).
// `resumed.pdf` closes the browser only when printing succeeds, so a failure
// (e.g. a navigation timeout on a network that black-holes the font request)
// would leave Chrome running until the server exits. This wrapper calls the
// real `puppeteer.launch`, records each browser in the current print session
// so the adapter can close it in a `finally`, and applies the session's
// timeout to launch and to every page (D20).

import { AsyncLocalStorage } from 'node:async_hooks';
import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer';

export interface PrintSession {
  timeoutMs: number;
  browsers: Browser[];
}

// `resumed` imports this file natively, while test runners may load the
// adapter through their own module graph. One process-wide store keeps both
// copies on the same sessions.
const KEY = Symbol.for('reusable-resume-builder.print-sessions');
const store = globalThis as unknown as Record<symbol, AsyncLocalStorage<PrintSession> | undefined>;
export const printSessions: AsyncLocalStorage<PrintSession> = (store[KEY] ??= new AsyncLocalStorage<PrintSession>());

export async function launch(options: LaunchOptions = {}): Promise<Browser> {
  const session = printSessions.getStore();
  // `timeout` bounds the launch; `protocolTimeout` bounds every CDP call, including
  // resumed's `page.evaluate(() => document.fonts.ready)`, which no page timeout covers.
  const browser = await puppeteer.launch(
    session ? { timeout: session.timeoutMs, protocolTimeout: session.timeoutMs, ...options } : options,
  );
  if (!session) return browser;
  session.browsers.push(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args: Parameters<Browser['newPage']>) => {
    const page = await newPage(...args);
    page.setDefaultTimeout(session.timeoutMs); // setContent, fonts wait and pdf
    return page;
  };
  return browser;
}
