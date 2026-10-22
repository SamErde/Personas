import { describe, expect, it } from 'vitest';
import { crosshairFor } from '../../src/webview/crosshair';

describe('crosshairFor', () => {
  it('highlights the row and column of a body cell under the pointer', () => {
    expect(crosshairFor({ pointer: { kind: 'cell', row: 2, col: 3 } })).toEqual({ row: 2, col: 3, outlineCell: true });
  });

  it('highlights only the row of an extension name', () => {
    expect(crosshairFor({ pointer: { kind: 'name', row: 4 } })).toEqual({ row: 4 });
  });

  it('highlights only the column of a profile header', () => {
    expect(crosshairFor({ pointer: { kind: 'header', col: 1 } })).toEqual({ col: 1 });
  });

  it('highlights nothing for the Extension column header', () => {
    expect(crosshairFor({ pointer: { kind: 'header', col: 0 } })).toEqual({});
  });

  it('follows keyboard focus when the pointer is outside the table', () => {
    expect(crosshairFor({ focus: { kind: 'cell', row: 0, col: 2 } })).toEqual({ row: 0, col: 2, outlineCell: true });
  });

  it('prefers the pointer over keyboard focus', () => {
    expect(
      crosshairFor({ pointer: { kind: 'name', row: 5 }, focus: { kind: 'cell', row: 0, col: 2 } }),
    ).toEqual({ row: 5 });
  });

  it("keeps the open hover card's row highlighted once the pointer leaves the table", () => {
    expect(crosshairFor({ cardRow: 3 })).toEqual({ row: 3 });
  });

  it('lets the pointer in the table override the hover card row', () => {
    expect(crosshairFor({ pointer: { kind: 'cell', row: 1, col: 1 }, cardRow: 3 })).toEqual({ row: 1, col: 1, outlineCell: true });
  });

  it('highlights nothing when neither the pointer, focus, nor a hover card is involved', () => {
    expect(crosshairFor({})).toEqual({});
  });
});
