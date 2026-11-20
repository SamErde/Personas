import { describe, expect, it } from 'vitest';
import { resolveFocus, type FocusRow, type FocusSlot } from '../../src/webview/matrixFocus';

/** A row with its name in column 0 and a checkbox for each listed profile column. */
function row(extId: string, profileCols: Record<string, number>, extra: FocusSlot[] = []): FocusRow {
  return {
    extId,
    slots: [
      { slot: 'name', col: 0 },
      ...extra,
      ...Object.entries(profileCols).map(([id, col]): FocusSlot => ({ slot: `profile:${id}`, col })),
    ],
  };
}

describe('resolveFocus', () => {
  it('keeps the same control when it is still rendered', () => {
    const grid = [row('pub.a', { default: 1, aaa: 2 }), row('pub.b', { default: 1, aaa: 2 })];

    expect(resolveFocus({ extId: 'pub.b', slot: 'profile:aaa' }, grid, grid)).toEqual({ extId: 'pub.b', slot: 'profile:aaa' });
  });

  it('moves to the nearest control in the same row when the control is gone, preferring the next one on a tie', () => {
    const before = [row('pub.b', { default: 1, aaa: 2, bbb: 3 })];
    const after = [row('pub.b', { default: 1, bbb: 3 })]; // Work became read-only

    expect(resolveFocus({ extId: 'pub.b', slot: 'profile:aaa' }, before, after)).toEqual({ extId: 'pub.b', slot: 'profile:bbb' });
  });

  it('moves from a removed badge to the name in the same column', () => {
    const before = [row('pub.a', { default: 1 }, [{ slot: 'all', col: 0 }])];
    const after = [row('pub.a', { default: 1 })];

    expect(resolveFocus({ extId: 'pub.a', slot: 'all' }, before, after)).toEqual({ extId: 'pub.a', slot: 'name' });
  });

  it('moves to the same control in the next row when the focused row is removed', () => {
    const before = [row('pub.a', { aaa: 2 }), row('pub.b', { aaa: 2 }), row('pub.c', { aaa: 2 })];
    const after = [row('pub.a', { aaa: 2 }), row('pub.c', { aaa: 2 })];

    expect(resolveFocus({ extId: 'pub.b', slot: 'profile:aaa' }, before, after)).toEqual({ extId: 'pub.c', slot: 'profile:aaa' });
  });

  it('moves to the previous row when the removed row was last, choosing its nearest control', () => {
    const before = [row('pub.a', { default: 1 }), row('pub.b', { default: 1, aaa: 2 })];
    const after = [row('pub.a', { default: 1 })];

    expect(resolveFocus({ extId: 'pub.b', slot: 'profile:aaa' }, before, after)).toEqual({ extId: 'pub.a', slot: 'profile:default' });
  });

  it('moves to the nearest surviving row by distance, even when a farther row survives below', () => {
    const before = ['pub.a', 'pub.b', 'pub.c', 'pub.d'].map((id) => row(id, { aaa: 2 }));
    const after = [row('pub.a', { aaa: 2 }), row('pub.d', { aaa: 2 })];

    expect(resolveFocus({ extId: 'pub.b', slot: 'profile:aaa' }, before, after)).toEqual({ extId: 'pub.a', slot: 'profile:aaa' });
  });

  it('prefers the row below when surviving rows above and below are equally near', () => {
    const before = ['pub.a', 'pub.b', 'pub.c'].map((id) => row(id, { aaa: 2 }));
    const after = [row('pub.a', { aaa: 2 }), row('pub.c', { aaa: 2 })];

    expect(resolveFocus({ extId: 'pub.b', slot: 'profile:aaa' }, before, after)).toEqual({ extId: 'pub.c', slot: 'profile:aaa' });
  });

  it('finds nothing when no row survives', () => {
    const before = [row('pub.a', { default: 1 })];

    expect(resolveFocus({ extId: 'pub.a', slot: 'name' }, before, [])).toBeUndefined();
  });
});
