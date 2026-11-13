// Story / game logic: "Clack-clack! Sew an outing bag with the sewing machine".
// One stage at a time; applyStage(name) sets up everything for a stage from the saved state and is
// used both for normal progression and for restoring after a reload.
import * as THREE from 'three';
import { createEngine } from './engine.js';
import { createAudio } from './audio.js';
import { createHints } from './hints.js';
import { createMachine } from './machine.js';
import { createWorld } from './world.js';
import { createApple, createBottle, createBento, createHanky, createTin, createButton } from './props.js';
import { CLOTH, createCloth } from './cloth.js';
import { FABRICS } from './fabrics.js';
import { createSparkles } from './game_fx.js';

const V3 = THREE.Vector3;
const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const r3 = (v) => Math.round(v * 1000) / 1000;
const { H, HANDLE } = CLOTH;
const HALF = HANDLE + H / 2; // grip -> centre of the bag body (lying)

// ------------------------------------------------------------------ story
const STAGES = ['fold', 'apple1', 'lift1', 'carry1', 'sew1', 'apple2', 'lift2', 'carry2', 'sew2', 'apple3', 'lift3',
  'button', 'pack', 'go', 'park', 'ending', 'home'];
const SI = {}; STAGES.forEach((s, i) => { SI[s] = i; });
const DEF = {
  fold: { type: 'fold', view: 'start', next: 'apple1' },
  apple1: { type: 'apple', n: 1, next: 'lift1' },
  lift1: { type: 'lift', n: 1, next: 'carry1' },
  carry1: { type: 'carry', side: 'R', next: 'sew1' },
  sew1: { type: 'sew', side: 'R', view: 'sew', next: 'apple2' },
  apple2: { type: 'apple', n: 2, next: 'lift2' },
  lift2: { type: 'lift', n: 2, next: 'carry2' },
  carry2: { type: 'carry', side: 'L', next: 'sew2' },
  sew2: { type: 'sew', side: 'L', view: 'sew', next: 'apple3' },
  apple3: { type: 'apple', n: 3, next: 'lift3' },
  lift3: { type: 'lift', n: 3, next: 'button' },
  button: { type: 'button', next: 'pack' },
  pack: { type: 'pack', next: 'go' },
  go: { type: 'lift', n: 0, go: true, next: 'park' },
  park: { type: 'park', view: 'park', next: 'ending' },
  ending: { type: 'ending', view: 'park' },
  home: { type: 'home', view: 'home' },
};

const THREADS = [0xd8463b, 0x3f7fd0, 0xf2c230, 0xf7f3ea, 0xec8fb0, 0x4fa35a]; // red blue yellow white pink green
const MACHINE_POS = new V3(0.55, 0, -1.2);
const N = new V3(-0.70, 0.70, -1.10);   // needle pierce point (world)
const G0 = new V3(0, 0, -0.4);          // work spot grip (room)
const PG0 = new V3(0, 0, -1.2);         // work spot grip (park)
const STITCH = 0.06;
const THREAD_FOR = [1, 0, 5, 1];
const GAGBTN_FOR = [1, 0, 5, 2];           // 布地ごとの最初のボタン色（布と同化しない色）           // 布地ごとの初期糸色（布と同化しない色）: gingham→青, dots→赤, flower→緑, berry→青
const FEED_END = 0.985 * H;
const APPLE_Y = 0.33;                   // apple centre height when resting on the table
const LIFT_H = 0.5;                     // how high a dragged prop floats
const PARK_Y = 0.045;
const BTN_S = 1.6;                      // buttons are drawn a bit bigger so a small finger can find them

// Layout (x, z [, yaw]) — tuned so that no rest spot lies on any path of the bag.
const LAY = {
  apple0: [1.7, 4.45],
  contact1: [1.45, 0.03], rest1: [1.4, 0.22],
  contact2: [-1.16, 3.3], rest2: [-0.92, 3.36],
  bottle: [2.4, 0.35, 0.4], bento: [2.25, 1.95, PI / 2], hanky: [2.1, 3.25, 0.25],
  tin: [-2.2, 3.3], gagBtn: [-1.75, 4.42],
  tinSpots: [[-1.25, 4.35], [-2.45, 4.6], [-1.0, 4.95], [-1.95, 5.05], [-1.45, 5.45]],
  park: { hanky: [-2.15, 2.35, 0.5], bento: [2.25, -0.7, PI / 2 + 0.2], bottle: [-2.2, -0.75, 0], appleLand: [2.3, 2.75], appleStop: [1.5, 1.2] },
};

const VIEWS = {
  start: { box: [-2.7, 0, -2.4, 2.7, 1, 6.1], pitch: 0.95 },
  table: { box: [-2.9, 0, -2.6, 2.9, 1.6, 4.6], pitch: 0.85 },
  lift: { box: [-2.3, 0, -1.2, 2.3, 4.9, 3.4], pitch: 0.62 },
  sew: { box: [N.x - 1.0, 0.6, N.z - 1.15, N.x + 0.25, 1.0, N.z + 1.25], yaw: -0.7, pitch: 0.58 },
  home: { box: [-1.6, 0, -4.4, 4.9, 8.4, 2.5], pitch: 0.28 },
  park: { box: [-2.7, 0, -2.4, 2.7, 1.2, 3.4], pitch: 0.85 },
  parkLift: { box: [-2.4, 0, -2.4, 2.4, 4.9, 2.8], pitch: 0.62 },
};

// ------------------------------------------------------------------ persisted state
const SAVE_V = 1;
function defaults() { return { v: SAVE_V, round: 0, stage: 'fold', thread: 1, st: [], btns: [], packed: 0, extra: 0, bags: [] }; }
const fin = (v) => typeof v === 'number' && isFinite(v);
function cleanSt(a) {
  const out = [];
  if (!Array.isArray(a)) return out;
  for (const s of a) {
    if (Array.isArray(s) && s.length >= 4 && fin(s[1]) && fin(s[2]) && fin(s[3])) {
      out.push([s[0] === 1 ? 1 : 0, clamp(s[1], 0, 1), clamp(s[2], -0.12, 0.12), (s[3] >>> 0) & 0xffffff]);
    }
    if (out.length >= 380) break;
  }
  return out;
}
function cleanBt(a) {
  const out = [];
  if (!Array.isArray(a)) return out;
  for (const b of a) {
    if (Array.isArray(b) && b.length >= 3 && fin(b[0]) && fin(b[1]) && fin(b[2])) out.push([((b[0] | 0) % 6 + 6) % 6, clamp(b[1], -0.85, 0.85), clamp(b[2], 0.1, 0.9)]);
    if (out.length >= 6) break;
  }
  return out;
}
function sanitize(o) {
  const d = defaults();
  if (!o || typeof o !== 'object' || o.v !== SAVE_V) return d;
  try {
    d.round = fin(o.round) ? clamp(Math.floor(o.round), 0, 1e6) : 0;
    d.stage = STAGES.includes(o.stage) ? o.stage : 'fold';
    d.thread = fin(o.thread) ? clamp(Math.floor(o.thread), 0, THREADS.length - 1) : 0;
    d.st = cleanSt(o.st);
    d.btns = cleanBt(o.btns);
    d.packed = fin(o.packed) ? clamp(Math.floor(o.packed), 0, 3) : 0;
    d.extra = fin(o.extra) ? clamp(Math.floor(o.extra), 0, 5) : 0;
    d.bags = Array.isArray(o.bags) ? o.bags.slice(-3).filter((b) => b && typeof b === 'object')
      .map((b) => ({ f: fin(b.f) ? clamp(Math.floor(b.f), 0, 999) : 0, st: cleanSt(b.st), b: cleanBt(b.b) })) : [];
  } catch (_) { return defaults(); }
  return d;
}

// ------------------------------------------------------------------ game
export function startGame() {
  const engine = createEngine();
  if (!engine) return;
  const audio = createAudio();
  const hints = createHints(engine);
  const { scene, camera } = engine;
  const world = createWorld(scene, engine.renderer);
  const fx = createSparkles(scene, engine.quality.maxParticles);
  try { world.setLow(engine.quality.low); } catch (_) { /* */ }
  engine.onQuality((q) => { try { world.setLow(q.low); fx.setLimit(q.maxParticles); } catch (_) { /* */ } });

  // ---- machine
  const machine = createMachine();
  machine.group.position.copy(MACHINE_POS);
  world.room.add(machine.group);
  machine.group.updateMatrixWorld(true);
  const spoolHit = machine.spool.getObjectByName('hit');
  const wheelHit = machine.handwheel.getObjectByName('hit');
  const roomGround = (x, z) => machine.groundAt(x - MACHINE_POS.x, z - MACHINE_POS.z);
  const parkGround = () => PARK_Y;

  // ---- cloth
  const cloth = createCloth(FABRICS[0].id);
  scene.add(cloth.group);
  const ps = cloth.pose;

  // ---- props (entities)
  const mkEnt = (made, r, restY, extra) => Object.assign({ obj: made.group, r, restY, rest: new V3(), tok: 0, held: false, lump: null }, extra);
  const E = {
    apple: mkEnt(createApple(), 0.37, APPLE_Y, { rolls: true, snd: 'pop', name: 'apple' }),
    bottle: mkEnt(createBottle(), 0.32, 0, { snd: 'water', lumpAt: [-0.42, 0.42, 0.34], name: 'bottle' }),
    bento: mkEnt(createBento(), 0.6, 0, { snd: 'box', lumpAt: [0.36, 0.38, 0.36], name: 'bento' }),
    hanky: mkEnt(createHanky(), 0.5, 0, { snd: 'soft', lumpAt: [0.05, 0.68, 0.2], name: 'hanky' }),
  };
  const ITEMS = [E.bottle, E.bento, E.hanky];        // packing order
  const PARK_ORDER = [E.hanky, E.bento, E.bottle];   // unpacking order (apple last)
  for (const k in E) scene.add(E[k].obj);
  const tin = createTin();
  tin.group.position.set(LAY.tin[0], 0, LAY.tin[1]);
  tin.group.rotation.y = 0.35;
  world.room.add(tin.group);
  const tinEnt = { obj: tin.group, r: 0.67 };

  let gagBtn = null;                // the button that hopped out of the tin
  const loose = [];                 // extra buttons lying on the table (pack stage)
  const attachedObjs = [];          // meshes attached to the bag
  let appleLump = null;             // lump object of the apple while inside
  let appleIn = false;              // apple mesh follows appleLump

  // ---- temp vectors
  const _a = new V3(), _b = new V3(), _g = new V3(), _m = new V3(), _d = new V3(), _q = new THREE.Quaternion(), _ax = new V3();
  const fA = new V3(), fB = new V3(), fArr = [fA, fB], fOne = [fA];
  const hA = new V3(), hB = new V3(), haloRet = [hA, 1], halo2Ret = [hB, 1];
  const SURF = { pos: new V3(), normal: new V3() };

  // ---- state
  let S = sanitize(engine.store.load());
  const gagBtnIdx = () => GAGBTN_FOR[S.round % FABRICS.length] ?? 1;
  if (__DEV__) {
    const m = /stage=(\w+)/.exec(location.hash || '');
    if (m && STAGES.includes(m[1])) S.stage = m[1];
  }
  const save = () => { try { engine.store.save(S); } catch (_) { /* */ } };

  let cur = 'fold', def = DEF.fold, stageObj = null;
  let busy = 0, drag = null, boost = 0, cueOn = false, hopClock = 0;
  let L = null, C = null, W = null, K = null, F = null;   // per-stage scratch
  let pegBags = [];

  // ---- epoch-guarded async helpers
  let epoch = 0;
  const live = new Set();
  function tw(d, fn, ease = 'inOut', guard = null) {
    const e = epoch;
    const p = engine.tween(d, (k) => { if (e === epoch && (!guard || guard())) fn(k); }, { ease });
    live.add(p);
    return p.then((ok) => { live.delete(p); return ok !== false && e === epoch && (!guard || guard()); });
  }
  function wt(s) {
    const e = epoch;
    const p = engine.wait(s);
    live.add(p);
    return p.then((ok) => { live.delete(p); return ok !== false && e === epoch; });
  }
  function killAll() {
    epoch++;
    for (const p of [...live]) { try { p.cancel(); } catch (_) { /* */ } }
    live.clear();
  }
  function run(fn) {
    const e = epoch;
    busy++;
    let pr;
    try { pr = fn(); } catch (err) { try { console.error(err); } catch (_) { /* */ } }
    Promise.resolve(pr).catch((err) => { try { console.error(err); } catch (_) { /* */ } })
      .finally(() => { if (e === epoch) busy = Math.max(0, busy - 1); });
  }
  async function fadeTo(v, d) { const e = epoch; await engine.fade(v, d); return e === epoch; }
  const view = (name, dur = 1.2, ease) => engine.frame(Object.assign({}, VIEWS[name], { duration: dur, ease }));

  // ---- small helpers
  function bezier(P0, P1, P2, k, out) {
    const u = 1 - k;
    return out.set(u * u * P0.x + 2 * u * k * P1.x + k * k * P2.x, u * u * P0.y + 2 * u * k * P1.y + k * k * P2.y, u * u * P0.z + 2 * u * k * P1.z + k * k * P2.z);
  }
  function rollBy(obj, dx, dz, r) {
    const dd = Math.hypot(dx, dz);
    if (dd < 1e-6) return;
    _ax.set(dz / dd, 0, -dx / dd);
    _q.setFromAxisAngle(_ax, dd / r);
    obj.quaternion.premultiply(_q);
  }
  function placeEnt(ent, x, z, yaw = 0, y0 = 0) {
    ent.tok++; ent.held = false;
    ent.obj.visible = true;
    ent.obj.position.set(x, ent.restY + y0, z);
    ent.obj.rotation.set(0, yaw, 0);
    ent.rest.copy(ent.obj.position);
  }
  function bagCenter(out) { return out.set(ps.grip.x + Math.sin(ps.yaw) * HALF, 0.1, ps.grip.z + Math.cos(ps.yaw) * HALF); }
  function setCenter(cx, cz, yaw) { ps.yaw = yaw; ps.grip.set(cx - Math.sin(yaw) * HALF, 0, cz - Math.cos(yaw) * HALF); }
  function inBagRect(v, m) { // lying bag at yaw 0
    const g = ps.grip;
    return v.x > g.x - 1 - m && v.x < g.x + 1 + m && v.z > g.z - 0.1 - m && v.z < g.z + HANDLE + H + m;
  }
  function overBag(v) { cloth.mouth(_m); return inBagRect(v, 0.3) || Math.hypot(v.x - _m.x, v.z - _m.z) < 1.2; }
  function overBagFront(v) {
    const g = ps.grip;
    return v.x > g.x - 1.15 && v.x < g.x + 1.15 && v.z > g.z + HANDLE - 0.25 && v.z < g.z + HANDLE + H + 0.25;
  }
  function hitEnt(p, ent, px = 80) {
    if (!ent || !ent.obj.visible) return false;
    if (engine.screenDist(p, ent.obj.position) < px) return true;
    const h = engine.pick(p, ent.obj);
    return !!h;
  }
  function removeLump(lp) { const i = cloth.lumps.indexOf(lp); if (i >= 0) cloth.lumps.splice(i, 1); }
  function newLump(x, y, r) { return { x, y, r }; }
  function answerTap(p) {
    audio.play('tap', { vol: 0.45 });
    const g = engine.groundPoint(p, world.current === 'park' ? PARK_Y : 0, _g);
    if (g && Math.abs(g.x) < 12 && Math.abs(g.z) < 12) fx.emit(g, 3, 0.06, 0.5, 0.6);
  }
  function addStitch(side, t, off) {
    const col = THREADS[S.thread];
    cloth.addStitch(side, t, off, col);
    S.st.push([side === 'L' ? 1 : 0, r3(t), r3(off), col]);
    save();
  }
  function mkButton(ci) {
    const b = createButton(ci);
    b.group.scale.setScalar(BTN_S);
    scene.add(b.group);
    return mkEnt(b, 0.13 * BTN_S, 0.03 * BTN_S, { button: true, ci });
  }
  function dropObj(o) { if (o && o.parent) o.parent.remove(o); }

  // ---- motion primitives (all epoch guarded)
  async function fall(ent, from, to) {
    const h = Math.max(0, from.y - to.y);
    const dur = clamp(Math.sqrt(2 * h / 22), 0.16, 0.5);
    const o = ent.obj;
    const ok = await tw(dur, (k) => {
      const px = o.position.x, pz = o.position.z;
      o.position.set(lerp(from.x, to.x, k), from.y + (to.y - from.y) * k * k, lerp(from.z, to.z, k));
      if (ent.rolls) rollBy(o, (o.position.x - px) * 0.5, (o.position.z - pz) * 0.5, ent.r);
    }, 'linear');
    if (ok) audio.play('thud', { vol: clamp(0.4 + h * 0.4, 0.3, 1) });
    return ok;
  }
  function bounce(ent, h, dur) {
    const o = ent.obj, y0 = o.position.y;
    return tw(dur, (k) => { o.position.y = y0 + h * 4 * k * (1 - k); }, 'linear');
  }
  async function rollPath(ent, P0, P1, P2, dur, vol = 0.8) {
    const o = ent.obj;
    let px = P0.x, pz = P0.z;
    audio.loop('roll', vol, 1.1);
    const ok = await tw(dur, (k) => {
      bezier(P0, P1, P2, k, _b);
      rollBy(o, _b.x - px, _b.z - pz, ent.r);
      px = _b.x; pz = _b.z;
      o.position.copy(_b);
      audio.loop('roll', vol * (1 - 0.75 * k), 1.2 - 0.6 * k);
    }, 'out');
    audio.loop('roll', 0);
    return ok;
  }
  function hop(ent, h, snd = false) {
    const tk = ++ent.tok;
    const o = ent.obj, y0 = ent.rest.y;
    if (snd) audio.play('tap', { vol: 0.22, rate: 1.3 });
    tw(0.34, (k) => { o.position.y = y0 + h * 4 * k * (1 - k); o.rotation.z = 0.12 * h * Math.sin(k * PI * 2); }, 'linear', () => ent.tok === tk && !ent.held)
      .then((ok) => { if (ok) { o.position.y = y0; o.rotation.z = 0; } });
  }
  function idleHop(ent, dt, lvl) {
    if (!ent || !cueOn || ent.held) return;
    hopClock += dt;
    const period = lvl >= 1 ? 1.35 : 2.6;
    if (hopClock >= period) { hopClock = 0; hop(ent, lvl >= 1 ? 0.17 : 0.08, lvl >= 1); }
  }
  async function arc(ent, from, to, h, dur, spin = 0) {
    const o = ent.obj;
    return tw(dur, (k) => {
      o.position.lerpVectors(from, to, k);
      o.position.y += h * 4 * k * (1 - k);
      if (spin) o.rotation.x = spin * k;
    }, 'linear');
  }
  function safeSpot(x, z, r, self, out) {
    const others = [];
    for (const k in E) { const e = E[k]; if (e !== self && e.obj.visible && !e.held) others.push(e); }
    if (gagBtn && gagBtn !== self) others.push(gagBtn);
    for (const b of loose) if (b !== self) others.push(b);
    others.push(tinEnt);
    for (let it = 0; it < 4; it++) {
      x = clamp(x, -5.2, 5.2); z = clamp(z, -3.9, 6.2);
      // machine bed footprint
      const x0 = MACHINE_POS.x - 2.0 - r, x1 = MACHINE_POS.x + 2.0 + r, z0 = MACHINE_POS.z - 0.85 - r, z1 = MACHINE_POS.z + 0.85 + r;
      if (x > x0 && x < x1 && z > z0 && z < z1) {
        const dl = x - x0, dr = x1 - x, db = z - z0, df = z1 - z, m = Math.min(dl, dr, db, df);
        if (m === df) z = z1 + 0.01; else if (m === dl) x = x0 - 0.01; else if (m === dr) x = x1 + 0.01; else z = z0 - 0.01;
      }
      for (const e of others) {
        const p = e.obj.position, R = (e.r || 0.3) + r;
        const dx = x - p.x, dz = z - p.z, dd = Math.hypot(dx, dz);
        if (dd < R) { const s = dd > 1e-4 ? R / dd : 1; x = p.x + (dd > 1e-4 ? dx * s : R); z = p.z + (dd > 1e-4 ? dz * s : 0); }
      }
    }
    return out.set(x, 0, z);
  }

  // ---- generic prop dragging
  function grabProp(ent, p) {
    ent.tok++; ent.held = true;
    drag = { kind: 'prop', ent, lift: 0, tx: ent.obj.position.x, tz: ent.obj.position.z, sx: p.x, sy: p.y, moved: 0 };
    audio.play('tap', { vol: 0.8 });
  }
  function propMove(p) {
    const d = drag;
    const g = engine.groundPoint(p, d.ent.restY + LIFT_H + (world.current === 'park' ? PARK_Y : 0), _g);
    d.moved = Math.max(d.moved, Math.hypot(p.x - d.sx, p.y - d.sy));
    if (!g) return;
    d.tx = clamp(g.x, -5.2, 5.2); d.tz = clamp(g.z, -3.8, 6.4);
  }
  function propUpdate(dt) {
    const d = drag, o = d.ent.obj;
    d.lift = Math.min(1, d.lift + dt / 0.12);
    const k = 1 - Math.exp(-dt * 22);
    const nx = o.position.x + (d.tx - o.position.x) * k, nz = o.position.z + (d.tz - o.position.z) * k;
    if (d.ent.rolls) rollBy(o, nx - o.position.x, nz - o.position.z, d.ent.r);
    o.position.set(nx, d.ent.rest.y + LIFT_H * (1 - Math.pow(1 - d.lift, 3)), nz);
  }
  function propUp() {
    const d = drag; drag = null;
    d.ent.held = false;
    if (stageObj && stageObj.drop) stageObj.drop(d.ent, d); else landProp(d.ent);
  }
  function landProp(ent) {
    const o = ent.obj;
    const y0 = world.current === 'park' ? PARK_Y : 0;
    safeSpot(o.position.x, o.position.z, ent.r, ent, _d);
    const from = o.position.clone(), to = new V3(_d.x, ent.restY + y0, _d.z);
    ent.rest.copy(to);
    const tk = ++ent.tok;
    const h = from.y - to.y;
    tw(clamp(Math.sqrt(2 * Math.max(h, 0.05) / 22), 0.12, 0.4), (k) => {
      const px = o.position.x, pz = o.position.z;
      o.position.set(lerp(from.x, to.x, k), from.y + (to.y - from.y) * k * k, lerp(from.z, to.z, k));
      if (ent.rolls) rollBy(o, o.position.x - px, o.position.z - pz, ent.r);
    }, 'linear', () => ent.tok === tk).then((ok) => {
      if (!ok) return;
      audio.play(ent.button ? 'button' : 'thud', { vol: ent.button ? 0.4 : 0.6 });
      if (ent.rolls) bounce(ent, 0.06, 0.2);
    });
  }

  // ---- insertion into the bag
  function insertApple(next) {
    run(async () => {
      const ent = E.apple, o = ent.obj;
      ent.tok++;
      cloth.mouth(_m);
      const from = o.position.clone(), to = new V3(_m.x, Math.max(_m.y, 0.1) + 0.42, _m.z + 0.05);
      audio.play('soft', { vol: 0.5 });
      if (!await arc(ent, from, to, 0.55, 0.4)) return;
      appleLump = newLump(0, 0.95, 0.44);
      cloth.lumps.push(appleLump);
      appleIn = true;
      audio.play('pop');
      if (!await tw(0.6, (k) => { appleLump.y = 0.95 - 0.5 * k; }, 'out')) return;
      const g0 = ps.gape;
      if (!await tw(0.4, (k) => { ps.gape = g0 * (1 - k); }, 'inOut')) return;
      if (!await wt(0.25)) return;
      advance(next);
    });
  }
  function insertItem(ent) {
    run(async () => {
      const o = ent.obj;
      ent.tok++;
      cloth.mouth(_m);
      const from = o.position.clone(), to = new V3(_m.x, Math.max(_m.y, 0.1) + 0.35, _m.z - 0.05);
      if (!await arc(ent, from, to, 0.6, 0.42)) return;
      cloth.inside(0, 0.55, _a);
      const a0 = o.position.clone(), a1 = _a.clone();
      audio.play('pop'); audio.play(ent.snd, { delay: 0.06 });
      if (!await tw(0.22, (k) => { o.position.lerpVectors(a0, a1, k); if (k > 0.35) o.visible = false; }, 'in')) return;
      o.visible = false;
      ent.lump = newLump(ent.lumpAt[0], ent.lumpAt[1], ent.lumpAt[2]);
      cloth.lumps.push(ent.lump);
      S.packed = Math.min(3, S.packed + 1);
      ps.fill = 0.27 * S.packed;
      save();
      if (S.packed >= 3) {
        if (!await wt(0.5)) return;
        audio.play('chime', { vol: 0.7 });
        if (!await wt(0.4)) return;
        advance('go');
      } else {
        hopClock = 0;
        recue();
      }
    });
  }
  function attachButton(ent, next) {
    run(async () => {
      const g = ps.grip, o = ent.obj;
      ent.tok++; ent.held = false;
      const bx = clamp(o.position.x - g.x, -0.8, 0.8);
      const by = clamp((g.z + HANDLE + H - o.position.z) / H, 0.12, 0.88);
      cloth.surface(bx, by, SURF);
      const from = o.position.clone(), to = SURF.pos.clone();
      if (!await tw(0.14, (k) => { o.position.lerpVectors(from, to, k); }, 'in')) return;
      cloth.attach(o, bx, by);
      attachedObjs.push(o);
      if (gagBtn === ent) gagBtn = null;
      const li = loose.indexOf(ent); if (li >= 0) loose.splice(li, 1);
      S.btns.push([ent.ci, r3(bx), r3(by)]);
      save();
      audio.play('snap'); audio.play('sparkle', { delay: 0.05 });
      fx.emit(to, 10, 0.12, 0.7, 0.8);
      if (next) { if (!await wt(0.7)) return; advance(next); }
    });
  }

  // ---- buttons from the tin
  function tinMouthWorld(out) { tin.mouth.getWorldPosition(out); return out; }
  async function hopButtonOut(ent, to) {
    const o = ent.obj;
    tinMouthWorld(_a);
    const from = _a.clone();
    o.visible = true; o.position.copy(from); o.rotation.set(0, Math.random() * PI, 0);
    audio.play('button');
    const tk = ++ent.tok;
    if (!await tw(0.62, (k) => {
      o.position.lerpVectors(from, to, k); o.position.y += 0.9 * 4 * k * (1 - k);
      o.rotation.x = k * PI * 4;
    }, 'linear', () => ent.tok === tk)) return false;
    o.position.copy(to); o.rotation.x = 0;
    audio.play('button', { vol: 0.5, rate: 1.3 });
    const ry = o.rotation.y;
    const ok = await tw(0.7, (k) => {
      const e = Math.exp(-5 * k);
      o.rotation.set(0.3 * e * Math.sin(k * 26), ry + 2.4 * (1 - e), 0.3 * e * Math.cos(k * 26));
      o.position.y = to.y + 0.03 * e * Math.abs(Math.sin(k * 26));
    }, 'linear', () => ent.tok === tk);
    o.rotation.x = 0; o.rotation.z = 0; o.position.y = to.y;
    ent.rest.copy(o.position);
    return ok;
  }
  function tinRattle() {
    audio.play('tin'); tin.rattle();
    tw(0.12, (k) => tin.setLid(lerp(0.6, 1, k)), 'out').then((ok) => { if (ok) tw(0.35, (k) => tin.setLid(lerp(1, 0.6, k)), 'outBounce'); });
  }
  function tinHop() {
    if (S.extra >= 5) { tinRattle(); return; }
    const k = S.extra++;
    save();
    tinRattle();
    const ent = mkButton((gagBtnIdx() + 1 + k) % 6);
    loose.push(ent);
    const sp = LAY.tinSpots[k % LAY.tinSpots.length];
    hopButtonOut(ent, new V3(sp[0], 0.03 * BTN_S, sp[1]));
  }
  function hitTin(p) { _a.set(LAY.tin[0], 0.35, LAY.tin[1]); return engine.screenDist(p, _a) < 75 || !!engine.pick(p, tin.group); }

  // ---- optional discoveries on the machine
  let wheelTok = 0;
  function tryDiscovery(p) {
    if (world.current !== 'room' || cur === 'home') return false;
    const h = engine.pick(p, [spoolHit, wheelHit, ...cloth.hit]);
    if (h && h.object === spoolHit) {
      S.thread = (S.thread + 1) % THREADS.length;
      machine.setThreadColor(THREADS[S.thread]);
      audio.play('spool');
      machine.spool.getWorldPosition(_a); _a.y += 0.6;
      fx.emit(_a, 5, 0.15, 0.4, 0.7);
      save();
      return true;
    }
    if (h && h.object === wheelHit) {
      if (def.type === 'sew' && W && !W.done) { W.feedT = Math.min(FEED_END, W.feedT + STITCH); return true; }
      const tk = ++wheelTok;
      audio.play('stitch', { delay: 0.18 });
      tw(0.42, (k) => machine.setPhase(k * 2 * PI), 'inOut', () => tk === wheelTok);
      return true;
    }
    return false;
  }

  // ---- hints / cue
  function recue() { cueOn = false; hints.glow(null); hints.halo(null); hints.halo2(null); hints.finger.hide(); hints.poke(); }
  function cueFrame() {
    const c = stageObj && stageObj.cue;
    const want = !!c && busy === 0 && !drag;
    if (want !== cueOn) {
      cueOn = want;
      if (want) {
        hints.poke(); hopClock = 0;
        hints.glow(c.glow ? c.glow() : null, { strength: c.glowStrength || 1 });
      } else { hints.glow(null); hints.halo(null); hints.halo2(null); hints.finger.hide(); }
    }
    if (cueOn) {
      if (c.halo) { const h = c.halo(); hints.halo(h[0], h[1]); }
      if (c.halo2) { const h = c.halo2(); hints.halo2(h[0], h[1]); }
    } else hints.poke();
  }
  hints.onLevel((l) => {
    if (!cueOn) return;
    const c = stageObj && stageObj.cue;
    if (!c) return;
    if (l >= 1) audio.play('hint', { vol: 0.55 });
    if (l >= 2 && c.finger) hints.finger.show(c.finger, c.fingerOpt || {});
    if (l === 0) hints.finger.hide();
  });

  // ====================================================================== stage types
  const TYPES = {};

  // ---------------------------------------------------------------- 0 fold
  TYPES.fold = {
    cue: {
      glow: () => cloth.group,
      halo: () => { cloth.nearEnd(hA); hA.y = 0.02; haloRet[1] = 1.25; return haloRet; },
      finger: () => { cloth.nearEnd(fA); fA.y += 0.12; fB.set(0, 0.15, 0.9); return fArr; },
      fingerOpt: { duration: 1.5, pause: 0.8 },
    },
    enter() { F = { tok: 0, curl: 0.6 }; },
    down(p) {
      const g = engine.groundPoint(p, 0, _g);
      cloth.nearEnd(_a);
      const ok = (g && Math.abs(g.x) < 1.9 && g.z > 1.2 && g.z < 7.2) || engine.screenDist(p, _a) < 120 || !!engine.pick(p, cloth.hit);
      if (!ok) return false;
      F.tok++;
      const zd = g ? g.z : 5.0;
      drag = { kind: 'fold', zOff: clamp(5.0 - zd, -0.3, 1.0), target: Math.max(ps.fold, 0.08), lastZ: zd };
      ps.nearCurl = 0;
      audio.play('cloth');
      return true;
    },
    move(p) {
      const g = engine.groundPoint(p, 0, _g);
      if (!g) return;
      const z = g.z + drag.zOff;
      drag.target = Math.max(0.08, Math.acos(clamp((z - 2.8) / H, -1, 1)) / PI);
      if (Math.abs(g.z - drag.lastZ) > 0.4) { drag.lastZ = g.z; audio.play('cloth', { vol: 0.35, rate: 1.1 + Math.random() * 0.2 }); }
    },
    up() {
      const d = drag; drag = null;
      if (Math.max(ps.fold, d.target) > 0.45) {
        run(async () => {
          const f0 = ps.fold;
          if (!await tw(0.15 + 0.4 * (1 - f0), (k) => { ps.fold = f0 + (1 - f0) * k; }, 'out')) return;
          ps.fold = 1;
          audio.play('fold');
          cloth.inside(0, 0.5, _a); _a.y += 0.15;
          fx.emit(_a, 8, 0.7, 0.5, 0.9);
          if (!await wt(0.45)) return;
          audio.play('chime');
          if (!await wt(0.2)) return;
          advance('apple1');
        });
      } else {
        const tk = ++F.tok, f0 = ps.fold;
        audio.play('soft', { vol: 0.4 });
        tw(0.45, (k) => { ps.fold = f0 * (1 - k); }, 'out', () => tk === F.tok && !drag);
      }
    },
    update(dt, lvl, t) {
      if (drag && drag.kind === 'fold') {
        ps.fold += (drag.target - ps.fold) * (1 - Math.exp(-dt * 16));
        ps.nearCurl = 0;
      } else {
        const want = cueOn ? (0.55 + 0.3 * lvl + 0.6 * boost) * (0.8 + 0.2 * Math.sin(t * 1.7)) : 0.3;
        ps.nearCurl += (want - ps.nearCurl) * (1 - Math.exp(-dt * 4));
      }
    },
    nudge() { boost = 1; audio.play('cloth', { vol: 0.3 }); },
  };

  // ---------------------------------------------------------------- apple stages
  TYPES.apple = {
    cue: {
      glow: () => E.apple.obj,
      halo: () => { cloth.mouth(hA); hA.y = Math.max(0.1, hA.y); haloRet[1] = 1.0; return haloRet; },
      finger: () => { fA.copy(E.apple.obj.position); fA.y += 0.3; cloth.mouth(fB); fB.y = Math.max(fB.y, 0.1) + 0.3; return fArr; },
      fingerOpt: { duration: 1.4 },
    },
    enter() { },
    down(p) { if (hitEnt(p, E.apple)) { grabProp(E.apple, p); return true; } return false; },
    drop(ent) { if (overBag(ent.obj.position)) insertApple(def.next); else landProp(ent); },
    update(dt, lvl, t) {
      const want = cueOn || (drag && drag.kind === 'prop') ? 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2)) : 0;
      if (busy === 0) ps.gape += (want - ps.gape) * (1 - Math.exp(-dt * 5));
      idleHop(E.apple, dt, lvl);
    },
    nudge() { hop(E.apple, 0.15, false); },
  };

  // ---------------------------------------------------------------- lift stages (+ go)
  function liftTarget(p) {
    camera.getWorldDirection(_d); _d.y = 0;
    if (_d.lengthSq() < 1e-6) _d.set(0, 0, -1);
    _d.normalize();
    _a.set(0, 0, ps.grip.z);
    const q = engine.planePoint(p, _d, _a, _g);
    if (!q) return;
    const y = clamp(q.y, 0.35, 4.7);
    L.target.set(clamp(q.x, -0.6, 0.6), y, lerp(G0.z, 1.3, sstep(0, 3.2, y)));
  }
  function liftLayBack() {
    run(async () => {
      L.held = false; drag = null;
      const from = ps.grip.clone(), sw0 = L.sway;
      view('table', 1.1);
      const y0 = appleLump ? appleLump.y : 0;
      if (!await tw(1.05, (k) => {
        ps.grip.lerpVectors(from, G0, k);
        L.sway = sw0 * (1 - k);
        if (appleIn && appleLump) appleLump.y = lerp(y0, 0.45, k);
      }, 'inOut')) return;
      if (!await wt(0.25)) return;
      advance(def.next);
    });
  }
  function liftSettleBack() {
    const tk = ++L.tok;
    const from = ps.grip.clone();
    view('table', 0.9);
    audio.play('soft', { vol: 0.4 });
    tw(0.6, (k) => { ps.grip.lerpVectors(from, G0, k); }, 'inOut', () => tk === L.tok && !L.held);
  }
  function sway(dir, amt = 0.22) {
    tw(0.1, (k) => { L.sway = dir * amt * k; }, 'out').then((ok) => { if (ok) tw(0.5, (k) => { L.sway = dir * amt * (1 - k); }, 'inOut'); });
  }
  function bulge(lp) {
    const r0 = lp.r;
    tw(0.4, (k) => { lp.r = r0 + 0.1 * Math.sin(PI * k) * (1 - k * 0.5); }, 'linear').then(() => { lp.r = r0; });
  }

  async function gag1() {
    const lp = appleLump;
    audio.play('soft', { vol: 0.5 });
    if (!await tw(0.75, (k) => { lp.x = k; }, 'in')) return false;
    cloth.inside(1, lp.y, _a);
    const from = new V3(_a.x + 0.3, Math.max(_a.y, APPLE_Y + 0.05), _a.z);
    removeLump(lp); appleLump = null; appleIn = false;
    const ent = E.apple;
    ent.obj.position.copy(from);
    audio.play('out', { vol: 0.7 });
    const land = new V3(clamp(from.x + 0.1, 1.15, 1.45), APPLE_Y, 1.15);
    if (!await fall(ent, from, land)) return false;
    if (!await bounce(ent, 0.14, 0.28)) return false;
    audio.play('thud', { vol: 0.35 });
    const c = new V3(LAY.contact1[0], APPLE_Y, LAY.contact1[1]);
    if (!await rollPath(ent, land, new V3(1.85, APPLE_Y, 0.75), c, 1.05)) return false;
    audio.play('knock'); machine.bump(1);
    audio.play('lamp', { delay: 0.14 });
    tw(0.35, (k) => machine.setLamp(k), 'out');
    audio.play('stitch', { delay: 0.2 });
    tw(0.32, (k) => machine.setPhase(k * 2 * PI), 'inOut');
    const rest = new V3(LAY.rest1[0], APPLE_Y, LAY.rest1[1]);
    if (!await rollPath(ent, c, new V3(lerp(c.x, rest.x, 0.5) + 0.02, APPLE_Y, lerp(c.z, rest.z, 0.5)), rest, 0.6, 0.4)) return false;
    ent.rest.copy(rest);
    return true;
  }
  async function gag2() {
    const lp = appleLump;
    audio.play('soft', { vol: 0.5 });
    if (!await tw(0.5, (k) => { lp.x = 0.62 * k; }, 'in')) return false;
    audio.play('boing'); bulge(lp); sway(-1);
    if (!await wt(0.4)) return false;
    if (!await tw(0.95, (k) => { lp.x = lerp(0.62, -1, k); }, 'inOut')) return false;
    cloth.inside(-1, lp.y, _a);
    const from = new V3(_a.x - 0.3, Math.max(_a.y, APPLE_Y + 0.05), _a.z);
    removeLump(lp); appleLump = null; appleIn = false;
    const ent = E.apple;
    ent.obj.position.copy(from);
    audio.play('out', { vol: 0.7 });
    const land = new V3(clamp(from.x - 0.1, -1.75, -1.3), APPLE_Y, 1.2);
    if (!await fall(ent, from, land)) return false;
    if (!await bounce(ent, 0.14, 0.28)) return false;
    audio.play('thud', { vol: 0.35 });
    const c = new V3(LAY.contact2[0], APPLE_Y, LAY.contact2[1]);
    if (!await rollPath(ent, land, new V3(-0.5, APPLE_Y, 3.05), c, 1.3)) return false;
    audio.play('knock');
    tinRattle0();
    // one button hops out of the tin
    if (!gagBtn) gagBtn = mkButton(gagBtnIdx());
    hopButtonOut(gagBtn, new V3(LAY.gagBtn[0], 0.03 * BTN_S, LAY.gagBtn[1]));
    const rest = new V3(LAY.rest2[0], APPLE_Y, LAY.rest2[1]);
    if (!await rollPath(ent, c, new V3(lerp(c.x, rest.x, 0.5), APPLE_Y, lerp(c.z, rest.z, 0.5) + 0.03), rest, 0.6, 0.4)) return false;
    ent.rest.copy(rest);
    if (!await wt(0.6)) return false;
    return true;
  }
  function tinRattle0() {
    audio.play('tin', { delay: 0.03 }); tin.rattle();
    tw(0.12, (k) => tin.setLid(k), 'out').then((ok) => { if (ok) tw(0.4, (k) => tin.setLid(lerp(1, 0.6, k)), 'outBounce'); });
  }
  async function gag3() {
    const lp = appleLump;
    audio.play('soft', { vol: 0.5 });
    if (!await tw(0.5, (k) => { lp.x = 0.62 * k; }, 'in')) return false;
    audio.play('boing'); bulge(lp); sway(-1);
    if (!await wt(0.3)) return false;
    if (!await tw(0.75, (k) => { lp.x = lerp(0.62, -0.62, k); }, 'inOut')) return false;
    audio.play('boing', { rate: 1.12 }); bulge(lp); sway(1);
    if (!await wt(0.3)) return false;
    if (!await tw(0.6, (k) => { lp.x = lerp(-0.62, 0, k); }, 'out')) return false;
    sway(-1, 0.12);
    audio.play('fanfare');
    // sparkles around the bag + glints along both seams
    const n = engine.quality.low ? 8 : 18;
    tw(1.4, () => {
      cloth.inside(0, 0.5, _a);
      if (Math.random() < 0.5) fx.emit(_a, 1, 1.1, 0.6, 0.9);
    }, 'linear');
    for (let i = 0; i < n; i++) { cloth.inside((Math.random() - 0.5) * 2, Math.random(), _a); fx.emit(_a, 1, 0.3, 0.6, 1.0); }
    glintSeam('R'); glintSeam('L');
    audio.play('sparkle', { delay: 0.2 });
    if (!await wt(1.3)) return false;
    return true;
  }
  async function gagGo() {
    audio.play('chime');
    if (!await wt(0.9)) return false;
    audio.play('whoosh');
    const b = VIEWS.lift.box;
    engine.frame({ box: [b[0], b[1] + 1.6, b[2] - 0.5, b[3], b[4] + 1.6, b[5] - 0.5], pitch: VIEWS.lift.pitch - 0.12, duration: 1.4 });
    if (!await wt(0.35)) return false;
    if (!await fadeTo(1, 0.8)) return false;
    applyStage('park', { arrive: true, teleport: true, fadeIn: 0.9 });
    return false;
  }
  function glintSeam(side) {
    const sx = side === 'R' ? 0.91 : -0.91;
    tw(0.9, (k) => {
      cloth.surface(sx, 1 - k, SURF);
      fx.emit(SURF.pos, 1, 0.02, 0.25, 0.5);
    }, 'linear');
  }

  TYPES.lift = {
    cue: {
      glow: () => cloth.group,
      finger: () => { cloth.handleTop(fA); fA.y += 0.06; fB.copy(fA); fB.y += 2.8; return fArr; },
      fingerOpt: { duration: 1.3, pause: 0.8 },
    },
    enter(d) { L = { def: d, held: false, target: G0.clone(), gag: 0, doneAt: 0, tok: 0, sway: 0 }; },
    allowBusy: () => !!L && L.gag === 1,
    down(p) {
      if (L.gag === 2) return false;
      cloth.handleTop(_a);
      const g = engine.groundPoint(p, 0, _g);
      const ok = (ps.grip.y > 0.3 && engine.pick(p, cloth.hit)) || engine.screenDist(p, _a) < 120 || (g && inBagRect(g, 0.45)) || !!engine.pick(p, cloth.hit);
      if (!ok) return false;
      L.tok++; L.held = true;
      drag = { kind: 'lift' };
      ps.grip.y = Math.max(ps.grip.y, 0.35);
      L.target.copy(ps.grip);
      audio.play('cloth');
      if (L.gag === 0) view(world.current === 'park' ? 'parkLift' : 'lift', 0.8);
      liftTarget(p);
      return true;
    },
    move(p) { liftTarget(p); },
    up() {
      L.held = false; drag = null;
      if (L.gag === 2) liftLayBack();
      else if (L.gag === 0) liftSettleBack();
    },
    update(dt, lvl, t) {
      if (L.held || L.gag === 1) {
        if (L.held) {
          const k = 1 - Math.exp(-dt * 14);
          ps.grip.x += (L.target.x + L.sway - ps.grip.x) * k;
          ps.grip.y += (L.target.y - ps.grip.y) * k;
          ps.grip.z += (L.target.z - ps.grip.z) * k;
        } else ps.grip.x += (L.target.x + L.sway - ps.grip.x) * (1 - Math.exp(-dt * 14));
      }
      if (appleIn && appleLump) appleLump.y = lerp(0.45, 0.22, sstep(0.4, 3.0, ps.grip.y));
      if (L.held && L.gag === 0 && ps.grip.y >= 3.5) {
        L.gag = 1;
        const d = L.def;
        const fn = d.go ? gagGo : d.n === 1 ? gag1 : d.n === 2 ? gag2 : gag3;
        run(async () => {
          const ok = await fn();
          if (!ok) return;
          L.gag = 2; L.doneAt = engine.time;
          if (!L.held) liftLayBack();
        });
      }
      if (L.gag === 2 && L.held && engine.time - L.doneAt > 1.5) { drag = null; L.held = false; liftLayBack(); }
      const want = cueOn ? 0.6 + 0.35 * lvl + 0.8 * boost : 0;
      ps.handleWiggle += (want - ps.handleWiggle) * (1 - Math.exp(-dt * 5));
      if (cueOn && lvl >= 1) ps.gape = 0.1 + 0.1 * Math.sin(t * 3); else ps.gape *= 1 - Math.min(1, dt * 4);
    },
    nudge() { boost = 1; },
  };

  // ---------------------------------------------------------------- carry (bag -> machine)
  function carryMetric(g) {
    return C.side === 'R' ? Math.hypot(g.x + 0.91 - N.x, g.z + HANDLE - N.z) : Math.hypot(g.x - N.x, g.z + HANDLE - N.z);
  }
  function carrySnap() {
    run(async () => {
      drag = null;
      const side = C.side;
      bagCenter(_a);
      const c0x = _a.x, c0z = _a.z, y0 = ps.yaw;
      audio.play('soft', { vol: 0.6 });
      if (!await tw(0.2, (k) => machine.setFoot(k), 'out')) return;
      const yaw1 = side === 'R' ? 0 : PI;
      const g1 = side === 'R' ? new V3(N.x - 0.91, 0, N.z - HANDLE) : new V3(N.x - 0.91, 0, N.z + HANDLE + H);
      const c1x = g1.x + Math.sin(yaw1) * HALF, c1z = g1.z + Math.cos(yaw1) * HALF;
      audio.play('cloth', { vol: 0.6 });
      view('sew', 1.5);
      if (!await tw(1.05, (k) => { setCenter(lerp(c0x, c1x, k), lerp(c0z, c1z, k), lerp(y0, yaw1, k)); }, 'inOut')) return;
      machine.setClothThickness(0.05);
      if (!await tw(0.14, (k) => machine.setFoot(1 - k), 'in')) return;
      audio.play('footDown');
      if (!await wt(0.35)) return;
      advance(C.def.next, { camDur: 0.5 });
    });
  }
  TYPES.carry = {
    cue: {
      glow: () => cloth.group,
      halo: () => { hA.set(N.x, N.y + 0.01, N.z + 0.15); haloRet[1] = 0.8; return haloRet; },
      finger: () => { bagCenter(fA); fA.y = 0.2; fB.set(N.x, N.y + 0.1, N.z + 0.55); return fArr; },
      fingerOpt: { duration: 1.5 },
    },
    enter(d) { C = { def: d, side: d.side, target: G0.clone(), start: 0, tok: 0 }; C.start = carryMetric(G0); },
    down(p) {
      const g = engine.groundPoint(p, 0, _g);
      const ok = !!engine.pick(p, cloth.hit) || (g && inBagRect(g, 0.5));
      if (!ok) return false;
      C.tok++;
      drag = { kind: 'carry', lx: g ? g.x : 0, lz: g ? g.z : 0, ok: !!g, rz: 0 };
      C.target.copy(ps.grip);
      audio.play('cloth');
      return true;
    },
    move(p) {
      const g = engine.groundPoint(p, 0, _g);
      if (!g) return;
      if (!drag.ok) { drag.ok = true; drag.lx = g.x; drag.lz = g.z; return; }
      C.target.x = clamp(C.target.x + g.x - drag.lx, -2.2, 1.4);
      C.target.z = clamp(C.target.z + g.z - drag.lz, -2.3, 1.0);
      drag.rz += Math.hypot(g.x - drag.lx, g.z - drag.lz);
      if (drag.rz > 0.6) { drag.rz = 0; audio.play('cloth', { vol: 0.3, rate: 1.15 }); }
      drag.lx = g.x; drag.lz = g.z;
      if (carryMetric(C.target) < (C.side === 'R' ? 1.3 : 1.15)) carrySnap();
    },
    up() {
      drag = null;
      if (C.start - carryMetric(ps.grip) >= 0.8) { carrySnap(); return; }
      const tk = ++C.tok, from = ps.grip.clone();
      audio.play('soft', { vol: 0.4 });
      tw(0.5, (k) => { ps.grip.lerpVectors(from, G0, k); }, 'inOut', () => tk === C.tok && !drag);
    },
    update(dt, lvl, t) {
      if (drag && drag.kind === 'carry') {
        const k = 1 - Math.exp(-dt * 18);
        ps.grip.x += (C.target.x - ps.grip.x) * k; ps.grip.z += (C.target.z - ps.grip.z) * k;
      } else if (cueOn) {
        // the bag gently "leans" toward the machine now and then
        const a = (0.035 + 0.05 * lvl + 0.08 * boost) * Math.pow(Math.max(0, Math.sin(t * 2.6)), 6);
        _a.set(N.x - G0.x - 0.9, 0, N.z - G0.z - 1.0).normalize();
        ps.grip.set(G0.x + _a.x * a, 0, G0.z + _a.z * a);
      }
      const want = cueOn ? 0.25 + 0.2 * lvl : 0;
      ps.handleWiggle += (want - ps.handleWiggle) * (1 - Math.exp(-dt * 5));
    },
    nudge() { boost = 1; },
  };

  // ---------------------------------------------------------------- sew
  function setSewGrip() { ps.grip.set(W.base.x + W.off, 0, W.base.z - W.feed + W.nudge); }
  function finishSeam() {
    run(async () => {
      drag = null;
      audio.loop('motor', 0);
      const side = W.side, f = W.feed / STITCH;
      const tEnd = side === 'R' ? FEED_END / H : 1 - FEED_END / H;
      const sgn = side === 'R' ? 1 : -1;
      const locks = [tEnd - 0.012 * sgn, tEnd, tEnd - 0.006 * sgn];
      for (let i = 0; i < 3; i++) {
        if (!await tw(0.1, (k) => machine.setPhase((f + i + k) * 2 * PI), 'linear')) return;
        addStitch(side, locks[i], W.off);
        audio.play('stitch');
      }
      cloth.setSewn(side, true);
      audio.play('snip', { delay: 0.1 });
      tw(0.25, (k) => machine.setFoot(k), 'out');
      if (!await wt(0.25)) return;
      glintSeam(side);
      audio.play('sparkle');
      audio.play('chime', { delay: 0.35 });
      if (!await wt(0.9)) return;
      view('table', 1.6);
      bagCenter(_a);
      const c0x = _a.x, c0z = _a.z, y0 = ps.yaw;
      const y1 = side === 'R' ? 0 : 2 * PI;
      audio.play('cloth', { vol: 0.5 });
      if (!await tw(0.4, (k) => setCenter(c0x - 0.45 * k, c0z + 0.1 * k, y0), 'inOut')) return;
      const c1 = bagCenter(new V3());
      if (!await tw(1.25, (k) => setCenter(lerp(c1.x, G0.x, k), lerp(c1.z, G0.z + HALF, k), lerp(y0, y1, k)), 'inOut')) return;
      ps.yaw = 0; ps.grip.copy(G0);
      machine.setClothThickness(0.03);
      tw(0.15, (k) => machine.setFoot(1 - k), 'in');
      if (!await wt(0.35)) return;
      advance(W.def.next);
    });
  }
  TYPES.sew = {
    cue: {
      glow: () => cloth.group, glowStrength: 0.45,
      halo2: () => { hB.set(N.x, N.y + 0.035, N.z + 0.32); halo2Ret[1] = 0.2; return halo2Ret; },
      finger: () => { fA.set(N.x - 0.2, N.y + 0.05, N.z + 1.45); fB.set(N.x - 0.08, N.y + 0.05, N.z + 0.32); return fArr; },
      fingerOpt: { duration: 1.1, pause: 0.6 },
    },
    enter(d) {
      const side = d.side, sb = side === 'R' ? 0 : 1;
      let made = 0, lastOff = 0;
      for (const s of S.st) if (s[0] === sb) { made++; lastOff = s[2]; }
      const feed = Math.min(made * STITCH, FEED_END);
      W = {
        def: d, side, made, feed, feedT: feed, off: lastOff, offT: lastOff, speed: 0, motor: 0, nudge: 0, nudgePh: 0, done: false,
        base: new V3(N.x - 0.91, 0, side === 'R' ? N.z - HANDLE : N.z + HANDLE + H),
      };
      ps.yaw = side === 'R' ? 0 : PI;
      setSewGrip();
      machine.setFoot(0); machine.setClothThickness(0.05);
      machine.setPhase(feed / STITCH * 2 * PI);
    },
    down(p) {
      if (W.done) return false;
      W.feedT = Math.min(FEED_END, W.feedT + STITCH);
      const g = engine.groundPoint(p, N.y, _g);
      drag = { kind: 'sew', lx: g ? g.x : 0, lz: g ? g.z : 0, ok: !!g };
      return true;
    },
    move(p) {
      const g = engine.groundPoint(p, N.y, _g);
      if (!g) return;
      if (!drag.ok) { drag.ok = true; drag.lx = g.x; drag.lz = g.z; return; }
      const dz = drag.lz - g.z;
      if (dz > 0) W.feedT = Math.min(FEED_END, W.feedT + Math.min(dz * 0.6, 0.15));
      W.offT = clamp(W.offT + (g.x - drag.lx) * 0.6, -0.1, 0.1);
      drag.lx = g.x; drag.lz = g.z;
    },
    up() { drag = null; },
    update(dt, lvl, t) {
      if (!W || W.done) return;
      const f0 = W.feed;
      const gap = W.feedT - W.feed;
      if (gap > 1e-6) W.feed = Math.min(W.feedT, W.feed + clamp(gap * 7, 0.38, 1.5) * dt);
      W.off += (W.offT - W.off) * (1 - Math.exp(-dt * 6));
      const inst = dt > 0 ? (W.feed - f0) / dt : 0;
      W.speed += (inst - W.speed) * (1 - Math.exp(-dt * 10));
      const mv = W.speed > 0.03 ? clamp(0.25 + W.speed * 0.6, 0, 0.9) : 0;
      if (Math.abs(mv - W.motor) > 0.03 || (mv === 0 && W.motor !== 0)) { W.motor = mv; audio.loop('motor', mv, 0.75 + W.speed * 0.5); }
      const n = Math.floor(W.feed / STITCH + 0.5);
      while (W.made < n) {
        const fa = (W.made + 0.5) * STITCH;
        addStitch(W.side, W.side === 'R' ? fa / H : 1 - fa / H, W.off);
        W.made++;
        audio.play('stitch', { vol: 0.85 });
      }
      // hint level >= 1: the cloth nudges forward and back once, with a tick
      let nud = 0;
      if (cueOn && lvl >= 1 && gap <= 1e-6) {
        const ph0 = W.nudgePh;
        W.nudgePh = (W.nudgePh + dt / 2.2) % 1;
        if (W.nudgePh < ph0) audio.play('stitch', { vol: 0.5 });
        const k = W.nudgePh < 0.25 ? Math.sin(W.nudgePh / 0.25 * PI) : 0;
        nud = -0.03 * k;
        machine.setPhase((W.feed / STITCH + 0.06 * k) * 2 * PI);
      } else { W.nudgePh = 0; machine.setPhase(W.feed / STITCH * 2 * PI); }
      W.nudge = nud;
      setSewGrip();
      if (W.feed >= FEED_END - 1e-6) { W.done = true; finishSeam(); }
    },
    nudge() { if (W && !W.done) W.feedT = Math.min(FEED_END, W.feedT + STITCH); },
  };

  // ---------------------------------------------------------------- button
  TYPES.button = {
    cue: {
      glow: () => gagBtn && gagBtn.obj,
      halo: () => { bagCenter(hA); hA.y = 0.14; haloRet[1] = 1.2; return haloRet; },
      finger: () => { if (gagBtn) fA.copy(gagBtn.obj.position); fA.y += 0.15; bagCenter(fB); fB.y = 0.4; return fArr; },
      fingerOpt: { duration: 1.4 },
    },
    enter() { },
    down(p) { if (gagBtn && hitEnt(p, gagBtn, 75)) { grabProp(gagBtn, p); return true; } return false; },
    drop(ent) { if (overBagFront(ent.obj.position)) attachButton(ent, 'pack'); else landProp(ent); },
    update(dt, lvl) { idleHop(gagBtn, dt, lvl); },
    nudge() { if (gagBtn) hop(gagBtn, 0.15); },
  };

  // ---------------------------------------------------------------- pack
  TYPES.pack = {
    cue: {
      glow: () => { const it = ITEMS[S.packed]; return it ? it.obj : null; },
      halo: () => { cloth.mouth(hA); hA.y = Math.max(0.1, hA.y); haloRet[1] = 1.0; return haloRet; },
      finger: () => { const it = ITEMS[S.packed]; if (it) fA.copy(it.obj.position); fA.y += 0.4; cloth.mouth(fB); fB.y = Math.max(fB.y, 0.1) + 0.35; return fArr; },
      fingerOpt: { duration: 1.4 },
    },
    enter() { },
    down(p) {
      const it = ITEMS[S.packed];
      if (it && hitEnt(p, it, 85)) { grabProp(it, p); return true; }
      for (const b of loose) if (hitEnt(p, b, 55)) { grabProp(b, p); return true; }
      for (const b of attachedObjs) if (engine.screenDist(p, b.position) < 30) { audio.play('button', { vol: 0.5 }); return true; }
      if (hitTin(p)) { tinHop(); return true; }
      return false;
    },
    drop(ent) {
      if (ent.button) { if (overBagFront(ent.obj.position)) attachButton(ent, null); else landProp(ent); return; }
      if (ent === ITEMS[S.packed] && overBag(ent.obj.position)) insertItem(ent); else landProp(ent);
    },
    update(dt, lvl, t) {
      const want = cueOn || (drag && drag.kind === 'prop' && !drag.ent.button) ? 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2)) : 0.05;
      if (busy === 0) ps.gape += (want - ps.gape) * (1 - Math.exp(-dt * 5));
      idleHop(ITEMS[S.packed], dt, lvl);
    },
    nudge() { const it = ITEMS[S.packed]; if (it) hop(it, 0.12); },
  };

  // ---------------------------------------------------------------- park
  function popNext() {
    run(async () => {
      const k = K.out++;
      cloth.mouth(_m);
      const from = new V3(_m.x, Math.max(_m.y, 0.15) + 0.1, _m.z);
      const g0 = ps.gape;
      tw(0.55, (kk) => { ps.gape = g0 + (0.95 - g0) * Math.sin(PI * kk); }, 'linear');
      ps.handleWiggle = 0.8;
      if (k < 3) {
        const it = PARK_ORDER[k];
        if (it.lump) removeLump(it.lump);
        let inside = 0; for (const e of ITEMS) if (!e.obj.visible && e !== it) inside++;
        ps.fill = 0.27 * inside;
        const sp = LAY.park[it.name];
        const to = new V3(sp[0], it.restY + PARK_Y, sp[1]);
        it.tok++;
        it.obj.visible = true; it.obj.position.copy(from); it.obj.rotation.set(0, sp[2], 0);
        audio.play('out'); audio.play(it.snd, { delay: 0.08 });
        if (!await arc(it, from, to, 1.3, 0.62)) return;
        audio.play('thud', { vol: 0.45 });
        it.rest.copy(to);
        if (!await wt(0.12)) return;
      } else {
        const ent = E.apple;
        if (appleLump) removeLump(appleLump);
        appleLump = null; appleIn = false;
        ent.obj.position.copy(from);
        audio.play('out');
        const land = new V3(LAY.park.appleLand[0], APPLE_Y + PARK_Y, LAY.park.appleLand[1]);
        if (!await arc(ent, from, land, 1.4, 0.72)) return;
        audio.play('thud', { vol: 0.6 });
        if (!await bounce(ent, 0.12, 0.26)) return;
        const stop = new V3(LAY.park.appleStop[0], APPLE_Y + PARK_Y, LAY.park.appleStop[1]);
        if (!await rollPath(ent, land, new V3(2.45, APPLE_Y + PARK_Y, 1.55), stop, 1.25, 0.6)) return;
        ent.rest.copy(stop);
        // the bag catches the apple this time
        audio.play('boing', { vol: 0.55, rate: 0.85 });
        const gx = ps.grip.x;
        tw(0.7, (kk) => { ps.grip.x = gx - 0.06 * Math.sin(PI * kk) * (1 - 0.5 * kk); ps.handleWiggle = 0.9 * (1 - kk); }, 'linear');
        if (!await wt(1.2)) return;
        audio.play('chime', { vol: 0.6 });
        if (!await wt(0.8)) return;
        advance('ending');
      }
    });
  }
  TYPES.park = {
    cue: {
      glow: () => cloth.group,
      finger: () => { bagCenter(fA); fA.y = 0.25; return fOne; },
      fingerOpt: { tap: true, duration: 0.6, pause: 1.0 },
    },
    enter(d, o) {
      K = { out: 0 };
      if (o.arrive) {
        run(async () => {
          const top = new V3(0, 4.3, -0.5);
          ps.grip.copy(top); cloth.settle();
          view('parkLift', 0);
          if (!await wt(0.35)) return;
          audio.play('soft', { vol: 0.6 });
          view('park', 1.8);
          if (!await tw(1.7, (k) => { ps.grip.lerpVectors(top, PG0, k); }, 'inOut')) return;
          audio.play('cloth', { vol: 0.4 });
          if (!await wt(0.3)) return;
        });
      }
    },
    down(p) {
      if (K.out >= 4) return false;
      bagCenter(_a);
      const g = engine.groundPoint(p, PARK_Y, _g);
      if (engine.pick(p, cloth.hit) || engine.screenDist(p, _a) < 170 || (g && inBagRect(g, 0.6))) { popNext(); return true; }
      return false;
    },
    update(dt, lvl, t) {
      const want = cueOn ? 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.4)) + 0.2 * boost : 0.1;
      if (busy === 0) ps.gape += (want - ps.gape) * (1 - Math.exp(-dt * 5));
      if (busy === 0) ps.handleWiggle += ((cueOn ? 0.2 * lvl : 0) - ps.handleWiggle) * (1 - Math.exp(-dt * 5));
    },
    nudge() { boost = 1; },
  };

  // ---------------------------------------------------------------- ending
  TYPES.ending = {
    cue: null,
    enter() {
      run(async () => {
        let dur = audio.music('ending');
        if (!(dur > 0)) dur = 17;
        tw(8, (k) => world.setEvening(k), 'inOut');
        engine.frame({ box: [-3.3, 0, -2.6, 3.3, 3.4, 3.3], pitch: 0.3, duration: 13, ease: 'inOut' });
        if (!await wt(dur + 2)) return;
        if (!await fadeTo(1, 1.4)) return;
        finishRound();
      });
    },
  };

  // ---------------------------------------------------------------- home
  TYPES.home = {
    cue: null,
    enter(d, o) {
      run(async () => {
        if (o.arrive) {
          if (!await wt(0.7)) return;
          audio.play('chime');
        }
        if (!await wt(o.arrive ? 3.0 : 2.0)) return;
        advance('fold', { camDur: 2.2 });
      });
    },
  };

  // ====================================================================== peg bags
  function buildPegBags(swingNewest) {
    for (const pb of pegBags) { for (const b of pb.btns) dropObj(b); try { pb.cloth.dispose(); } catch (_) { /* */ } }
    pegBags = [];
    S.bags.forEach((bag, i) => {
      const peg = world.pegs[i];
      if (!peg) return;
      const c = createCloth(FABRICS[bag.f % FABRICS.length].id);
      world.room.add(c.group);
      c.setGround(() => -60);
      c.pose.fold = 1; c.pose.yaw = 0; c.pose.gape = 0.08; c.pose.grip.copy(peg);
      c.setSewn('R', true); c.setSewn('L', true);
      c.setStitches(bag.st.map((s) => ({ side: s[0] ? 'L' : 'R', t: s[1], off: s[2], color: s[3] })));
      c.settle(); c.update(1 / 60);
      const btns = [];
      for (const b of bag.b) { const bt = createButton(b[0]); bt.group.scale.setScalar(BTN_S); world.room.add(bt.group); c.attach(bt.group, b[1], b[2]); btns.push(bt.group); }
      const pb = { cloth: c, btns, peg, t: 0, swing: swingNewest && i === S.bags.length - 1 };
      if (pb.swing) c.pose.grip.set(peg.x - 0.7, peg.y + 0.35, peg.z + 0.3); else c.freeze();
      if (pb.swing) { c.settle(); c.update(1 / 60); }
      pegBags.push(pb);
    });
  }
  function updatePegBags(dt) {
    for (const pb of pegBags) {
      if (!pb.swing) continue;
      pb.t += dt;
      const k = clamp(pb.t / 0.45, 0, 1), e = 1 - Math.pow(1 - k, 3);
      pb.cloth.pose.grip.set(pb.peg.x - 0.7 * (1 - e), pb.peg.y + 0.35 * (1 - e), pb.peg.z + 0.3 * (1 - e));
      pb.cloth.update(dt);
      if (pb.t > 4) { pb.swing = false; pb.cloth.freeze(); }
    }
  }
  function finishRound() {
    S.bags.push({ f: S.round % FABRICS.length, st: S.st.slice(), b: S.btns.slice() });
    while (S.bags.length > 3) S.bags.shift();
    S.round++; S.st = []; S.btns = []; S.packed = 0; S.extra = 0;
    S.thread = THREAD_FOR[S.round % FABRICS.length] ?? 1;
    applyStage('home', { arrive: true, teleport: true, fadeIn: 1.2, pegs: true });
  }

  // ====================================================================== applyStage
  function appleWhere(name) {
    switch (name) {
      case 'fold': case 'apple1': case 'home': return 'start';
      case 'carry1': case 'sew1': case 'apple2': return 'rest1';
      case 'carry2': case 'sew2': case 'apple3': return 'rest2';
      case 'ending': return 'park';
      default: return 'inside';
    }
  }
  function itemInside(k, name) {
    if (name === 'pack') return S.packed > k;
    const i = SI[name];
    return i > SI.pack && i <= SI.park;
  }
  function normalizeState(name) {
    const i = SI[name];
    if (i < SI.sew1 || name === 'home') S.st = [];
    else if (i < SI.sew2) S.st = S.st.filter((s) => s[0] === 0);
    if (i <= SI.button || name === 'home') S.btns = [];
    if (i < SI.pack || name === 'home') { S.packed = 0; S.extra = 0; } else if (i > SI.pack) S.packed = 3;
    if (name === 'pack') S.extra = Math.max(0, S.btns.length - 1);
  }
  function applyStage(name, o = {}) {
    if (!DEF[name]) name = 'fold';
    const restore = !!o.restore, teleport = restore || !!o.teleport;
    killAll();
    busy = 0; drag = null; boost = 0; L = C = W = K = F = null;
    recue(); hints.clear();
    audio.loop('roll', 0); audio.loop('motor', 0);
    cur = name; def = DEF[name]; S.stage = name;
    normalizeState(name);
    save();
    const i = SI[name];
    const inPark = name === 'park' || name === 'ending';
    // world
    world.show(inPark ? 'park' : 'room'); world.setEvening(0);
    audio.loop('room', inPark ? 0 : 1); audio.loop('park', inPark ? 1 : 0);
    // cloth
    const fid = FABRICS[S.round % FABRICS.length].id;
    if (cloth.fabricId !== fid) cloth.setFabric(fid);
    cloth.setGround(inPark ? parkGround : roomGround);
    ps.fold = name === 'fold' || name === 'home' ? 0 : 1;
    ps.nearCurl = 0; ps.yaw = 0; ps.gape = 0; ps.handleWiggle = 0;
    ps.grip.copy(inPark ? PG0 : G0);
    cloth.setSewn('R', i > SI.sew1 && name !== 'home');
    cloth.setSewn('L', i > SI.sew2 && name !== 'home');
    cloth.setStitches(S.st.map((s) => ({ side: s[0] ? 'L' : 'R', t: s[1], off: s[2], color: s[3] })));
    cloth.lumps.length = 0;
    // apple
    const aw = appleWhere(name);
    appleIn = false;
    if (aw === 'inside') {
      if (!appleLump || teleport) appleLump = newLump(0, 0.45, 0.44);
      appleLump.x = 0; appleLump.y = 0.45; appleLump.r = 0.44;
      cloth.lumps.push(appleLump); appleIn = true;
      E.apple.obj.visible = true; E.apple.tok++; E.apple.held = false;
    } else {
      appleLump = null;
      const sp = aw === 'start' ? LAY.apple0 : aw === 'rest1' ? LAY.rest1 : aw === 'rest2' ? LAY.rest2 : LAY.park.appleStop;
      const y0 = aw === 'park' ? PARK_Y : 0;
      const p = E.apple.obj.position;
      if (teleport || Math.hypot(p.x - sp[0], p.z - sp[1]) > 0.05) placeEnt(E.apple, sp[0], sp[1], 0.6, y0);
      else { E.apple.tok++; E.apple.rest.set(sp[0], APPLE_Y + y0, sp[1]); }
    }
    // items
    let nIn = 0;
    ITEMS.forEach((it, k) => {
      if (itemInside(k, name)) {
        it.obj.visible = false; it.tok++;
        if (!it.lump || teleport) it.lump = newLump(it.lumpAt[0], it.lumpAt[1], it.lumpAt[2]);
        cloth.lumps.push(it.lump); nIn++;
      } else {
        const sp = name === 'ending' ? LAY.park[it.name] : LAY[it.name];
        placeEnt(it, sp[0], sp[1], sp[2] || 0, name === 'ending' ? PARK_Y : 0);
        it.lump = null;
      }
    });
    ps.fill = 0.27 * nIn;
    // buttons
    cloth.detachAll();
    for (const b of attachedObjs) dropObj(b);
    attachedObjs.length = 0;
    for (const b of loose) dropObj(b.obj);
    loose.length = 0;
    if (i > SI.lift2 && i <= SI.button) {
      if (!gagBtn) gagBtn = mkButton(gagBtnIdx());
      placeEnt(gagBtn, LAY.gagBtn[0], LAY.gagBtn[1], 0.4);
      gagBtn.obj.position.y = 0.03 * BTN_S; gagBtn.rest.y = 0.03 * BTN_S;
    } else if (gagBtn) { dropObj(gagBtn.obj); gagBtn = null; }
    cloth.update(0);
    for (const b of S.btns) {
      const bt = createButton(b[0]); bt.group.scale.setScalar(BTN_S); scene.add(bt.group);
      cloth.attach(bt.group, b[1], b[2]); attachedObjs.push(bt.group);
    }
    // tin + machine
    tin.setLid(i >= SI.carry2 && i <= SI.go ? 0.6 : 0);
    machine.setLamp(!inPark && i >= SI.carry1 && i <= SI.go ? 1 : 0);
    machine.setFoot(0); machine.setPhase(0); machine.setClothThickness(0.03);
    machine.setThreadColor(THREADS[S.thread]);
    if (o.pegs || restore) buildPegBags(!!o.arrive && name === 'home');
    if (teleport) cloth.settle();
    cloth.update(0);
    fx.clear();
    fx.setSize(def.view === 'sew' ? 0.2 : 0.45);
    view(def.view || 'table', restore ? 0 : (o.camDur != null ? o.camDur : 1.2));
    engine.fade(0, restore ? 0.5 : (o.fadeIn != null ? o.fadeIn : 0.4));
    stageObj = TYPES[def.type];
    try { if (stageObj.enter) stageObj.enter(def, o); } catch (err) { try { console.error(err); } catch (_) { /* */ } }
  }
  function advance(name, o = {}) { applyStage(name, o); }

  // ====================================================================== input
  engine.input.onDown((p) => {
    hints.poke();
    if (!stageObj) return;
    if (busy > 0 && !(stageObj.allowBusy && stageObj.allowBusy())) { answerTap(p); return; }
    if (drag) return;
    const sewFirst = def.type === 'sew';
    if (sewFirst && tryDiscovery(p)) return;
    if (stageObj.down && stageObj.down(p)) return;
    if (!sewFirst && tryDiscovery(p)) return;
    answerTap(p);
    if (stageObj.nudge && busy === 0) stageObj.nudge();
  });
  engine.input.onMove((p) => {
    if (!drag) return;
    hints.poke();
    if (drag.kind === 'prop') propMove(p);
    else if (stageObj && stageObj.move) stageObj.move(p);
  });
  engine.input.onUp((p) => {
    if (!drag) return;
    if (drag.kind === 'prop') propUp();
    else if (stageObj && stageObj.up) stageObj.up(p);
    else drag = null;
  });

  // ====================================================================== frame
  engine.onFrame((dt, t) => {
    const lvl = hints.level;
    boost = Math.max(0, boost - dt * 1.6);
    if (stageObj && stageObj.update) { try { stageObj.update(dt, lvl, t); } catch (err) { try { console.error(err); } catch (_) { /* */ } } }
    if (drag && drag.kind === 'prop') propUpdate(dt);
    cloth.update(dt);
    if (appleIn && appleLump) cloth.inside(appleLump.x, appleLump.y, E.apple.obj.position);
    updatePegBags(dt);
    machine.update(dt);
    tin.update(dt);
    world.update(dt, t);
    fx.update(dt);
    cueFrame();
    hints.update(dt);
  });

  engine.onVisibility((v) => { if (!v) { audio.loop('motor', 0); if (W) W.motor = 0; } });
  engine.onFirstTouch(() => {
    audio.unlock();
    if (cur !== 'ending') audio.music('intro');
  });

  // ====================================================================== start
  buildPegBags(false);
  applyStage(S.stage, { restore: true });
  // 最初の場面に要るシェーダーだけ先に作る（公園はまだ作っていないので、部屋の分だけで済む）。
  try { if (engine.renderer.compile) engine.renderer.compile(scene, camera); } catch (_) { /* */ }
  engine.start();
  warmPark();

  // ---- 裏での読み込み: 公園を遊んでいる間に少しずつ作り、絵とシェーダーも先に GPU へ送っておく
  // （公園へ切り替える瞬間の止まりを防ぐ）。指で動かしている最中とタブが裏のときは待つ。
  // 公園が先に要るときは world.show('park') がその場で仕上げるので、ここが間に合わなくても困らない。
  function warmPark() {
    const later = (fn, ms) => setTimeout(() => { try { fn(); } catch (err) { try { console.error(err); } catch (_) { /* */ } } }, ms);
    const idle = () => !document.hidden && !drag;
    const r = engine.renderer;
    let tex = null;
    function step() {
      if (!idle()) { later(step, 400); return; }
      if (!world.parkReady) { world.preparePark(1); later(step, 150); return; }
      if (!tex) tex = world.parkTextures.slice();
      if (world.current !== 'park' && tex.length) {
        const t = tex.shift();
        if (r.initTexture) r.initTexture(t);
        later(step, 100); return;
      }
      if (world.current === 'park' || !r.compileAsync) return;
      // 部屋と公園は光の構成を揃えてあるので、部屋を見せたまま公園の分を作っておける。
      r.compileAsync(world.park, camera, scene).catch(() => { /* */ });
    }
    later(step, 1200);
  }

  if (__DEV__) {
    window.__g = {
      get state() { return S; }, get stage() { return cur; }, get busy() { return busy; }, get drag() { return drag; },
      goto(name) { applyStage(name, { restore: true }); },
      reset() { engine.store.clear(); S = defaults(); buildPegBags(false); applyStage('fold', { restore: true }); },
      engine, audio, hints, cloth, machine, world, E, N, VIEWS, LAY, tin,
      get gagBtn() { return gagBtn; }, get loose() { return loose; },
      toScreen(x, y, z) { return engine.toScreen(new V3(x, y, z)); },
    };
  }
}
