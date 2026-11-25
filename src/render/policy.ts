// Runtime content policy (SPEC §3.5 rule 1, "Runtime enforcement"). Every
// rendered HTML document is parsed and checked before it reaches the preview
// or the printer. This backs up the write-time check for stored data that
// bypassed it (older rows, direct SQL): a violation is 409
// CONTENT_POLICY_VIOLATION and nothing is printed.

import { ServiceError } from '../core/errors.ts';
import { attr, elements, parseHtml, type Element } from './dom.ts';

/** Elements that load or embed external content. */
const BANNED_ELEMENTS = new Set(['img', 'picture', 'source', 'iframe', 'frame', 'object', 'embed', 'video', 'audio']);
/** Attributes that make an element fetch a resource. */
const BANNED_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'data']);
const LINK_RELS = new Set(['stylesheet', 'preconnect']);
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const ANCHOR_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function absoluteUrl(value: string): URL | null {
  try {
    return new URL(value); // WHATWG parsing, as the browser does: strips surrounding whitespace, tabs and newlines
  } catch {
    return null;
  }
}

function linkAllowed(el: Element): boolean {
  const rels = (attr(el, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (rels.length === 0 || !rels.every((r) => LINK_RELS.has(r))) return false;
  const url = absoluteUrl(attr(el, 'href') ?? '');
  return url !== null && url.protocol === 'https:' && FONT_HOSTS.has(url.hostname) && url.port === '';
}

function anchorAllowed(href: string): boolean {
  if (href.trim() === '') return true; // Even neutralizes unsafe links to href=""
  const url = absoluteUrl(href);
  return url !== null && ANCHOR_SCHEMES.has(url.protocol);
}

/**
 * §3.5 rule 3: "other schemes must be neutralized". Even already blanks
 * javascript:, data: and ftp: links, but keeps tel: (its phone contact link)
 * and the irc:, ircs: and xmpp: links micromark allows in user text. Each such
 * href is replaced with href="", keeping the link text, so a saved phone
 * number or chat link prints as text instead of blocking export. The exact
 * attribute is spliced out by source position; nothing else in the theme's
 * HTML changes. The policy check below still runs afterwards as the backstop.
 */
export function neutralizeLinks(html: string): string {
  const spans: { start: number; end: number }[] = [];
  for (const el of elements(parseHtml(html, true, true))) {
    if (el.tagName !== 'a') continue;
    const href = el.attrs.find((a) => a.name === 'href');
    const at = el.sourceCodeLocation?.attrs?.href;
    if (href && at && !anchorAllowed(href.value)) spans.push({ start: at.startOffset, end: at.endOffset });
  }
  let out = html;
  for (const { start, end } of spans.sort((a, b) => b.start - a.start)) out = out.slice(0, start) + 'href=""' + out.slice(end);
  return out;
}

/** The first violation, described by element (and attribute), or null when the document is allowed. */
export function contentPolicyViolation(html: string): string | null {
  // Checked under both <noscript> parsings: the printer runs with JavaScript on,
  // the preview iframe with it off, and neither parse is a superset of the other.
  return violationIn(html, true) ?? violationIn(html, false);
}

function violationIn(html: string, scripting: boolean): string | null {
  for (const el of elements(parseHtml(html, scripting))) {
    const tag = el.tagName;
    if (BANNED_ELEMENTS.has(tag)) return `<${tag}> element`;
    const banned = el.attrs.find((a) => BANNED_ATTRIBUTES.has(a.name));
    if (banned) return `${banned.name} attribute on <${tag}>`;
    if (tag === 'link') {
      if (!linkAllowed(el)) return '<link> other than a font stylesheet or preconnect';
      continue;
    }
    const href = el.attrs.find((a) => a.name === 'href'); // includes SVG xlink:href (prefix stripped by parse5)
    if (!href) continue;
    if (tag === 'a') {
      if (!anchorAllowed(href.value)) return '<a> with an href scheme other than http, https or mailto';
    } else if (href.value.trim() !== '' && !href.value.trim().startsWith('#')) {
      // "Inline <svg> without external references is allowed" (§3.5): an href on
      // any other element (<base>, <area>, SVG <image>/<use>) is an external reference.
      return `external href on <${tag}>`;
    }
  }
  return null;
}

export function enforceContentPolicy(html: string): void {
  const violation = contentPolicyViolation(html);
  if (violation) {
    throw new ServiceError('CONTENT_POLICY_VIOLATION', `rendered resume breaks the content policy: ${violation}; nothing was printed`);
  }
}
