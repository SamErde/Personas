import * as vscode from 'vscode';
import { createNonce, homeContentSecurityPolicy, renderContentSecurityPolicyMeta } from './webviewSecurity';

/** Styles every Home view's page shares: the page itself, buttons and links. */
export const sidebarBaseStyles = `
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0.5rem 1rem;
  }
  /* High-contrast themes can color a button the same as the surface behind it and rely on
   * contrastBorder for its edge. Other themes leave contrastBorder unset, so the border stays
   * transparent there. The shape follows VS Code's own text buttons (.monaco-text-button in
   * src/vs/base/browser/ui/button/button.css): a 1px border outside 4px by 8px padding and a 4px
   * corner radius. */
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-contrastBorder, transparent);
    padding: 4px 8px;
    border-radius: 4px;
    font: inherit;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  /* A standard button fills the width up to 300px, the cap VS Code gives the buttons in its views'
   * welcome content (.welcome-view-content > .button-container in
   * src/vs/workbench/browser/parts/views/media/views.css). */
  .standard-button { display: block; box-sizing: border-box; width: 100%; max-width: 300px; }
  button:disabled { opacity: .65; cursor: default; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
  a:hover, a:focus { text-decoration: underline; }
`;

/**
 * The page of one Home view. Each view is its own webview, so each gets its own document: the
 * shared base styles, the view's own styles and markup, and its script from dist/.
 */
export function renderSidebarPage(page: { title: string; styles: string; body: string; scriptUri: string }): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
${renderContentSecurityPolicyMeta(homeContentSecurityPolicy(nonce))}
<title>${page.title}</title>
<style nonce="${nonce}">${sidebarBaseStyles}${page.styles}</style>
</head>
<body>
${page.body}
<script nonce="${nonce}" src="${page.scriptUri}"></script>
</body>
</html>`;
}

/** What one Home view puts on its page, and how it reacts to the page and to being shown or hidden. */
export interface SidebarView<ToHost> {
  title: string;
  styles: string;
  body: string;
  /** The page's script, by its file name in dist/. */
  script: string;
  onMessage(message: ToHost): unknown;
  onVisibilityChange?(visible: boolean): void;
  onDispose(): void;
}

/**
 * Sets up the page of a Home view that VS Code has just resolved: its content, its messages to the
 * host, and the listeners that follow the view being shown, hidden and disposed.
 */
export function openSidebarPage<ToHost>(
  context: vscode.ExtensionContext,
  webviewView: vscode.WebviewView,
  view: SidebarView<ToHost>,
): void {
  const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
  const { webview } = webviewView;
  webview.options = { enableScripts: true, localResourceRoots: [dist] };
  webview.html = renderSidebarPage({
    title: view.title,
    styles: view.styles,
    body: view.body,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, view.script)).toString(),
  });
  webview.onDidReceiveMessage((message: ToHost) => void view.onMessage(message));
  const visibilityListener = webviewView.onDidChangeVisibility(() => view.onVisibilityChange?.(webviewView.visible));
  webviewView.onDidDispose(() => {
    visibilityListener.dispose();
    view.onDispose();
  });
  context.subscriptions.push(visibilityListener);
}
