import type { HostToWelcome, ParseWarning, WelcomeProfileVm, WelcomeToHost } from '../core/types';

declare function acquireVsCodeApi(): { postMessage(m: WelcomeToHost): void };
const vscode = acquireVsCodeApi();

let state: { profiles: WelcomeProfileVm[]; orphanCount: number; warnings: ParseWarning[] } | undefined;
let orphanSizeText = '';

document.getElementById('open')?.addEventListener('click', () => vscode.postMessage({ type: 'openMatrix' }));

window.addEventListener('message', (event: MessageEvent<HostToWelcome>) => {
  // Same origin check as the matrix webview (main.ts): host messages are
  // delivered same-origin in VS Code's webview architecture. Do NOT use
  // `event.source !== window` here — the sender is the host page, never this
  // window, so that guard would silently drop every legitimate message.
  if (event.origin !== window.location.origin) return;
  const m = event.data;
  switch (m.type) {
    case 'state':
      state = m;
      orphanSizeText = '';
      setLauncherHidden(false);
      render();
      return;
    case 'orphanSize':
      orphanSizeText = formatBytes(m.totalSizeBytes);
      render();
      return;
    case 'unsupported': {
      state = undefined;
      // The intro text and "Open Extension Matrix" button would only re-trigger the same
      // failure in this environment — hide them and show nothing but the reason text.
      setLauncherHidden(true);
      const dashboard = document.getElementById('dashboard');
      if (!dashboard) return;
      dashboard.replaceChildren(el('p', '', m.reason));
      return;
    }
  }
});

function setLauncherHidden(hidden: boolean): void {
  const launcher = document.getElementById('launcher');
  if (launcher) launcher.hidden = hidden;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function render(): void {
  const list = document.getElementById('profiles');
  const extra = document.getElementById('extra');
  if (!list || !extra) return;
  list.replaceChildren();
  extra.replaceChildren();
  if (!state) return;

  for (const p of state.profiles) {
    const li = document.createElement('li');
    const line1 = el('div', 'profile-line1');
    if (p.inheritsDefaultExtensions) {
      const nameSpan = el('span', 'profile-name', p.name);
      nameSpan.title = p.name;
      line1.append(nameSpan, el('span', 'inherits', '(inherits Default)'));
    } else {
      const link = el('a', 'profile-name', p.name) as HTMLAnchorElement;
      link.href = '#';
      link.title = p.name;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'openProfileReadOnly', profileId: p.id });
      });
      line1.append(link);

      const edit = el('a', 'edit-icon', '✎') as HTMLAnchorElement;
      edit.href = '#';
      edit.tabIndex = 0;
      edit.title = 'Edit raw file — caution: VS Code owns this file';
      edit.setAttribute('role', 'button');
      edit.setAttribute('aria-label', `Edit raw file for ${p.name} — caution: VS Code owns this file`);
      const openEdit = (e: Event) => {
        e.preventDefault();
        vscode.postMessage({ type: 'editProfileFile', profileId: p.id });
      };
      edit.addEventListener('click', openEdit);
      edit.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') openEdit(e);
      });
      line1.append(edit);
    }
    li.append(line1, el('div', 'profile-counts', `${p.direct} direct + ${p.shared} shared`));
    list.append(li);
  }

  if (state.orphanCount > 0) {
    const line = el('p', '');
    const sizePart = orphanSizeText ? ` · ${orphanSizeText} reclaimable` : '';
    line.append(`${state.orphanCount} orphaned extension(s)${sizePart} — `);
    const link = el('a', '', 'Review…') as HTMLAnchorElement;
    link.href = '#';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'reviewOrphans' });
    });
    line.append(link);
    extra.append(line);
  }

  for (const w of state.warnings) {
    extra.append(el('p', 'warning-line', `⚠ ${w.file}: actions for affected profiles are disabled`));
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

vscode.postMessage({ type: 'ready' });
