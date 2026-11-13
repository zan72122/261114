// game.js — ゲーム本体（起動・描画ループ・カメラ・入力・お話の進行・ヒント・保存）
// 前提: THREE, Base, L, Sfx, Room, Jar, Vacuum, Debris が同じスコープにある。読み込まれたら自分で起動する。
const Game = (() => {
  const clamp = Base.clamp, sat = Base.sat, lerp = Base.lerp, smooth = Base.smooth, damp = Base.damp;
  const ease = t => { t = sat(t); return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) * (2 - 2 * t) / 2; };
  const KEY = 'gf261114-2';

  // ステージ名
  const POP = 'pop', BURST = 'burst', VACUUM = 'vacuum', CLEAN = 'clean', CARRY = 'carry',
    DUMP_READY = 'dump_ready', DUMPING = 'dumping', STUCK = 'stuck', DUMP_DONE = 'dump_done',
    RETURN = 'return', ENDING = 'ending', NIGHT = 'night';

  // ---- 基本オブジェクト ----
  let canvas = null, renderer = null, scene = null, camera = null, fitCam = null;
  let W = 1, H = 1, aspect = 1, dprNow = 1, rectL = 0, rectT = 0;
  let running = false, raf = 0, lastNow = 0, time = 0, started = false;

  // 使い回しの一時オブジェクト
  const V3 = THREE.Vector3;
  const tv = new V3(), tv2 = new V3(), tv3 = new V3(), fwd = new V3();
  const sp = { x: 0, y: 0 };
  const rc = { x: 0, z: 0 };
  const near = { x: 0, z: 0 };
  const qId = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new V3(0, 1, 0), 0);

  // ---- 保存 ----
  let round = 0, day = 0;
  function load() {
    try {
      const s = window.localStorage.getItem(KEY);
      if (!s) return;
      const o = JSON.parse(s);
      if (!o || o.v !== 1) return;
      if (Number.isInteger(o.round) && o.round >= 0 && o.round <= 2) round = o.round;
      if (Number.isInteger(o.day) && o.day >= 0 && o.day < 1e6) day = o.day;
    } catch (e) { round = 0; day = 0; }
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, round, day })); } catch (e) { /* 保存できなくても遊べる */ }
  }

  // ---- 品質（動的解像度）----
  // 描く画素数の上限（物理ピクセル）。iPhone 縦（390×844 @2x ≒ 132 万）はそのまま、
  // iPad（834×1194 @2x ≒ 400 万、1024×1366 @2x ≒ 560 万）は 2x より少し下げて 1 フレームの塗りを抑える
  const PIX_BUDGET = 2.6e6;
  const QS = [1, 0.88, 0.76, 0.66];
  let qIdx = 0, avgMs = 16, slowT = 0, perfWarm = 2, perfDone = false, prevAvg = 0, probing = false;
  function applySize() {
    dprNow = window.devicePixelRatio || 1;
    let pr = Math.min(dprNow, Base.quality.maxDpr);
    pr = Math.min(pr, Math.max(1, Math.sqrt(PIX_BUDGET / (W * H))));
    renderer.setPixelRatio(pr * QS[qIdx]);
    renderer.setSize(W, H, false);
    const r = canvas.getBoundingClientRect();
    rectL = r.left; rectT = r.top;
  }
  let needResize = true;
  function readSize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
    if (needResize || w !== W || h !== H || (window.devicePixelRatio || 1) !== dprNow) {
      needResize = false;
      W = w; H = h; aspect = W / H;
      applySize();
    }
  }
  function setQuality(i) {
    qIdx = i;
    // 段 2 以降は影の解像度を下げる（影そのものは消さない: 消すと全シェーダーの作り直しで大きく止まる）
    const low = qIdx >= 2;
    if (low !== Base.quality.low) {
      Base.quality.low = low;
      try { Room.applyQuality(); } catch (e) { /* 続行 */ }
      shadowDirty = true;
    }
    applySize();
  }
  // 1.5 秒続けて 60fps に届かない（約 38fps 未満）ときに 1 段ずつ解像度を下げる。
  // 下げても速くならない（省電力モードなどで 30fps に固定されている）ときは元に戻して、それ以上は下げない
  function perf(real) {
    if (perfDone || real > 0.5) return; // 一時停止明けなどは無視
    if (perfWarm > 0) { perfWarm -= real; return; }
    avgMs = avgMs * 0.92 + real * 1000 * 0.08;
    if (probing) {
      slowT += real;
      if (slowT < 1.5) return;
      probing = false; slowT = 0;
      if (avgMs > prevAvg * 0.9) { setQuality(qIdx - 1); perfDone = true; return; }
    }
    if (avgMs > 26) slowT += real; else slowT = 0;
    if (slowT > 1.5) {
      if (qIdx >= QS.length - 1) { perfDone = true; return; }
      prevAvg = avgMs; probing = true;
      slowT = 0; perfWarm = 0.5;
      setQuality(qIdx + 1);
    }
  }

  // ---- 影の描き直しは「影を落とす物が動いたときだけ」----
  // 部屋の家具・壁は止まっているので、そうじきやくす玉が止まっている間は前の影をそのまま使う
  let shadowDirty = true, sunLight = null, castN = 0, castPrev = -1;
  const shadowRec = new Map();
  const sunRec = new Float64Array(33);
  function recChanged(o, vis) {
    let r = shadowRec.get(o);
    if (!r) { r = { m: new Float64Array(16), v: -1, iv: -1, n: -1, g: null, on: false }; shadowRec.set(o, r); }
    const on = vis && o.castShadow;
    if (!on) { if (r.on) { r.on = false; return true; } return false; }
    let ch = !r.on; r.on = true; castN++;
    const e = o.matrixWorld.elements, m = r.m;
    for (let i = 0; i < 16; i++) if (m[i] !== e[i]) { m[i] = e[i]; ch = true; }
    const g = o.geometry, pa = g && g.attributes && g.attributes.position;
    const v = pa ? pa.version : 0;
    if (g !== r.g || v !== r.v) { r.g = g; r.v = v; ch = true; }
    if (o.isInstancedMesh) {
      if (o.instanceMatrix.version !== r.iv || o.count !== r.n) { r.iv = o.instanceMatrix.version; r.n = o.count; ch = true; }
    }
    return ch;
  }
  function walkShadow(o, vis) {
    vis = vis && o.visible;
    let ch = false;
    if (o.isMesh || o.isLine || o.isPoints) ch = recChanged(o, vis);
    const c = o.children;
    for (let i = 0; i < c.length; i++) if (walkShadow(c[i], vis)) ch = true;
    return ch;
  }
  function updateShadowFlag() {
    const sm = renderer.shadowMap;
    if (!sunLight) {
      scene.traverse(o => { if (!sunLight && o.isDirectionalLight && o.castShadow) sunLight = o; });
      if (!sunLight) return;
      sm.autoUpdate = false;
    }
    scene.updateMatrixWorld();
    castN = 0;
    let ch = walkShadow(scene, true);
    if (castN !== castPrev) { castPrev = castN; ch = true; } // 影を落とす物が減った（外された）とき
    // 太陽の向き・影の範囲・解像度・影の有無
    const sh = sunLight.shadow, a = sunLight.matrixWorld.elements, b = sh.camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) {
      if (sunRec[i] !== a[i]) { sunRec[i] = a[i]; ch = true; }
      if (sunRec[16 + i] !== b[i]) { sunRec[16 + i] = b[i]; ch = true; }
    }
    const on = sunLight.castShadow ? sh.mapSize.x : 0;
    if (sunRec[32] !== on) { sunRec[32] = on; ch = true; }
    if (!sh.map) ch = true;
    if (ch || shadowDirty) { sm.needsUpdate = true; shadowDirty = false; }
  }

  // ---- カメラ ----
  const views = Object.create(null);
  const fitPts = [];
  function buildFitPts() {
    const p = L.play, b = L.basket, t = L.trash, m = L.jarMount;
    fitPts.push(new V3(-p.hwFar, 0, p.zFar), new V3(p.hwFar, 0, p.zFar), new V3(-p.hwNear, 0, p.zNear), new V3(p.hwNear, 0, p.zNear));
    // かご・ごみ箱は「だいたい見えていればよい」（外側の端は少し切れてよい。床を大きく見せるほうを優先）
    for (const o of [b, t]) {
      const sgn = o.x < 0 ? -1 : 1;
      fitPts.push(new V3(o.x + sgn * o.r * 0.3, o.h, o.z), new V3(o.x, 0, o.z + o.r));
    }
    fitPts.push(new V3(m.x, m.y, m.z), new V3(m.x - L.jar.r, m.y, m.z), new V3(m.x + L.jar.r, m.y, m.z));
  }
  function fits(cam) {
    for (let i = 0; i < fitPts.length; i++) {
      tv3.copy(fitPts[i]).project(cam);
      if (tv3.z > 1) return false;
      if (tv3.x < -1 + 0.03 || tv3.x > 1 - 0.03 || tv3.y > 1 - 0.06 || tv3.y < -1 + 0.04) return false;
    }
    return true;
  }
  function fitFov(c, a) {
    const cam = fitCam;
    cam.position.copy(c.pos); cam.aspect = a;
    cam.lookAt(c.target);
    for (let i = 0; i <= 16; i++) {
      cam.fov = c.fov + i;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      if (fits(cam)) return cam.fov;
    }
    return c.fov + 16;
  }
  // ビュー名 + いまの縦横比（+ round）から求める。値が変わったときだけ L を呼ぶ
  function viewOf(name) {
    const ak = Math.round(aspect * 1000);
    const key = name === 'before' ? round * 1e6 + ak : ak;
    let c = views[name];
    if (!c) c = views[name] = { key: -1, pos: new V3(), target: new V3(), fov: 50 };
    if (c.key === key) return c;
    c.key = key;
    const v = name === 'before' ? L.camBefore(round, aspect)
      : name === 'jar' ? L.camJarClose(aspect)
      : name === 'dump' ? L.camDump(aspect)
      : L.camPlay(aspect);
    c.pos.fromArray(v.pos); c.target.fromArray(v.target); c.fov = v.fov;
    if (name === 'play') c.fov = fitFov(c, aspect);
    return c;
  }
  let viewName = 'before', camT = 0, camDur = 0;
  const camFrom = { pos: new V3(), target: new V3(), fov: 50 };
  const curTarget = new V3();
  function setView(name, dur) {
    camFrom.pos.copy(camera.position);
    camFrom.target.copy(curTarget);
    camFrom.fov = camera.fov;
    viewName = name; camT = 0; camDur = Math.max(0, dur || 0);
  }
  const camDone = () => camT >= camDur;
  function updateCamera(dt) {
    const b = viewOf(viewName);
    if (camT < camDur) {
      camT = Math.min(camDur, camT + dt);
      const e = ease(camT / camDur);
      camera.position.lerpVectors(camFrom.pos, b.pos, e);
      curTarget.lerpVectors(camFrom.target, b.target, e);
      camera.fov = lerp(camFrom.fov, b.fov, e);
    } else {
      camera.position.copy(b.pos); curTarget.copy(b.target); camera.fov = b.fov;
    }
    camera.aspect = aspect;
    camera.lookAt(curTarget);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ---- 画面 ⇔ 世界 ----
  const mn = () => Math.min(W, H);
  function toScreen(v, out) {
    tv3.copy(v).project(camera);
    if (tv3.z > 1 || tv3.z < -1) return false;
    out.x = (tv3.x + 1) * 0.5 * W; out.y = (1 - tv3.y) * 0.5 * H;
    return true;
  }
  // 世界の点 v の画面上の位置と指の距離（px）。画面外・背後は大きな値
  function ptrDist(v) { return toScreen(v, sp) ? Math.hypot(sp.x - ptr.x, sp.y - ptr.y) : 1e9; }
  // 指のレイと平面 y=h の交点
  function rayPlane(h, out) {
    ndc.set(ptr.x / W * 2 - 1, -(ptr.y / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    plane.constant = -h;
    return raycaster.ray.intersectPlane(plane, out) !== null;
  }

  // ---- 状態 ----
  let stage = POP, st = 0, stPrev = 0;
  let idle = 0, hintStep = 0;
  let downMode = 'none'; // 'none' | 'touch' | 'pull' | 'floor' | 'peek' | 'carry'
  const ptr = { id: null, x: 0, y: 0, x0: 0, y0: 0, down: false };

  // そうじき
  let motor = 0, motorTarget = 0, strain = 0, strainTarget = 0, flow = 0, flowAcc = 0;
  let hx = L.head.restX, hz = L.head.restZ, lift = 0, vx = 0, vz = 0, phx = hx, phz = hz;
  let tpx = hx, tpz = hz; // ラグの跡の直前点
  const mouth = new V3();
  const headS = { x: 0, z: 0, lift: 0, yaw: 0, motor: 0, mouth, vx: 0, vz: 0 };
  const vacS = { motor: 0, strain: 0, flow: 0, time: 0 };
  let sockAuto = -1, autoX = 0, autoZ = 0, dropT = 0, sockFlying = 0;
  const socks = L.socks.map(s => ({ x: s.x, z: s.z, inB: false }));
  let cleanX = 0, cleanZ = 0;

  // 吸い込み → カップへの待ち行列（リングバッファ）
  const QN = 512;
  const qT = new Float64Array(QN), qC = new Float64Array(QN), qType = new Array(QN).fill('paper');
  let qHead = 0, qLen = 0;
  function qPush(t, type, color) {
    if (qLen >= QN) { // あふれたら最古をすぐ入れる
      try { Jar.add(qType[qHead], qC[qHead]); } catch (e) { /* 続行 */ }
      qHead = (qHead + 1) % QN; qLen--;
    }
    const i = (qHead + qLen) % QN;
    qT[i] = t; qType[i] = type; qC[i] = color; qLen++;
  }
  function qFlush() {
    while (qLen > 0 && qT[qHead] <= time) {
      Jar.add(qType[qHead], qC[qHead]);
      qHead = (qHead + 1) % QN; qLen--;
    }
  }

  // くす玉
  let popFails = 0, pull = 0;
  // カップ
  let jarMounted = true;
  const carryTgt = new V3();
  const jt = { active: false, t: 0, dur: 0.3, p0: new V3(), q0: new THREE.Quaternion(), p1: new V3(), q1: new THREE.Quaternion(), mount: false };
  let dumpPressT = -1, lidOpen = false;

  // ---- 光らせる（値が変わったときだけ呼ぶ）----
  const gc = Object.create(null);
  const chg = (k, a) => { if (gc[k] === a) return false; gc[k] = a; return true; };
  const vGlow = (part, a) => { if (chg('v' + part, a)) Vacuum.setGlow(part, a); };
  const jGlow = (part, a) => { if (chg('j' + part, a)) Jar.setGlow(part, a); };
  const rGlow = (name, a) => { if (chg('r' + name, a)) Room.setGlow(name, a); };
  const twinkle = a => { if (chg('tw', a)) Debris.setTwinkle(a); };
  const glint = (i, a) => { if (chg('k' + i, a)) Room.kusu[i].setGlint(a); };
  // 夕方は全体の露出も少し下げる（そうじき等、部屋以外の物も一緒に暗くなるように）
  const setTime = t => { if (chg('time', t)) { Room.setTime(t); if (renderer) renderer.toneMappingExposure = 1 - 0.24 * Base.smooth(t); } };
  function glowsOff() {
    vGlow('head', 0); vGlow('cradle', 0); vGlow('power', 0);
    jGlow('handle', 0); jGlow('button', 0);
    rGlow('basket', 0); rGlow('trash', 0);
    twinkle(0);
    for (let i = 0; i < 3; i++) glint(i, 0);
  }

  // ---- ステージ遷移 ----
  // st は入った直後のフレームで 0 をまたぐ（at(0) が 1 回だけ真になる）
  function enter(s) {
    stage = s;
    st = -1e-6; stPrev = -1e-6;
    idle = 0; hintStep = 0;
    if (downMode !== 'none') downMode = 'none';
    hideDemo();
  }
  const at = t => stPrev < t && st >= t;

  // ---- 指のお手本 ----
  let finger = null;
  const demo = { on: false, kind: 'drag', t: 0, n: 0, pts: [new V3(), new V3(), new V3(), new V3()], len: [0, 0, 0, 0], total: 0 };
  function makeFinger() {
    const tex = Base.canvasTex(128, 256, (g, w, h) => {
      // はっきりした肌色の指先（上が指先）。ふちはやわらかく、根元へ向かって消える
      const fw = 80, x0 = (w - fw) / 2, top = 14, r = fw / 2;
      const capsule = () => {
        g.beginPath();
        g.moveTo(x0, top + r);
        g.arc(x0 + r, top + r, r, Math.PI, 0);
        g.lineTo(x0 + fw, h + 40);
        g.lineTo(x0, h + 40);
        g.closePath();
      };
      g.save();
      g.shadowColor = 'rgba(120,70,50,0.55)'; g.shadowBlur = 9;
      const sk = g.createLinearGradient(x0, 0, x0 + fw, 0);
      sk.addColorStop(0, '#dfa184'); sk.addColorStop(0.3, '#f7cfb6'); sk.addColorStop(0.62, '#fbdcc6'); sk.addColorStop(1, '#d99a7e');
      g.fillStyle = sk; capsule(); g.fill();
      g.restore();
      // 爪
      g.save();
      const ng = g.createLinearGradient(0, top + 6, 0, top + 62);
      ng.addColorStop(0, '#fdeee8'); ng.addColorStop(1, '#f3c3b6');
      g.fillStyle = ng;
      g.beginPath(); g.ellipse(w / 2, top + 36, 22, 27, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(190,120,100,0.45)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.ellipse(w / 2 - 7, top + 26, 6, 10, -0.3, 0, Math.PI * 2); g.fill();
      // 関節のしわ（うっすら）
      g.strokeStyle = 'rgba(180,110,90,0.35)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x0 + 14, top + 112); g.quadraticCurveTo(w / 2, top + 104, x0 + fw - 14, top + 112); g.stroke();
      g.restore();
      // 根元に向かって消える
      g.save();
      g.globalCompositeOperation = 'destination-in';
      const fg = g.createLinearGradient(0, 0, 0, h);
      fg.addColorStop(0, 'rgba(0,0,0,1)'); fg.addColorStop(0.55, 'rgba(0,0,0,1)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fg; g.fillRect(0, 0, w, h);
      g.restore();
    });
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0, toneMapped: false });
    finger = new THREE.Sprite(mat);
    finger.center.set(0.5, 1 - 15 / 256); // 指先がスプライトの上端
    finger.renderOrder = 1000;
    finger.frustumCulled = false;
    finger.visible = false;
    scene.add(finger);
  }
  function hideDemo() {
    demo.on = false;
    if (finger) { finger.visible = false; finger.material.opacity = 0; }
  }
  function showDemo(kind) {
    demo.on = true; demo.kind = kind; demo.t = 0;
    fillDemo();
  }
  function jarWorld(out) { Jar.object.updateWorldMatrix(true, false); return Jar.object.getWorldPosition(out); }
  // 指の位置 = ヘッド位置 + 手前 10cm（ヘッドは指先の少し奥に来るため）
  function fillDemo() {
    const P = demo.pts, b = L.basket;
    let n = 0;
    switch (stage) {
      case POP: {
        const k = Room.kusu[round];
        k.getRing(P[0]); P[1].copy(P[0]); P[1].y -= 0.14; n = 2;
        break;
      }
      case VACUUM: {
        P[0].set(hx, 0, hz + 0.10);
        if (Debris.stuckSock() >= 0) {
          P[1].set(b.x, 0, b.z + b.r + 0.12 + 0.10); n = 2;
        } else if (Debris.nearest(hx, hz, near)) {
          P[1].set(near.x, 0, near.z + 0.10);
          let dx = near.x - hx, dz = near.z - hz; const d = Math.hypot(dx, dz) || 1;
          dx /= d; dz /= d;
          L.clampReach(near.x + dx * 0.15, near.z + dz * 0.15, rc);
          P[2].set(rc.x, 0, rc.z + 0.10); n = 3;
        } else {
          const s = nearestSock();
          if (s) { P[1].set(s.x, 0, s.z + 0.10); P[2].set(b.x, 0, b.z + b.r + 0.12 + 0.10); n = 3; }
        }
        break;
      }
      case CARRY: jarWorld(P[0]); P[1].set(L.dumpPos.x, L.dumpPos.y, L.dumpPos.z); n = 2; break;
      case RETURN: jarWorld(P[0]); P[1].set(L.jarMount.x, L.jarMount.y, L.jarMount.z); n = 2; break;
      case DUMP_READY: case STUCK: jarWorld(P[0]); n = 1; break;
      default: n = 0;
    }
    demo.n = n;
    if (n === 0) { hideDemo(); return; }
    let tot = 0;
    for (let i = 1; i < n; i++) { demo.len[i] = P[i].distanceTo(P[i - 1]); tot += demo.len[i]; }
    demo.total = tot;
  }
  function demoPoint(u, out) { // u 0..1 を折れ線上の点へ
    const P = demo.pts;
    if (demo.n < 2 || demo.total <= 1e-6) return out.copy(P[0]);
    let d = u * demo.total;
    for (let i = 1; i < demo.n; i++) {
      if (d <= demo.len[i] || i === demo.n - 1) return out.lerpVectors(P[i - 1], P[i], demo.len[i] > 0 ? sat(d / demo.len[i]) : 1);
      d -= demo.len[i];
    }
    return out.copy(P[demo.n - 1]);
  }
  function updateDemo(dt) {
    if (!demo.on || !finger) return;
    const cycle = demo.kind === 'drag' ? 3.2 : 2.5;
    demo.t += dt;
    if (demo.t >= cycle) { demo.t -= cycle; fillDemo(); if (!demo.on) return; }
    const t = demo.t;
    let a = 0, s = 1;
    if (demo.kind === 'drag') {
      if (t < 0.25) { a = smooth(t / 0.25); demoPoint(0, tv2); }
      else if (t < 0.4) { a = 1; s = 1 - 0.1 * smooth((t - 0.25) / 0.15); demoPoint(0, tv2); }
      else if (t < 1.75) { a = 1; s = 0.9; demoPoint(ease((t - 0.4) / 1.35), tv2); }
      else if (t < 2.0) { const k = (t - 1.75) / 0.25; a = 1 - smooth(k); s = 0.9 + 0.1 * k; demoPoint(1, tv2); }
      else { a = 0; demoPoint(1, tv2); }
    } else {
      tv2.copy(demo.pts[0]);
      if (t < 0.25) a = smooth(t / 0.25);
      else if (t < 1.05) {
        a = 1;
        const b1 = Math.max(0, 1 - Math.abs(t - 0.48) / 0.1), b2 = Math.max(0, 1 - Math.abs(t - 0.82) / 0.1);
        s = 1 - 0.12 * Math.max(b1, b2);
      } else if (t < 1.3) a = 1 - smooth((t - 1.05) / 0.25);
      else a = 0;
    }
    if (a <= 0.001) { finger.visible = false; return; }
    finger.visible = true;
    finger.position.copy(tv2);
    // 画面上で幅 ≈ 0.15×min(幅,高さ) px になるよう、奥行きから大きさを決める
    camera.getWorldDirection(fwd);
    const depth = Math.max(0.05, tv3.copy(tv2).sub(camera.position).dot(fwd));
    const perPx = 2 * depth * Math.tan(camera.fov * Math.PI / 360) / H;
    const w = 0.2 * mn() * perPx * s;
    finger.scale.set(w, w * 2, 1);
    finger.material.opacity = 0.72 * a;
  }

  // ---- くつしたの居場所（Debris に取得 API が無いので、イベントから推定）----
  function resetSockTrack(onFloor) {
    for (let i = 0; i < socks.length; i++) { socks[i].x = L.socks[i].x; socks[i].z = L.socks[i].z; socks[i].inB = !onFloor; }
  }
  function nearestSock() {
    let best = null, bd = 1e9;
    const stuck = Debris.stuckSock();
    for (let i = 0; i < socks.length; i++) {
      if (socks[i].inB || i === stuck) continue;
      const d = Math.hypot(socks[i].x - hx, socks[i].z - hz);
      if (d < bd) { bd = d; best = socks[i]; }
    }
    return Debris.socksLeft() > 0 ? best : null;
  }

  // ---- ヘッド ----
  function moveHead(tx, tz, dt) {
    const nx = damp(hx, tx, 18, dt), nz = damp(hz, tz, 18, dt);
    let dx = nx - hx, dz = nz - hz;
    const d = Math.hypot(dx, dz), mx = 4.5 * dt;
    if (d > mx && d > 0) { dx *= mx / d; dz *= mx / d; }
    hx += dx; hz += dz;
  }

  // ---- カップ ----
  function jarTween(x, y, z, q, dur, mount) {
    const o = Jar.object;
    jt.p0.copy(o.position); jt.q0.copy(o.quaternion);
    jt.p1.set(x, y, z); jt.q1.copy(q);
    jt.t = 0; jt.dur = Math.max(0.01, dur); jt.mount = !!mount; jt.active = true;
  }
  function placeJar(x, z, dur) {
    z = clamp(z, L.play.zFar, 0.8);
    const hw = L.playHalfW(z);
    x = clamp(x, -hw, hw);
    for (const o of [L.basket, L.trash]) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), m = o.r + L.jar.r + 0.04;
      if (d < m) { const k = m / (d || 1e-4); x = o.x + dx * k; z = o.z + dz * k; }
    }
    jarTween(x, L.jar.h / 2 + 0.005, z, qId, dur, false);
  }
  function startMountTween() {
    const m = Vacuum.jarMount;
    m.updateWorldMatrix(true, false);
    m.getWorldPosition(tv2); m.getWorldQuaternion(qTmp);
    jarTween(tv2.x, tv2.y, tv2.z, qTmp, 0.35, true);
  }
  function updateJar(dt) {
    if (jarMounted) return;
    const o = Jar.object;
    if (downMode === 'carry') {
      if (rayPlane(L.carryY, tv)) carryTgt.set(clamp(tv.x, -0.9, 0.9), L.carryY, clamp(tv.z, -1.0, 1.6));
      o.position.lerp(carryTgt, 1 - Math.exp(-12 * dt));
      o.quaternion.slerp(qId, 1 - Math.exp(-10 * dt));
      if (stage === CARRY && Math.hypot(o.position.x - L.dumpPos.x, o.position.z - L.dumpPos.z) < 0.38) {
        downMode = 'none'; enter(DUMP_READY);
      } else if (stage === RETURN && Math.hypot(o.position.x - L.jarMount.x, o.position.z - L.jarMount.z) < 0.42) {
        downMode = 'none'; startMountTween();
      }
    } else if (jt.active) {
      jt.t += dt;
      const e = ease(jt.t / jt.dur);
      o.position.lerpVectors(jt.p0, jt.p1, e);
      o.quaternion.slerpQuaternions(jt.q0, jt.q1, e);
      if (jt.t >= jt.dur) {
        jt.active = false;
        if (jt.mount) {
          jt.mount = false;
          Vacuum.attachJar(Jar.object); jarMounted = true;
          Sfx.jarClick();
          if (stage === RETURN) enter(ENDING);
        }
      }
    }
  }
  function grabJar() {
    if (jt.active && jt.mount) return false;
    if (ptrDist(jarWorld(tv2)) > 0.30 * mn()) return false;
    if (jarMounted) {
      Vacuum.detachJar(Jar.object, scene); jarMounted = false;
      Sfx.jarRelease();
    }
    jt.active = false;
    carryTgt.copy(Jar.object.position);
    downMode = 'carry';
    return true;
  }

  // ---- 入力 ----
  function pressed() {
    idle = 0; hintStep = 0;
    hideDemo();
    switch (stage) {
      case POP: {
        const k = Room.kusu[round];
        k.touch(); Sfx.kusuTouch();
        if (popFails >= 2) { openKusu(); return; } // 3 回目のタッチで開く（救済）
        k.getRing(tv2);
        let grab = ptrDist(tv2) <= 0.28 * mn();
        if (!grab) {
          k.getBall(tv2);
          if (toScreen(tv2, sp) && Math.abs(ptr.x - sp.x) <= 0.2 * W && ptr.y > sp.y) grab = true;
        }
        pull = 0;
        downMode = grab ? 'pull' : 'touch';
        break;
      }
      case VACUUM: {
        tv2.set(L.jarMount.x, L.jarMount.y, L.jarMount.z);
        if (ptrDist(tv2) <= 0.24 * mn()) { downMode = 'peek'; setView('jar', 0.45); }
        else downMode = 'floor';
        break;
      }
      case CARRY: case RETURN: grabJar(); break;
      case DUMP_READY:
        if (st >= 0.8 && dumpPressT < 0 && !jt.active) {
          Jar.setHatch(true); Sfx.hatch(true); dumpPressT = st;
        }
        break;
      case STUCK: Jar.shake(); Sfx.shake(); break;
      case NIGHT:
        if (st >= 3.5 && st < 5.99) { st = 5.99; stPrev = 5.989; } // 静止中のタップは朝を早めるだけ
        break;
      default: break; // 自動で進むステージ中は無視
    }
  }
  function moved() {
    if (stage === POP && downMode === 'pull') {
      pull = clamp((ptr.y - ptr.y0) / (0.15 * H), 0, 1);
      Room.kusu[round].setPull(pull);
      if (pull >= 1) openKusu();
    }
  }
  function released() {
    const m = downMode;
    downMode = 'none';
    switch (stage) {
      case POP:
        if (m === 'pull') {
          if (pull > 0.5) { openKusu(); return; }
          Room.kusu[round].setPull(0); pull = 0; popFails++;
        } else if (m === 'touch') popFails++;
        break;
      case VACUUM:
        if (m === 'peek') setView('play', 0.45);
        break;
      case CARRY: case RETURN:
        if (m === 'carry' && !jarMounted) {
          placeJar(Jar.object.position.x, Jar.object.position.z, 0.25);
          Sfx.jarSet();
        }
        break;
      default: break;
    }
  }
  function openKusu() {
    if (stage !== POP) return;
    downMode = 'none';
    enter(BURST);
  }

  function onDown(e) {
    try {
      if (e.cancelable) e.preventDefault();
      try { Sfx.init(); } catch (err) { /* 音なしで続行 */ }
      if (ptr.id !== null) return; // 最初の 1 本だけ
      ptr.id = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 続行 */ }
      ptr.x = ptr.x0 = e.clientX - rectL; ptr.y = ptr.y0 = e.clientY - rectT;
      ptr.down = true;
      if (started) pressed();
    } catch (err) { /* 続行 */ }
  }
  function onMove(e) {
    if (e.pointerId !== ptr.id) return;
    try {
      ptr.x = e.clientX - rectL; ptr.y = e.clientY - rectT;
      if (started) moved();
    } catch (err) { /* 続行 */ }
  }
  function onUp(e) {
    if (e.pointerId !== ptr.id) return;
    ptr.x = e.clientX - rectL; ptr.y = e.clientY - rectT;
    release();
  }
  function release() {
    if (ptr.id === null) return;
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(ptr.id)) canvas.releasePointerCapture(ptr.id); } catch (err) { /* 続行 */ }
    ptr.id = null; ptr.down = false;
    try { if (started) released(); } catch (err) { /* 続行 */ }
  }

  // ---- ステージごとの毎フレーム ----
  function stepStage(dt) {
    switch (stage) {
      case POP: {
        if (at(0)) { popFails = 0; pull = 0; motorTarget = 0; setTime(0); Room.kusu[round].setPull(0); }
        if (!ptr.down) {
          if (hintStep < 1 && idle >= 4) { hintStep = 1; Sfx.hint(); }
          if (hintStep < 2 && idle >= 8) { hintStep = 2; showDemo('drag'); }
        }
        for (let i = 0; i < 3; i++) glint(i, i === round ? (ptr.down ? 0.2 : idle >= 4 ? 1 : 0.45) : 0);
        break;
      }
      case BURST: {
        if (at(0)) {
          const k = Room.kusu[round];
          glint(round, 0);
          k.open(); Sfx.kusuOpen();
          k.getBall(tv2);
          Debris.burst(round, { x: tv2.x, y: tv2.y, z: tv2.z });
        }
        if (at(0.5)) setView('play', 2.2);
        if (st > 0.5 && camDone()) enter(VACUUM);
        break;
      }
      case VACUUM: stepVacuum(dt); break;
      case CLEAN: {
        if (at(0)) {
          downMode = 'none'; motorTarget = 0;
          Sfx.powerDown(); Sfx.chime('clean');
          twinkle(0); vGlow('head', 0);
          cleanX = hx; cleanZ = hz;
          if (viewName !== 'play') setView('play', 0.45);
        }
        motorTarget = 0;
        if (st >= 0) {
          const e = smooth(st / 1.2);
          hx = lerp(cleanX, L.head.restX, e); hz = lerp(cleanZ, L.head.restZ, e);
          lift = damp(lift, 0, 10, dt);
        }
        if (at(0.6) && Jar.count() > 0) { Room.trash.setLid(1); lidOpen = true; Sfx.lid(true); }
        if (st >= 1.6) enter(Jar.count() === 0 ? ENDING : CARRY);
        break;
      }
      case CARRY: case RETURN: {
        if (at(0)) {
          jGlow('handle', 1);
          if (stage === CARRY) rGlow('trash', 1); else vGlow('cradle', 1);
        }
        if (!ptr.down) {
          if (hintStep < 1 && idle >= 4) { hintStep = 1; Sfx.hint(); }
          if (hintStep < 2 && idle >= 8) { hintStep = 2; showDemo('drag'); }
        }
        break;
      }
      case DUMP_READY: {
        if (at(0)) {
          dumpPressT = -1;
          jarTween(L.dumpPos.x, L.dumpPos.y, L.dumpPos.z, qId, 0.35, false);
          setView('dump', 0.8);
          jGlow('handle', 0); jGlow('button', 1); rGlow('trash', 0.4);
        }
        if (dumpPressT >= 0 && st - dumpPressT >= 0.15) {
          dumpPressT = -1;
          Sfx.dump(Jar.fill());
          Jar.dump();
          enter(DUMPING);
        } else if (dumpPressT < 0 && !ptr.down && hintStep < 1 && idle >= 4 && st >= 0.8) {
          hintStep = 1; showDemo('tap');
        }
        break;
      }
      case DUMPING: {
        if (at(0)) jGlow('button', 0);
        if (st >= 6) enter(DUMP_DONE); // 保険
        break;
      }
      case STUCK: {
        if (!ptr.down && hintStep < 1 && idle >= 3.5) { hintStep = 1; showDemo('tap'); }
        if (Jar.state() === 'empty') enter(DUMP_DONE); // 保険
        break;
      }
      case DUMP_DONE: {
        if (at(0)) {
          Jar.setHatch(false); Sfx.hatch(false);
          Jar.clear();
          jGlow('button', 0);
          if (!jarMounted) jarTween(0.22, L.jar.h / 2 + 0.005, 0.12, qId, 0.6, false);
          setView('play', 0.9);
        }
        if (at(0.4)) { Room.trash.setLid(0); lidOpen = false; Sfx.lid(false); rGlow('trash', 0); }
        if (at(0.5)) Sfx.jarSet();
        if (st >= 1.4) enter(RETURN);
        break;
      }
      case ENDING: {
        if (at(0)) {
          glowsOff();
          Sfx.chime('round');
          if (lidOpen) { Room.trash.setLid(0); lidOpen = false; Sfx.lid(false); }
          if (viewName !== 'play') setView('play', 0.6);
        }
        if (at(0.6)) {
          Room.kusu[round].getBall(tv2);
          Debris.spawnLast({ x: tv2.x, y: tv2.y, z: tv2.z }, { x: -0.05, z: 0.05 });
        }
        if (at(3.6)) {
          if (round < 2) { round++; save(); setView('before', 1.6); }
          else { enter(NIGHT); break; }
        }
        if (at(4.5)) enter(POP);
        break;
      }
      case NIGHT: {
        if (at(0)) { glowsOff(); Sfx.chime('night'); vGlow('power', 0.5); }
        if (st < 6) setTime(smooth(st / 3.5));
        else setTime(1 - smooth((st - 6) / 3));
        if (at(6)) {
          Sfx.chime('morning');
          vGlow('power', 0);
          for (let i = 0; i < 3; i++) { Room.kusu[i].reset(); Room.kusu[i].setPull(0); }
          Debris.clear();
          Debris.resetSocks(true); resetSockTrack(true);
          Room.trash.reset();
          Jar.clear();
          round = 0; day++; save();
          setView('before', 2.6);
        }
        if (st >= 9) { setTime(0); enter(POP); }
        break;
      }
      default: break;
    }
  }

  function stepVacuum(dt) {
    if (at(0)) { if (ptr.down) downMode = 'floor'; }
    const b = L.basket;
    let stuck = Debris.stuckSock() >= 0;

    // モーター（指が触れている間）
    let mt = (downMode === 'floor' || downMode === 'peek') ? 1 : 0;
    if (sockAuto >= 0 && sockAuto < 0.3) mt = 1;
    motorTarget = mt;

    // ヘッド
    if (sockAuto >= 0) {
      const t0 = sockAuto; sockAuto += dt; const t = sockAuto;
      const rimX = b.x, rimZ = b.z + b.r + 0.12;
      if (t0 < 0.3) {
        const e = smooth(Math.min(t, 0.3) / 0.3);
        hx = lerp(autoX, rimX, e); hz = lerp(autoZ, rimZ, e); lift = 0.44 * e;
        if (t >= 0.3 && Debris.stuckSock() >= 0) { Debris.sockToBasket(); sockFlying = 3; }
      } else if (t < 0.65) { lift = 0.44; }
      else if (t < 0.95) { lift = 0.44 * (1 - smooth((t - 0.65) / 0.3)); }
      else { lift = 0; sockAuto = -1; }
      stuck = Debris.stuckSock() >= 0;
    } else if (downMode === 'floor' && rayPlane(0, tv)) {
      L.clampReach(tv.x, tv.z - 0.10, rc);
      moveHead(rc.x, rc.z, dt);
    }

    // くつした
    if (stuck && sockAuto < 0) {
      if (!ptr.down) { dropT += dt; if (dropT >= 0.25) { dropT = 0; Debris.dropSock(); stuck = Debris.stuckSock() >= 0; } }
      else dropT = 0;
      if (stuck && Math.hypot(hx - b.x, hz - b.z) < 0.46) { sockAuto = 0; autoX = hx; autoZ = hz; dropT = 0; }
    } else dropT = 0;
    strainTarget = stuck ? 1 : 0;
    rGlow('basket', (stuck || sockFlying > 0) ? 1 : 0);

    // ヒント
    const rem = Debris.remaining();
    const touching = ptr.down && downMode !== 'none';
    if (!touching) {
      if (hintStep < 1 && idle >= 6) { hintStep = 1; Sfx.hint(); }
      if (hintStep < 2 && idle >= 10) { hintStep = 2; showDemo('drag'); }
    }
    vGlow('head', !touching && idle >= 3 ? 0.7 : 0);
    twinkle(Math.max(rem > 0 && rem <= 12 ? 0.8 : 0, !touching && idle >= 6 ? 1 : 0));

    // おわり
    if (rem === 0 && Debris.falling() === 0 && Debris.socksLeft() === 0 && qLen === 0 && sockAuto < 0) enter(CLEAN);
  }

  // ---- 毎フレーム ----
  function step(dt) {
    readSize();
    if (ptr.down) idle = 0; else idle += dt;
    stPrev = st; st += dt;
    if (sockFlying > 0) sockFlying = Math.max(0, sockFlying - dt);

    stepStage(dt);
    if (stage !== VACUUM) { strainTarget = 0; if (stage !== CLEAN) motorTarget = 0; }
    updateJar(dt);

    // モーター・苦しさ・流れ
    motor = damp(motor, motorTarget, motorTarget > motor ? 7 : 3, dt);
    if (motor < 1e-4) motor = 0;
    strain = damp(strain, strainTarget, 6, dt);
    flowAcc *= Math.exp(-2.5 * dt);
    flow = damp(flow, Math.min(1, flowAcc / 3), 8, dt);
    if (dt > 0) { vx = (hx - phx) / dt; vz = (hz - phz) / dt; }
    phx = hx; phz = hz;

    qFlush();

    // ヘッド → 本体
    Vacuum.setHead(hx, hz, lift);
    // ラグの跡・房
    if (motor > 0.3 && lift < 0.01 && L.onRug(hx, hz)) {
      if (Math.hypot(hx - tpx, hz - tpz) >= 0.01) { Room.paintTrack(tpx, tpz, hx, hz); tpx = hx; tpz = hz; }
    } else { tpx = hx; tpz = hz; }
    Sfx.setFringe(Room.setFringe(hx, hz, motor));

    Room.update(dt, time);
    vacS.motor = motor; vacS.strain = strain; vacS.flow = flow; vacS.time = time;
    Vacuum.update(dt, vacS);
    Vacuum.getMouth(mouth);
    Jar.update(dt, motor, time);
    headS.x = hx; headS.z = hz; headS.lift = lift; headS.yaw = Vacuum.getHeadYaw();
    headS.motor = motor; headS.vx = vx; headS.vz = vz;
    Debris.update(dt, headS);

    Sfx.setMotor(motor, strain, L.onRug(hx, hz) ? 1 : 0);
    Sfx.setRattle(Jar.getRattle());
    Sfx.setSlurp(Debris.slurp());
    Sfx.update(dt);

    updateCamera(dt);
    updateDemo(dt);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    let real = (now - lastNow) / 1000;
    lastNow = now;
    if (!(real >= 0)) real = 0;
    const dt = Math.min(0.05, real);
    time += dt;
    try {
      step(dt);
      updateShadowFlag();
      renderer.render(scene, camera);
      perf(real);
    } catch (e) { /* 1 フレームの失敗で止めない */ }
  }

  function pause() {
    release();
    try { Sfx.setActive(false); } catch (e) { /* 続行 */ }
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
  }
  function resume() {
    if (running || document.hidden || !started) return;
    running = true;
    lastNow = performance.now();
    perfWarm = 1; slowT = 0; probing = false;
    needResize = true; shadowDirty = true;
    try { Sfx.setActive(true); } catch (e) { /* 続行 */ }
    raf = requestAnimationFrame(frame);
  }

  // ---- シェーダーの先読み ----
  // 遊びの途中で初めて見える物（紙ふぶき・カップの中身・夕方の照明など）のシェーダーを起動時にまとめて作っておく。
  // （途中で作ると iPhone / iPad で数十〜数百 ms 止まる）
  function precompile() {
    try {
      renderer.compile(scene, camera);
      // 影の深度シェーダーは影の描画時に作られるので、いったん全部見える状態で影だけ描く
      const hidden = [];
      scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      for (const o of hidden) o.visible = false;
      shadowDirty = true;
    } catch (e) { /* 先読みできなくても遊べる */ }
  }

  // ---- 起動 ----
  function fail() {
    running = false; started = false;
    try { cancelAnimationFrame(raf); } catch (e) { /* 続行 */ }
    try { document.body.classList.add('nogl'); } catch (e) { /* 続行 */ }
  }
  function boot() {
    try {
      canvas = document.getElementById('c');
      if (!canvas) { fail(); return; }
      renderer = Base.makeRenderer(canvas);
      if (!renderer) { fail(); return; }
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, 1, 0.03, 30);
      fitCam = new THREE.PerspectiveCamera(50, 1, 0.03, 30);
      scene.environment = Base.makeEnv(renderer);
      const ctx = { scene, renderer, camera };
      Room.init(ctx);
      Vacuum.init(ctx);
      Jar.init(ctx);
      Vacuum.attachJar(Jar.object); jarMounted = true;
      Debris.init(ctx);

      Debris.on.suck = (type, color) => {
        if (type !== 'streamer') Sfx.tick(type);
        qPush(time + 0.22, type, color);
        flowAcc += 1;
      };
      Debris.on.land = (type, v) => Sfx.land(type, v);
      Debris.on.sockStick = () => Sfx.sockStick();
      Debris.on.sockDrop = i => {
        Sfx.sockDrop(); sockFlying = 0;
        if (socks[i]) { socks[i].x = mouth.x; socks[i].z = mouth.z; }
      };
      Debris.on.sockBasket = i => {
        Sfx.sockBasket(); sockFlying = 0;
        if (socks[i]) socks[i].inB = true;
      };
      Jar.on.land = (type, color) => {
        Room.trash.addFill(color);
        if (stage === STUCK) Sfx.plop();
      };
      Jar.on.stuck = () => { if (stage === DUMPING) enter(STUCK); };
      Jar.on.empty = () => { if (stage === DUMPING || stage === STUCK) enter(DUMP_DONE); };

      makeFinger();
      buildFitPts();

      // 保存から復元
      load();
      for (let i = 0; i < round; i++) Room.kusu[i].open();
      Debris.resetSocks(round === 0); resetSockTrack(round === 0);
      setTime(0);
      hx = phx = tpx = L.head.restX; hz = phz = tpz = L.head.restZ;

      readSize();
      viewName = 'before'; camT = camDur = 0;
      updateCamera(0);
      enter(POP);
      precompile();

      // 入力
      canvas.addEventListener('pointerdown', onDown, { passive: false });
      canvas.addEventListener('pointermove', onMove, { passive: true });
      canvas.addEventListener('pointerup', onUp, { passive: true });
      canvas.addEventListener('pointercancel', onUp, { passive: true });
      canvas.addEventListener('lostpointercapture', e => { if (e.pointerId === ptr.id) release(); });
      const stop = e => { if (e.cancelable) e.preventDefault(); };
      for (const n of ['touchstart', 'touchmove', 'gesturestart', 'contextmenu', 'dblclick', 'selectstart']) {
        document.addEventListener(n, stop, { passive: false });
      }
      // 画面サイズ
      const onResize = () => { needResize = true; };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
      // 表示・非表示
      document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
      window.addEventListener('pagehide', pause);
      window.addEventListener('pageshow', resume);
      window.addEventListener('blur', release);

      window.__game = { probe };

      started = true;
      resume();
    } catch (e) { fail(); }
  }

  // ---- 自己確認用（読み取り専用）----
  function probe() {
    try {
      const v = new V3(), o = { x: 0, y: 0 };
      const P = (x, y, z) => { v.set(x, y, z); return toScreen(v, o) ? [Math.round(o.x), Math.round(o.y)] : null; };
      const Pv = w => P(w.x, w.y, w.z);
      const k = Room.kusu[round], r = new V3();
      k.getRing(r);
      const jp = new V3(); Jar.object.getWorldPosition(jp);
      const nn = { x: 0, z: 0 };
      const hasN = Debris.nearest(hx, hz, nn);
      const stuckI = Debris.stuckSock();
      const s = stuckI >= 0 ? null : nearestSock();
      return {
        stage, round, motor, remaining: Debris.remaining(), falling: Debris.falling(), socksLeft: Debris.socksLeft(),
        stuck: stuckI, jarCount: Jar.count(),
        pts: {
          ring: Pv(r), head: P(hx, 0, hz), jar: Pv(jp),
          trash: P(L.trash.x, L.trash.h, L.trash.z), basket: P(L.basket.x, L.basket.h, L.basket.z),
          cradle: P(L.jarMount.x, L.jarMount.y, L.jarMount.z),
          nearest: hasN ? P(nn.x, 0, nn.z) : null,
          sock: stuckI >= 0 ? P(hx, 0, hz) : s ? P(s.x, 0, s.z) : null,
        },
      };
    } catch (e) { return null; }
  }

  boot();
  return { probe };
})();
