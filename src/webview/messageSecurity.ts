/** VS Code host messages arrive with the webview's own origin. Reject all other senders. */
export function isTrustedHostMessageOrigin(eventOrigin: string, webviewOrigin: string): boolean {
  return eventOrigin === webviewOrigin;
}

/**
 * Host-sent icon URIs come from asWebviewUri, which always yields https. Anything else — a
 * javascript:/data: URI or an unparsable string — is rejected, so the caller falls back to its
 * letter tile instead of handing the value to an <img>.
 */
export function safeImageSource(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}
