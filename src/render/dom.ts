// Minimal helpers over a parse5 document: walk every element (including
// <template> contents) in document order, and read an element's text.

import { parse, type DefaultTreeAdapterTypes as T } from 'parse5';

export type Element = T.Element;

/**
 * `scripting` selects how <noscript> content is parsed: as raw text (a browser
 * with JavaScript on, like the printer) or as markup (the sandboxed preview).
 */
export function parseHtml(html: string, scripting = true): T.Document {
  return parse(html, { scriptingEnabled: scripting });
}

const isElement = (node: T.Node): node is T.Element => 'tagName' in node;

/** Every element in document order. Template contents are included: they are still markup the theme emitted. */
export function* elements(node: T.Node): Generator<T.Element> {
  if (isElement(node)) yield node;
  const children: T.ChildNode[] = 'childNodes' in node ? node.childNodes : [];
  for (const child of children) yield* elements(child);
  if (isElement(node) && node.tagName === 'template') yield* elements((node as T.Template).content);
}

export function attr(el: T.Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** Concatenated text of all descendant text nodes (entities already decoded by the parser). */
export function textContent(node: T.Node): string {
  if (node.nodeName === '#text') return (node as T.TextNode).value;
  const children: T.ChildNode[] = 'childNodes' in node ? node.childNodes : [];
  return children.map(textContent).join('');
}
