/** DOM and formatting helpers shared by the matrix and sidebar webviews. */

export function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A disclosure button that shows and hides `panel`, which starts hidden. A chevron (style.css,
 * `.disclosure`) and aria-expanded say whether it is open. */
export function disclosure(label: string, panel: HTMLElement): HTMLButtonElement {
  panel.hidden = true;
  const toggle = el('button', 'chip disclosure', label) as HTMLButtonElement;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panel.id);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  return toggle;
}

/** A count of extensions in words, as in "1 extension" or "3 extensions". */
export function extensionCount(n: number): string {
  return `${n} ${n === 1 ? 'extension' : 'extensions'}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
