// 効果音・ループ・音楽をすべて Web Audio で合成する。どの関数も例外を投げない。
const dbg = (e) => { try { if (window.__audioDebug) console.error(e); } catch (_) { /* */ } };
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI -> Hz

export function createAudio() {
  let ctx = null, master = null, sfxBus = null, musicBus = null, hidden = false, failed = false;
  const buf = {};
  const loops = new Map();
  const wanted = new Map(); // unlock 前に要求されたループ
  const lastPlay = new Map();
  let curMusic = null;

  // ------------------------------------------------------------ setup
  function makeNoise(kind, seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.6;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } // brown
    }
    // ループ継ぎ目を馴染ませる
    const f = Math.min(2000, n >> 3);
    for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
    return b;
  }
  function makeSlowRandom(seconds, rate) {
    // 0..1 のゆっくり揺らぐ値 (転がり音の不規則な振幅用)
    const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const pts = Math.ceil(seconds * rate) + 1, v = [];
    for (let i = 0; i < pts; i++) v.push(Math.random());
    v[pts - 1] = v[0];
    for (let i = 0; i < n; i++) {
      const x = (i / n) * (pts - 1), j = Math.floor(x), k = x - j, s = k * k * (3 - 2 * k);
      d[i] = v[j] + (v[Math.min(pts - 1, j + 1)] - v[j]) * s;
    }
    return b;
  }
  function makeStitch() {
    // "カタッ" 1針分をあらかじめ波形として作っておく (安い再生のため)
    const sr = ctx.sampleRate, n = Math.floor(sr * 0.09);
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    let lp = 0, ph1 = 0, ph2 = 0, ph3 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      // 低い "トッ"
      const fl = 150 - 70 * Math.min(1, t / 0.04);
      ph1 += 2 * Math.PI * fl / sr;
      s += Math.sin(ph1) * Math.exp(-t / 0.018) * 0.55;
      // 1つめのティック "カ"
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.35;
      const hiN = w - lp;
      ph2 += 2 * Math.PI * 1850 / sr;
      s += (hiN * 0.5 + Math.sin(ph2) * 0.35) * Math.exp(-t / 0.006);
      // 2つめのティック "タ" (+28ms)
      const t2 = t - 0.028;
      if (t2 >= 0) {
        ph3 += 2 * Math.PI * 1420 / sr;
        s += (hiN * 0.35 + Math.sin(ph3) * 0.3) * Math.exp(-t2 / 0.008);
      }
      d[i] = s * 0.8;
    }
    return b;
  }
  function init() {
    if (ctx || failed) return !!ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = true; return false; }
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain(); master.gain.value = 0.62;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7500; lp.Q.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
      sfxBus = ctx.createGain(); sfxBus.gain.value = 1;
      musicBus = ctx.createGain(); musicBus.gain.value = 0.75;
      sfxBus.connect(master); musicBus.connect(master);
      master.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
      buf.white = makeNoise('white', 2);
      buf.pink = makeNoise('pink', 3);
      buf.brown = makeNoise('brown', 3);
      buf.slow = makeSlowRandom(6, 9);
      buf.stitch = makeStitch();
      return true;
    } catch (err) {
      failed = true; ctx = null;
      return false;
    }
  }
  function tryResume() {
    if (!ctx || hidden) return;
    try {
      if (ctx.state !== 'running') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (_) { /* */ }
  }
  function unlock() {
    try {
      const fresh = !ctx;
      if (!init()) return;
      tryResume();
      if (fresh) for (const [n, w] of wanted) loop(n, w.vol, w.rate);
      // iOS: 無音バッファを1つ鳴らしてアンロックを確実にする
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination); s.start(0);
    } catch (_) { /* */ }
  }
  // 以降のどのジェスチャーでも、止まっていたら再開を試みる
  const gesture = () => { if (ctx && ctx.state !== 'running') tryResume(); };
  try {
    for (const ev of ['touchend', 'pointerup', 'pointerdown', 'click', 'keydown']) document.addEventListener(ev, gesture, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else resume(); });
    window.addEventListener('pagehide', () => suspend());
    window.addEventListener('pageshow', () => { if (!document.hidden) resume(); });
  } catch (_) { /* */ }
  function ready() { return !!ctx && ctx.state === 'running' && !hidden; }

  // ------------------------------------------------------------ primitives
  function env(g, t, v, a, d) {
    v = Math.max(1e-4, v);
    g.gain.setValueAtTime(1e-4, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(1e-4, t + a + d);
  }
  // 正弦などの単音: f->f2 グライド, 指数減衰
  function tone(out, t, f, d, v, o = {}) {
    const os = ctx.createOscillator();
    os.type = o.type || 'sine';
    if (o.curve) os.frequency.value = o.curve[0];
    else os.frequency.setValueAtTime(f, t);
    if (o.f2 && !o.curve) os.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || d));
    if (o.curve) os.frequency.setValueCurveAtTime(o.curve, t, o.glide || d);
    const g = ctx.createGain();
    const a = o.a != null ? o.a : 0.004;
    env(g, t, v, a, d);
    os.connect(g); g.connect(out);
    os.start(t); os.stop(t + a + d + 0.05);
    return os;
  }
  // フィルタ付きノイズ
  function noise(out, t, d, v, o = {}) {
    const src = ctx.createBufferSource();
    const b = buf[o.buf || 'white'];
    src.buffer = b;
    if (o.rate) src.playbackRate.value = o.rate;
    const fl = ctx.createBiquadFilter();
    fl.type = o.type || 'bandpass';
    fl.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || d));
    fl.Q.value = o.q != null ? o.q : 1;
    const g = ctx.createGain();
    if (o.shape) {
      g.gain.value = 0;
      const c = new Float32Array(o.shape.length);
      for (let i = 0; i < c.length; i++) c[i] = o.shape[i] * v;
      g.gain.setValueCurveAtTime(c, t, d);
    } else env(g, t, v, o.a != null ? o.a : 0.002, d);
    src.connect(fl); fl.connect(g); g.connect(out);
    const off = Math.random() * Math.max(0, b.duration - d - 0.1);
    src.start(t, off); src.stop(t + d + 0.08);
  }
  function rustleShape(n, len) {
    // 布のこすれ: 細かな不規則振幅
    const s = [];
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const envl = Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k * 0.3);
      s.push(Math.max(0, envl * (0.45 + 0.55 * Math.random() * Math.random() * 2)));
    }
    s[n - 1] = 0;
    return s;
  }
  // 木琴・オルゴール系の打鍵音
  function mallet(out, t, f, v, o = {}) {
    const d = o.d || 0.9;
    tone(out, t, f, d, v, { a: 0.003 });
    tone(out, t, f * (o.p2 || 4.0), d * 0.25, v * (o.v2 != null ? o.v2 : 0.12), { a: 0.002 });
    if (o.p3) tone(out, t, f * o.p3, d * 0.12, v * 0.05, { a: 0.001 });
    noise(out, t, 0.02, v * 0.08, { type: 'bandpass', f: Math.min(5000, f * 3), q: 1.2 });
  }
  function musicBox(out, t, f, v, d = 1.4) {
    tone(out, t, f, d, v, { a: 0.002 });
    tone(out, t, f * 2, d * 0.35, v * 0.22, { a: 0.002 });
    tone(out, t, f * 3.01, d * 0.12, v * 0.07, { a: 0.001 });
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ------------------------------------------------------------ one-shots
  const SFX = {
    tap(o, t, r) {
      tone(o, t, 820 * r, 0.05, 0.35, { a: 0.002 });
      tone(o, t, 1930 * r, 0.025, 0.12, { a: 0.001 });
      noise(o, t, 0.015, 0.25, { f: 2600 * r, q: 2 });
    },
    cloth(o, t, r) {
      noise(o, t, 0.26 / r, 0.55, { buf: 'white', type: 'bandpass', f: 1400 * r, f2: 2600 * r, q: 0.7, shape: rustleShape(28) });
      noise(o, t + 0.02, 0.22 / r, 0.25, { buf: 'pink', type: 'highpass', f: 2200, q: 0.5, shape: rustleShape(20) });
    },
    fold(o, t, r) {
      noise(o, t, 0.22, 0.9, { buf: 'brown', type: 'lowpass', f: 600 * r, f2: 180 * r, q: 0.7, a: 0.012 });
      tone(o, t, 110 * r, 0.16, 0.35, { f2: 60 * r, a: 0.01 });
      noise(o, t + 0.04, 0.4 / r, 0.45, { buf: 'white', type: 'bandpass', f: 1200 * r, f2: 2400 * r, q: 0.6, shape: rustleShape(36) });
    },
    pop(o, t, r) {
      tone(o, t, 520 * r, 0.09, 0.55, { f2: 1150 * r, glide: 0.04, a: 0.002 });
      tone(o, t + 0.03, 260 * r, 0.08, 0.25, { f2: 180 * r, a: 0.003 });
      noise(o, t, 0.02, 0.15, { f: 1800, q: 1 });
    },
    out(o, t, r) {
      tone(o, t, 380 * r, 0.16, 0.38, { type: 'triangle', f2: 880 * r, glide: 0.12, a: 0.01 });
      tone(o, t + 0.01, 760 * r, 0.12, 0.08, { f2: 1760 * r, glide: 0.12, a: 0.01 });
    },
    boing(o, t, r) {
      const n = 64, c = new Float32Array(n), dur = 0.42;
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * dur; c[i] = 230 * r * (1 + 0.38 * Math.exp(-x * 7) * Math.sin(2 * Math.PI * 13 * x)); }
      tone(o, t, c[0], dur, 0.45, { type: 'triangle', curve: c, glide: dur, a: 0.005 });
      tone(o, t, 115 * r, 0.12, 0.2, { a: 0.003 });
    },
    knock(o, t, r) {
      tone(o, t, 310 * r, 0.09, 0.5, { a: 0.002 });
      tone(o, t, 690 * r, 0.05, 0.22, { a: 0.001 });
      noise(o, t, 0.03, 0.3, { f: 1100 * r, q: 2.5 });
    },
    thud(o, t, r) {
      tone(o, t, 120 * r, 0.2, 0.75, { f2: 55 * r, glide: 0.12, a: 0.004 });
      noise(o, t, 0.12, 0.45, { buf: 'brown', type: 'lowpass', f: 380 * r, q: 0.8 });
    },
    lamp(o, t, r) {
      noise(o, t, 0.012, 0.5, { type: 'highpass', f: 2500, q: 0.7 });
      tone(o, t, 2400 * r, 0.015, 0.15, { a: 0.001 });
      noise(o, t + 0.035, 0.01, 0.3, { type: 'bandpass', f: 3200, q: 2 });
      tone(o, t + 0.06, 1318 * r, 0.7, 0.16, { a: 0.003 });
      tone(o, t + 0.06, 2636 * r, 0.25, 0.04, { a: 0.002 });
    },
    footDown(o, t, r) {
      noise(o, t, 0.05, 0.5, { f: 2900 * r, q: 3 });
      for (const [f, v] of [[1170, 0.2], [2730, 0.12], [3890, 0.06]]) tone(o, t, f * r, 0.08, v, { a: 0.001 });
      tone(o, t, 150 * r, 0.06, 0.4, { f2: 90 * r, a: 0.002 });
    },
    stitch(o, t, r) {
      const s = ctx.createBufferSource();
      s.buffer = buf.stitch;
      s.playbackRate.value = r * rnd(0.95, 1.05);
      const g = ctx.createGain(); g.gain.value = 0.55;
      s.connect(g); g.connect(o); s.start(t);
    },
    snip(o, t, r) {
      for (const [dt, f] of [[0, 1], [0.075, 0.9]]) {
        noise(o, t + dt, 0.018, 0.45, { type: 'highpass', f: 3500, q: 0.7 });
        tone(o, t + dt, 2580 * f * r, 0.05, 0.14, { a: 0.001 });
        tone(o, t + dt, 4090 * f * r, 0.03, 0.06, { a: 0.001 });
      }
      noise(o, t + 0.01, 0.07, 0.12, { type: 'bandpass', f: 5000, f2: 3000, q: 1.5, a: 0.02 });
    },
    tin(o, t, r) {
      const partials = [1760, 2460, 3320, 2090];
      for (let i = 0; i < 6; i++) {
        const dt = i * 0.055 + rnd(0, 0.03), v = 0.22 * (1 - i * 0.11);
        const f = partials[i % partials.length] * rnd(0.97, 1.03) * r;
        tone(o, t + dt, f, 0.14, v, { a: 0.001 });
        tone(o, t + dt, f * 1.53, 0.07, v * 0.4, { a: 0.001 });
        noise(o, t + dt, 0.03, v * 0.7, { f: 3800, q: 2 });
      }
    },
    button(o, t, r) {
      // 跳ねる→くるくる落ち着く
      const hops = [0, 0.11, 0.19, 0.245];
      hops.forEach((dt, i) => {
        const v = 0.4 * Math.pow(0.7, i);
        noise(o, t + dt, 0.012, v, { f: 3400 * r, q: 3 });
        tone(o, t + dt, 2150 * r * rnd(0.97, 1.03), 0.02, v * 0.35, { a: 0.001 });
      });
      let tt = 0.29, gap = 0.035;
      for (let i = 0; i < 9; i++) {
        noise(o, t + tt, 0.008, 0.12 * (1 - i / 10), { f: 4200 * r, q: 4 });
        tt += gap; gap *= 0.8;
      }
    },
    snap(o, t, r) {
      noise(o, t, 0.008, 0.7, { type: 'highpass', f: 2200, q: 0.7, a: 0.0005 });
      tone(o, t, 1450 * r, 0.025, 0.28, { a: 0.001 });
      tone(o, t, 420 * r, 0.04, 0.3, { a: 0.001 });
    },
    water(o, t, r) {
      tone(o, t, 280 * r, 0.1, 0.5, { f2: 820 * r, glide: 0.07, a: 0.004 });
      tone(o, t + 0.09, 380 * r, 0.08, 0.3, { f2: 1050 * r, glide: 0.05, a: 0.004 });
      noise(o, t, 0.45, 0.35, { buf: 'pink', type: 'lowpass', f: 450, f2: 1300, glide: 0.2, q: 2, shape: [0, 0.6, 1, 0.8, 0.5, 0.3, 0.15, 0] });
    },
    box(o, t, r) {
      tone(o, t, 175 * r, 0.16, 0.55, { a: 0.002 });
      tone(o, t, 268 * r, 0.1, 0.25, { a: 0.002 });
      noise(o, t, 0.15, 0.45, { buf: 'white', type: 'bandpass', f: 230 * r, q: 7 });
      noise(o, t, 0.02, 0.2, { f: 1500, q: 1.5 });
    },
    soft(o, t, r) {
      noise(o, t, 0.32, 0.5, { buf: 'pink', type: 'lowpass', f: 1500 * r, f2: 350 * r, q: 0.5, a: 0.03 });
    },
    spool(o, t, r) {
      tone(o, t, 330 * r, 0.45, 0.4, { type: 'triangle', f2: 495 * r, glide: 0.1, a: 0.002 });
      tone(o, t, 660 * r, 0.18, 0.12, { f2: 990 * r, glide: 0.1, a: 0.002 });
      noise(o, t, 0.015, 0.2, { f: 2500, q: 1 });
    },
    chime(o, t, r) {
      [NOTE(76), NOTE(79), NOTE(84)].forEach((f, i) => mallet(o, t + i * 0.13, f * r, 0.26, { d: 1.1, p2: 2.76, v2: 0.1, p3: 5.4 }));
    },
    fanfare(o, t, r) {
      const notes = [60, 64, 67, 72, 76, 79];
      const times = [0, 0.13, 0.26, 0.39, 0.52, 0.72];
      notes.forEach((n, i) => mallet(o, t + times[i], NOTE(n) * r, i === 5 ? 0.38 : 0.3, { d: i === 5 ? 1.3 : 0.7, p2: 3.93, v2: 0.08 }));
      // 最後にやわらかい和音
      [60, 64, 67].forEach((n) => mallet(o, t + 0.72, NOTE(n) * r, 0.12, { d: 1.2, p2: 3.93, v2: 0.05 }));
    },
    whoosh(o, t, r) {
      noise(o, t, 0.7, 0.55, { buf: 'pink', type: 'bandpass', f: 300 * r, f2: 2000 * r, glide: 0.55, q: 0.9, shape: [0, 0.2, 0.5, 0.85, 1, 0.8, 0.45, 0.15, 0] });
    },
    sparkle(o, t, r) {
      for (let i = 0; i < 4; i++) {
        const f = [2093, 2637, 3136, 2349][i] * r * rnd(0.99, 1.01);
        tone(o, t + i * 0.045 + rnd(0, 0.02), f, 0.25, 0.07 * (1 - i * 0.15), { a: 0.002 });
      }
    },
    hint(o, t, r) {
      tone(o, t, 659 * r, 0.45, 0.18, { a: 0.012 });
      tone(o, t, 1318 * r, 0.15, 0.025, { a: 0.01 });
    },
  };
  const minGap = { stitch: 0.035 };

  function play(name, opts = {}) {
    try {
      if (!ready()) return;
      const fn = SFX[name];
      if (!fn) return;
      const o = opts || {};
      const vol = isFinite(o.vol) ? Math.max(0, o.vol) : 1;
      if (vol <= 0) return;
      const rate = isFinite(o.rate) && o.rate > 0 ? o.rate : 1;
      const delay = isFinite(o.delay) ? Math.max(0, o.delay) : 0;
      const t = ctx.currentTime + 0.005 + delay;
      const gap = minGap[name] || 0.025;
      const lp = lastPlay.get(name);
      if (lp != null && Math.abs(t - lp) < gap) return;
      lastPlay.set(name, t);
      const g = ctx.createGain(); g.gain.value = vol;
      let out = g;
      const pan = isFinite(o.pan) ? Math.max(-1, Math.min(1, o.pan)) : 0;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(sfxBus); }
      else g.connect(sfxBus);
      fn(out, t, rate);
      // 少し後で切り離す
      setTimeout(() => { try { g.disconnect(); } catch (_) { /* */ } }, (delay + 3) * 1000);
    } catch (e) { dbg(e); }
  }

  // ------------------------------------------------------------ loops
  const LOOPS = {
    motor() {
      const out = ctx.createGain(); out.gain.value = 1;
      const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 58;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 1.2;
      const sg = ctx.createGain(); sg.gain.value = 0.35;
      saw.connect(lp); lp.connect(sg); sg.connect(out);
      const hum = ctx.createOscillator(); hum.frequency.value = 116;
      const hg = ctx.createGain(); hg.gain.value = 0.18; hum.connect(hg); hg.connect(out);
      const whine = ctx.createOscillator(); whine.frequency.value = 464;
      const wg = ctx.createGain(); wg.gain.value = 0.025; whine.connect(wg); wg.connect(out);
      const n = ctx.createBufferSource(); n.buffer = buf.pink; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = 0.25; n.connect(nf); nf.connect(ng); ng.connect(out);
      // 針の上下に合わせた軽いうなり
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
      const lg = ctx.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(out.gain);
      const srcs = [saw, hum, whine, n, lfo];
      return {
        out, srcs,
        setRate(r, t) {
          saw.frequency.setTargetAtTime(58 * r, t, 0.03); hum.frequency.setTargetAtTime(116 * r, t, 0.03);
          whine.frequency.setTargetAtTime(464 * r, t, 0.03); lfo.frequency.setTargetAtTime(9 * r, t, 0.03);
          lp.frequency.setTargetAtTime(300 + 220 * r, t, 0.03); n.playbackRate.setTargetAtTime(0.8 + 0.3 * r, t, 0.03);
        },
      };
    },
    roll() {
      const out = ctx.createGain(); out.gain.value = 0;
      const n = ctx.createBufferSource(); n.buffer = buf.brown; n.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 1.5;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 140; pk.gain.value = 6; pk.Q.value = 1.5;
      n.connect(lp); lp.connect(pk); pk.connect(out);
      const m = ctx.createBufferSource(); m.buffer = buf.slow; m.loop = true; m.playbackRate.value = 1.6;
      const mg = ctx.createGain(); mg.gain.value = 0.9; m.connect(mg); mg.connect(out.gain);
      const base = ctx.createConstantSource ? ctx.createConstantSource() : null;
      const srcs = [n, m];
      if (base) { base.offset.value = 0.35; base.connect(out.gain); srcs.push(base); } else out.gain.value = 0.35;
      return {
        out, srcs, gainScale: 1.6,
        setRate(r, t) {
          m.playbackRate.setTargetAtTime(0.8 + 1.4 * r, t, 0.05);
          lp.frequency.setTargetAtTime(180 + 140 * r, t, 0.05);
          n.playbackRate.setTargetAtTime(0.85 + 0.25 * r, t, 0.05);
        },
      };
    },
    room() {
      const out = ctx.createGain();
      const n = ctx.createBufferSource(); n.buffer = buf.brown; n.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 0.4;
      n.connect(lp); lp.connect(out);
      return { out, srcs: [n], gainScale: 0.09, setRate() {} };
    },
    park() {
      const out = ctx.createGain(); out.gain.value = 0.6;
      const n = ctx.createBufferSource(); n.buffer = buf.pink; n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.55;
      const hs = ctx.createBiquadFilter(); hs.type = 'lowpass'; hs.frequency.value = 3500;
      n.connect(bp); bp.connect(hs); hs.connect(out);
      const l1 = ctx.createOscillator(); l1.frequency.value = 0.13;
      const l1g = ctx.createGain(); l1g.gain.value = 0.3; l1.connect(l1g); l1g.connect(out.gain);
      const l2 = ctx.createOscillator(); l2.frequency.value = 0.071;
      const l2g = ctx.createGain(); l2g.gain.value = 450; l2.connect(l2g); l2g.connect(bp.frequency);
      const m = ctx.createBufferSource(); m.buffer = buf.slow; m.loop = true; m.playbackRate.value = 0.25;
      const mg = ctx.createGain(); mg.gain.value = 0.25; m.connect(mg); mg.connect(out.gain);
      return { out, srcs: [n, l1, l2, m], gainScale: 0.35, setRate(r, t) { n.playbackRate.setTargetAtTime(r, t, 0.1); } };
    },
  };

  function loop(name, vol = 1, rate = 1) {
    try {
      if (!LOOPS[name]) return;
      vol = isFinite(vol) ? Math.max(0, vol) : 0;
      rate = isFinite(rate) && rate > 0 ? rate : 1;
      if (vol > 0) wanted.set(name, { vol, rate }); else wanted.delete(name);
      if (!ctx) return;
      const t = ctx.currentTime;
      let L = loops.get(name);
      if (!L) {
        if (vol <= 0) return;
        const v = LOOPS[name]();
        const g = ctx.createGain(); g.gain.value = 0;
        v.out.connect(g); g.connect(sfxBus);
        for (const s of v.srcs) { try { s.start(t); } catch (_) { /* */ } }
        L = { v, g, stopTimer: null };
        loops.set(name, L);
      }
      if (L.stopTimer) { clearTimeout(L.stopTimer); L.stopTimer = null; }
      const scale = L.v.gainScale || 1;
      L.g.gain.cancelScheduledValues(t);
      L.g.gain.setTargetAtTime(vol * scale * 0.5, t, 0.027); // ~80ms で到達
      try { L.v.setRate(rate, t); } catch (_) { /* */ }
      if (vol <= 0) {
        L.stopTimer = setTimeout(() => {
          loops.delete(name);
          for (const s of L.v.srcs) { try { s.stop(); } catch (_) { /* */ } }
          try { L.g.disconnect(); } catch (_) { /* */ }
        }, 400);
      }
    } catch (e) { dbg(e); }
  }

  // ------------------------------------------------------------ music
  function music(name) {
    try {
      if (!ready()) return 0;
      if (curMusic) {
        const old = curMusic;
        try { old.gain.setTargetAtTime(0, ctx.currentTime, 0.15); } catch (_) { /* */ }
        setTimeout(() => { try { old.disconnect(); } catch (_) { /* */ } }, 1500);
      }
      const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(musicBus);
      curMusic = bus;
      const t0 = ctx.currentTime + 0.05;
      if (name === 'intro') {
        // やさしい導入モチーフ (約2.5秒)
        const seq = [[67, 0, 0.3], [72, 0.3, 0.3], [76, 0.6, 0.3], [74, 0.9, 0.28], [72, 1.25, 0.34], [79, 1.6, 0.3]];
        for (const [n, dt, v] of seq) mallet(bus, t0 + dt, NOTE(n), v * 0.8, { d: 1.0, p2: 3.93, v2: 0.07 });
        [48, 55].forEach((n) => mallet(bus, t0 + 1.6, NOTE(n), 0.16, { d: 1.4, p2: 3.93, v2: 0.04 }));
        return 3;
      }
      if (name === 'ending') {
        // オリジナルのオルゴール子守唄 3/4 拍子 11小節
        const B = 0.42;
        const mel = [
          [64, 1], [67, 1], [64, 1], [62, 2], [60, 1], [62, 1], [64, 1], [67, 1], [64, 3],
          [69, 1], [67, 1], [64, 1], [62, 2], [64, 1], [60, 1], [62, 1], [64, 1], [62, 3],
          [64, 1], [67, 1], [69, 1], [67, 1], [64, 1], [62, 1], [60, 3],
        ];
        const bass = [48, 43, 43, 48, 53, 43, 48, 43, 45, 43, 48];
        const chords = [[64, 67], [62, 67], [62, 67], [64, 67], [65, 69], [62, 67], [64, 67], [62, 67], [64, 69], [62, 67], [64, 67]];
        let tt = 0;
        mel.forEach(([n, beats], i) => {
          const last = i === mel.length - 1;
          const slow = i >= mel.length - 3 ? 1 + (i - (mel.length - 4)) * 0.08 : 1; // 最後は少しゆっくり
          musicBox(bus, t0 + tt, NOTE(n + 12), last ? 0.2 : 0.22, last ? 3.0 : 1.4);
          tt += beats * B * slow;
        });
        for (let bar = 0; bar < bass.length; bar++) {
          const bt = t0 + bar * 3 * B + (bar >= 9 ? (bar - 8) * 0.08 : 0);
          musicBox(bus, bt, NOTE(bass[bar] + 12), 0.13, bar === bass.length - 1 ? 3.2 : 1.6);
          if (bar < bass.length - 1) {
            musicBox(bus, bt + B, NOTE(chords[bar][0] + 12), 0.06, 0.8);
            musicBox(bus, bt + 2 * B, NOTE(chords[bar][1] + 12), 0.06, 0.8);
          } else {
            musicBox(bus, bt + 0.25, NOTE(67 + 12), 0.07, 2.6);
            musicBox(bus, bt + 0.5, NOTE(72 + 12), 0.06, 2.8);
          }
        }
        return tt + 3;
      }
      return 0;
    } catch (e) { dbg(e); return 0; }
  }

  // ------------------------------------------------------------ suspend/resume
  function suspend() {
    hidden = true;
    try { if (ctx && ctx.state === 'running') { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } } catch (_) { /* */ }
  }
  function resume() {
    hidden = false;
    if (typeof document !== 'undefined' && document.hidden) { hidden = true; return; }
    tryResume();
  }
  function stopAll() {
    for (const name of [...loops.keys()]) loop(name, 0);
  }

  return {
    unlock, play, loop, music, suspend, resume, stopAll,
    get ready() { return ready(); },
    get context() { return ctx; },
    names: Object.keys(SFX),
  };
}
