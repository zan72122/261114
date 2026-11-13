// 1場面だけ開いて撮る: STAGE=sew1 NAME=x node dev/pw.mjs dev/s_view.mjs
export default async ({ open, shot, wait, g, page }) => {
  await open('');
  await g('localStorage.clear()');
  await g(`__g.goto('${process.env.STAGE || 'fold'}')`);
  await wait(+(process.env.WAIT || 4000));
  if (process.env.JS) { await g(process.env.JS); await wait(1500); }
  if (process.env.DRAG) { const d = process.env.DRAG.split(',').map(Number); const n = +(process.env.REP || 1);
    for (let r = 0; r < n; r++) { await page.mouse.move(d[0], d[1]); await page.mouse.down(); await wait(150);
      for (let i = 1; i <= 10; i++) { await page.mouse.move(d[0] + (d[2] - d[0]) * i / 10, d[1] + (d[3] - d[1]) * i / 10); await wait(70); }
      await page.mouse.up(); await wait(400); } }
  await shot(process.env.NAME || 'view');
};
