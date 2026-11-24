/** Styles for the VS Code Profiles view's page. */
export const vscodeProfilesStyles = `
  #profiles { list-style: none; margin: 0; padding: 0; }
  #profiles li { margin: 0 0 8px; }
  #profiles li:last-child { margin-bottom: 0; }
  #launcher { margin-bottom: 0.75rem; }
  .profile-line1 { display: flex; align-items: center; gap: 0.3rem; }
  .profile-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The pencil is an icon button styled like the actions in VS Code's view toolbars. */
  button.edit-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 0.35rem;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--vscode-icon-foreground);
    font: inherit;
  }
  button.edit-icon:hover {
    background: var(--vscode-toolbar-hoverBackground);
    outline: 1px dashed var(--vscode-contrastActiveBorder, transparent);
    outline-offset: -1px;
  }
  button.edit-icon:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .profile-counts { margin-top: 0.15rem; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  .workspace-card {
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.75rem;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
  }
  .workspace-matrix {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.65rem;
    text-align: left;
    border: none;
    border-radius: 3px 3px 0 0;
    background: transparent;
    color: inherit;
  }
  .workspace-matrix:hover { background: var(--vscode-list-hoverBackground); }
  .workspace-matrix:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  /* The manifest actions are VS Code's secondary buttons: the same shape as Open Extension Matrix,
   * set below it in emphasis, and capped together at the same 300px. */
  .workspace-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    box-sizing: border-box;
    max-width: 300px;
    padding: 0 0.65rem 0.55rem;
  }
  /* The pair stacks when the sidebar is too narrow to fit both labels on one line. */
  .workspace-action {
    flex: 1 1 7rem;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .workspace-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .workspace-title { font-weight: 600; }
  .workspace-name { color: var(--vscode-textLink-foreground); margin-top: 0.15rem; }
  .workspace-readonly, .workspace-counts, .workspace-profile {
    margin-top: 0.2rem;
    font-size: 0.85em;
    color: var(--vscode-descriptionForeground);
  }
  .workspace-warning { margin: 0.25rem 0 0; font-size: 0.85em; }
  #extra p { margin: 0.4rem 0; }
  .warning-line { opacity: 0.9; }
`;

/** The page's skeleton; src/webview/vscodeProfiles.ts fills it in. */
export const vscodeProfilesBody = `<div id="launcher">
<button id="open" class="standard-button" type="button">Open Extension Matrix</button>
</div>
<div id="profiles-extensions">
<ul id="profiles"></ul>
<div id="workspace"></div>
<div id="extra"></div>
</div>`;
