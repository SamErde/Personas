function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

export function matrixContentSecurityPolicy(cspSource: string, nonce: string): string {
  return `default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource};`;
}

export function welcomeContentSecurityPolicy(nonce: string): string {
  return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
}

export function renderContentSecurityPolicyMeta(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(policy)}">`;
}
