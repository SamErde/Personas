import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('webview security and workspace protocol smoke checks', () => {
  const source = (relativePath: string) => readFileSync(join(__dirname, '..', '..', relativePath), 'utf8');

  it('keeps both webviews on nonce-restricted scripts with no default resource access', () => {
    const matrixPanel = source('src/panel/matrixPanel.ts');
    const welcomeView = source('src/panel/welcomeView.ts');
    expect(matrixPanel).toContain("default-src 'none'");
    expect(matrixPanel).toContain("script-src 'nonce-${nonce}'");
    expect(welcomeView).toContain("default-src 'none'");
    expect(welcomeView).toContain("script-src 'nonce-${nonce}'");
  });

  it('keeps host-message origin checks in both browser entry points', () => {
    expect(source('src/webview/main.ts')).toContain('event.origin !== window.location.origin');
    expect(source('src/webview/welcome.ts')).toContain('event.origin !== window.location.origin');
  });

  it('uses host-only workspace manifest commands without accepting a webview-supplied path', () => {
    const types = source('src/core/types.ts');
    expect(types).toContain("{ type: 'openWorkspaceReadOnly' }");
    expect(types).toContain("{ type: 'editWorkspaceFile' }");
    expect(types).not.toContain("{ type: 'editWorkspaceFile';");
  });
});
