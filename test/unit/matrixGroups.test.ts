import { describe, expect, it } from 'vitest';
import { groupRows } from '../../src/webview/matrixGroups';
import type { RowVm } from '../../src/webview/render';

function row(displayName: string, publisher?: string): RowVm {
  return {
    id: `${publisher ?? 'none'}.${displayName}`,
    displayName,
    applyToAllProfiles: false,
    orphaned: false,
    profileBacked: true,
    cells: [],
    ...(publisher ? { publisher } : {}),
  };
}

/** Each group as its label and the names of its rows, in order. */
const shape = (groups: ReturnType<typeof groupRows>) => groups.map((g) => [g.label, g.rows.map((r) => r.displayName)]);

describe('no grouping', () => {
  it('keeps every row, in order, in one group with no heading', () => {
    const rows = [row('Beta'), row('Alpha')];
    expect(shape(groupRows(rows, 'none', []))).toEqual([[undefined, ['Beta', 'Alpha']]]);
  });
});

describe('grouping by name', () => {
  it('runs A to Z and leaves out letters no name starts with', () => {
    const rows = [row('Prettier'), row('azure tools'), row('Python'), row('ESLint')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['A', ['azure tools']],
      ['E', ['ESLint']],
      ['P', ['Prettier', 'Python']],
    ]);
  });

  it('puts names that do not start with a Latin letter in a final "#" group', () => {
    const rows = [row('42 Snippets'), row('Zig'), row('[Deprecated] Old'), row('.NET Runtime')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['Z', ['Zig']],
      ['#', ['42 Snippets', '[Deprecated] Old', '.NET Runtime']],
    ]);
  });

  it('files an accented Latin name under its base letter', () => {
    const rows = [row('Ägypten Helper'), row('Éclair'), row('ñandú'), row('Alpha')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['A', ['Ägypten Helper', 'Alpha']],
      ['E', ['Éclair']],
      ['N', ['ñandú']],
    ]);
  });

  it('files Latin letters that do not decompose under their base letter', () => {
    const rows = [row('Æther'), row('Øresund'), row('Łódź'), row('Đorđe'), row('Œuvre'), row('Þorn'), row('Ħamrun'), row('ß Tools'), row('ılık'), row('ẞ Tools'), row('Ðoc'), row('ðoc')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['A', ['Æther']],
      ['D', ['Đorđe', 'Ðoc', 'ðoc']],
      ['H', ['Ħamrun']],
      ['I', ['ılık']],
      ['L', ['Łódź']],
      ['O', ['Øresund', 'Œuvre']],
      ['S', ['ß Tools', 'ẞ Tools']],
      ['T', ['Þorn']],
    ]);
  });

  it('folds compatibility forms of Latin letters to their base letter', () => {
    const rows = [row('Ａbc'), row('ǆungla'), row('𝐀lpha')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['A', ['Ａbc', '𝐀lpha']],
      ['D', ['ǆungla']],
    ]);
  });

  it('files symbols under "#", even those that fold to a letter', () => {
    const rows = [row('™ Tools'), row('Ⓐ Circle'), row('Zed')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['Z', ['Zed']],
      ['#', ['™ Tools', 'Ⓐ Circle']],
    ]);
  });

  it('files names in non-Latin scripts under "#"', () => {
    const rows = [row('日本語 Language Pack'), row('Ελληνικά'), row('Кириллица'), row('Beta')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['B', ['Beta']],
      ['#', ['日本語 Language Pack', 'Ελληνικά', 'Кириллица']],
    ]);
  });

  it('ignores leading spaces and files a blank name under "#"', () => {
    const rows = [row('  zeta'), row('   ')];
    expect(shape(groupRows(rows, 'name', []))).toEqual([
      ['Z', ['  zeta']],
      ['#', ['   ']],
    ]);
  });
});

describe('every grouping', () => {
  const rows = [
    row('Alpha', 'contoso'),
    row('ägypten', 'Contoso'),
    row('日本語', 'fabrikam'),
    row('42', undefined),
    row('Zeta', 'zed'),
    row('Beta', undefined),
  ];
  for (const groupBy of ['none', 'name', 'publisher'] as const) {
    it(`puts each row in exactly one group when grouping by ${groupBy}`, () => {
      const placed = groupRows(rows, groupBy, []).flatMap((g) => g.rows);
      expect(placed).toHaveLength(rows.length);
      expect(new Set(placed)).toEqual(new Set(rows));
    });
  }
});

describe('grouping by publisher', () => {
  const contoso = { value: 'contoso', label: 'Contoso Ltd', count: 2, selected: false };
  const fabrikam = { value: 'fabrikam', label: 'fabrikam', count: 1, selected: false };
  const unknown = { value: '', label: 'Unknown', count: 1, selected: false };

  it("labels each group with the publisher's display name, in the publisher filter's order", () => {
    const rows = [row('Alpha', 'Contoso'), row('Beta'), row('Gamma', 'fabrikam'), row('Delta', 'contoso')];
    expect(shape(groupRows(rows, 'publisher', [contoso, fabrikam, unknown]))).toEqual([
      ['Contoso Ltd', ['Alpha', 'Delta']],
      ['fabrikam', ['Gamma']],
      ['Unknown', ['Beta']],
    ]);
  });

  it('tells apart publishers that share a display name, as the filter chips do', () => {
    const rows = [row('Alpha', 'acme'), row('Beta', 'acme-labs')];
    const options = [
      { value: 'acme', label: 'Acme', detail: 'acme', count: 1, selected: false },
      { value: 'acme-labs', label: 'Acme', detail: 'acme-labs', count: 1, selected: false },
    ];
    expect(shape(groupRows(rows, 'publisher', options))).toEqual([
      ['Acme (acme)', ['Alpha']],
      ['Acme (acme-labs)', ['Beta']],
    ]);
  });

  it('labels a publisher no option names by its ID, after the named ones and before Unknown', () => {
    const rows = [row('Beta'), row('Alpha', 'Northwind'), row('Gamma', 'fabrikam'), row('Delta', 'adatum')];
    expect(shape(groupRows(rows, 'publisher', [fabrikam]))).toEqual([
      ['fabrikam', ['Gamma']],
      ['adatum', ['Delta']],
      ['northwind', ['Alpha']],
      ['Unknown', ['Beta']],
    ]);
  });
});
