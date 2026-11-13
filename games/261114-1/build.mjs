// 開発時ビルド: vendor/three.min.js と src/*.js を template.html に埋め込み、1ファイルの index.html を作る。
// 使い方: node build.mjs [出力先(省略時 index.html)]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(dir, 'index.html');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');

let three = fs.readFileSync(path.join(dir, 'vendor/three.min.js'), 'utf8');
three = three.replace(/^console\.warn\('[^']*'\),/, 'void 0,');

const srcDir = path.join(dir, 'src');
// 開発用: STATION=wrap|fry|eat を付けると、その場面のファイルだけを入れる（並行作業中の他の場面を除く）
const only = process.env.STATION;
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))
  .filter((f) => !only || !/^[4-6]\d-/.test(f) || f.includes('-' + only + '.'))
  .sort();
const scripts = files
  .map((f) => `<script>/* ${f} */\n${esc(fs.readFileSync(path.join(srcDir, f), 'utf8'))}\n</script>`)
  .join('\n');

let fallback = '';
const fb = path.join(dir, 'assets/fallback.jpg');
if (fs.existsSync(fb)) fallback = 'data:image/jpeg;base64,' + fs.readFileSync(fb).toString('base64');

let html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
html = html
  .replace('/*__FALLBACK__*/', () => `window.G_FALLBACK_IMG=${JSON.stringify(fallback)};`)
  .replace('<!--__THREE__-->', () => `<script>${esc(three)}</script>`)
  .replace('<!--__SRC__-->', () => scripts);
fs.writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB) from ${files.join(', ')}`);
