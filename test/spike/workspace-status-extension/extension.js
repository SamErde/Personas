'use strict';

const fs = require('node:fs');
const vscode = require('vscode');

function snapshot(label) {
  const logPath = process.env.PERSONAS_SPIKE_LOG;
  if (!logPath) return;
  const extensions = vscode.extensions.all.map((extension) => ({
    id: extension.id.toLowerCase(),
    uri: extension.extensionUri.toString(),
    kind: extension.packageJSON.extensionKind,
  }));
  fs.appendFileSync(logPath, `${JSON.stringify({
    label,
    timestamp: new Date().toISOString(),
    workspaceFile: vscode.workspace.workspaceFile?.toString(),
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [],
    extensions,
  })}\n`);
}

exports.activate = function activate(context) {
  snapshot('activate');
  context.subscriptions.push(vscode.extensions.onDidChange(() => snapshot('onDidChange')));
};

exports.deactivate = function deactivate() {};
