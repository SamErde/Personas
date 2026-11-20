/** Which control in a row: the extension's name, its ALL badge, a profile cell's checkbox, or
 * the workspace guide button. */
export type SlotName = 'name' | 'all' | 'workspace' | `profile:${string}`;

/** A focusable control in the Extension Matrix, named by what it is rather than by its element,
 * so it can be found again after the table is rebuilt. */
export interface FocusTarget {
  extId: string;
  slot: SlotName;
}

/** A control in a row and the table column that holds it. */
export interface FocusSlot {
  slot: SlotName;
  col: number;
}

/** One table row's focusable controls in visual order. */
export interface FocusRow {
  extId: string;
  slots: FocusSlot[];
}

/** The `data-focus-key` the table stamps on a control. Extension IDs never contain '|'. */
export function focusKey(target: FocusTarget): string {
  return `${target.extId}|${target.slot}`;
}

/**
 * Decides where focus belongs after a rebuild. The same control keeps focus when it is still
 * rendered. Otherwise focus moves to the nearest control: first within the same row, then in the
 * nearest surviving row (looking down before up), on the same control or the nearest column.
 * Returns undefined only when no row survives.
 */
export function resolveFocus(target: FocusTarget, before: FocusRow[], after: FocusRow[]): FocusTarget | undefined {
  const byId = new Map(after.map((r) => [r.extId, r]));
  const prevIndex = before.findIndex((r) => r.extId === target.extId);
  const prevCol = before[prevIndex]?.slots.find((s) => s.slot === target.slot)?.col ?? 0;

  const sameRow = byId.get(target.extId);
  if (sameRow) return pickInRow(sameRow, target.slot, prevCol);

  // The focused row is gone: walk outward from where it was, rows below first.
  const below = before.slice(prevIndex + 1);
  const above = before.slice(0, Math.max(prevIndex, 0)).reverse();
  for (const candidate of [...below, ...above]) {
    const survivor = byId.get(candidate.extId);
    if (survivor) {
      const picked = pickInRow(survivor, target.slot, prevCol);
      if (picked) return picked;
    }
  }
  return undefined;
}

// --- DOM wiring --------------------------------------------------------------------------------
// Controls carry `data-focus-key` (stamped by renderMatrixTable) inside cells that carry
// `data-col`, inside rows that carry `data-row`.

/**
 * Runs `rebuild`, which may replace everything inside `container`, and keeps keyboard focus on
 * the same logical control. It does nothing to focus unless focus was on a keyed control inside
 * `container`, so a rebuild never takes focus from elsewhere (the filter box, a toolbar chip).
 * When nothing survives, focus goes to `container` itself so it stays in the matrix.
 *
 * `heldFor` names the matrix control that owns focus held outside `container` (the hover card
 * for an extension's name). That focus is left alone unless the rebuild drops it to <body>, as
 * when the card closes because its row is gone; it then moves as if it had been on `heldFor`.
 */
export function preserveMatrixFocus(container: HTMLElement, rebuild: () => void, heldFor?: FocusTarget): void {
  const keyed = keyedTarget(document.activeElement, container);
  const target = keyed ?? heldFor;
  const before = target ? readRows(container) : [];
  rebuild();
  if (!target) return;
  if (!keyed && !focusWasDropped()) return;
  const next = resolveFocus(target, before, readRows(container));
  if (next && focusMatrixControl(container, next)) return;
  focusContainer(container);
}

/** Focuses the control for `target` inside `container`; false when it is not rendered. */
export function focusMatrixControl(container: HTMLElement, target: FocusTarget): boolean {
  const key = focusKey(target);
  for (const node of container.querySelectorAll<HTMLElement>('[data-focus-key]')) {
    if (node.dataset['focusKey'] === key) {
      // The element is re-created where the old one was; scrolling would only close the hover card.
      node.focus({ preventScroll: true });
      return document.activeElement === node;
    }
  }
  return false;
}

/** True when nothing holds focus, as after the focused element is removed. */
function focusWasDropped(): boolean {
  return document.activeElement === null || document.activeElement === document.body;
}

function keyedTarget(active: Element | null, container: HTMLElement): FocusTarget | undefined {
  if (!(active instanceof HTMLElement) || !container.contains(active)) return undefined;
  return parseKey(active.dataset['focusKey']);
}

/** Reads a `data-focus-key` back into a target; anything that is not a known slot is ignored. */
const FOCUS_KEY = /^([^|]+)\|(name|all|workspace|profile:.+)$/;

function parseKey(key = ''): FocusTarget | undefined {
  const match = FOCUS_KEY.exec(key);
  return match ? { extId: match[1]!, slot: match[2] as SlotName } : undefined;
}

function readRows(container: HTMLElement): FocusRow[] {
  const rows = new Map<string, FocusRow>();
  for (const node of container.querySelectorAll<HTMLElement>('tr[data-row] [data-focus-key]')) {
    const target = parseKey(node.dataset['focusKey']);
    if (!target) continue;
    const col = Number(node.closest<HTMLElement>('[data-col]')?.dataset['col'] ?? 0);
    let row = rows.get(target.extId);
    if (!row) rows.set(target.extId, (row = { extId: target.extId, slots: [] }));
    row.slots.push({ slot: target.slot, col });
  }
  return [...rows.values()];
}

/** A temporary tabindex lets the container hold focus without becoming a click or Tab stop. */
function focusContainer(container: HTMLElement): void {
  container.tabIndex = -1;
  container.addEventListener('blur', () => container.removeAttribute('tabindex'), { once: true });
  container.focus({ preventScroll: true });
}

/** The same slot when the row has it, else the control nearest `col`. A tie goes to the later
 * column (the next control in Tab order), then to the earlier control in the row. */
function pickInRow(row: FocusRow, slot: SlotName, col: number): FocusTarget | undefined {
  if (row.slots.some((s) => s.slot === slot)) return { extId: row.extId, slot };
  let best: FocusSlot | undefined;
  for (const s of row.slots) {
    if (!best) {
      best = s;
      continue;
    }
    const d = Math.abs(s.col - col);
    const bestD = Math.abs(best.col - col);
    if (d < bestD || (d === bestD && s.col > best.col)) best = s;
  }
  return best && { extId: row.extId, slot: best.slot };
}
