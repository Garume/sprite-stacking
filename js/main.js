// スクロール位置だけが時計。スクロールした分だけ島が回り、輪切りが下から離れ、下から重なり、建物が建つ。
import { Renderer } from './engine/renderer.js';
import { pack } from './engine/palette.js';
import { buildScene, placeClouds, extent } from './scene/index.js';

const SQUASH = 0.6; // 見下ろす角度（縦のつぶし率）
const APART_SQUASH = 0.45; // 輪切りを離すあいだは少し横から見て、すき間を見せる
const GAP = 10; // 離したときの、輪切り1枚ごとの間隔（ドット）。重なっているときは 1
const WAVE = 14; // 離れる・重なる動きの途中にある輪切りの枚数

// 床に落ちる影。rx / ry = 影の半径（ry はつぶす前）、peek = 組みあがった島の手前のふちから下にのぞく量
const FLOOR = { rx: 120, ry: 34, peek: 10, color: pack('#dbe4e7') };

const MARGIN = 4; // 内部の画面のふちに残す余白（ドット）
const MAX_SCALE = 8; // 絵の1ドットを、CSS の何 px まで大きくするか
const FOLLOW = 10; // 島がスクロールに追いつく速さ（1秒あたり）
const WIDE_ART_FROM = 0.42; // 広い画面で、島の置き場所が始まる位置（画面幅に対する割合。文章は 8〜42% にある）
const COPY_GAP = 4; // せまい画面で、島の見える範囲と文章の箱のあいだに空ける量
const AREA_PAD = 8; // 島の置き場所の上下に残す余白。上は、絵がうすれる幅（site.css の mask）の終わりに合わせてある
// 島が上・文章が下になる画面。site.css と同じ境目（横長の画面は、幅 640px から左右に並べる）
const narrow = matchMedia('(max-width: 831px) and (orientation: portrait), (max-width: 639px)');
// 「描く順番」の表示：高い輪切りから順に描いていく1巡の長さ（ミリ秒）。run = 描くあいだ、rest = 描きおえて止まるあいだ
const SCAN = { run: 7000, rest: 1800 };
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const still = matchMedia('(prefers-reduced-motion: reduce)');

// 各停留所での島の向き（度）。「90 − 建物の方位」でその建物が画面の手前に来る。
// 進むほど同じ向きに回り、最後は島をもう1周して、表紙と同じ向きにもどる。
// apart = 輪切りが離れきった場面。build = そこへ着くまでに建つ部品と、区間のどこからどこまでで建つか。
// handoff = 前の場面から来るとき、区間のどこで文章を入れ替えるか（書かなければまん中）
const STOPS = [
  { id: 'cover', angle: -50 },
  { id: 'slices', angle: 130, apart: true },
  { id: 'lighthouse', angle: 240, focus: 'lighthouse', handoff: 0.6, build: [['lighthouse', 0.64, 0.97]] },
  { id: 'bakery', angle: 330, focus: 'bakery', build: [['bakery', 0.15, 0.9]] },
  { id: 'sento', angle: 420, focus: 'sento', build: [['sento', 0.15, 0.9]] },
  { id: 'shrine', angle: 510, focus: 'shrine', build: [['shrine', 0.15, 0.9]] },
  { id: 'tree', angle: 645, focus: 'tree', build: [['tree', 0.15, 0.8], ['lamps', 0.55, 0.92]] }, // 広場へ続く道の正面から見る
  { id: 'end', angle: 1030 },
];
// 輪切りが離れきった場面の前後の進行。区間のどこからどこまでで何をするか。
// 離れるのは、はじめからある島（地面と木）の輪切り。地面の1枚と見る位置は動かさないので、
// 地面より下の輪切りは下へ、上の輪切りは上へ、画面の外まで伸びる
const OPEN = { wave: [0.12, 0.9], tilt: [0.12, 0.5] }; // 離れる：下から順に離し、少し横から見る
const CLOSE = { wave: [0.05, 0.5], tilt: [0.32, 0.52] }; // 重なる：下から順に重ね、見下ろしにもどす
const SLICES = STOPS.findIndex((stop) => stop.apart); // 描きかたの表示を切りかえられる場面
const TURN = [0.05, 0.95]; // 区間のこの範囲で回る。両端ではその場にとどまる

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const ramp = (t, [from, to]) => clamp((t - from) / (to - from), 0, 1); // from で 0、to で 1

// アドレスの # と場面の対応。表紙は # なし
const hashOf = (index) => (index > 0 ? `#${STOPS[index].id}` : '');
const urlOf = (index) => hashOf(index) || location.pathname + location.search;
// # が指す場面。# がなければ表紙、知らない # なら -1
const stopOfHash = () => (location.hash ? STOPS.findIndex((stop) => location.hash === `#${stop.id}`) : 0);

const root = document.documentElement;
const stage = document.querySelector('.stage');
const canvas = document.querySelector('#island');
const scene = buildScene();
// はじめからある島（地面と木）の、いちばん高い輪切り。ここまでが離れる
const LAND_TOP = Math.max(...scene.parts.filter((part) => part.base).map((part) => part.z1));

// 組みあがった絵の広がり。置き場所に収める大きさは、島と雲（ART_W × ART_H）で決める。
// 床の影はその下にのぞく。置き場所に収まらないときは、影のほうを切る
const art = extent(scene, SQUASH);
const ART_W = art.side * 2;
const ART_H = art.top + art.bottom;
const ART_MIDDLE = (art.bottom + FLOOR.peek - art.top) / 2; // 影までふくめた絵のまん中は、地面よりこれだけ下
const FLOOR_DROP = art.bottom + FLOOR.peek - FLOOR.ry * SQUASH - scene.deck; // 島の底から、床の影のまん中まで

// 内部の画面は、輪切りが離れきったときも収まる大きさにする。回転の軸（地面の中心）を PIVOT に置く
const apart = extent(scene, SQUASH, (z) => (z - scene.deck) * GAP, true);
const PIVOT_X = Math.ceil(art.side) + MARGIN;
const PIVOT_Y = Math.ceil(Math.max(art.top, apart.top)) + MARGIN;
const BUFFER_W = PIVOT_X * 2;
const BUFFER_H = PIVOT_Y + Math.ceil(Math.max(apart.bottom, scene.deck * GAP + FLOOR_DROP + FLOOR.ry * SQUASH)) + MARGIN;

const renderer = new Renderer(canvas, scene, BUFFER_W, BUFFER_H);
const sections = STOPS.map((stop) => document.getElementById(stop.id));
const copies = sections.map((section) => section.querySelector('.copy'));
const navLinks = [...document.querySelectorAll('#places a')];
const menuButton = document.querySelector('#menu-button');
const places = document.querySelector('#places');
const countNow = document.querySelector('#count-now');
// しくみの場面の、描きかたの表示。文章の下のボタンで切りかえる。どちらか片方だけ出せる。
// order = 描く順番（高い輪切りから順に描いていくようすを見せる）、rim = 描く範囲（重なると隠れる部分を縞で見せる）
const toggles = [...document.querySelectorAll('[data-show]')];
const readout = sections[SLICES].querySelector('.dims'); // 表示の説明を出す行
const PAPER = pack(getComputedStyle(root).getPropertyValue('--bg').trim()); // 背景の色
let showing = null; // 'order' / 'rim' / null
let scanning = false; // 描く順番のようすを、時間で進めているところか
let scanFrom = 0; // その1巡めが始まった時刻
let readoutDefault = ''; // 表示を切っているときの、行のもとの文字
let readoutNow = null;
const lift = new Float32Array(scene.height); // 高さ z の輪切りを、地面からどれだけ上に描くか
const reveal = new Float32Array(scene.parts.length).fill(1); // 部品ごとの建ち具合
// 建つ部品ごとの、建ちはじめと建ちおわりの位置（停留所の番号 + 区間の進み具合）
const builds = STOPS.flatMap((stop, i) => (stop.build ?? []).map(([key, from, to]) => (
  { index: scene.part(key).index, span: [i - 1 + from, i - 1 + to] })));

let frames; // measure() が決める、停留所ごとの島の置き場所と倍率
let dpr = 1;
let dprQuery; // いまの拡大率が変わったら知らせてもらう相手
let bar = 0; // 上の帯の高さ。島はこれより下に見せる
let fade = 0; // 見える範囲の端で、絵がうすれて消える幅
let maskBottom = -1; // いま stage に渡してある、島の見える範囲の下端
let shown = null; // いま描いている位置。停留所の番号 + 次の停留所までの進み具合
let currentStop = -1;
// リンクや建物を押して向かっている先。着くまで、通りすぎる場面の文章は出さない。
// { index: 停留所の番号, focus: 着いたら見出しへフォーカスを移すか }
let jump = null;
let scrollIdle = 0;
// アドレスの # は、いま出ている場面に合わせて書きかえる（表紙は # なし）。
// 読みこみが済むまでと、「戻る」「進む」を受けとった直後は、ブラウザに任せて書きかえない
let hashReady = false;
let historyPending = false;
let lastTime;
let raf = 0;

document.querySelector('#count-total').textContent = STOPS.length;
fillDims();
readoutDefault = readout.textContent;
measure();
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', remeasure);
document.fonts?.ready.then(remeasure); // 書体が届くと文章の高さが変わる
canvas.addEventListener('click', onCanvasClick);
canvas.addEventListener('pointermove', onCanvasMove);
document.addEventListener('click', onDocumentClick);
document.addEventListener('keydown', onKeyDown);
document.addEventListener('pointerdown', onPointerDown);
places.parentElement.addEventListener('focusout', onMenuFocusOut);
for (const type of ['wheel', 'touchstart']) addEventListener(type, cancelJump, { passive: true });
addEventListener('hashchange', onHistoryMove);
addEventListener('popstate', onHistoryMove);
if (document.readyState === 'complete') onLoaded();
else addEventListener('load', onLoaded);
// # つきのアドレスで開いたときは、ブラウザがその場面まで運ぶ。着くまで、通りすぎる場面の文章は出さない
if (stopOfHash() > 0) startJump(stopOfHash(), false);
schedule();

// 「輪切り 76枚 / 3,412ドット」の表記を、実際の形から数えて入れる
function fillDims() {
  const format = (slices, voxels) => `輪切り ${slices}枚 / ${voxels.toLocaleString('ja-JP')}ドット`;
  for (const el of document.querySelectorAll('[data-dims]')) {
    const key = el.dataset.dims;
    const part = key === 'land' ? scene.land : scene.part(key);
    if (part) el.textContent = format(part.slices, part.voxels);
  }
}

function remeasure() {
  measure();
  schedule();
}

// 画面の大きさから、停留所ごとに島を置く場所と倍率を決める。
// 倍率は画面の1ピクセル刻みにして、止まっているときは絵のどのドットも同じ大きさで出るようにする
function measure() {
  dpr = devicePixelRatio || 1;
  const step = 1 / dpr; // 画面の1ピクセル。倍率の刻みで、これより小さくはしない

  // 表示領域。アドレスバーの出入りで変わらない clientHeight を使う
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const css = getComputedStyle(root);
  bar = parseFloat(css.getPropertyValue('--bar'));
  fade = parseFloat(css.getPropertyValue('--fade'));
  const copyBottom = parseFloat(css.getPropertyValue('--copy-bottom'));
  const top = bar + AREA_PAD;

  frames = STOPS.map((stop, i) => {
    // せまい画面では上の帯とその場面の文章のあいだ、広い画面では文章の右に置く。
    // bottom = 島の見える範囲の下端。その手前 fade の幅で絵がうすれるので、置き場所はそこで終わる。
    // 広い画面では画面の下端まで見せる（うすれる幅は画面の外に置くので、離れた島は画面の端でそのまま切れる）
    const bottom = narrow.matches ? vh - copyBottom - copies[i].offsetHeight - COPY_GAP : vh + fade;
    const area = narrow.matches
      ? { x: 0, w: vw, h: bottom - fade - top }
      : { x: vw * WIDE_ART_FROM, w: vw * (1 - WIDE_ART_FROM), h: vh - AREA_PAD - top };
    const h = Math.max(area.h, 1);
    const scale = clamp(floorToPixel(Math.min(area.w / ART_W, h / ART_H)), step, MAX_SCALE);
    // 輪切りが離れきったとき、この高さより下の輪切りは画面の下の外にある。
    // 高さ z の輪切りは、地面より (地面の高さ − z) × GAP 行だけ下に見える
    const below = (Math.min(bottom, vh) - top - h / 2) / scale + eyeOffset(h, scale); // 地面の中心から、見える範囲の下端まで
    const skip = clamp(Math.floor(scene.deck - (below + art.side * SQUASH) / GAP) - 1, 0, scene.deck);
    return { cx: area.x + area.w / 2, cy: top + h / 2, w: area.w, h, scale, bottom, skip };
  });

  // 別の拡大率の画面へ窓を移したときは resize が来ないので、ここで待つ
  dprQuery?.removeEventListener('change', remeasure);
  dprQuery = matchMedia(`(resolution: ${dpr}dppx)`);
  dprQuery.addEventListener('change', remeasure, { once: true });
}

// 置き場所（高さ h、倍率 scale）のまん中に見せる行を、地面の中心から数えたもの。
// ふだんは、床の影までふくめた組みあがった絵のまん中。
// 影まで入れると島の上が置き場所から出るときは、出ないところまで下げる（影が下で切れる）
function eyeOffset(h, scale) {
  return Math.min(ART_MIDDLE, h / scale / 2 - art.top);
}

// 倍率を、画面の1ピクセル刻みに切り下げる
function floorToPixel(scale) {
  return Math.floor(scale * dpr + 1e-6) / dpr;
}

// 位置（停留所の番号 + 進み具合）で、どの場面の文章を出すか
function stopAt(position) {
  const i = Math.min(Math.floor(position), STOPS.length - 1);
  if (i === STOPS.length - 1) return i;
  return position - i >= (STOPS[i + 1].handoff ?? 0.5) ? i + 1 : i;
}

// スクロール位置 → 「停留所の番号 + 次の停留所までの進み具合」
function scrollPosition() {
  const y = scrollY;
  const tops = sections.map((s) => s.offsetTop);
  let i = tops.length - 1;
  while (i > 0 && y < tops[i]) i--;
  if (i >= tops.length - 1) return tops.length - 1;
  const position = i + clamp((y - tops[i]) / (tops[i + 1] - tops[i]), 0, 1);
  return still.matches ? stopAt(position) : position; // 動きを減らす設定では、場面から場面へ切りかえる
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  const target = scrollPosition();
  const dt = lastTime === undefined ? 1 / 60 : Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (shown === null || still.matches) shown = target;
  else shown += (target - shown) * (1 - Math.exp(-FOLLOW * dt)); // スクロールに少し遅れてついていく
  if (Math.abs(target - shown) < 0.0002) shown = target;
  draw(shown);
  if (shown !== target || scanning) schedule();
  else lastTime = undefined;
}

// 輪切り1枚ごとの高さを決める。open = 下から何割まで離れたか、close = 下から何割まで重なりなおしたか。
// どちらも下の輪切りから順に進む。離れるのは、はじめからある島の輪切りだけ。
// skip = 重なりはじめる高さ。それより下（画面の外にある輪切り）は、はじめから重ねておく
function setLifts(open, close, skip) {
  const top = LAND_TOP;
  lift[0] = 0;
  for (let z = 1; z < lift.length; z++) {
    let apart = 0;
    if (open > 0 && z <= top) {
      const opened = smooth(clamp((open * (top + WAVE) - z) / WAVE, 0, 1));
      const closed = smooth(clamp((skip + close * (top + WAVE - skip) - z) / WAVE, 0, 1));
      apart = opened * (1 - closed);
    }
    lift[z] = lift[z - 1] + 1 + (GAP - 1) * apart;
  }
  const deck = lift[scene.deck];
  for (let z = 0; z < lift.length; z++) lift[z] -= deck; // 地面の1枚を基準にする
}

function draw(position) {
  const i = Math.min(Math.floor(position), STOPS.length - 2);
  const t = position - i;
  const from = STOPS[i];
  const to = STOPS[i + 1];
  const here = frames[i];
  const next = frames[i + 1];

  // 輪切りを離す・重ねる進行
  let open = 0;
  let close = 0;
  let tilt = 0; // 0 = 見下ろす、1 = 横から見る
  if (to.apart) {
    open = ramp(t, OPEN.wave);
    tilt = smooth(ramp(t, OPEN.tilt));
  } else if (from.apart) {
    open = 1;
    close = ramp(t, CLOSE.wave);
    tilt = 1 - smooth(ramp(t, CLOSE.tilt));
  }
  for (const build of builds) reveal[build.index] = ramp(position, build.span);
  const squash = lerp(SQUASH, APART_SQUASH, tilt);
  const angle = (lerp(from.angle, to.angle, smooth(ramp(t, TURN))) * Math.PI) / 180;

  // 置き場所は場面ごとに違う（せまい画面では文章の高さで決まる）。文章が入れ替わる前後で、
  // 狭くなるときは入れ替わりまでに縮め、広くなるときは入れ替わってから広げて、文章に重ならないようにする
  const swap = to.handoff ?? 0.5;
  const u = next.h < here.h ? Math.min(1, t / swap) : Math.max(0, (t - swap) / (1 - swap));
  const room = { w: lerp(here.w, next.w, u), h: lerp(here.h, next.h, u) };
  // 倍率は2つの場面のあいだをなめらかに変えるが、途中で絵が置き場所からはみ出すぶんは引く。
  // 止まっているときは、画面の1ピクセル刻みにそろえる
  let scale = Math.min(lerp(here.scale, next.scale, t), room.h / ART_H, room.w / ART_W);
  if (t === 0 || t === 1) scale = floorToPixel(scale);
  scale = Math.max(scale, 1 / dpr); // 絵の1ドットは、画面の1ピクセルより小さくしない（measure() と同じ下限）

  // 置き場所のまん中に見せる高さ（内部の画面の行）。輪切りが離れているあいだも変えない
  const eye = PIVOT_Y + eyeOffset(room.h, scale);

  // 動かすのは transform だけ
  const snap = (v) => Math.round(v * dpr) / dpr;
  const x = snap(lerp(here.cx, next.cx, u) - PIVOT_X * scale);
  const y = snap(lerp(here.cy, next.cy, u) - eye * scale);
  canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;

  // 島の見える範囲。上の帯の下端のあたりから bottom まで。端で絵がうすれて消える（site.css の mask）
  const bottom = Math.round(lerp(here.bottom, next.bottom, u));
  if (bottom !== maskBottom) {
    maskBottom = bottom;
    stage.style.setProperty('--mask-bottom', `${bottom}px`);
  }

  // 重なりなおすとき、画面の下の外にある輪切りは先に重ねておき、見えている輪切りから動かしはじめる
  setLifts(open, close, from.apart ? here.skip : 0);

  // しくみの場面では、描きかたの表示を出せる。描く順番は、動きを減らす設定なら濃淡だけで見せる
  // リンクで飛んでいる途中に通りすぎるだけのときは出さない（文章が出ていないので、何の表示か分からない）
  const demo = stopAt(position) === SLICES && (jump === null || jump.index === SLICES);
  const ordered = demo && showing === 'order';
  const now = performance.now();
  if (ordered && !still.matches && !scanning) scanFrom = now; // この場面に入ったら、上から描きなおす
  scanning = ordered && !still.matches;

  placeClouds(scene, angle, position / (STOPS.length - 1));
  const floorY = PIVOT_Y - lift[0] + FLOOR_DROP;
  renderer.render({
    angle,
    squash,
    pivotX: PIVOT_X,
    pivotY: PIVOT_Y,
    lift,
    reveal,
    clipTop: (bar - AREA_PAD - y) / scale - GAP, // すき間の陰は上の行を見て決めるので、そのぶん上から描く
    clipBottom: (Math.min(bottom, root.clientHeight) - y) / scale + 1,
    floor: { x: PIVOT_X, y: floorY, rx: FLOOR.rx, ry: FLOOR.ry * squash, color: FLOOR.color },
    paper: PAPER,
    markHidden: demo && showing === 'rim',
    paintUpTo: scanning ? ((now - scanFrom) % (SCAN.run + SCAN.rest)) / SCAN.run : undefined,
    orderTint: ordered && still.matches,
  });
  updateReadout(demo);

  setCurrent(stopAt(position));
}

// 描きかたの表示を出しているあいだ、文章の下の行に、その説明を出す
function updateReadout(demo) {
  let text = readoutDefault;
  if (demo && showing === 'order') {
    const { upTo, dots } = renderer.drawn;
    text = still.matches
      ? 'うすいほど、あとに描く輪切り'
      : `上から ${upTo}枚目は ${dots.toLocaleString('ja-JP')}ドット`;
  } else if (demo && showing === 'rim') {
    text = '縞 = 重なると隠れて描かない部分';
  }
  if (text === readoutNow) return;
  readoutNow = text;
  readout.textContent = text;
}

// 描きかたの表示を切りかえる。同じボタンをもう一度押すと、ふつうの表示にもどる
function setShowing(key) {
  showing = showing === key ? null : key;
  for (const toggle of toggles) toggle.setAttribute('aria-pressed', String(toggle.dataset.show === showing));
  scanning = false; // 描く順番は、押すたびに上から始める
  schedule();
}

function setCurrent(index) {
  if (index === currentStop) return;
  // 去る場面の中にフォーカスがあったら、着いた場面の見出しへ引きつぐ（でないと行き場をなくす）
  const hadFocus = currentStop >= 0 && sections[currentStop].contains(document.activeElement);
  currentStop = index;
  let moveFocus = hadFocus;
  if (jump) {
    jump.focus ||= hadFocus;
    if (jump.index === index) {
      moveFocus = jump.focus;
      jump = null;
    }
  }
  showCurrent();
  for (const link of navLinks) {
    if (link.hash === `#${STOPS[index].id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  countNow.textContent = index + 1;
  if (moveFocus && !jump) focusHeading(index);
  syncHash();
}

// いまいる場面の文章だけを出す。見えていない場面は、キーボードでも読み上げでも触れない
function showCurrent() {
  root.classList.remove('at-cover'); // 島を組み立てるあいだ表紙の文章を出しておく印。ここからは is-current が決める
  const passing = jump !== null && jump.index !== currentStop;
  sections.forEach((section, i) => {
    const on = i === currentStop && !passing;
    section.classList.toggle('is-current', on);
    section.inert = !on;
  });
}

// ---- 場面を替える操作 ----

function focusHeading(index) {
  sections[index].querySelector('h1, h2').focus({ preventScroll: true });
}

function startJump(index, focus) {
  if (index === currentStop) {
    // もうそこにいる：向かっていた先があればやめて、この場面を出す
    jump = null;
    showCurrent();
    if (focus) focusHeading(index);
    return;
  }
  jump = { index, focus };
}

// 自分でスクロールしはじめた、または途中で止まった：飛ぶのをやめて、いまの場面を出す
function cancelJump() {
  if (!jump) return;
  jump = null;
  showCurrent();
  syncHash();
}

// ---- アドレスの # と履歴 ----

// 自分でスクロールして場面が替わったときも、# をいまの場面に合わせる。
// そうしておくと「戻る」で、最後にいた場面へもどれる
function syncHash() {
  if (!hashReady || jump || historyPending || currentStop < 0) return;
  if (location.hash === hashOf(currentStop)) return;
  try {
    history.replaceState(null, '', urlOf(currentStop));
  } catch {
    // 書きかえの回数に上限のあるブラウザがある。失敗しても、アドレスが古いままになるだけ
  }
}

function onLoaded() {
  hashReady = true;
  requestAnimationFrame(syncHash);
  onScroll(); // 開いたときの行き先へブラウザが運ばなかった場合に、いまの場面を出すための見張りを始める
}

// リンクや建物を押して、場面 index へ行く。履歴に1つ足して、スクロールは自分で始める。
// ブラウザ任せ（# へのリンク）にすると、なめらかなスクロールの最中に押した2つめが無視される
function goTo(index, focus) {
  if (location.hash !== hashOf(index)) history.pushState(null, '', urlOf(index));
  startJump(index, focus);
  sections[index].scrollIntoView();
}

// ブラウザの「戻る」「進む」やアドレスの書きかえ。# が指す場面へ行く。
// ブラウザがスクロール位置をもどし終えるのを1コマ待ってから見る
function onHistoryMove() {
  const index = stopOfHash();
  if (index < 0) return;
  historyPending = true;
  requestAnimationFrame(() => {
    historyPending = false;
    startJump(index, false); // 島が追いつくまで、通りすぎる場面の文章は出さない
    // もどった位置がその場面でなければ（スクロールの最中に「戻る」を押したなど）、そこまで運ぶ
    if (stopAt(scrollPosition()) !== index) sections[index].scrollIntoView();
    else syncHash();
  });
}

function onScroll() {
  schedule();
  // スクロールが止まったのに目的地にいなければ（スクロールバーを直接つかんだなど）、飛ぶのをやめる
  clearTimeout(scrollIdle);
  scrollIdle = setTimeout(() => {
    if (jump && stopAt(scrollPosition()) !== jump.index) cancelJump();
  }, 250);
}

function setMenu(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  places.classList.toggle('is-open', open);
}

function onDocumentClick(event) {
  const toggle = event.target.closest('[data-show]');
  if (toggle) {
    setShowing(toggle.dataset.show);
    return;
  }
  if (event.target.closest('#menu-button')) {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    return;
  }
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  setMenu(false);
  if (link.classList.contains('skip')) {
    // 本文は固定の場所にあるので、スクロールせずに、いまの場面の見出しへ移る
    event.preventDefault();
    focusHeading(currentStop);
    return;
  }
  // 場面どうしのリンク。新しいタブで開くなどの押しかたは、ブラウザに任せる
  const index = STOPS.findIndex((stop) => link.hash === `#${stop.id}`);
  if (index < 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  goTo(index, true); // 着いたら見出しへフォーカスを移す
}

// メニューの外を押したら閉じる（click は iOS で届かないことがあるので pointerdown で見る）
function onPointerDown(event) {
  if (!event.target.closest('.bar nav')) setMenu(false);
}

// Tab や Shift+Tab でメニュー（ボタンと一覧）の外へ出たら閉じる
function onMenuFocusOut(event) {
  if (!event.relatedTarget?.closest('.bar nav')) setMenu(false);
}

function onKeyDown(event) {
  if (SCROLL_KEYS.has(event.key)) cancelJump(); // キーで自分でスクロールしはじめたら、飛ぶのをやめる
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuButton.focus();
  }
}

// ---- 島を直接さわる ----

function stopUnder(event) {
  const rect = canvas.getBoundingClientRect();
  const key = renderer.partAt(
    ((event.clientX - rect.left) / rect.width) * BUFFER_W,
    ((event.clientY - rect.top) / rect.height) * BUFFER_H,
  );
  return STOPS.find((stop) => stop.focus && stop.focus === key);
}

function onCanvasClick(event) {
  const stop = stopUnder(event);
  if (!stop) return;
  goTo(STOPS.indexOf(stop), false);
}

function onCanvasMove(event) {
  canvas.classList.toggle('is-pointing', Boolean(stopUnder(event)));
}
