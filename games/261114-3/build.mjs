// 開発時ビルド: src/main.js (+ three) を1本にまとめ、index.html に全部埋め込む。
// 使い方: node build.mjs                      → index.html
//         node build.mjs dev/xxx.js out.html  → プレビュー用
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, process.argv[2] || 'src/main.js');
const out = resolve(here, process.argv[3] || 'index.html');
const isMain = !process.argv[2];
const r = await build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: isMain, write: false,
  target: ['safari15'], loader: { '.jpg': 'dataurl', '.png': 'dataurl' }, legalComments: 'none',
  define: { __DEV__: isMain ? 'false' : 'true' },
});
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
let fallback = '';
const fb = resolve(here, 'assets/fallback.jpg');
if (existsSync(fb)) fallback = 'data:image/jpeg;base64,' + readFileSync(fb).toString('base64');
const html = readFileSync(resolve(here, 'src/shell.html'), 'utf8')
  .replace('/*__FALLBACK__*/', fallback)
  .replace('/*__BUNDLE__*/', () => js);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log('built', out, (html.length / 1024 | 0) + ' KB');
