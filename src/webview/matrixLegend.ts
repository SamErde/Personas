// The Extension Matrix's Legend: a disclosure button in the toolbar over a panel that explains the
// cell marks. Like the Filters disclosure, both elements are built once and live outside the rebuilt
// table, so a rebuild never takes focus from the button or resets whether the panel is open.
import { renderMatrixLegend } from './matrixTable';
import { el } from './ui';

/** One titled list in the panel. The title is for sighted readers only: each list's own label
 * already names it for assistive technology. */
function legendGroup(title: string, list: HTMLElement): HTMLElement {
  const group = el('div', 'legend-group');
  const heading = el('div', 'legend-title', title);
  heading.setAttribute('aria-hidden', 'true');
  group.append(heading, list);
  return group;
}

export interface LegendControls {
  /** The Legend disclosure button, for the toolbar. */
  toggle: HTMLButtonElement;
  /** The disclosed panel. */
  panel: HTMLElement;
  /** Shows the Current workspace legend while the matrix has a Current workspace column. */
  update(showWorkspace: boolean): void;
}

/** The key to the Current workspace column's marks. */
function renderWorkspaceLegend(): HTMLElement {
  const legend = el('div', 'workspace-legend');
  legend.setAttribute('aria-label', 'Current workspace extension status legend');
  legend.append(
    el('span', '', '✓ Enabled'),
    el('span', '', '○ Not enabled'),
    el('span', '', '— Not installed in profile'),
    el('span', '', '✓ W Workspace-local'),
    el('span', '', '? Unknown'),
  );
  return legend;
}

export function createLegendControls(): LegendControls {
  const panel = el('div', 'legend-panel');
  panel.id = 'matrix-legend';
  panel.hidden = true;
  const workspaceGroup = legendGroup('Current workspace', renderWorkspaceLegend());
  workspaceGroup.hidden = true;
  panel.append(legendGroup('Cells', renderMatrixLegend()), workspaceGroup);

  const toggle = el('button', 'chip disclosure', 'Legend') as HTMLButtonElement;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panel.id);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  return {
    toggle,
    panel,
    update(showWorkspace) {
      workspaceGroup.hidden = !showWorkspace;
    },
  };
}
