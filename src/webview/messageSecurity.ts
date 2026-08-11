/** VS Code host messages arrive with the webview's own origin. Reject all other senders. */
export function isTrustedHostMessageOrigin(eventOrigin: string, webviewOrigin: string): boolean {
  return eventOrigin === webviewOrigin;
}
