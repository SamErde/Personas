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

/** Classifies the element under the pointer or focus by the table cell that holds it. Column
 * headers sit in the table head; a row header (`th scope="row"`) is the extension's name. */
export function gridHitAt(target: EventTarget | null, container: Element): GridHit | undefined {
  if (!(target instanceof Element)) return undefined;
  const cellEl = target.closest<HTMLElement>('th[data-col], td[data-col]');
  if (!cellEl || !container.contains(cellEl)) return undefined;
  const col = Number(cellEl.dataset['col']);
  if (cellEl.closest('thead')) return { kind: 'header', col };
  const row = Number(cellEl.closest<HTMLElement>('tr')?.dataset['row']);
  return cellEl.getAttribute('scope') === 'row' ? { kind: 'name', row } : { kind: 'cell', row, col };
}

const CROSSHAIR_CLASSES = ['crosshair', 'crosshair-label', 'crosshair-cell'];

/** Paints a crosshair onto the table inside `container`, replacing the previous one. The row's
 * header and the column's header are labels, the cells the user reads to find their place, so
 * they get the stronger emphasis. */
export function paintCrosshair(container: Element, { row, col, outlineCell }: Crosshair): void {
  for (const node of container.querySelectorAll(CROSSHAIR_CLASSES.map((c) => `.${c}`).join(', '))) {
    node.classList.remove(...CROSSHAIR_CLASSES);
  }
  const rowCells =
    row === undefined ? [] : [...container.querySelectorAll<HTMLElement>(`tr[data-row="${row}"] > [data-col]`)];
  for (const node of rowCells) node.classList.add(node.getAttribute('scope') === 'row' ? 'crosshair-label' : 'crosshair');
  if (col === undefined) return;
  for (const node of container.querySelectorAll<HTMLElement>(`[data-col="${col}"]`)) {
    node.classList.add(node.closest('thead') ? 'crosshair-label' : 'crosshair');
  }
  if (outlineCell) rowCells.find((node) => node.dataset['col'] === String(col))?.classList.add('crosshair-cell');
}
