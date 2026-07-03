import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('visex.showMatrix', () => {
      void vscode.window.showInformationMessage('Visex: matrix coming soon.');
    }),
  );
}

export function deactivate(): void {}
