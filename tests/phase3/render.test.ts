// Phase 3 unit tests: the runtime content policy (SPEC §3.5) and the rendering
// adapter's failure paths (§3.2 step 5, FR-06). The printer is injected here,
// so none of these launch Chrome.

import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../src/core/errors.ts';
import { createRenderer, resumedBackend } from '../../src/render/adapter.ts';
import { contentPolicyViolation } from '../../src/render/policy.ts';
import { readFixture } from '../support/harness.ts';

const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const body = (html: string) => page('', html);

describe('content policy (§3.5 runtime enforcement)', () => {
  it("allows Even's own output for every expected document", async () => {
    for (const file of ['security', 'engineering', 'overflow', 'sections.platform', 'sections.data']) {
      const html = await resumedBackend.html(readFixture(`${file}.expected.json`));
      expect(contentPolicyViolation(html), file).toBeNull();
    }
  });

  it.each(['img', 'picture', 'source', 'iframe', 'frame', 'object', 'embed', 'video', 'audio'])('refuses <%s>', (tag) => {
    const html = tag === 'frame' ? `<frameset><frame></frameset>` : `<${tag}></${tag}>`;
    expect(contentPolicyViolation(tag === 'frame' ? `<!doctype html><html><head></head>${html}</html>` : body(html))).toBe(`<${tag}> element`);
  });

  it.each(['src', 'srcset', 'poster', 'data'])('refuses a %s attribute on any element', (name) => {
    expect(contentPolicyViolation(body(`<div ${name}="http://127.0.0.1:9/x"></div>`))).toBe(`${name} attribute on <div>`);
  });

  it('allows data-* attributes and inline SVG with internal references only', () => {
    expect(contentPolicyViolation(body('<div data-x="1"><svg><use href="#icon"></use><path d="M0 0"></path></svg></div>'))).toBeNull();
  });

  it.each([
    ['SVG <image>', '<svg><image href="http://127.0.0.1:9/x.png"></image></svg>', 'external href on <image>'],
    ['SVG xlink:href', '<svg><use xlink:href="http://127.0.0.1:9/s.svg#a"></use></svg>', 'external href on <use>'],
    ['<base>', '<base href="http://127.0.0.1:9/">', 'external href on <base>'],
  ])('refuses an external reference: %s', (_, html, violation) => {
    expect(contentPolicyViolation(body(html))).toBe(violation);
  });

  it.each([
    ['stylesheet', 'https://fonts.googleapis.com/css?family=Lato:400,700&display=swap'],
    ['preconnect', 'https://fonts.gstatic.com'],
    ['preconnect', 'https://fonts.googleapis.com/'],
  ])('allows <link rel=%s> to %s', (rel, href) => {
    expect(contentPolicyViolation(page(`<link rel="${rel}" href="${href}">`, ''))).toBeNull();
  });

  it.each([
    ['icon', 'https://fonts.googleapis.com/x.ico'],
    ['stylesheet', 'https://evil.example/fonts.googleapis.com.css'],
    ['stylesheet', 'http://fonts.googleapis.com/css'],
    ['stylesheet', 'https://fonts.googleapis.com.evil.example/css'],
    ['stylesheet', 'https://fonts.googleapis.com:8443/css'],
    ['stylesheet preload', 'https://fonts.googleapis.com/css'],
    ['', 'https://fonts.googleapis.com/css'],
    ['stylesheet', ''],
  ])('refuses <link rel="%s" href="%s">', (rel, href) => {
    expect(contentPolicyViolation(page(`<link rel="${rel}" href="${href}">`, ''))).toBe('<link> other than a font stylesheet or preconnect');
  });

  it.each(['', '   ', 'https://example.com/page', 'http://example.com', 'mailto:sample@example.com', 'HTTPS://EXAMPLE.COM'])(
    'allows <a href="%s">',
    (href) => {
      expect(contentPolicyViolation(body(`<a href="${href}">x</a>`))).toBeNull();
    },
  );

  it.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java&#9;script:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', '/relative', '#top', 'file:///etc/passwd'])(
    'refuses <a href="%s">',
    (href) => {
      expect(contentPolicyViolation(body(`<a href="${href}">x</a>`))).toBe('<a> with an href scheme other than http, https or mailto');
    },
  );

  it('looks inside <template> and under both <noscript> parsings', () => {
    expect(contentPolicyViolation(body('<template><img></template>'))).toBe('<img> element');
    // Markup only when scripting is off (the sandboxed preview):
    expect(contentPolicyViolation(body('<noscript><img src="http://127.0.0.1:9/x"></noscript>'))).toBe('<img> element');
    // Markup only when scripting is on (the printer):
    expect(contentPolicyViolation(body('<noscript><p title="</noscript><img>"></p></noscript>'))).toBe('<img> element');
  });

  it('does not mistake escaped user text for markup', () => {
    expect(contentPolicyViolation(body('<li>Reviewed &lt;img src=x&gt; and &lt;iframe&gt;.</li>'))).toBeNull();
  });
});

describe('rendering adapter failure paths (FR-06, T14 at the adapter level)', () => {
  const doc = readFixture('security.expected.json');
  const okHtml = body('<p>ok</p>');

  async function failure(promise: Promise<unknown>) {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceError);
    return error as ServiceError;
  }

  it('a throwing theme is RENDER_FAILED and nothing is printed', async () => {
    const print = vi.fn();
    const r = createRenderer({ html: async () => Promise.reject(new Error('theme blew up')), print });
    const e = await failure(r.renderPdf(doc));
    expect([e.code, e.status]).toEqual(['RENDER_FAILED', 500]);
    expect(e.message).not.toContain('theme blew up');
    expect(print).not.toHaveBeenCalled();
  });

  it('empty HTML is RENDER_FAILED', async () => {
    const e = await failure(createRenderer({ html: async () => '  ' }).renderHtml(doc));
    expect(e.code).toBe('RENDER_FAILED');
  });

  it.each([
    ['throws', () => Promise.reject(new Error('chrome missing'))],
    ['returns no bytes', async () => new Uint8Array()],
    ['returns bytes that are not a PDF', async () => new TextEncoder().encode('<html>not a pdf</html>')],
  ])('a printer that %s is RENDER_FAILED, never a PDF', async (_, print) => {
    const e = await failure(createRenderer({ html: async () => okHtml, print }).renderPdf(doc));
    expect(e.code).toBe('RENDER_FAILED');
  });

  it('a policy violation is CONTENT_POLICY_VIOLATION and the printer is never invoked', async () => {
    const print = vi.fn();
    const r = createRenderer({ html: async () => body('<li><img src="http://127.0.0.1:9/probe.png"></li>'), print });
    for (const attempt of [r.renderPdf(doc), r.renderHtml(doc)]) {
      const e = await failure(attempt);
      expect([e.code, e.status]).toEqual(['CONTENT_POLICY_VIOLATION', 409]);
      expect(e.message).toContain('<img>');
    }
    expect(print).not.toHaveBeenCalled();
  });

  it('a backend cannot bypass the policy by returning disallowed HTML from a wrapped theme', async () => {
    const print = vi.fn();
    const r = createRenderer({ html: async (d) => (await resumedBackend.html(d)).replace('</body>', '<iframe></iframe></body>'), print });
    expect((await failure(r.renderPdf(doc))).code).toBe('CONTENT_POLICY_VIOLATION');
    expect(print).not.toHaveBeenCalled();
  });
});
