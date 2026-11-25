// §7.3 extraction: line grouping must not depend on content-stream order
// (Codex Phase 3 review, finding 4).

import { describe, expect, it } from 'vitest';
import { groupLines, type Run } from '../support/pdf.ts';

const run = (str: string, x: number, y: number): Run => ({ str, x, y, width: 5 });

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

const text = (runs: Run[]) => groupLines(runs).map((line) => line.map((r) => r.str).join(' '));

describe('groupLines', () => {
  it('gives one result for every input order, including a chain of baselines within 2 pt of each other', () => {
    // y 100 and 98.5 are within 2 pt, 98.5 and 97 are within 2 pt, but 100 and 97 are not.
    const runs = [run('A', 30, 100), run('B', 20, 98.5), run('C', 10, 97), run('D', 40, 90)];
    const results = new Set(permutations(runs).map((p) => JSON.stringify(text(p))));
    expect([...results]).toEqual([JSON.stringify(['B A', 'C', 'D'])]);
  });

  it('orders lines top to bottom and runs left to right', () => {
    expect(text([run('world', 50, 700), run('Hello', 10, 700.5), run('next', 10, 680)])).toEqual(['Hello world', 'next']);
  });
});
