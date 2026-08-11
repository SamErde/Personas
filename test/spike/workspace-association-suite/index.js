'use strict';

const fs = require('node:fs');
const vscode = require('vscode');

exports.run = async function run() {
  const resultPath = process.env.PERSONAS_SPIKE_RESULT;
  if (!resultPath) throw new Error('missing PERSONAS_SPIKE_RESULT');
  fs.writeFileSync(resultPath, JSON.stringify({
    workspaceFile: vscode.workspace.workspaceFile?.toString(),
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) ?? [],
  }, null, 2));
};
