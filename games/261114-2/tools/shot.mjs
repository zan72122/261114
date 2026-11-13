// 見た目確認用のスクリーンショット（開発時のみ）。コンソールのエラーも表示する。
// 使い方: node tools/shot.mjs <html> <out.png> [--w 390] [--h 844] [--wait 1500] [--dpr 1] [--eval "js式"] [--evalwait 500]
//   --eval はページ内で実行する JS（window.__dbg などを叩く用）。複数回指定可（順に実行、各回のあと evalwait ms 待つ）。
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const html = args[0], out = args[1];
if (!html || !out) { console.error('usage: shot.mjs <html> <out.png> [opts]'); process.exit(2); }
const num = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
const evals = []; args.forEach((a, i) => { if (a === '--eval') evals.push(args[i + 1]); });
const w = num('w', 390), h = num('h', 844), wait = num('wait', 1500), dpr = num('dpr', 1), evalwait = num('evalwait', 500);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true });
const page = await ctx.newPage();
let errors = 0;
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { console.log(`[console.${m.type()}] ${m.text()}`); if (m.type() === 'error') errors++; } });
page.on('pageerror', e => { console.log('[pageerror] ' + e.message); errors++; });
await page.goto('file://' + path.resolve(html));
await page.waitForTimeout(wait);
for (const e of evals) {
  try { const r = await page.evaluate(e); if (r !== undefined) console.log('[eval] ' + JSON.stringify(r)); }
  catch (err) { console.log('[eval error] ' + err.message); errors++; }
  await page.waitForTimeout(evalwait);
}
await page.screenshot({ path: out });
await browser.close();
console.log(`shot ${out} ${w}x${h} errors=${errors}`);
