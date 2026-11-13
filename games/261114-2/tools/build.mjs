// 開発時ビルド: vendor/three + assets + src/*.js を 1 つの HTML にまとめる（実行時ビルドではない）
// 使い方:
//   node tools/build.mjs                         -> index.html（本番: 全モジュール）
//   node tools/build.mjs --out preview/jar.html --modules jar --boot src/preview/jar.boot.js
//     -> base, layout は常に入る。--modules で追加モジュール、--boot で確認用の起動スクリプトを末尾に足す
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const ALL = ['audio', 'room', 'jar', 'vacuum', 'debris', 'game'];
const out = path.resolve(root, opt('out', 'index.html'));
const modules = opt('modules', ALL.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const boot = opt('boot', null);

const read = p => fs.readFileSync(path.resolve(root, p), 'utf8');

// three.module.min.js の末尾 export{a as B,...} を return{B:a,...} に変えて関数スコープへ閉じ込める
let three = read('vendor/three.module.min.js');
const ei = three.lastIndexOf('export{');
if (ei < 0) throw new Error('three export not found');
const list = three.slice(ei + 7, three.lastIndexOf('}'));
const ret = list.split(',').map(s => {
  const m = s.trim().match(/^(\S+)\s+as\s+(\S+)$/);
  return m ? `${m[2]}:${m[1]}` : s.trim();
}).join(',');
three = `const THREE=(()=>{${three.slice(0, ei)}return{${ret}};})();`;

// assets/* を data URI に
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const assets = {};
const adir = path.resolve(root, 'assets');
if (fs.existsSync(adir)) {
  for (const f of fs.readdirSync(adir).sort()) {
    const m = mime[path.extname(f).toLowerCase()];
    if (!m) continue;
    assets[f] = `data:${m};base64,` + fs.readFileSync(path.join(adir, f)).toString('base64');
  }
}
const fallback = assets['fallback.jpg'] ||
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
delete assets['fallback.jpg'];

const parts = [three, `const ASSETS=${JSON.stringify(assets)};`];
for (const m of ['base', 'layout', ...modules]) {
  const p = `src/${m}.js`;
  if (!fs.existsSync(path.resolve(root, p))) throw new Error('missing module: ' + p);
  parts.push(`\n/* ---- ${m}.js ---- */\n` + read(p));
}
if (boot) parts.push(`\n/* ---- boot ---- */\n` + read(boot));

let js = `(()=>{'use strict';\n${parts.join('\n')}\n})();`;
js = js.replace(/<\/script/gi, '<\\/script');

let html = read('src/template.html');
html = html.replace('__FALLBACK_SRC__', () => fallback).replace('/*__JS__*/', () => js);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`built ${path.relative(root, out)}  ${(html.length / 1024).toFixed(0)} KB  modules=[${modules.join(',')}]${boot ? ' boot=' + boot : ''}`);
