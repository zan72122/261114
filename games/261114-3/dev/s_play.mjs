// Full playthrough with screenshots at every stage.
export default async ({ page, open, shot, wait, g, tap }) => {
  const M = page.mouse;
  const scr = (x, y, z) => g(`(() => { const s = __g.toScreen(${x},${y},${z}); return [Math.round(s.x), Math.round(s.y)]; })()`);
  const stage = () => g('__g.stage');
  const busy = () => g('__g.busy');
  const log = [];
  async function waitStage(name, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await stage() === name) { await wait(300); return true; } await wait(250); } console.log('TIMEOUT waiting for', name, 'at', await stage()); return false; }
  async function waitIdle(ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!(await busy()) && !(await g('engine_framing()').catch(() => false))) return; await wait(250); } }
  async function dragPts(pts, stepWait = 70, hold = 0, rec = '') {
    await M.move(pts[0][0], pts[0][1]); await M.down(); await wait(200);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      for (let s = 1; s <= 6; s++) { await M.move(ax + (bx - ax) * s / 6, ay + (by - ay) * s / 6); await wait(stepWait); }
    }
    if (hold) await wait(hold);
    await M.up();
    log.push(`${rec || await stage()}: drag ${pts.map((p) => p.join(',')).join(' -> ')}${hold ? ' hold ' + hold + 'ms' : ''}`);
  }
  async function waitFrame() { const t0 = Date.now(); while (Date.now() - t0 < 8000) { if (!(await g('__g.engine.isFraming()'))) return; await wait(200); } }

  await open('');
  await g('localStorage.clear()');
  await open('');
  await waitFrame();
  // --- fold
  await shot('p00_fold');
  {
    const a = await g('(() => { const v = new __g.cloth.group.position.constructor(); __g.cloth.nearEnd(v); const s = __g.engine.toScreen(v); return [Math.round(s.x), Math.round(s.y)]; })()');
    const b = await scr(0, 0.1, 0.8);
    await M.move(a[0], a[1]); await M.down(); await wait(200);
    for (let s = 1; s <= 6; s++) { await M.move(a[0] + (b[0] - a[0]) * s / 6, a[1] + (b[1] - a[1]) * s / 6); await wait(80); }
    await shot('p01_fold_mid');
    for (let s = 7; s <= 12; s++) { await M.move(a[0] + (b[0] - a[0]) * s / 12 * 1, a[1] + (b[1] - a[1]) * 1); await wait(60); }
    await M.up();
    log.push(`fold: drag ${a} -> ${b}`);
  }
  await waitStage('apple1'); await waitFrame();
  await shot('p02_apple1');
  for (const n of [1, 2, 3]) {
    if (n > 1) { await waitStage('apple' + n); await waitFrame(); await shot(`p${n}0_apple${n}`); }
    const ap = await g('(() => { const p = __g.E.apple.obj.position; const s = __g.engine.toScreen(p); return [Math.round(s.x), Math.round(s.y)]; })()');
    const bag = await scr(0, 0.1, 1.6);
    await dragPts([ap, bag], 70, 0, 'apple' + n);
    await waitStage('lift' + n); await waitFrame();
    await shot(`p${n}1_lift${n}`);
    const h = await g('(() => { const v = new __g.cloth.group.position.constructor(); __g.cloth.handleTop(v); const s = __g.engine.toScreen(v); return [Math.round(s.x), Math.round(s.y)]; })()');
    await M.move(h[0], h[1]); await M.down(); await wait(200);
    for (let s = 1; s <= 10; s++) { await M.move(h[0], h[1] + (90 - h[1]) * s / 10); await wait(90); }
    await wait(1500); await shot(`p${n}2_lift${n}_up`);
    let k = 0; const t0 = Date.now();
    const next = n === 3 ? 'button' : 'carry' + n;
    while (await stage() !== next && Date.now() - t0 < 60000) { await wait(900); if (k < 4) await shot(`p${n}3_gag${n}_${k++}`); await M.move(h[0] + (k % 2 ? 10 : -10), 95); }
    await M.up();
    log.push(`lift${n}: drag ${h} -> ${h[0]},90 hold until laid back`);
    if (n === 3) break;
    await waitStage('carry' + n); await waitFrame();
    await shot(`p${n}4_carry${n}`);
    const bc = await scr(0, 0.1, 1.6);
    const nd = await scr(-0.7, 0.7, -0.6);
    await dragPts([bc, nd], 80, 0, 'carry' + n);
    await waitStage('sew' + n); await waitFrame();
    await shot(`p${n}5_sew${n}`);
    let sw = 0;
    while (await stage() === 'sew' + n && sw < 20) {
      await dragPts([[200, 780], [200 + (sw % 3 - 1) * 15, 430]], 60, 0, 'sew' + n); sw++;
      if (sw === 1) await shot(`p${n}6_sew${n}_a`);
      await wait(300);
    }
    await shot(`p${n}7_sew${n}_done`);
  }
  // --- button
  await waitStage('button'); await waitFrame();
  await shot('p40_button');
  {
    const b = await g('(() => { const p = __g.gagBtn.obj.position; const s = __g.engine.toScreen(p); return [Math.round(s.x), Math.round(s.y)]; })()');
    const t = await scr(-0.3, 0.1, 1.5);
    await dragPts([b, t], 70, 0, 'button');
  }
  await waitStage('pack'); await waitFrame();
  await shot('p41_pack');
  // discovery: tap tin, drag the loose button onto the bag
  { const t = await scr(-2.2, 0.35, 3.3); await tap(t[0], t[1]); log.push(`pack: tap tin ${t}`); await wait(2500);
    const b = await g('(() => { const p = __g.loose[0].obj.position; const s = __g.engine.toScreen(p); return [Math.round(s.x), Math.round(s.y)]; })()');
    const tt = await scr(0.4, 0.1, 2.2); await dragPts([b, tt], 70, 0, 'pack-button'); await wait(1500); await shot('p42_pack_btn'); }
  for (const it of ['bottle', 'bento', 'hanky']) {
    await waitIdle();
    const a = await g(`(() => { const p = __g.E.${it}.obj.position; const s = __g.engine.toScreen(p); return [Math.round(s.x), Math.round(s.y)]; })()`);
    const bag = await scr(0, 0.1, 1.5);
    await dragPts([a, bag], 70, 0, 'pack-' + it);
    await wait(2000);
    await shot('p43_pack_' + it);
  }
  await waitStage('go'); await waitFrame();
  await shot('p50_go');
  {
    const h = await g('(() => { const v = new __g.cloth.group.position.constructor(); __g.cloth.handleTop(v); const s = __g.engine.toScreen(v); return [Math.round(s.x), Math.round(s.y)]; })()');
    await M.move(h[0], h[1]); await M.down(); await wait(200);
    for (let s = 1; s <= 10; s++) { await M.move(h[0], h[1] + (90 - h[1]) * s / 10); await wait(90); }
    await wait(1200); await shot('p51_go_up');
    const t0 = Date.now(); while (await stage() !== 'park' && Date.now() - t0 < 30000) await wait(400);
    await M.up();
    log.push(`go: drag ${h} -> ${h[0]},90 hold until park`);
  }
  await waitStage('park'); await wait(1500); await shot('p60_park_arrive'); await waitIdle(); await waitFrame();
  await shot('p61_park');
  for (let i = 0; i < 4; i++) {
    await waitIdle();
    const c = await scr(0, 0.1, 0.9); await tap(c[0], c[1]); log.push(`park: tap ${c}`);
    await wait(2500); await shot('p62_park_' + i);
  }
  await waitStage('ending'); await wait(3000); await shot('p70_ending');
  await wait(15000); await shot('p71_ending_late');
  await waitStage('home', 120000); await wait(2500); await shot('p80_home'); await wait(3000); await shot('p81_home2');
  await waitStage('fold', 60000); await waitFrame(); await shot('p90_round2');
  console.log(log.join('\n'));
  console.log('STATE', JSON.stringify(await g('__g.state')).slice(0, 400));
};
