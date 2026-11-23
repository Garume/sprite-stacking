// 島の上に立つもの。どれも stamp の中で「正面から見て右 u・正面方向 f・高さ k」で形を書く。
// 細い部品は 2ドット以上にする。それより細いと、回したときに消えたり現れたりする。
import { hash } from '../engine/volume.js';
import { M } from './materials.js';
import { C, GROUND, HILL, SITE, polar, rad, groundTop } from './island.js';

const abs = Math.abs;
const mod = (a, n) => ((a % n) + n) % n;

// 建物を置く位置。正面は島の外（海岸）へ向ける
function site(key, z = GROUND + 1) {
  const { deg, r } = SITE[key];
  return { ...polar(deg, r), z, facing: rad(deg) };
}

export function buildLighthouse(v) {
  v.beginPart('lighthouse');
  v.stamp(site('lighthouse'), 18, 0, 75, (u, f, k) => {
    const r = Math.hypot(u, f);
    const a = Math.atan2(f, u);
    if (k < 4) {
      // 石積みの土台。1段おきに目地をずらす
      if (r > 16.8 - k * 0.7) return;
      const course = k >> 1;
      return hash(Math.floor(a * 7 + course * 0.5), course, 11) < 0.35 ? M.stoneDark : M.stone;
    }
    if (k < 54) {
      const R = 12.4 - (k - 4) * 0.085; // 上へいくほど細い
      if (r > R) return;
      if (r > R - 2.4) {
        if (f > 0) {
          const arch = 12 + Math.sqrt(Math.max(0, 10.24 - u * u)) * 0.8; // 扉の上は丸い
          if (abs(u) < 3.2 && k < arch) return M.door;
          if (abs(u) < 4.6 && k < arch + 1.6) return M.stone;
        }
        // 窓。正面に2つ、裏に1つ
        const row = f > 0 ? (k >= 26 && k < 30) || (k >= 44 && k < 48) : k >= 34 && k < 38;
        if (row && abs(u) < 2.2) return M.window;
        const sill = f > 0 ? k === 25 || k === 43 : k === 33;
        if (sill && abs(u) < 3.2) return M.stone;
      }
      return Math.floor((k - 4) / 10) % 2 ? M.white : M.red; // 10枚ごとの赤白が5本
    }
    if (k < 56) return r <= 14 ? (k === 55 && r <= 12.6 ? M.stoneDark : M.iron) : undefined; // 回廊の床
    if (k < 66) {
      // 手すり。柱が12本と、上の横木
      if (k < 60 && r > 12.6 && r <= 14) return k === 59 || abs(Math.sin(a * 6)) > 0.85 ? M.iron : undefined;
      if (r > 7.2) return;
      if (k < 58) return M.white;
      if (r < 2.6) return M.lamp;
      return r > 5.4 && (k === 65 || abs(Math.sin(a * 4)) > 0.8) ? M.iron : M.glass; // 灯室
    }
    if (k < 74) return r <= 9.6 - (k - 66) * 1.15 ? M.navy : undefined; // 屋根
    return r <= 1.3 ? M.iron : undefined;
  });
}

export function buildBakery(v) {
  v.beginPart('bakery');
  const stripe = (u) => (mod(Math.floor((u + 18) / 6), 2) ? M.awningWhite : M.awningRed);
  v.stamp(site('bakery'), 30, 0, 37, (u, f, k) => {
    const au = abs(u);
    const af = abs(f);
    if (abs(u - 11) <= 3 && abs(f + 6) <= 3 && k >= 18) {
      // 煙突。れんがの目地は4枚ごと
      if (k >= 36) return M.black;
      if (k >= 34) return M.stone;
      return k % 4 === 3 ? M.brickDark : M.brick;
    }

    if (k <= 17) {
      // 店先のひさし。外側が1段低い
      if ((k === 14 || k === 15) && f > 14 && f <= 19 && au <= 18) return stripe(u);
      if ((k === 12 || k === 13) && f > 18 && f <= 22 && au <= 18) return stripe(u);
      if (au > 20 || af > 14) return;
      if (au <= 17.5 && af <= 11.5) return k <= 1 ? M.timber : M.woodDark; // 中
      if (k <= 1) return M.stone;
      if (f > 11.5) {
        // ひさしの下に見えるのは下から11枚ぶん。扉と陳列窓はその中に収める
        if (abs(u + 11) <= 3.2 && k <= 10) return k >= 6 && abs(u + 11) <= 2 ? M.window : M.door;
        if (abs(u + 11) <= 4.4 && k <= 11) return M.timber;
        if (u >= -3 && u <= 15.6 && k >= 3 && k <= 10) {
          return k === 3 || k === 10 || mod(u + 3, 6.2) < 1.2 ? M.timber : M.window;
        }
      }
      if (au > 17.5 && af <= 6 && k >= 6 && k <= 11) return af < 1.1 || k === 6 || k === 11 ? M.timber : M.window;
      if (f < -11.5 && au <= 4.5 && k >= 6 && k <= 11) return au < 1.1 ? M.timber : M.window;
      if ((au > 18.4 && af > 12.4) || k >= 16) return M.timber; // 角の柱と、軒の下の梁
      return M.cream;
    }

    // 切妻屋根。棟は u 方向
    const layer = k - 18;
    const half = Math.max(2.2, 17.2 - layer * 1.35); // 棟は細くても 4ドット
    if (layer > 13 || au > 22.8 || af > half) return;
    const covered = af <= 17.2 - (layer + 1) * 1.35 - 3 && au <= 20.4; // 屋根の板の下
    if (covered) {
      if (au <= 17) return M.woodDark; // 屋根裏
      return au > 19 && af < 2.2 && layer >= 3 && layer <= 6 ? M.window : M.cream; // 妻壁と、その小窓
    }
    return layer >= 12 || (layer >> 1) % 2 ? M.tealLight : M.teal;
  });
}

export function buildSento(v) {
  v.beginPart('sento');
  v.stamp(site('sento'), 40, 0, 69, (u, f, k) => {
    const au = abs(u);
    const af = abs(f);

    // 煙突。太さ 10ドットの丸い筒が屋根を抜ける
    if (Math.hypot(u - 18, f + 10) <= 5) {
      if (k >= 68) return M.black;
      if (k >= 56 && k <= 61) return M.white;
      return k % 6 === 5 ? M.brickDark : M.brick;
    }
    if (k > 31) return;

    if (k <= 19) {
      // 入口の小屋根と、それを支える柱
      if ((k === 15 || k === 16) && f > 18 && f <= 24 && au <= 9.5) return M.slate;
      if (k <= 14 && f > 21.5 && f <= 23.5 && abs(au - 7.5) <= 1) return M.timber;
      if (au > 26 || af > 18) return;
      if (au <= 23 && af <= 15) return k <= 1 ? M.stone : M.woodDark; // 中
      if (f > 15) {
        if (au <= 6 && k <= 13) {
          if (k < 8) return M.black; // 入口
          return (k === 10 || k === 11) && abs(mod(u + 6, 4) - 2) < 1 ? M.white : M.indigo; // のれん
        }
        if (au >= 11 && au <= 21 && k >= 9 && k <= 14) {
          return au < 12 || au > 20 || abs(au - 16) < 1 || k === 9 || k === 14 ? M.timber : M.window;
        }
      }
      if (au > 23 && af <= 9 && k >= 11 && k <= 14) return M.window;
      if (k <= 7) return M.woodDark; // 腰板
      return k >= 18 ? M.timber : M.plaster;
    }

    // 寄棟の瓦屋根
    const layer = k - 20;
    const halfU = 29.2 - layer * 1.5;
    const halfF = Math.max(3.2, 21.2 - layer * 1.8);
    if (layer > 11 || au > halfU || af > halfF) return;
    if (layer < 11 && au <= halfU - 4.5 && af <= Math.max(3.2, 21.2 - (layer + 1) * 1.8) - 3) return M.woodDark; // 屋根裏
    return layer >= 10 || (layer >> 1) % 2 ? M.slateLight : M.slate;
  });
}

export function buildShrine(v) {
  v.beginPart('shrine');
  v.stamp(site('shrine', GROUND + HILL + 1), 32, 0, 31, (u, f, k, wx, wy) => {
    const au = abs(u);

    // 鳥居。柱の太さは 4ドット
    if (f >= 14 && f < 18) {
      if (abs(au - 12) <= 2 && k <= 21) return k <= 1 ? M.black : M.vermilion;
      if ((k === 16 || k === 17) && au <= 15) return M.vermilion;
      if (k >= 18 && k <= 21 && au <= 1.6) return M.timber; // 額
      if ((k === 22 || k === 23) && au <= 18) return M.vermilion;
      if ((k === 24 || k === 25) && au <= 19.6) return M.black;
    }

    // 石灯籠が左右に1基ずつ
    const lantern = Math.max(abs(au - 8), abs(f - 8));
    if (lantern <= 2.2 && k <= 1) return M.stoneDark;
    if (lantern <= 1.2 && k <= 5) return M.stone;
    if (lantern <= 2.2 && (k === 6 || k === 7)) return M.lamp;
    if (lantern <= 3.2 && (k === 8 || k === 9)) return M.stoneDark;
    if (lantern <= 1.2 && k === 10) return M.stoneDark;

    // 基壇と、正面の2段
    if (k <= 3) {
      if (f > 3 && f <= 5.5 + (k <= 1 ? 2.5 : 0) && au <= 6) return M.stone;
      if (au > 15 || f < -21 || f > 3) return;
      return hash(wx >> 1, wy >> 1, k >> 1) < 0.3 ? M.stoneDark : M.stone;
    }

    // 賽銭箱
    if (k <= 6 && au <= 3.2 && f >= 0 && f <= 2.6) return k === 6 ? M.woodDark : M.timber;

    // 社殿の壁。柱は 6ドットおき
    if (k <= 15) {
      if (au > 11 || f < -19 || f > -1) return;
      if (au <= 8.5 && f >= -16.5 && f <= -3.5) return M.woodDark; // 中
      if (f > -3.5 && au <= 3.2 && k <= 11) return M.door;
      if (k <= 5 || k >= 14) return M.shrineWood;
      const post = au > 8.5 ? mod(Math.round(f), 6) < 2 : mod(Math.round(u) + 1, 6) < 2;
      return post ? M.shrineWood : M.white;
    }

    // 棟木と、その両端の千木
    if (k >= 27) {
      const fromRidge = abs(f + 12.6);
      if (k <= 28 && au <= 16.4 && fromRidge <= 2.2) return M.black;
      if (au >= 13 && au <= 15.2 && abs(fromRidge - (k - 27) * 1.1) <= 1.1) return M.black;
      return;
    }

    // 流造の屋根。正面側だけ長くのびる
    const layer = k - 16;
    const back = -22 + layer * 0.9;
    const front = 5.2 - layer * 1.7;
    if (au > 15.2 || f < back || f > front) return;
    const covered = f >= back + 0.9 + 3 && f <= front - 1.7 - 3;
    if (covered) return au > 12.4 ? M.shrineWood : M.woodDark; // 妻壁は木の色、その内側は屋根裏
    return (layer >> 1) % 2 ? M.copperLight : M.copper;
  });
}

export function buildTownTree(v) {
  v.beginPart('tree');
  // 葉のかたまり：[u, f, 高さ, 半径, 厚み]
  const crowns = [
    [0, 0, 36, 22, 13], [-12, 10, 28, 15, 9], [12, -8, 30, 16, 10],
    [6, 12, 40, 12, 8], [-11, -12, 34, 11, 7], [15, 7, 25, 9, 6],
  ];
  v.stamp({ x: C, y: C, z: GROUND + 1, facing: rad(120) }, 34, 0, 51, (u, f, k, wx, wy) => {
    // ベンチ。座面と背もたれ、鉄の脚
    if (abs(u + 16) <= 5.4 && abs(f - 14) <= 2.4) {
      if (k === 4 || k === 5) return M.bench;
      if (k >= 6 && k <= 9 && f < 12.8) return M.bench;
      if (k < 4 && abs(abs(u + 16) - 4) < 1.1) return M.iron;
    }

    // 幹。根もとが広がり、上へいくほど少し細い
    const r = Math.hypot(u, f);
    if (k <= 27) {
      const root = k < 4 ? (4 - k) * (0.5 + 0.5 * Math.max(0, Math.cos(Math.atan2(f, u) * 5))) : 0;
      if (r <= 5.2 - k * 0.03 + root) return hash(wx >> 1, wy >> 1, k >> 2) < 0.25 ? M.trunkDark : M.trunk;
    }

    const inCrown = crowns.some(([cu, cf, ck, cr, ch]) => (
      ((u - cu) / cr) ** 2 + ((f - cf) / cr) ** 2 + ((k - ck) / ch) ** 2 <= 1));
    if (!inCrown) return;
    if (hash(wx >> 1, wy >> 1, k >> 1) < 0.03) return M.fruit; // みかん
    const clump = Math.sin(u * 0.45 + k * 0.5) + Math.sin(f * 0.4 - k * 0.35);
    return clump > 0.9 ? M.leafLight : clump < -1 ? M.leafDark : M.leaf;
  });
}

// ---- 小さなもの ----

// 置く位置。丘の上でも地面に乗るよう、その場所の高さを調べる
function onGround(deg, r) {
  const at = polar(deg, r);
  return { ...at, z: groundTop(Math.round(at.x), Math.round(at.y)) + 1 };
}

function pine(v, deg, r) {
  v.stamp(onGround(deg, r), 12, 0, 29, (u, f, k, wx, wy) => {
    const d = Math.hypot(u, f);
    if (k <= 5) return d <= 2.4 ? M.trunkDark : undefined;
    const tier = k - 6;
    const R = 9 - tier * 0.36 + 2 * (1 - (tier % 6) / 5); // 6枚ごとに段をつける
    if (d > R) return;
    return hash(wx >> 1, wy >> 1, k) < 0.3 ? M.pineLight : M.pine;
  });
}

function roundTree(v, deg, r) {
  v.stamp(onGround(deg, r), 11, 0, 25, (u, f, k, wx, wy) => {
    const d = Math.hypot(u, f);
    if (k <= 8) return d <= 2.4 ? M.trunk : undefined;
    if ((d / 9.6) ** 2 + ((k - 16.5) / 8.6) ** 2 > 1) return;
    return hash(wx >> 1, wy >> 1, k >> 1) < 0.25 ? M.roundLight : M.round;
  });
}

function bush(v, deg, r, size = 6.4) {
  v.stamp(onGround(deg, r), size + 1, 0, 6, (u, f, k, wx, wy) => {
    if ((Math.hypot(u, f) / size) ** 2 + ((k - 1) / (size * 0.82)) ** 2 > 1) return;
    return hash(wx >> 1, wy >> 1, k >> 1) < 0.3 ? M.leafLight : M.leaf;
  });
}

function boulder(v, deg, r, size) {
  v.stamp(onGround(deg, r), size + 1, 0, Math.ceil(size), (u, f, k, wx, wy) => {
    if ((u / size) ** 2 + (f / (size * 0.8)) ** 2 + (k / (size * 0.9)) ** 2 > 1) return;
    return hash(wx >> 1, wy >> 1, k >> 1) < 0.35 ? M.stoneDark : M.stone;
  });
}

function streetLamp(v, deg, r) {
  v.stamp(onGround(deg, r), 5, 0, 21, (u, f, k) => {
    const d = Math.hypot(u, f);
    if (k <= 1) return d <= 2.6 ? M.iron : undefined;
    if (k <= 15) return d <= 1.5 ? M.iron : undefined;
    if (k <= 19) return d <= 3 ? M.lamp : undefined;
    return d <= (k === 20 ? 4.2 : 2.2) ? M.iron : undefined;
  });
}

/** 木・やぶ・岩。はじめから島にある。 */
export function buildNature(v) {
  v.beginPart('nature', { base: true });
  [[72, 96], [60, 101], [85, 92], [338, 98], [354, 90], [150, 96], [176, 132], [165, 127], [236, 141], [268, 122]]
    .forEach(([deg, r]) => pine(v, deg, r));
  [[5, 52], [84, 58], [182, 70], [196, 90], [228, 52], [268, 96], [140, 124], [20, 122]]
    .forEach(([deg, r]) => roundTree(v, deg, r));
  [[150, 123], [185, 58], [10, 121], [100, 122], [226, 40], [45, 122], [322, 120], [202, 142], [130, 38],
    [22, 39], [250, 37], [312, 38], [75, 70], [252, 148], [186, 100]]
    .forEach(([deg, r], i) => bush(v, deg, r, i % 3 ? 6.4 : 4.8));
  [[231, 152, 5.4], [223, 147, 3.4], [199, 76, 4], [58, 121, 3.2], [305, 120, 3.6], [112, 128, 3], [163, 142, 4.4]]
    .forEach(([deg, r, size]) => boulder(v, deg, r, size));
}

/** 街灯。町ができあがるときに立つ。 */
export function buildLamps(v) {
  v.beginPart('lamps');
  [[140, 35], [320, 35], [196, 104.5], [42, 104.5], [130, 104.5], [290, 104.5]]
    .forEach(([deg, r]) => streetLamp(v, deg, r));
}
