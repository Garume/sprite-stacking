// 島の地面。上は草地と道、下へいくほど細くなる土と岩のかたまり。
import { hash } from '../engine/volume.js';
import { M } from './materials.js';

export const SIZE = 352; // 島を置く盤の一辺（ドット）
export const HEIGHT = 120; // 盤の高さ（枚）
export const C = (SIZE - 1) / 2; // 盤の中心
export const GROUND = 40; // 平らな草地の高さ
export const HILL = 6; // 神社の丘の高さ

export const rad = (deg) => (deg * Math.PI) / 180;
const mod = (a, n) => ((a % n) + n) % n;

/** 中心から方位 deg、距離 r の位置。 */
export function polar(deg, r) {
  return { x: C + r * Math.cos(rad(deg)), y: C + r * Math.sin(rad(deg)) };
}

// 配置。建物は海岸へ正面を向けて、時計と逆まわりに並ぶ
export const SITE = {
  lighthouse: { deg: 210, r: 126 },
  bakery: { deg: 120, r: 76 },
  sento: { deg: 30, r: 76 },
  shrine: { deg: 300, r: 66 },
};
const FRAME = Object.fromEntries(Object.entries(SITE).map(([key, { deg, r }]) => (
  [key, { ...polar(deg, r), cos: Math.cos(rad(deg)), sin: Math.sin(rad(deg)) }]
)));

/** 建物から見た位置。[正面から見て右, 正面方向]。Volume.stamp と同じ向き。 */
function local(key, x, y) {
  const frame = FRAME[key];
  const dx = x - frame.x;
  const dy = y - frame.y;
  return [dx * frame.sin - dy * frame.cos, dx * frame.cos + dy * frame.sin];
}

const POND = { ...polar(248, 84), r: 17 };
// 丘は3段。いちばん外の段が道の手前で終わるので、石段をおりた先が道につながる
const HILL_TIERS = [30, 35, 40];
const STAIRS = { half: 4.5, from: 30, tread: 2.5, steps: HILL - 1 }; // 丘の上から、1段 1ドットずつおりる
const PROMENADE = { r: 110, half: 3.6 }; // 建物の前を通る道
const PLAZA = 30; // まん中の広場の半径
const SPOKES = [165, 345]; // 広場と道をつなぐ方位
const SPOKE_HALF = 3.4;
// 店の入口から道まで。u = 入口の位置、from〜to = 正面方向の範囲
const WALKS = [
  { site: 'bakery', u: -11, from: 14, to: 35, half: 3 },
  { site: 'sento', u: 0, from: 18, to: 35, half: 3.4 },
];
const APRON = 21; // 灯台のまわりの石だたみの半径
const BEACH = { deg: 62, spread: 42, width: 9 }; // 砂浜のまん中の方位、片側の広がり、幅
const CRUST = 3; // 草のすぐ下の、土の層の厚さ

/** 海岸線。方位ごとの島の半径。灯台のある 210度が岬になる。 */
function coast(t) {
  return 141 + 14 * Math.cos(t - rad(210)) + 8.5 * Math.cos(2 * t - rad(60)) + 5.5 * Math.cos(3 * t)
    + 2.2 * Math.sin(7 * t + 1) + 1.1 * Math.sin(15 * t + 2);
}

function onStairs(u, f) {
  return Math.abs(u) <= STAIRS.half && f >= STAIRS.from && f < STAIRS.from + STAIRS.tread * STAIRS.steps;
}

/** 地面のいちばん上の高さ。島の外は -1。 */
export function groundTop(x, y) {
  const r = Math.hypot(x - C, y - C);
  if (r > coast(Math.atan2(y - C, x - C))) return -1;
  if (Math.hypot(x - POND.x, y - POND.y) < POND.r) return GROUND - 2;
  const [u, f] = local('shrine', x, y);
  const hill = Math.hypot(u, f);
  const tier = HILL_TIERS.findIndex((radius) => hill < radius);
  const top = tier < 0 ? GROUND : GROUND + HILL - tier * 2;
  if (!onStairs(u, f)) return top;
  return Math.max(top, GROUND + HILL - 1 - Math.floor((f - STAIRS.from) / STAIRS.tread));
}

const stone = (x, y, seed) => (hash(x >> 1, y >> 1, seed) < 0.3 ? M.stoneDark : M.stone);

function surface(x, y, top) {
  const dx = x - C;
  const dy = y - C;
  const r = Math.hypot(dx, dy);
  const t = Math.atan2(dy, dx);
  const edge = coast(t);

  const pond = Math.hypot(x - POND.x, y - POND.y);
  if (pond < POND.r) {
    if (pond < POND.r - 3 && hash(x >> 1, y >> 1, 7) < 0.05) return M.lily;
    return Math.sin(x * 0.45 + y * 0.25) > 0.72 ? M.waterLight : M.water;
  }
  if (pond < POND.r + 3.6) return hash(x, y, 5) < 0.2 ? M.pathDark : M.sand;

  const [su, sf] = local('shrine', x, y);
  if (onStairs(su, sf)) return stone(x, y, 9);
  if (top === GROUND + HILL) return hash(x, y, 6) < 0.18 ? M.paveDark : M.pave; // 境内の玉砂利

  if (top === GROUND) {
    // 広場は輪になった石だたみ
    if (r < PLAZA) {
      if (r > PLAZA - 2.2) return stone(x, y, 4);
      const ring = Math.floor(r / 5.5);
      const joint = mod(r, 5.5) < 1 || mod(t * (ring * 3 + 3) / Math.PI + ring * 0.5, 1) < 0.14;
      return joint ? M.paveDark : M.pave;
    }
    const [lu, lf] = local('lighthouse', x, y);
    if (Math.hypot(lu, lf) < APRON) return hash(x >> 1, y >> 1, 8) < 0.25 ? M.paveDark : M.pave;

    const onPromenade = Math.abs(r - PROMENADE.r) < PROMENADE.half && r < edge - 6;
    const onSpoke = r < PROMENADE.r && SPOKES.some((deg) => {
      const off = Math.atan2(Math.sin(t - rad(deg)), Math.cos(t - rad(deg)));
      return Math.abs(off) * r < SPOKE_HALF;
    });
    const onWalk = WALKS.some((walk) => {
      const [u, f] = local(walk.site, x, y);
      return Math.abs(u - walk.u) <= walk.half && f >= walk.from && f <= walk.to;
    });
    if (onPromenade || onSpoke || onWalk) return hash(x >> 1, y >> 1, 3) < 0.2 ? M.pathDark : M.path;

    // 砂浜。両端へいくほど細くなる
    const off = Math.abs(mod(t - rad(BEACH.deg) + Math.PI, Math.PI * 2) - Math.PI) / rad(BEACH.spread);
    if (off < 1 && edge - r < BEACH.width * Math.cos((off * Math.PI) / 2) + Math.sin(t * 23)) {
      return hash(x, y, 5) < 0.12 ? M.pathDark : M.sand;
    }
  }

  // 草。濃淡と花は 2×2 ドットのかたまりで置く
  const flower = hash(x >> 1, y >> 1, 2);
  if (flower < 0.004) return M.flowerWhite;
  if (flower < 0.007) return M.flowerYellow;
  if (flower < 0.01) return M.flowerPink;
  const patch = hash(x >> 1, y >> 1, 1);
  if (patch < 0.1) return M.grassDark;
  if (patch > 0.93) return M.grassLight;
  return M.grass;
}

export function buildIsland(v) {
  v.beginPart('ground', { base: true });
  const under = GROUND - CRUST - 1; // 島の裏側が始まる高さ
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const r = Math.hypot(x - C, y - C);
      const t = Math.atan2(y - C, x - C);
      const edge = coast(t);
      if (r > edge + 12) continue;
      const top = groundTop(x, y);
      const [su, sf] = local('shrine', x, y);
      const stairs = onStairs(su, sf);

      for (let z = 0; z <= Math.max(top, under); z++) {
        if (z > under) {
          // 草の層とそのすぐ下。草は土より 2ドットせり出す
          if (z > top) break;
          if (z < GROUND && top >= GROUND && r > edge - 2) continue;
          if (z === top) v.put(x, y, z, surface(x, y, top));
          else if (z >= GROUND) v.put(x, y, z, stairs ? stone(x, y, 9) : M.grassDark); // 丘の斜面も草
          else v.put(x, y, z, hash(x >> 1, y >> 1, z) < 0.3 ? M.soilDark : M.soil);
          continue;
        }
        // 島の裏側：下へいくほど細く、ごつごつさせる
        const depth = (under - z) / under; // 0 = 草のすぐ下、1 = 底
        const taper = depth < 0.45 ? 1 - depth * 0.3 : 0.865 * (1 - ((depth - 0.45) / 0.55) ** 1.6 * 0.72);
        const rough = depth * (7 * Math.sin(7 * t + z * 0.4) + 4 * Math.sin(13 * t - z * 0.65));
        if (r > (edge - 2) * taper + rough) continue;
        const n = hash(x >> 1, y >> 1, z >> 1);
        if (z >= 29) v.put(x, y, z, n < 0.3 ? M.soilDark : M.soil);
        else if (z >= 23) v.put(x, y, z, n < 0.4 ? M.soilDark : n < 0.7 ? M.rock : M.soil);
        else v.put(x, y, z, z % 8 === 2 || z % 8 === 3 ? M.rockLight : n < 0.3 ? M.rockDark : M.rock);
      }
    }
  }
}
