/** Styles for the PowerShell Profiles view's page: a compact list in the manner of VS Code's own views. */
export const powerShellProfilesStyles = `
  /* VS Code dims secondary list text by opacity; several themes give description text the foreground color. */
  #powershell { margin: 0 -1rem; --ps-quiet: color-mix(in srgb, var(--vscode-foreground) 72%, transparent); }
  #ps-help {
    box-sizing: border-box;
    width: min(30rem, calc(100% - 1rem));
    max-height: calc(100vh - 0.5rem);
    overflow: auto;
    overscroll-behavior: contain;
    margin: 0.25rem auto auto;
    padding: 0.75rem;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-contrastBorder, var(--vscode-widget-border, var(--vscode-focusBorder)));
  }
  #ps-help h3 { margin: 0; }
  #ps-help p { margin: 0.65em 0; }
  #ps-help button { margin: 0.75em 0 0; }
  #powershell [hidden] { display: none; }
  .ps-message { margin: 0; padding: 0.15rem 1rem; color: var(--ps-quiet); }
  .ps-edition + .ps-edition { margin-top: 6px; }
  .ps-edition-name {
    margin: 0;
    padding: 0 1rem;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ps-list { list-style: none; margin: 0; padding: 0; }
  .ps-icon {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ps-icon-more { stroke-width: 1.75; }
  button.ps-more, button.ps-open, button.ps-fold, button.ps-resolve, button.ps-menu-item {
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.ps-more {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: var(--vscode-icon-foreground);
  }
  button.ps-more:hover, button.ps-more[aria-expanded="true"] {
    background: var(--vscode-toolbar-hoverBackground);
    outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  button.ps-more:focus-visible, button.ps-fold:focus-visible, button.ps-resolve:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .ps-row, button.ps-fold, button.ps-resolve, .ps-note { height: 22px; line-height: 22px; }
  .ps-row { position: relative; display: flex; align-items: center; padding: 0 calc(1rem - 4px) 0 1rem; }
  .ps-row.ps-inert { padding-right: calc(1rem + 18px); }
  .ps-row:not(.ps-inert):hover, .ps-row:focus-within, .ps-row.ps-menu-open, button.ps-fold:hover, button.ps-resolve:hover {
    background: var(--vscode-list-hoverBackground);
    outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  .ps-row:has(button.ps-open:focus-visible) { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  button.ps-open { flex: 1 1 auto; min-width: 0; height: 100%; display: flex; align-items: center; gap: 6px; }
  button.ps-open:focus-visible { outline: none; }
  button.ps-open:disabled { opacity: 1; }
  .ps-label, .ps-description, .ps-fold-label, .ps-note-text, .ps-resolve-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ps-label { flex: 0 1 auto; }
  .ps-description { flex: 1 1 0; font-size: 0.9em; color: var(--ps-quiet); }
  .ps-tag { flex: none; font-size: 0.85em; color: var(--ps-quiet); }
  .ps-row[data-ps-state="missing"] button.ps-open, .ps-row[data-ps-state="unresolved"] button.ps-open {
    color: var(--ps-quiet);
  }
  .ps-row[data-ps-state="missing"] button.ps-open:enabled:hover, .ps-row[data-ps-state="missing"] button.ps-open:focus-visible {
    color: var(--vscode-foreground);
  }
  .ps-row[data-ps-state="brokenLink"] .ps-icon, .ps-row[data-ps-state="brokenLink"] .ps-tag, .ps-warning .ps-icon {
    color: var(--vscode-list-warningForeground);
  }
  .ps-row[data-ps-state="inaccessible"] .ps-icon, .ps-row[data-ps-state="inaccessible"] .ps-tag {
    color: var(--vscode-list-errorForeground);
  }
  button.ps-more { opacity: 0; }
  .ps-row:hover button.ps-more, .ps-row:focus-within button.ps-more, .ps-row.ps-menu-open button.ps-more { opacity: 1; }
  .ps-row[data-ps-state="brokenLink"] button.ps-more .ps-icon, .ps-row[data-ps-state="inaccessible"] button.ps-more .ps-icon {
    color: inherit;
  }

  button.ps-fold, button.ps-resolve, .ps-note {
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    padding: 0 1rem;
    font-size: 0.9em;
    color: var(--ps-quiet);
  }
  button.ps-fold:hover, button.ps-fold:focus-visible { color: var(--vscode-foreground); }
  button.ps-fold[aria-expanded="true"] .ps-icon { transform: rotate(90deg); }
  button.ps-resolve { padding-left: calc(1rem + 22px); color: var(--vscode-textLink-foreground); }

  .ps-menu {
    position: absolute;
    z-index: 10;
    top: 100%;
    right: 8px;
    box-sizing: border-box;
    max-width: calc(100% - 16px);
    padding: 4px;
    line-height: normal;
    border: 1px solid var(--vscode-menu-border, var(--vscode-contrastBorder, transparent));
    border-radius: 5px;
    background: var(--vscode-menu-background);
    color: var(--vscode-menu-foreground);
    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
  }
  .ps-menu.ps-menu-up { top: auto; bottom: 100%; }
  button.ps-menu-item {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 24px;
    padding: 0 8px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.ps-menu-item:enabled:hover, button.ps-menu-item:focus-visible {
    background: var(--vscode-menu-selectionBackground);
    color: var(--vscode-menu-selectionForeground);
    outline: 1px solid var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  button.ps-menu-item:disabled { opacity: 1; color: var(--vscode-disabledForeground); }
  .ps-menu-separator { margin: 4px 0; border: none; border-top: 1px solid var(--vscode-menu-separatorBackground); }
`;

/** The page's skeleton; src/webview/powershell.ts draws the list inside it. */
export const powerShellProfilesBody =
  `<div id="powershell" tabindex="-1" aria-live="polite"><p class="ps-message">Discovering PowerShell profiles…</p></div>
  <dialog id="ps-help" aria-labelledby="ps-help-heading">
    <h3 id="ps-help-heading" tabindex="-1" autofocus>PowerShell Profiles help</h3>
    <p><strong>How are paths found?</strong> Personas checks known locations without starting PowerShell, including when you refresh.</p>
    <p><strong>What does runtime discovery allow?</strong> If a path is unresolved, enable Allow Runtime Discovery in Personas Settings to use “Run … to resolve”. Each click starts the named executable once with profiles disabled. Successful results are kept for this session.</p>
    <p><strong>Can I create a missing profile?</strong> Yes, once its location is known and writable.</p>
    <a href="https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles">Profiles and load order on Microsoft Learn</a>
    <div><button id="ps-help-close" type="button">Close</button></div>
  </dialog>`;
