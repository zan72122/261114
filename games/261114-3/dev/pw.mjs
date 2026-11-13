// Throwaway Playwright helper: node dev/pw.mjs <script.mjs>  (script exports default async ({page, shot, wait, drag, tap, g}) => {})
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(process.argv[2]);
const W = +(process.env.W || 390), H = +(process.env.H || 844);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console.' + m.type() + ']', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const url = pathToFileURL(resolve(here, 'out/game.html')).href;
const shot = async (name) => { await page.screenshot({ path: resolve(here, 'shots', name + '.png') }); console.log('shot', name); };
const wait = (ms) => page.waitForTimeout(ms);
const g = (expr) => page.evaluate(expr);
async function drag(x0, y0, x1, y1, steps = 12, holdMs = 0) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await wait(150);
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(60); }
  if (holdMs) await wait(holdMs);
  await page.mouse.up();
}
async function tap(x, y) { await page.mouse.move(x, y); await page.mouse.down(); await wait(80); await page.mouse.up(); }
async function open(hash = '') { await page.goto(url + hash); await wait(2500); }
const scr = (await import(pathToFileURL(scriptPath).href)).default;
const t0 = Date.now();
try { await scr({ page, shot, wait, drag, tap, g, open, url }); } catch (e) { console.log('SCRIPT ERROR', e); }
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await b.close();
