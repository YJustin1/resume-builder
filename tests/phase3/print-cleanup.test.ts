// D20 regression: a print that fails must not leave Chrome running, and a
// black-holed network must fail within the print timeout. Real pipeline,
// through the HTTP API; the network is simulated with a local proxy that
// accepts connections and never answers (the font request hangs).

import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer';
import { resumedPrinter } from '../../src/render/adapter.ts';
import { dumpRows, freshLibrary } from '../support/harness.ts';
import { Api } from '../support/http.ts';
import { probeRenderer } from '../support/render.ts';

let server: Server;
let port: number;
const held: Socket[] = [];
const launched: Browser[] = [];

beforeAll(async () => {
  server = createServer(() => {}); // plain requests: never answered
  server.on('connect', (_req, socket: Socket) => held.push(socket)); // HTTPS tunnels: never answered
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  for (const s of held) s.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function exited(pid: number, withinMs = 5_000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < withinMs; await new Promise((r) => setTimeout(r, 100))) {
    if (!alive(pid)) return true;
  }
  return false;
}

afterEach(() => {
  // Never let a regression leak Chrome past the test (it would also keep vitest alive).
  for (const b of launched.splice(0)) {
    const pid = b.process()?.pid;
    if (pid !== undefined && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

describe('D20: Chrome is closed after every print, and a hung network fails fast', () => {
  it('black-holed font request: 500 RENDER_FAILED within the timeout, and the browser process is gone', async () => {
    const print = resumedPrinter({
      timeoutMs: 2_000,
      args: [`--proxy-server=127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'],
      onBrowser: (b) => launched.push(b),
    });
    const api = new Api(freshLibrary('primary.input.json'), probeRenderer({ base: { print } }));
    const before = dumpRows(api.lib.db);
    const started = Date.now();
    const res = await api.exportPdf('r-security');
    expect([res.status, res.code]).toEqual([500, 'RENDER_FAILED']);
    expect(Date.now() - started).toBeLessThan(10_000); // the 2 s timeout applied, not Puppeteer's 30 s
    expect(held.length).toBeGreaterThan(0); // the font request really went to the black hole
    expect(dumpRows(api.lib.db)).toEqual(before);
    expect(launched).toHaveLength(1);
    const pid = launched[0]!.process()!.pid!;
    expect(launched[0]!.connected).toBe(false);
    expect(await exited(pid)).toBe(true);
  }, 30_000);

  it('page loads but the font wait never ends (resumed awaits document.fonts.ready): fails within the timeout too', async () => {
    // Chrome holds the load event for fonts used at first layout, so the font
    // load starts only after load: setContent succeeds and the hang moves into
    // page.evaluate(() => document.fonts.ready), which only the CDP protocol timeout bounds.
    const html =
      '<!doctype html><html><head><script>addEventListener("load", () => {' +
      'const f = new FontFace("Hang", "url(https://fonts.gstatic.com/hang.woff2)"); document.fonts.add(f); f.load(); });' +
      '</script></head><body>text</body></html>';
    const print = resumedPrinter({
      timeoutMs: 2_000,
      args: [`--proxy-server=127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'],
      onBrowser: (b) => launched.push(b),
    });
    const heldBefore = held.length;
    const started = Date.now();
    const error = await print(html, {} as never).then(() => undefined, (e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toMatch(/Navigation timeout/); // setContent finished; the font wait timed out
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(held.length).toBeGreaterThan(heldBefore);
    expect(launched).toHaveLength(1);
    expect(await exited(launched[0]!.process()!.pid!)).toBe(true);
  }, 30_000);

  it('successful print: the browser is closed too', async () => {
    const print = resumedPrinter({ onBrowser: (b) => launched.push(b) });
    const api = new Api(freshLibrary('primary.input.json'), probeRenderer({ base: { print } }));
    expect((await api.exportPdf('r-security')).status).toBe(200);
    expect(launched).toHaveLength(1);
    expect(await exited(launched[0]!.process()!.pid!)).toBe(true);
  }, 30_000);
});
