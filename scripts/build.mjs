import { build as esbuild } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distPlugin = resolve(root, 'dist', 'plugin');

console.log('[build] Cleaning dist/plugin...');
if (existsSync(distPlugin)) {
  rmSync(distPlugin, { recursive: true, force: true });
}
mkdirSync(distPlugin, { recursive: true });

console.log('[build] Copying static plugin manifests...');
cpSync(resolve(root, 'plugin-static'), distPlugin, { recursive: true });

console.log('[build] Building self-contained React sidebar UI (classic IIFE, zero CORS module fetches)...');
const uiBuild = await esbuild({
  entryPoints: [resolve(root, 'src', 'ui', 'main.tsx')],
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  write: false,
  outdir: resolve(distPlugin, 'sidecars', 'sidebar', 'public'),
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

let jsText = '';
let cssText = '';
for (const out of uiBuild.outputFiles) {
  if (out.path.endsWith('.js')) jsText += out.text;
  else if (out.path.endsWith('.css')) cssText += out.text;
}
if (!jsText) {
  throw new Error('UI bundle produced no JS output');
}

const safeCss = cssText.replace(/<\/style/gi, '<\\/style');
const safeJs = jsText.replace(/<\/script/gi, '<\\/script');

const publicDir = resolve(distPlugin, 'sidecars', 'sidebar', 'public');
mkdirSync(publicDir, { recursive: true });

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>模块树 · modtree</title>
  <script src="/preload.js"></script>
  <style>${safeCss}</style>
</head>
<body>
  <div id="root"><div style="padding:16px;color:#334155;font-family:sans-serif;font-size:13px;">正在加载模块树…</div></div>
  <script>
    window.addEventListener('error', function(e) {
      var r = document.getElementById('root');
      if (r && !r.dataset.mounted) {
        r.innerHTML = '<pre style="padding:12px;color:#b91c1c;white-space:pre-wrap;font-size:12px;">UI 启动错误: ' + (e.message || e.error) + '</pre>';
      }
    });
  </script>
  <script>${safeJs}</script>
</body>
</html>
`;

writeFileSync(resolve(publicDir, 'index.html'), html, 'utf-8');
console.log(`[build] Self-contained UI index.html written (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

const commonOpts = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  minify: false,
};

console.log('[build] Bundling Sidecar backend...');
await esbuild({
  ...commonOpts,
  entryPoints: [resolve(root, 'src', 'sidecar', 'main.ts')],
  outfile: resolve(distPlugin, 'sidecars', 'sidebar', 'main.mjs'),
  external: ['sidecar_sdk'],
});

console.log('[build] Bundling MCP server...');
await esbuild({
  ...commonOpts,
  entryPoints: [resolve(root, 'src', 'mcp', 'server.ts')],
  outfile: resolve(distPlugin, 'mcp', 'server.mjs'),
});

console.log('[build] Bundling PreToolUse & PreInvocation hooks...');
await esbuild({
  ...commonOpts,
  entryPoints: [
    resolve(root, 'src', 'hooks', 'pre-tool-use.ts'),
    resolve(root, 'src', 'hooks', 'pre-invocation.ts'),
  ],
  outdir: resolve(distPlugin, 'hooks'),
  outExtension: { '.js': '.mjs' },
});

console.log(`[build] Done! Zero-dependency plugin bundle ready at: ${distPlugin}`);
