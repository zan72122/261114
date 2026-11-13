// audio.js — 音（Web Audio の合成音のみ。素材ファイルなし）
// init 前・初期化失敗時はすべてのメソッドが何もしない。例外は外へ投げない。
const Sfx = (() => {
  let ctx = null;          // AudioContext
  let dead = false;        // 作れなかった・壊れた → 以後なにもしない
  let master = null, sfxBus = null;
  let noiseBuf = null, clickBufs = null;
  let M = null;            // モーター等の常設ノード
  const voices = [];       // 単発音の終了予定時刻（同時発音数の上限管理）
  const MAX_VOICES = 48;
  const lastTick = {};     // 種類ごとの最終発音時刻（間引き）
  let streak = 0, streakT = -1; // 連続で吸うほど少しずつ音程が上がる
  let rattleA = 0, rattleAcc = 0;
  const last = {};         // 常設パラメータの前回値（無駄な自動化イベントを減らす）

  const PENTA = [0, 2, 4, 7, 9];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = x => (x > 1 ? 1 : x > 0 ? x : 0);
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);

  function ok() { return !!ctx && !dead; }
  function playing() { return ok() && ctx.state === 'running'; }

  // ---- 初期化 ------------------------------------------------------------
  function makeNoise() {
    const n = Math.floor(ctx.sampleRate * 2);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // カップの中のビーズ用の短いプラスチックの粒（4 種）
  function makeClicks() {
    const out = [];
    const sr = ctx.sampleRate;
    const freqs = [[3100, 5200], [2600, 4700], [3600, 6100], [2900, 4300]];
    for (let k = 0; k < 4; k++) {
      const n = Math.floor(sr * 0.03);
      const b = ctx.createBuffer(1, n, sr);
      const d = b.getChannelData(0);
      const f1 = freqs[k][0], f2 = freqs[k][1];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const e = Math.exp(-t / 0.0055);
        d[i] = e * (0.55 * Math.sin(2 * Math.PI * f1 * t) + 0.3 * Math.sin(2 * Math.PI * f2 * t) +
          0.25 * (Math.random() * 2 - 1) * Math.exp(-t / 0.0015));
      }
      out.push(b);
    }
    return out;
  }
  function noiseSrc(loop) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = !!loop;
    return s;
  }
  function osc(type, f) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    return o;
  }
  function gainNode(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function filt(type, f, q) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q;
    return b;
  }

  function buildContinuous() {
    const t0 = ctx.currentTime;
    M = {};
    // ---- モーター: 倍音数本（丸い波形のみ）+ 風切りノイズ + 低いうなり → ローパス → 揺れ → 出力
    M.out = gainNode(0);
    M.trem = gainNode(1);
    M.lp = filt('lowpass', 2000, 0.5);
    M.pre = gainNode(1);
    M.pre.connect(M.lp); M.lp.connect(M.trem); M.trem.connect(M.out); M.out.connect(master);

    M.harm = gainNode(0.32);
    M.harm.connect(M.pre);
    const partials = [[1, 'sine', 0.5], [2, 'sine', 0.2], [3, 'triangle', 0.07], [5.03, 'sine', 0.035], [0.5, 'sine', 0.22]];
    M.oscs = [];
    for (const p of partials) {
      const o = osc(p[1], 110 * p[0]);
      const g = gainNode(p[2]);
      o.connect(g); g.connect(M.harm);
      M.oscs.push({ o, mul: p[0] });
    }
    // 風（帯域ノイズ。詰まると Q が上がって笛のように鳴る）
    M.airBP = filt('bandpass', 600, 0.7);
    M.airG = gainNode(0.9);
    const n1 = noiseSrc(true); n1.connect(M.airBP); M.airBP.connect(M.airG); M.airG.connect(M.pre);
    // 低いうなり
    M.rumLP = filt('lowpass', 160, 0.7);
    M.rumG = gainNode(0.5);
    const n2 = noiseSrc(true); n2.connect(M.rumLP); M.rumLP.connect(M.rumG); M.rumG.connect(M.pre);
    // 揺れ: ゆっくりした自然な揺らぎ + 苦しいときのうなり
    const lfoSlow = osc('sine', 0.37);
    const slowDepth = gainNode(7);   // cents
    lfoSlow.connect(slowDepth);
    M.lfoStrain = osc('sine', 2.3);
    M.strainDepth = gainNode(0);     // cents
    M.strainAM = gainNode(0);        // 音量のうなり
    M.lfoStrain.connect(M.strainDepth); M.lfoStrain.connect(M.strainAM);
    M.strainAM.connect(M.trem.gain);
    for (const p of M.oscs) { slowDepth.connect(p.o.detune); M.strainDepth.connect(p.o.detune); }

    // ---- つるつる（紙テープ）: ノイズの帯域がうねる
    M.slG = gainNode(0);
    M.slBP = filt('bandpass', 1200, 1.6);
    const n3 = noiseSrc(true); n3.connect(M.slBP); M.slBP.connect(M.slG); M.slG.connect(sfxBus);
    const sl1 = osc('sine', 6.3), sl1d = gainNode(520);
    const sl2 = osc('sine', 0.9), sl2d = gainNode(280);
    sl1.connect(sl1d); sl1d.connect(M.slBP.frequency);
    sl2.connect(sl2d); sl2d.connect(M.slBP.frequency);

    // ---- パタパタ（ラグの房）: 低いノイズを 13Hz くらいで開け閉め
    M.frG = gainNode(0);
    M.frAM = gainNode(0.5);
    M.frLP = filt('lowpass', 380, 0.8);
    const n4 = noiseSrc(true); n4.connect(M.frLP); M.frLP.connect(M.frAM); M.frAM.connect(M.frG); M.frG.connect(sfxBus);
    const fl = osc('triangle', 12.5), fld = gainNode(0.5);
    fl.connect(fld); fld.connect(M.frAM.gain);
    M.frLfo = fl;

    const starts = [n1, n2, n3, n4, lfoSlow, M.lfoStrain, sl1, sl2, fl];
    for (const p of M.oscs) starts.push(p.o);
    for (const s of starts) {
      if (s.buffer) s.start(t0, Math.random() * 1.8); else s.start(t0);
    }
  }

  function unlock() {
    try {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) { /* 無視 */ }
  }
  function tryResume() {
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 無視 */ }
  }

  function init() {
    if (dead) return;
    if (ctx) { tryResume(); unlock(); return; }
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { dead = true; return; }
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 8;
      comp.attack.value = 0.004; comp.release.value = 0.22;
      master = gainNode(0.55);
      master.connect(comp); comp.connect(ctx.destination);
      sfxBus = gainNode(1); sfxBus.connect(master);
      noiseBuf = makeNoise();
      clickBufs = makeClicks();
      buildContinuous();
      unlock();
      tryResume();
    } catch (e) {
      dead = true;
      try { if (ctx && ctx.close) { const p = ctx.close(); if (p && p.catch) p.catch(() => {}); } } catch (e2) { /* 無視 */ }
      ctx = null;
    }
  }

  function setActive(on) {
    if (!ok()) return;
    try {
      const p = on ? ctx.resume() : ctx.suspend();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 無視 */ }
  }

  // 常設パラメータをなめらかに動かす（変化が小さければ何もしない）
  function ramp(key, param, v, tau, eps) {
    const pv = last[key];
    if (pv !== undefined && Math.abs(pv - v) < (eps || 1e-4)) return;
    last[key] = v;
    param.setTargetAtTime(v, ctx.currentTime, tau);
  }

  // ---- 連続音 -------------------------------------------------------------
  function setMotor(speed, strain, rug) {
    if (!ok() || !M) return;
    try {
      const s = clamp01(num(speed, 0)), k = clamp01(num(strain, 0)), r = clamp01(num(rug, 0));
      const f0 = (105 + 330 * Math.pow(s, 0.85)) * (1 + 0.1 * k);
      for (let i = 0; i < M.oscs.length; i++) {
        ramp('mf' + i, M.oscs[i].o.frequency, f0 * M.oscs[i].mul, 0.12, 0.05);
      }
      const level = s <= 0.001 ? 0 : 0.17 * Math.pow(s, 1.25) * (1 + 0.12 * k);
      ramp('mlev', M.out.gain, level, 0.07, 2e-4);
      ramp('mlp', M.lp.frequency, (900 + 3600 * s) * (1 - 0.62 * r) * (1 + 0.15 * k), 0.1, 5);
      ramp('mair', M.airBP.frequency, (380 + 1500 * s) * (1 + 0.45 * k), 0.12, 3);
      ramp('mairq', M.airBP.Q, 0.7 + 3.2 * k, 0.15, 0.02);
      ramp('mairg', M.airG.gain, 0.8 + 0.4 * s - 0.2 * r, 0.1, 0.01);
      ramp('mrum', M.rumG.gain, 0.45 + 0.35 * r, 0.1, 0.01);
      ramp('msd', M.strainDepth.gain, 32 * k, 0.15, 0.3);
      ramp('msa', M.strainAM.gain, 0.22 * k, 0.15, 0.003);
      ramp('msf', M.lfoStrain.frequency, 1.8 + 1.4 * k, 0.2, 0.02);
    } catch (e) { /* 無視 */ }
  }
  function setRattle(a) {
    if (!ok()) return;
    rattleA = clamp01(num(a, 0));
  }
  function setSlurp(a) {
    if (!ok() || !M) return;
    try { ramp('sl', M.slG.gain, 0.11 * clamp01(num(a, 0)), 0.06, 2e-4); } catch (e) { /* 無視 */ }
  }
  function setFringe(a) {
    if (!ok() || !M) return;
    try {
      const v = clamp01(num(a, 0));
      ramp('fr', M.frG.gain, 0.32 * v, 0.08, 3e-4);
      ramp('frf', M.frLfo.frequency, 10 + 6 * v, 0.2, 0.05);
    } catch (e) { /* 無視 */ }
  }

  function update(dt) {
    if (!playing()) return;
    dt = num(dt, 0); if (dt <= 0) return; if (dt > 0.1) dt = 0.1;
    // カラカラ: ランダムな粒を少し先に予約する
    if (rattleA > 0.01) {
      rattleAcc += dt * rattleA * 30;
      let guard = 0;
      while (rattleAcc >= 1 && guard++ < 6) {
        rattleAcc -= Math.random() < 0.5 ? 1 : 0.6;
        grain(ctx.currentTime + Math.random() * 0.04, 0.05 + 0.09 * rattleA * Math.random(), rnd(0.75, 1.35));
      }
      if (rattleAcc > 2) rattleAcc = 0;
    } else rattleAcc = 0;
  }

  // ---- 単発音の部品 -------------------------------------------------------
  function claim(n, end) {
    const now = ctx.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i] <= now) voices.splice(i, 1);
    if (voices.length + n > MAX_VOICES) return false;
    for (let i = 0; i < n; i++) voices.push(end);
    return true;
  }
  // 包絡: 0 → peak（attack）→ 指数的に減衰（decay で約 99% 減）
  function env(g, t, att, peak, decay) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setTargetAtTime(0, t + att, decay / 5);
  }
  // 純音（周波数の滑りつき）
  function tone(t, f, vol, att, decay, o) {
    o = o || {};
    const end = t + att + decay + 0.03;
    if (!claim(1, end)) return;
    const os = osc(o.type || 'sine', f);
    os.frequency.setValueAtTime(f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || decay));
    const g = gainNode(0);
    env(g, t, att, vol, decay);
    os.connect(g);
    if (o.lp) { const f2 = filt('lowpass', o.lp, 0.7); g.connect(f2); f2.connect(o.dest || sfxBus); }
    else g.connect(o.dest || sfxBus);
    os.start(t); os.stop(end);
  }
  // ノイズの一撃（フィルタの周波数を f0 → f1 へ滑らせる）
  function noise(t, vol, att, decay, type, f0, f1, q, dest) {
    const end = t + att + decay + 0.03;
    if (!claim(1, end)) return;
    const s = noiseSrc(false);
    const f = filt(type, f0, q);
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + att + decay * 0.8);
    const g = gainNode(0);
    env(g, t, att, vol, decay);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus);
    s.start(t, Math.random() * 1.7, att + decay + 0.03);
  }
  // カップの中の粒
  function grain(t, vol, rate) {
    if (!claim(1, t + 0.05)) return;
    const s = ctx.createBufferSource();
    s.buffer = clickBufs[(Math.random() * 4) | 0];
    s.playbackRate.value = rate;
    const g = gainNode(vol);
    s.connect(g); g.connect(sfxBus);
    s.start(t);
  }
  // マリンバ/オルゴール風の澄んだ音
  function mallet(t, f, vol, decay, bright) {
    const b = bright == null ? 0.3 : bright;
    tone(t, f, vol, 0.004, decay);
    tone(t, f * 3.93, vol * b, 0.002, decay * 0.18);
    if (b > 0.25) tone(t, f * 9.2, vol * b * 0.25, 0.001, 0.05);
  }
  // 鈴（金属的な非整数倍音 + シャッ）
  function bell(t, f, vol) {
    tone(t, f, vol, 0.002, 0.45);
    tone(t, f * 2.756, vol * 0.45, 0.001, 0.2);
    tone(t, f * 5.404, vol * 0.2, 0.001, 0.08);
    noise(t, vol * 0.35, 0.002, 0.05, 'highpass', 7000, 0, 0.7);
  }
  // 木の打撃（パカッ・コト・とん）
  function knock(t, f, vol, decay) {
    tone(t, f, vol, 0.002, decay, { to: f * 0.8 });
    noise(t, vol * 0.6, 0.001, decay * 0.5, 'bandpass', f * 2.6, 0, 2.5);
  }
  // プラスチックのクリック（カチ）
  function click(t, f, vol) {
    noise(t, vol, 0.001, 0.025, 'bandpass', f, 0, 3);
    tone(t, f * 0.62, vol * 0.4, 0.001, 0.03);
  }
  const penta = (oct, deg) => mtof(12 * (oct + 1) + PENTA[((deg % 5) + 5) % 5] + 12 * Math.floor(deg / 5));

  // 安全に包む（例外を外へ出さない）
  function safe(fn) {
    return function () {
      if (!playing()) return;
      try { fn.apply(null, arguments); } catch (e) { /* 無視 */ }
    };
  }
  function gate(key, ms) {
    const now = ctx.currentTime;
    const p = lastTick[key];
    if (p !== undefined && now - p < ms / 1000) return false;
    lastTick[key] = now;
    return true;
  }

  // ---- 単発音 -------------------------------------------------------------
  const tick = safe(type => {
    if (!gate('t' + type, 35)) return;
    const t = ctx.currentTime + 0.003;
    if (t - streakT < 0.45) streak = Math.min(streak + 1, 14); else streak = 0;
    streakT = t;
    const up = 1 + streak * 0.022;
    const j = rnd(0.92, 1.08) * up;
    // 共通の「シュポッ」: 短いノイズの上昇スイープ
    noise(t, 0.05, 0.006, 0.07, 'bandpass', 700 * j, 2600 * j, 2.2);
    if (type === 'paper') {
      noise(t, 0.06, 0.008, 0.06, 'bandpass', 1800 * j, 3600 * j, 1.2);
    } else if (type === 'star') {
      tone(t + 0.01, 3000 * j, 0.035, 0.002, 0.05, { to: 4300 * j, glide: 0.03 });
      noise(t, 0.03, 0.002, 0.03, 'highpass', 6000, 0, 0.7);
    } else if (type === 'bead') {
      const deg = (Math.random() * 6) | 0;
      mallet(t + 0.01, penta(6, deg) * (1 + streak * 0.01), 0.07, 0.09, 0.35);
    } else if (type === 'pom') {
      tone(t, 210 * j, 0.11, 0.006, 0.1, { to: 120 * j });
      noise(t, 0.07, 0.006, 0.08, 'lowpass', 600, 300, 0.7);
    } else if (type === 'streamer') {
      noise(t, 0.06, 0.01, 0.16, 'bandpass', 900, 3200, 1.5);
      tone(t + 0.05, penta(5, 4), 0.05, 0.004, 0.25);
    } else {
      noise(t, 0.05, 0.008, 0.06, 'bandpass', 1500 * j, 3000 * j, 1.2);
    }
  });

  const land = safe((type, v) => {
    v = clamp01(num(v, 0.5));
    if (v < 0.02) return;
    const t = ctx.currentTime + 0.002;
    if (type === 'bead') {
      if (!gate('l' + type, 30)) return;
      knock(t, rnd(1500, 2300), 0.07 * v, 0.04);
    } else if (type === 'pom') {
      if (!gate('l' + type, 80)) return;
      noise(t, 0.025 * v, 0.004, 0.05, 'lowpass', 350, 0, 0.7);
    } else if (type === 'star') {
      if (!gate('l' + type, 45)) return;
      tone(t, rnd(4200, 5600), 0.018 * v, 0.001, 0.03);
    } else if (type === 'sock') {
      if (!gate('l' + type, 120)) return;
      noise(t, 0.12 * v, 0.004, 0.12, 'lowpass', 500, 0, 0.7);
    } else {
      if (!gate('l' + type, 45)) return;
      noise(t, 0.03 * v, 0.004, 0.04, 'bandpass', rnd(1500, 2500), 0, 0.9);
    }
  });

  const kusuTouch = safe(() => {
    if (!gate('kt', 120)) return;
    const t = ctx.currentTime + 0.003;
    bell(t, 2350, 0.05);
    bell(t + 0.035, 2790, 0.04);
    bell(t + 0.07, 3130, 0.03);
  });

  const kusuOpen = safe(() => {
    const t = ctx.currentTime + 0.003;
    // 木のパカッ
    knock(t, 620, 0.14, 0.09);
    knock(t + 0.045, 480, 0.11, 0.08);
    noise(t, 0.08, 0.002, 0.12, 'bandpass', 1400, 900, 1.2);
    // シャララン: 鈴が上がって下がる
    const seq = [5, 6, 7, 8, 9, 10, 9, 8, 7];
    for (let i = 0; i < seq.length; i++) {
      bell(t + 0.12 + i * 0.065, penta(5, seq[i]), 0.04 * (1 - i * 0.05));
    }
  });

  const sockStick = safe(() => {
    if (!gate('ss', 150)) return;
    const t = ctx.currentTime + 0.003;
    noise(t, 0.16, 0.006, 0.18, 'lowpass', 700, 250, 0.8);
    tone(t, 150, 0.1, 0.006, 0.16, { to: 85 });
  });
  const sockDrop = safe(() => {
    const t = ctx.currentTime + 0.003;
    noise(t, 0.1, 0.004, 0.12, 'lowpass', 450, 0, 0.7);
    tone(t, 120, 0.06, 0.004, 0.1, { to: 80 });
  });
  const sockBasket = safe(() => {
    const t = ctx.currentTime + 0.003;
    noise(t, 0.11, 0.004, 0.14, 'lowpass', 550, 300, 0.7);
    mallet(t + 0.16, penta(5, 3), 0.07, 0.3, 0.25);
    mallet(t + 0.29, penta(6, 0), 0.08, 0.5, 0.25);
  });

  const jarRelease = safe(() => {
    const t = ctx.currentTime + 0.003;
    click(t, 2600, 0.09);
    click(t + 0.05, 3100, 0.07);
    tone(t + 0.02, 900, 0.03, 0.002, 0.06, { to: 1100 });
  });
  const jarSet = safe(() => {
    const t = ctx.currentTime + 0.003;
    knock(t, 330, 0.11, 0.07);
  });
  const jarClick = safe(() => {
    const t = ctx.currentTime + 0.003;
    click(t, 3400, 0.11);
    click(t + 0.028, 2500, 0.08);
  });
  const lid = safe(open => {
    const t = ctx.currentTime + 0.003;
    if (open) {
      knock(t, 520, 0.09, 0.06);
      noise(t + 0.02, 0.04, 0.03, 0.18, 'bandpass', 600, 1400, 1);
    } else {
      knock(t, 400, 0.1, 0.07);
      click(t + 0.01, 2200, 0.04);
    }
  });
  const hatch = safe(open => {
    const t = ctx.currentTime + 0.003;
    if (open) {
      click(t, 2900, 0.08);
      knock(t + 0.03, 560, 0.09, 0.06);
    } else {
      click(t, 3200, 0.09);
    }
  });
  const dump = safe(amount => {
    const a = clamp01(num(amount, 0.5));
    if (a < 0.01) return;
    const t = ctx.currentTime + 0.003;
    noise(t, 0.16 * (0.4 + 0.6 * a), 0.02, 0.5, 'lowpass', 900, 260, 0.7);
    tone(t, 110, 0.08 * a, 0.01, 0.25, { to: 70 });
    const n = Math.round(6 + 16 * a);
    for (let i = 0; i < n; i++) {
      grain(t + 0.03 + Math.random() * 0.55, 0.05 + 0.05 * Math.random(), rnd(0.55, 1.0));
    }
  });
  const shake = safe(() => {
    if (!gate('sh', 90)) return;
    const t = ctx.currentTime + 0.003;
    knock(t, 260, 0.1, 0.07);
    for (let i = 0; i < 3; i++) grain(t + 0.02 + Math.random() * 0.08, 0.05, rnd(0.6, 1.1));
  });
  const plop = safe(() => {
    const t = ctx.currentTime + 0.003;
    tone(t, 520, 0.09, 0.004, 0.12, { to: 240 });
    noise(t, 0.05, 0.003, 0.06, 'lowpass', 800, 0, 0.7);
  });

  const chime = safe(kind => {
    const t = ctx.currentTime + 0.01;
    if (kind === 'clean') {
      const seq = [0, 2, 4, 5];
      seq.forEach((d, i) => mallet(t + i * 0.09, penta(6, d), 0.075, 0.6 + i * 0.15, 0.35));
      bell(t + 0.4, penta(7, 0), 0.025);
    } else if (kind === 'round') {
      const seq = [[2, 0], [3, 0.16], [4, 0.32], [3, 0.48], [5, 0.64], [7, 0.86]];
      seq.forEach((s, i) => mallet(t + s[1], penta(5, s[0]), 0.07, i === seq.length - 1 ? 1.4 : 0.6, 0.25));
      tone(t + 0.86, penta(4, 0), 0.04, 0.01, 1.2);
    } else if (kind === 'night') {
      const seq = [[4, 0], [3, 0.5], [2, 1.0], [0, 1.6], [-1, 2.1], [0, 2.7]];
      seq.forEach((s, i) => mallet(t + s[1], penta(5, s[0]), 0.055, i === seq.length - 1 ? 2.0 : 1.1, 0.15));
      tone(t, penta(4, 0), 0.025, 0.05, 1.6);
      tone(t + 1.6, penta(3, 4), 0.025, 0.05, 1.8);
    } else if (kind === 'morning') {
      const seq = [0, 2, 3, 5];
      seq.forEach((d, i) => mallet(t + i * 0.075, penta(5, d), 0.075, 0.45 + i * 0.12, 0.35));
      bell(t + 0.32, penta(7, 2), 0.022);
      bell(t + 0.4, penta(7, 4), 0.018);
    } else {
      mallet(t, penta(6, 0), 0.06, 0.6, 0.3);
    }
  });

  const hint = safe(() => {
    if (!gate('hint', 250)) return;
    const t = ctx.currentTime + 0.003;
    tone(t, penta(6, 4), 0.025, 0.01, 0.35);
  });
  const powerDown = safe(() => {
    if (!gate('pd', 400)) return;
    const t = ctx.currentTime + 0.003;
    tone(t, 460, 0.06, 0.02, 0.9, { to: 70, glide: 0.85, lp: 1500 });
    tone(t, 920, 0.02, 0.02, 0.7, { to: 140, glide: 0.65, lp: 1500 });
    noise(t, 0.05, 0.02, 0.7, 'bandpass', 1600, 250, 0.9);
  });

  return {
    init, setActive, update,
    setMotor, setRattle, setSlurp, setFringe,
    tick, land, kusuTouch, kusuOpen,
    sockStick, sockDrop, sockBasket,
    jarRelease, jarSet, jarClick, lid, hatch,
    dump, shake, plop, chime, hint, powerDown,
  };
})();
