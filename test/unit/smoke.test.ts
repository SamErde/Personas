import { describe, expect, expectTypeOf, it } from 'vitest';
import type { WelcomeToHost } from '../../src/core/types';
import { resolveWorkspaceManifestAction } from '../../src/panel/welcomeActions';
import {
  matrixContentSecurityPolicy,
  renderContentSecurityPolicyMeta,
  welcomeContentSecurityPolicy,
} from '../../src/panel/webviewSecurity';
import { isTrustedHostMessageOrigin } from '../../src/webview/messageSecurity';

describe('toolchain', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('webview security and workspace protocol smoke checks', () => {
  it('renders nonce-restricted CSP metadata with no default resource access', () => {
    const matrixMeta = renderContentSecurityPolicyMeta(
      matrixContentSecurityPolicy('vscode-webview://matrix', 'matrix-nonce'),
    );
    const welcomeMeta = renderContentSecurityPolicyMeta(welcomeContentSecurityPolicy('welcome-nonce'));
    expect(matrixMeta).toContain('http-equiv="Content-Security-Policy"');
    expect(matrixMeta).toContain("default-src 'none'");
    expect(matrixMeta).toContain("script-src 'nonce-matrix-nonce'");
    expect(matrixMeta).toContain('style-src vscode-webview://matrix');
    expect(welcomeMeta).toContain("default-src 'none'");
    expect(welcomeMeta).toContain("script-src 'nonce-welcome-nonce'");
  });

  it('accepts only same-origin host messages', () => {
    expect(isTrustedHostMessageOrigin('vscode-webview://safe', 'vscode-webview://safe')).toBe(true);
    expect(isTrustedHostMessageOrigin('https://attacker.invalid', 'vscode-webview://safe')).toBe(false);
  });

  it('uses exact host-only workspace manifest commands and ignores a forged path property', () => {
    type EditWorkspaceMessage = Extract<WelcomeToHost, { type: 'editWorkspaceFile' }>;
    expectTypeOf<EditWorkspaceMessage>().toEqualTypeOf<{ type: 'editWorkspaceFile' }>();

    const forged = {
      type: 'editWorkspaceFile',
      path: 'C:\\attacker\\other.code-workspace',
    } as WelcomeToHost & { path: string };
    expect(resolveWorkspaceManifestAction(forged, 'C:\\safe\\shared.code-workspace')).toEqual({
      mode: 'edit',
      filePath: 'C:\\safe\\shared.code-workspace',
    });
    expect(resolveWorkspaceManifestAction({ type: 'openWorkspaceReadOnly' }, undefined)).toBeUndefined();
  });
});
