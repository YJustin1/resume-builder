// The API server serving the built UI (SPEC §6: "in the built app the API
// server serves the UI files"): its CSP, only flat hashed asset names, the
// loopback Host check, and nothing served when no UI directory is given.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, UI_CSP } from '../../src/server/app.ts';
import { freshLibrary } from '../support/harness.ts';

const dir = mkdtempSync(join(tmpdir(), 'rb-ui-serve-'));
mkdirSync(join(dir, 'ui', 'assets'), { recursive: true });
writeFileSync(join(dir, 'ui', 'index.html'), '<!doctype html><title>UI</title><script type="module" src="/assets/index-abc123.js"></script>');
writeFileSync(join(dir, 'ui', 'assets', 'index-abc123.js'), 'console.log(1)');
writeFileSync(join(dir, 'ui', 'assets', 'index-abc123.css'), 'body{}');
writeFileSync(join(dir, 'secret.txt'), 'not for the browser');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const app = createApp(freshLibrary('primary.input.json'), { uiDir: join(dir, 'ui') });

describe('built UI served by the API server', () => {
  it('serves index.html at / with the UI CSP and no caching', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>UI</title>');
    expect(res.headers.get('content-security-policy')).toBe(UI_CSP);
    expect(UI_CSP).toContain("script-src 'self'");
    expect(UI_CSP).not.toContain('unsafe-inline');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves hashed assets with their content type', async () => {
    const js = await app.request('/assets/index-abc123.js');
    expect([js.status, js.headers.get('content-type')]).toEqual([200, 'text/javascript; charset=utf-8']);
    const css = await app.request('/assets/index-abc123.css');
    expect([css.status, css.headers.get('content-type')]).toEqual([200, 'text/css; charset=utf-8']);
  });

  it.each(['/assets/..%2Fsecret.txt', '/assets/..%2F..%2Fsecret.txt', '/assets/missing.js', '/assets/index-abc123.html', '/secret.txt', '/ui/index.html'])(
    'refuses %s with 404',
    async (path) => {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('not for the browser');
    },
  );

  it('UI routes require a loopback Host, like the API (DNS rebinding)', async () => {
    const res = await app.request('http://evil.example/');
    expect(res.status).toBe(403);
  });

  it('without uiDir, / is not served', async () => {
    const api = createApp(freshLibrary('primary.input.json'));
    expect((await api.request('/')).status).toBe(404);
  });
});
