export default async ({ page, open, shot, wait, g, drag }) => {
  await open('#stage=fold'); await g('localStorage.clear()');
  await g(`__g.goto('sew1')`); await wait(2500);
  await drag(200, 780, 200, 560, 8);
  await wait(3000);
  const n1 = await g('__g.state.st.length');
  await page.goto(page.url().split('#')[0]); await wait(4000);
  console.log('after reload', await g('__g.stage'), n1, await g('__g.state.st.length'), await g('__g.cloth.stitches.length'));
  await shot('r_sew_reload');
  await g(`localStorage.setItem('gf-261114-3', '{garbage')`);
  await page.reload(); await wait(3000);
  console.log('corrupt ->', await g('__g.stage'));
  await g(`localStorage.setItem('gf-261114-3', JSON.stringify({v:1,stage:'pack',packed:'x',st:[[0,'a']],bags:[{f:2,st:[[0,0.2,0,255]],b:[[1,0.1,0.5]]}],round:5}))`);
  await page.reload(); await wait(3500);
  console.log('weird ->', await g('__g.stage'), JSON.stringify(await g('__g.state')));
  await shot('r_pack_weird');
  // wild tapping during a gag + early release in lift
  await g(`__g.goto('lift1')`); await wait(1500);
  await drag(195, 372, 195, 250, 4); await wait(1500);
  console.log('early release ->', await g('__g.stage'), await g('__g.busy'));
  for (let i = 0; i < 15; i++) { await page.mouse.click(50 + i * 20, 300 + (i % 4) * 100); }
  await wait(1500);
  console.log('after wild taps', await g('__g.stage'), await g('__g.busy'), await g('!!__g.drag'));
};
