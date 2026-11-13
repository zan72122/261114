export default async ({ open, shot, wait, g }) => {
  await open('#stage=fold'); await g('localStorage.clear()');
  for (const s of (process.env.ST || 'button,park,sew1').split(',')) {
    await g(`__g.goto('${s}')`);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && (await g('__g.hints.level')) < 2) await wait(500);
    await wait(2500); await shot('h_' + s);
  }
};
