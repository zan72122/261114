# 実装済み API の実際（場面を書く人むけ。DESIGN.md より、こちらと実コードが正）

## 10-core.js
- `G.core = {renderer, scene, camera, canvas, time, dt, aspect, size:{w,h}, safe:{t,r,b,l}, low, exposure, init, start, onUpdate(fn(dt,time))→off, fade(to,秒)→Promise}`
  - 毎フレームの順: tween → onUpdate → 現在の場面の `update(dt)` → カメラ・ヒント・fx → 描画。
- `G.cam.frame({center, w, d, pitch=56, yaw=0, lift=0, margin?}, 秒=1.2)→Promise`（新しい frame が来ると前の Promise はすぐ解決。秒=0 は即時）。`G.cam.shake(強さ(例0.04), 秒)`、`G.cam.spec`。
- `G.input.set({down(p), move(p), up(p), cancel(p)})`, `clear()`, `active`。`p = {x, y, ray, ndc, id, t, start:{x,y}, moved(px, 始点からの最大距離), dt(前イベントからの秒), age(押してからの秒)}`。
  - `planeHit(p, y=0)→Vector3|null`, `screenDist(p, worldVec3)→px`, `toScreen(worldVec3)→{x,y,behind}`, `pick(p, obj|配列)→hit|null`（非表示は無視）, `pxPerUnit(worldVec3)`。
  - 指が触れている最中に `input.set/clear` を呼ぶと、その指は捨てられる（新しいハンドラに move/up は来ない）。
  - pointerdown のたびに `G.audio.unlock()` と `G.hint.poke()` が自動で呼ばれる。
- `G.tw.to(obj, props, 秒, {ease: 関数 or G.ease の名前(既定 inOutQuad), delay, onUpdate(k,obj)})→Promise`（完了 true / 取消・上書き false）、`wait(秒)`, `killOf(obj)`, `scope()→{to, wait, kill, alive, guard(promise), every(fn(dt))}`。
  - 非同期の流れは必ず `sc.to / sc.wait / sc.guard(...)` で（場面を出たら続きが走らない）。`G.cam.frame` や `G.core.fade` は `await sc.guard(G.cam.frame(...))` のように包む。
- `G.audio.sfx(name, {vol, pitch, delay})`: tap pop plop squish pinch fold splash drip clink lid ceramic metal whoosh ignite click crack crunch bite gulp sparkle chime puff pour sizzleBurst flour。
  `G.audio.loop(name, 0..1)`: sizzle bubble crackle flame steam。`muffle(0..1)`、`phrase('start'|'made'|'reveal'|'ending')`、`stopAll()`。
- `G.hint.set({target: Object3D|Vector3|関数, radius=0.5, wobble: Object3D, demo: {type:'drag', path:[Vector3…]|関数} | {type:'tap', at:Vector3|関数}, delays:[4,9], ringY?})`, `poke()`, `clear()`, `stage`。
  - 光の輪は target のワールド原点の y+0.01。原点が底でない物は `ringY` を渡す。指が触れている間は放置タイマーは進まない。
- `G.fx.steam(pos, {count=6, spread=.3, rise=1.2, size=.5, life=2.2, opacity=.32})`, `emitter(fn|Vector3, {rate=4,…})→{rate, stop()}`, `burst(pos, 'flour'|'crumb'|'drop'|'spark', {count, speed, life, size, dir, floor})`（`floor` を渡すと床で止まる。粒は寄りの画面むけの大きさなので、全景では size を 1.5〜2.5 に）。
- `G.state = {data, load(), save(), reset()}`。`data = {v, station, made, gyoza:[{pleats:[7], fill}×6]}`（0..2 はママで常に既定値）。未知のキーも保存される。
- `G.flow = {register(name, {build(), enter(scope), update(dt), exit(), reset()?}), go(name)→Promise, restart(), current, scope}`。
  - `go()` は `G.hint.clear()` と `G.input.clear()` を自動で呼ぶ → `enter` の中で `G.input.set` し直す。`go` は暗転しない。`restart()` は暗転→`state.reset()`→各場面の `reset()`→'wrap'→明転。
- 起動(90-main.js): `G.shared = {gyozas:[6], wing, tray, plate}` を `visible=false` で scene に入れる → 各場面の `build()` → `location.hash`（#wrap/#fry/#eat 開発用）か `state.data.station` から開始 → `G.core.fade(0, 0.8)`。

## 20-gyoza.js
- `g = G.shared.gyozas[i]`（0..2 ママ、3..5 じぶん）。セッターは全部 `this` を返す: `setShape({fold,stand})`, `setFilling(0..2)`, `setWet(a0,a1)`（角度 0=-X端、π/2=奥(-Z)、π=+X端）, `clearWet()`, `wetCoverage`, `setPleat(i,0..1)`, `pleats[]`, `pleatLocal(i)`, `setCook`, `setBrown`, `setSauce`, `setBite(0|1|2)`。読み取り: `g.fold, g.stand, g.filling`。`g.update()`（形を今すぐ作り直す。通常は描画前に自動）。
- 寝た姿(fold=1, stand=0): 原点＝ひらいた皮の中心の底。とじ目は奥 z≈-0.40、おなかの前は z≈+0.045、高さ≈0.17。
- 立った姿(stand=1): 原点＝底面の中心、とじ目が +Y、**ひだのある面はローカル +Z**、両端は +Z 側へ反る。長さ≈0.8（ローカルX）、幅≈0.37、高さ≈0.36。fold<1 の間 stand は無視。
- かじる側(bite=1)とたれ(sauce)は +X 側。
- `w = G.shared.wing`: `layout(list)`（重い。`G.kit.layoutWing()` を使う）, `setGrow(0..1)`, `setCrisp(0..1)`, `pieces[k] = {group, mesh, center}`。羽根は y≈0.006〜0.03、影は受けるが落とさない。
- `G.foodTex.fillingMound(r,h,seed)`, `fillingMaterial()`, `doughMaterial()`, `cookedFillingMaterial()`。

## 30-world.js
- `G.world.anchors = {wrap:(0,0,0), fry:(6,0,0), eat:(14,0,0)}`、`setFocus(Vector3, 半径)`（影の範囲。場面の enter で呼ぶ）、`setMood('day'|'evening', 秒)`。
- `G.world.stove = {group, knob, knobPos(5.1,0.13,1.15), burnerPos(5.75,0.12,-0.7), setFlame(0..1)}`。knob は Y 軸回転、指標の線がローカル -Z（rotation.y=0）で「切」。
- `G.props.*()` はどれも Group、原点は底面の中心。userData:
  - board: w2.6 d1.55 topY0.15 ／ tray: w3 d1 floorY0.008 rimY0.12 slots[6] ／ bowl: r0.55 rimY0.41 fillTop(0,0.325,0)
  - spoon: 原点＝つぼの縁の面の中心（つぼの底は y-0.055）、柄は +Z へ上がる。grip(0,0.17,0.75), handleEnd(0,0.2,0.93), `setLoad(0..1)`
  - waterDish: r0.4 waterY0.086 `ripple(x?,z?)` ／ wrapperStack(n=8): `setCount(k)`, `count()`, `topY()`
  - pan: innerR1.05 rimR1.22 rimY0.455 floorY0.035 handleTip(1.77,0.6,1.77) handleGrip handleDir `setWater(level, time?)`
  - lid: r1.22（原点＝縁の下面）knobTop(0,0.52,0) `setFog(0..1)`
  - cup: 注ぎ口 -X、取っ手 +X、**rotation.z を + にすると注ぐ**。spout(-0.37,0.53,0), `stream`（visible と scale.y=長さ だけ変える。常に真下へ垂れる）, `setLevel(0..1)`
  - plate: r1.3 topY0.075 rimY0.258 ／ smallPlate: r0.55 topY0.045 ／ soyDish: r0.36 liquidY0.06 `ripple()`
  - chopsticks(scale): 長さ2.2×scale、X 方向、先は -X ／ rest: topY0.08 ／ teaCup: r0.355 h0.795 liquidY0.6
- `userData.contact`（足もとの接地影の板）がある道具は、**持ち上げる時 `contact.visible=false`**、置いたら true。
- ガラスと水は透明材質（renderOrder 2〜3）。

## 35-kit.js（場面どうしの受け渡し。必ずこれを使う）
- `G.kit.panSlot(k)→{x,z,rot}`（鍋ローカルの風車の並び。k=0..5）、`slotOf(i)`（ぎょうざ番号→スロット。ママ 0,1,2→0,2,4／じぶん 3,4,5→1,3,5）、`gyozaAtSlot(k)`。
- `applyState()`（状態のひだ・あんの量を共有ぎょうざへ）、`detachAll()`（ぎょうざと羽根を scene 直下へ戻す）、`layoutWing()`（羽根を今のひだで配置。重い。`pieces[k]` が鍋スロット k）、`resetPieces()`。
- `placeInPan(i, pan)`（ぎょうざ i を鍋の子にして所定の位置・向きへ）。羽根は `pan.add(wing.group); wing.group.position.y = pan.userData.floorY` で鍋に入れる。
- `assemblePlated()`（大皿 `G.shared.plate` に、ひっくり返した焼き上がりを盛る。冪等）: `plate → G.kit._holder(x軸π回転, y=topY+0.39) → wing.group → pieces[k].group → ぎょうざ`。取り分けは `pieces[k].group` ごと。

## 場面の受け渡しの約束
- 各場面の `enter(scope)` は、共有の物（ぎょうざ6個・羽根・バット・大皿）を**自分の場面の最初の姿に置き直す**（どこから入っても、やり直しでも同じ）。`G.kit.detachAll()` → `G.kit.applyState()` → 位置・`setShape/setCook/setBrown/setBite/setSauce`・visible。
- wrap → fry: 暗転なし。wrap は最後に `G.shared.carry = true; G.flow.go('fry')`。fry.enter は carry が true なら、バットをカメラと一緒にこんろの手前へ運ぶ（1.6秒ほど）。false なら即時に配置。
- fry → eat: fry は最後に `await sc.guard(G.core.fade(1, 0.6))` → `G.flow.go('eat')`。eat.enter は即時に配置して `G.core.fade(0, 0.8)`。
- おしまい: eat は `G.state.data.station = 'end'; G.state.save()`。大皿タップで `G.flow.restart()`。
- 自分の場面だけで使う道具は `build()` で作って scene に入れ、`enter` で表示・`exit` で非表示（他の場面と重ならない位置なので出しっぱなしでも可）。
