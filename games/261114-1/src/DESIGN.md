# じゅわっ！ママとおなじぎょうざづくり — 設計書（実装役むけ）

遊ぶ人は5歳。iPhone/iPad、指1本、文字なし。写実的な3D（本物どおり・ふつうの見た目。おもちゃ風/ローポリ/絵本風は不可）。
切り口: **包んだひだが、焼くと羽（パリパリの羽根）になる**。ひだの数と位置が、焼いたときの羽根の形として残る。

## 0. ビルドと決まりごと
- `node build.mjs [out.html]` が `vendor/three.min.js`(r160, グローバル `THREE`) と `src/*.js`（ファイル名順）を `template.html` に埋め込む。
- すべて古典スクリプト（ES module 不可）。各ファイルは `(function(){ 'use strict'; var G = window.G; ... })();` で包む。外部読み込み・CDN・画像ファイル・fetch 禁止。テクスチャは Canvas で手続き生成、音は Web Audio 合成。
- 共有の小道具は `src/05-util.js`（`G.util`, `G.ease`）。読んで使うこと。
- 単位: **1 = 10cm**。Y が上。カウンター／テーブルの天板の上面が y=0。カメラは -Z の方を見る（画面の奥 = -Z、手前 = +Z、右 = +X）。
- 色は sRGB、`renderer.outputColorSpace = SRGBColorSpace`、ACESFilmic トーンマップ、PBR（MeshStandard/Physical）＋環境マップ＋影つき平行光。
- 性能: iPad で 30fps。影マップ 1 枚(1024〜2048)、粒子は上限つき、テクスチャは多くても 1024。ジオメトリは必要な滑らかさで（ぎょうざ1個 ~3k三角、皿や鍋 ~2〜4k）。
- 例外で止まらないこと。localStorage/Audio は try/catch。

## 1. 場所（1つの世界の中をカメラが移る）
| 場面 | アンカー `G.world.anchors` | 何がある |
|---|---|---|
| wrap（つつむ） | (0,0,0) | 石目のカウンター。まな板、皮、あんのボウル＋スプーン、水の小皿、バット（ママのぎょうざ3個＋空き3つ） |
| fry（やく） | (6,0,0) | 同じカウンターの右。ガスこんろ、フライパン、ふた、水溶き粉のカップ、バット、大皿 |
| eat（たべる） | (14,0,0) | 木のダイニングテーブル（上面 y=0）。大皿、しょうゆ小皿、じぶんの取り皿、ママの取り皿、はし |

各場面の遊び場は中心から **幅3.4 × 奥行3.6** におさめる（縦持ち 390×844 が基準、横持ち iPad でも同じ四角が入るようカメラが合わせる）。

## 2. お話と操作（各ステップで「次に触る1つ」だけが光る）
### wrap（3個つくる。ママの3個はバットに先に並んでいる＝お手本）
1. **あんをのせる**: スプーン（あんの山つき）をドラッグ → 皮の上で離すと「ぽてっ」。2杯目ものせられる（ふっくら。発見）。
2. **ふちに水**: 水の小皿に触る（ちゃぷ、指がぬれる）→ 皮の奥半分のふちをなぞると、なぞった所がつやっと光る。7割で完了。
3. **たたむ**: 皮の手前のふちを奥へドラッグ → 半月に「ぺたん」。途中で離すと6割未満は戻る。
4. **ひだをつける**: カメラが寄る。とじ目を押す/なぞると、その位置にひだが「きゅっ」（7スロット、最寄りに吸着）。全部うまるか、2個以上つけて2.5秒さわらないと完成。
5. 完成したぎょうざが立ち上がり、バットのママのとなりへ「ぴょん、こてん」（少しもたれてから起きる＝くすっと）。次の皮が出てくる。3個で fry へ。

### fry
1. **ならべる**: フライパンにはママの3個が先に入っている。じぶんの3個をバットからドラッグして空きへ（吸着）。
2. **火をつける**: つまみを回す → 「カチカチ…ボッ」青い火、だんだん「ジュー」。
3. **水を入れる**: 白い水溶き粉のカップをフライパンの上へドラッグ → 傾いて注がれ「**じゅわーっ！**」大きな湯気。
4. **ふたをする**: ふたをドラッグしてのせる → くもる、音がこもる、ふたがカタカタ（タップすると跳ねて湯気ぷしゅ＝発見・くすっと）。数秒で水がなくなり音が「パチパチ」に。
5. **ふたをとる**: ふたをドラッグで外す → 湯気がもわっ。**ひだの位置から羽根が広がり**、白い膜→きつね色のパリパリに。
6. **火をけす**: つまみを戻す。
7. **皿をかぶせる** → **ひっくり返す**（フライパンの柄をつかんで反対側へ弧を描いてドラッグ）→ 「パリッ」大皿に羽根つきぎょうざ。
8. 皿が手前に運ばれ、eat へ。

### eat
1. 大皿のぎょうざをドラッグ → 羽根が「パリッ」と割れて、そのぎょうざの分の羽根ごと取れる。
2. しょうゆ小皿を通すと、たれがつく（つけた分だけ色が残る。発見）。
3. 手前のじぶんの取り皿に置く → タップで「ぱくっ」（1回目は半分、2回目でなくなる）。奥のママの取り皿に置くこともできる（おすそわけ。やさしい音。発見）。
4. 大皿が空になり、じぶんの皿も空になったら、おしまい: カメラがゆっくり引き、夕方のやわらかい光、空の皿と羽根のかけら、やさしいメロディ。少しして大皿をタップすると最初からもう一度。

## 3. 状態（場面をまたいで保つ）
`G.state.data = { v:1, station:'wrap'|'fry'|'eat'|'end', made:0..3, gyoza:[ {pleats:[7個の0/1], fill:1|2} ×6 ], ... }`
- gyoza[0..2] はママ（pleats 全部1, fill 1）、[3..5] がじぶん。場面の `enter` は、この状態から物を正しい位置に置き直せること（途中から始めても壊れない）。
- `G.shared = { gyozas:[G.Gyoza×6], wing:G.Wing, tray, plate }`（main が作る）。場面はこれを動かして使う。

## 4. モジュールと公開 API（ファイル名順に読み込まれる）
- `05-util.js` … `G.util`, `G.ease`（済）
- `10-core.js` … `G.core`, `G.cam`, `G.input`, `G.tw`, `G.audio`, `G.hint`, `G.fx`, `G.state`, `G.flow`
- `20-gyoza.js` … `G.Gyoza`, `G.Wing`, `G.foodTex`
- `30-world.js` … `G.world`, `G.props`
- `40-wrap.js` / `50-fry.js` / `60-eat.js` … `G.flow.register('wrap'|'fry'|'eat', station)`
- `90-main.js` … 起動

### 10-core.js
```
G.core = { renderer, scene, camera, time, dt, low:boolean,            // low = 低負荷モード
           init(canvas) → false なら WebGL 不可, start(), onUpdate(fn)→解除関数,
           fade(to 0..1, 秒)→Promise }                                  // #fade の div で暗転
G.cam  = { frame({center:[x,y,z]|Vector3, w, d, pitch=56, yaw=0, lift=0}, 秒=1.2)→Promise, shake(強さ,秒), spec }
         // center を中心とする y=center.y の w×d の四角が、Safe Area 内に入る距離へ。リサイズ/回転で自動で合わせ直す。fov≈30°
G.input = { set({down(p), move(p), up(p), cancel(p)}), clear(),
            // p = {x,y(css px), ray:THREE.Ray, id, t, start:{x,y}, moved:px, dt}。最初の1本の指だけを扱い、他の指は無視
            planeHit(p, y=0)→Vector3|null, screenDist(p, worldVec3)→px, toScreen(worldVec3)→{x,y}, pick(p, objects)→hit|null,
            pxPerUnit(worldVec3)→その位置での 1 単位あたりの px }
G.tw = { to(obj, {prop:値…}, 秒, {ease, delay, onUpdate})→Promise(+cancel), wait(秒)→Promise, scope()→{to, wait, kill(), alive} }
         // scope.kill() 後は、その scope の Promise は二度と解決しない（場面を出たあと続きが走らない）
G.audio = { unlock(), sfx(name, {vol=1, pitch=1, delay=0}), loop(name, level 0..1), muffle(0..1), phrase(name), stopAll() }
         // sfx: tap pop plop squish pinch fold splash drip clink lid ceramic metal whoosh ignite click crack crunch bite gulp sparkle chime puff pour sizzleBurst flour
         // loop: sizzle bubble crackle flame steam（連続音。level へ滑らかに追従）。muffle はふた越しのこもり
         // phrase: 'start' 'made' 'reveal' 'ending'（短いやさしい旋律。マリンバ/オルゴール系）
G.hint = { set({target: Object3D|Vector3|()=>Vector3, radius=0.5, wobble:Object3D?, demo:{type:'drag', path:[Vector3…]|()=>[…]} | {type:'tap', at:Vector3|()=>Vector3}, delays:[4,9]}),
           poke(), clear(), stage }
         // 段階0: 対象にやわらかいスポット光＋足もとの光の輪がゆっくり脈打つ（他は少し暗く）。
         // 段階1(4秒放置): 輪が強く、wobble 対象が小さく揺れ、sparkle 音。段階2(9秒放置): 半透明の指（肌色の丸い指先の3Dモデル）が demo の動きをくり返す。
         // 指が画面に触れたら poke() が自動で呼ばれ段階0へ。
G.fx = { steam(pos, {count, spread, rise, size, life}), emitter(()=>pos, {rate, …})→{rate, stop()}, burst(pos, kind:'flour'|'crumb'|'drop'|'spark', {count, speed, …}) }
G.state = { data, load(), save(), reset() }
G.flow = { register(name, {build(), enter(), update(dt), exit()}), go(name)→Promise, current, restart() }
```

### 20-gyoza.js（形の状態はすべてセッターで、いつでも何度でも呼べる）
```
g = new G.Gyoza({ pleats:[7], fill:1, seed, mama:false })
g.group                      // 原点 = 皮の中心の底面。ローカル X が長手、とじ目は -Z 側（寝ているとき）/ 上（立っているとき）
g.setShape({ fold:0..1, stand:0..1 })   // fold 0=ひらいた円い皮(半径0.45) → 1=半月に閉じて寝ている。stand 0→1 で底が平らに立つ（とじ目が上、少し弓なり）
g.setFilling(0..2)           // あんの量。ひらいた皮の中央の山。閉じたあとはふくらみ具合
g.setWet(a0, a1) / g.clearWet()  // ひらいた皮の奥半分(角度 0..π、-X端→奥→+X端)のうち、ぬれた範囲を足す。g.wetCoverage 0..1
g.setPleat(i, 0..1)          // i=0..6（-X側→+X側）。g.pleats[i]。g.pleatLocal(i)→Vector3（寝ている時のスロット位置、ローカル）
g.setCook(0..1)              // 0 生（白く粉っぽい不透明）→ 1 蒸し上がり（つやがあり少し透けて、あんの緑がうっすら）
g.setBrown(0..1)             // 底の焼き色（きつね色〜こんがり）
g.setSauce(0..1)             // 片端のしょうゆ染み
g.setBite(0|1|2)             // 1 = 半分（断面にあんが見える）、2 = 見えない
寸法: 立った姿で 長さ≈0.82、幅≈0.36、高さ≈0.38。

w = new G.Wing({ radius:1.12 })
w.group                      // 原点 = 円の中心、y=0 の面に薄く広がる。6つの「かけら」(w.pieces[i].group) に分かれている（割れ目は動かすまで見えない）
w.layout([{x, z, rot, pleats:[7]} ×6])   // ぎょうざの位置（Wing ローカル）。各ぎょうざのボロノイ領域がそのぎょうざのかけら
w.setGrow(0..1)              // 各ぎょうざの「ひだのある位置」から羽根（葉/羽の形のふさ）が外へ伸び、1 で鍋いっぱいの円盤に
w.setCrisp(0..1)             // 0 白く泡立つ水溶き粉の膜 → 1 きつね色のパリパリのレース（穴あき・網目）。ひだの多いぎょうざの周りほど羽の筋が密
w.pieces[i]                  // {group, center:Vector3}。場面側が group を付け替えて、ぎょうざと一緒に運ぶ

G.foodTex = { fillingMaterial(), fillingMound(半径, 高さ, seed)→Mesh（ボウルやスプーンにのせる、ひき肉とニラのあんの山）, doughMaterial() }
```

### 30-world.js
```
G.world = { build(scene), anchors:{wrap,fry,eat}, setFocus(Vector3, 半径)  // 影つき平行光と影の範囲を場面へ
            setMood('day'|'evening', 秒), stove:{group, knob, knobPos, setFlame(0..1), burnerPos} }
G.props = { board(), tray(), bowl(), spoon(), waterDish(), wrapperStack(n), pan(), lid(), cup(), plate(), smallPlate(), soyDish(), chopsticks(scale), rest(), teaCup() }
          // どれも THREE.Group を返す。原点は底面の中心。寸法と持つ所は userData に（例: pan.userData = {innerR, rimY, floorY, handleTip:Vector3}）
```

## 5. 配置（各アンカーからの相対位置。カメラ枠 = center, w, d）
縦持ちでは奥行きに余裕（地面で約8単位）があり、横持ちでは幅に余裕がある。下の枠に入っていればどちらでも見える。
### wrap  枠: center(0,0,0.1) w3.4 d3.8
- バット: (0,0,-1.25) 3.0×1.0。スロット6つ x = -1.25 + i*0.5（0..2 ママ、3..5 じぶん）。ぎょうざは長手を Z 向きに立てて置く。
- まな板: (0,0,0.22) 2.6×1.55、厚み 0.15（上面 y=0.15）。皮は板の上 (0, 0.15, 0.3)。皮の束は板の左 (-0.9, 0.15, 0.2)。
- あんのボウル: (-1.0,0,1.6) 半径0.55。スプーンはボウルにささっている。 水の小皿: (1.05,0,1.6) 半径0.4。
- ひだの時の寄り枠: center(0,0.15,0.2) w1.7 d1.5。
### fry  枠: center(0,0,0.3) w3.4 d4.6
- こんろ(天板ガラス): x -1.7..1.5, z -2.1..1.45。五徳の上面 y=0.12。バーナー中心 (-0.25,0,-0.7)。つまみ (-0.9,0,1.15) 半径0.22（天板の手前の帯の上に立つ回転つまみ）。
- フライパン: バーナー上。底の内半径1.05、ふちの半径1.22、深さ0.42。柄は手前右ななめ45°へ長さ1.3。
- 手前の帯 z 1.6..2.6 に、その時の主役（バット→カップ→ふた→大皿）が順に出てくる。置き場所は場面側が縦横比で決める。
### eat  枠: center(0,0,0.15) w3.4 d4.6
- 大皿: (0,0,-0.1) 半径1.3。 ママの取り皿: (0.75,0,-1.75) 半径0.5。 じぶんの取り皿: (-0.55,0,1.85) 半径0.55。 しょうゆ小皿: (0.9,0,1.5) 半径0.36。

## 6. 「次の1操作が常に分かる」ための約束
- 場面は各ステップで `G.hint.set(...)` を1つだけ。操作が成立したら `G.hint.clear()` → 次へ。
- 当たり判定は見た目より大きく（画面上 44px 以上。`G.input.screenDist` で判定）、離したら近くの目的地へ吸着。目的地以外で離したら元の場所へ自然に戻る（失敗ではない）。
- 触った瞬間（100ms以内）に、動きと音で応える。
- 矢印・文字・数字・世界の外の UI は出さない。
