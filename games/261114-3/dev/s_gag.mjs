export default async ({ page, open, shot, wait, g }) => {
  const M = page.mouse;
  await open('#stage=fold'); await g('localStorage.clear()');
  for (const n of (process.env.N || '1,2,3').split(',')) {
    await g(`__g.goto('lift${n}')`); await wait(1500);
    const h = await g('(() => { const v = new __g.cloth.group.position.constructor(); __g.cloth.handleTop(v); const s = __g.engine.toScreen(v); return [Math.round(s.x), Math.round(s.y)]; })()');
    await M.move(h[0], h[1]); await M.down(); await wait(200);
    for (let s = 1; s <= 10; s++) { await M.move(h[0], h[1] + (110 - h[1]) * s / 10); await wait(60); }
    const t0 = await g('__g.engine.time');
    for (let k = 0; k < 14; k++) { await shot(`g${n}_${String(k).padStart(2, '0')}`); await wait(250); }
    console.log('game secs', (await g('__g.engine.time')) - t0);
    await M.up(); await wait(3000);
  }
};
