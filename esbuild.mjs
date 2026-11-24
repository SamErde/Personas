import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');

const extensionCtx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
});

const webviewCtx = await esbuild.context({
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'dist/webview.js',
  sourcemap: true,
});

// One script per Home view: each sidebar view is its own webview page.
const homeCtx = await esbuild.context({
  entryPoints: {
    vscodeProfiles: 'src/webview/vscodeProfiles.ts',
    powerShellProfiles: 'src/webview/powerShellProfiles.ts',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outdir: 'dist',
  sourcemap: true,
});

fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync('src/webview/style.css', 'dist/webview.css');

if (watch) {
  await Promise.all([extensionCtx.watch(), webviewCtx.watch(), homeCtx.watch()]);
} else {
  await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild(), homeCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), webviewCtx.dispose(), homeCtx.dispose()]);
}
