// Test-only rendering adapters: the real pipeline, instrumented so a test can
// see the document handed to the renderer (same-object rule, §7.3), the exact
// HTML handed to the printer (printed-bullet check), and whether the printer
// was invoked at all (T26). An optional `inject` rewrites the theme's HTML
// before the content policy and the printer (oracle self-tests 2, 3).

import type { JsonResume } from '../../src/core/assemble.ts';
import { createRenderer, resumedBackend, type RenderBackend, type Renderer } from '../../src/render/adapter.ts';

export interface Probe {
  renderer: Renderer;
  /** Every document passed to the HTML renderer, in call order. */
  rendered: JsonResume[];
  /** Every HTML string passed to the printer, in call order. */
  printed: string[];
}

export function probeRenderer(options: { inject?: (html: string) => string; base?: Partial<RenderBackend> } = {}): Probe {
  const base: RenderBackend = { ...resumedBackend, ...options.base };
  const probe: Probe = { rendered: [], printed: [], renderer: undefined as unknown as Renderer };
  probe.renderer = createRenderer({
    html: async (resume) => {
      probe.rendered.push(structuredClone(resume));
      const html = await base.html(resume);
      return options.inject ? options.inject(html) : html;
    },
    print: async (html, resume) => {
      probe.printed.push(html);
      return base.print(html, resume);
    },
  });
  return probe;
}

/** Insert markup just before the first highlight list item of the first work entry. */
export function insertBeforeFirstHighlight(markup: string) {
  return (html: string) => {
    const at = html.indexOf('<li><p>');
    if (at === -1) throw new Error('no highlight <li> to inject before');
    return html.slice(0, at) + markup + html.slice(at);
  };
}
