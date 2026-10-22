/** Which part of the Extension Matrix table the pointer or keyboard focus is on. Rows count
 * body rows from 0; columns count from 0, the extension-name column. */
export type GridHit =
  | { kind: 'header'; col: number }
  | { kind: 'name'; row: number }
  | { kind: 'cell'; row: number; col: number };

/** The row and/or column to highlight, and whether to outline the cell where they cross. */
export interface Crosshair {
  row?: number;
  col?: number;
  outlineCell?: boolean;
}

export interface CrosshairInput {
  pointer?: GridHit;
  /** Keyboard focus; the pointer wins when both are in the table. */
  focus?: GridHit;
  /** Row of the extension whose hover card is open. It stays highlighted while the pointer or
   * focus is on the card, which sits outside the table. */
  cardRow?: number;
}

export function crosshairFor(input: CrosshairInput): Crosshair {
  const hit = input.pointer ?? input.focus;
  if (!hit) return input.cardRow === undefined ? {} : { row: input.cardRow };
  switch (hit.kind) {
    case 'cell':
      return { row: hit.row, col: hit.col, outlineCell: true };
    case 'name':
      return { row: hit.row };
    case 'header':
      // The Extension header would light the whole name column, which only adds noise.
      return hit.col === 0 ? {} : { col: hit.col };
  }
}
