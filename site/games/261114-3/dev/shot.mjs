// 使い方: node dev/shot.mjs dev/xxx.js dev/out/xxx.png [幅 高さ] [待ちms] ["ブラウザ内で実行するJS"]
// 指定エントリをビルドして 390x844 で開き、スクリーンショットを1枚撮る。コンソールエラーは表示する。
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const [entry, outPng, w = '390', h = '844', wait = '1500', js = ''] = process.argv.slice(2);
const html = resolve(here, 'out', entry.replace(/[\/\\]/g, '_') + '.html');
execFileSync('node', [resolve(here, '../build.mjs'), entry, html], { stdio: 'inherit' });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(pathToFileURL(html).href);
await p.waitForTimeout(+wait);
if (js) { await p.evaluate(js); await p.waitForTimeout(400); }
await p.screenshot({ path: resolve(here, '..', outPng) });
await b.close();
console.log('shot', outPng);
