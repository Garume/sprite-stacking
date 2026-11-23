// 島まるごとを組み立てて、描画に渡せる形にする。
import { Volume, TILE_BITS } from '../engine/volume.js';
import { paletteTable } from '../engine/palette.js';
import { M } from './materials.js';
import { SIZE, HEIGHT, C, GROUND, rad, buildIsland } from './island.js';
import {
  buildLighthouse, buildBakery, buildSento, buildShrine, buildTownTree, buildNature, buildLamps,
} from './town.js';

const DROP = 64; // 建つとき、輪切りが降りてくる距離（ドット）

// 雲：島といっしょには回らず、画面の左奥・右奥・奥にとどまって少しだけ流れる（手前に来て建物を隠さないように）。
// deg = 画面上の方位（0 = 右、90 = 手前、180 = 左、270 = 奥）、r = 中心からの距離、z = 高さ、drift = 全体で流れる角度。
// どの雲も、いちばん外の建物（灯台、中心から約135ドット）に届かない距離に置き、島の幅からはみ出さない方位にとどめる
const CLOUDS = [
  { deg: 215, r: 172, z: 78, drift: 10, blobs: [[0, 0, 14, 7], [-12, 2, 10, 5.5], [12, -2, 10.5, 5.8]] },
  { deg: 325, r: 172, z: 66, drift: -10, blobs: [[0, 0, 12, 6.5], [10, 2, 9, 5]] },
  { deg: 266, r: 186, z: 44, drift: 8, blobs: [[0, 0, 11, 5.5], [-9, -1, 8, 4.5], [9, 1, 7.5, 4.2]] },
];
const CLOUD_W = 56;
const CLOUD_D = 30;
const CLOUD_H = 16;

function buildCloud(spec, key) {
  const v = new Volume(CLOUD_W, CLOUD_D, CLOUD_H);
  v.beginPart(key);
  for (let z = 0; z < CLOUD_H; z++) {
    for (let y = 0; y < CLOUD_D; y++) {
      for (let x = 0; x < CLOUD_W; x++) {
        const u = x - (CLOUD_W - 1) / 2;
        const f = y - (CLOUD_D - 1) / 2;
        // 底が平らで上が丸い、半分のだんご
        const inside = spec.blobs.some(([bu, bf, br, bh]) => (
          ((u - bu) / br) ** 2 + ((f - bf) / (br * 0.75)) ** 2 + (z / (bh * 2)) ** 2 <= 1));
        if (inside) v.put(x, y, z, M.cloud);
      }
    }
  }
  return v.bake();
}

export function buildScene() {
  const town = new Volume(SIZE, SIZE, HEIGHT);
  buildIsland(town);
  buildNature(town);
  buildLighthouse(town);
  buildBakery(town);
  buildSento(town);
  buildShrine(town);
  buildTownTree(town);
  buildLamps(town);
  const baked = town.bake();

  // objects[0] は動かない島。雲は 1つずつ別の object として位置をずらせる
  const objects = [{ dx: 0, dy: 0, dz: 0 }];
  const parts = baked.parts.map((part) => ({ ...part, object: 0, drop: part.base ? 0 : DROP }));
  const slabs = baked.slabs;

  const clouds = CLOUDS.map((spec, i) => {
    const cloud = buildCloud(spec, `cloud${i}`);
    // half = 雲の長いほうの半分。雲も島と同じ角度で回るので、どの向きにもこれだけ張り出しうる
    const half = Math.max(...spec.blobs.map(([bu, , br]) => Math.abs(bu) + br));
    const object = { dx: 0, dy: 0, dz: spec.z, spec: { ...spec, half } };
    const offset = parts.length;
    objects.push(object);
    for (const part of cloud.parts) parts.push({ ...part, index: part.index + offset, object: objects.length - 1, drop: 0 });
    for (const slab of cloud.slabs) {
      slab.part += offset;
      slabs.push(slab);
    }
    return object;
  });

  // 部品ごとのドット数と、輪切りごとの、島の中心からいちばん遠いマスまでの距離
  for (const part of parts) part.voxels = 0;
  for (const slab of slabs) {
    const part = parts[slab.part];
    slab.reach = 0;
    for (const tile of slab.tiles) {
      for (let b = tile.b0; b <= tile.b1; b++) {
        for (let a = tile.a0; a <= tile.a1; a++) {
          if (!tile.m[(b << TILE_BITS) | a]) continue;
          part.voxels++;
          if (part.object === 0) {
            slab.reach = Math.max(slab.reach, Math.hypot(tile.x0 + a - C, tile.y0 + b - C) + 0.5);
          }
        }
      }
    }
  }

  const island = parts.filter((p) => p.object === 0);
  const count = (list) => ({
    slices: Math.max(...list.map((p) => p.z1)) + 1,
    voxels: list.reduce((sum, p) => sum + p.voxels, 0),
  });
  const scene = {
    slabs, parts, objects, clouds,
    palette: paletteTable(),
    center: { x: C, y: C },
    deck: GROUND, // 地面の高さ。描く位置の基準
    height: HEIGHT,
    /** はじめからある島（地面と木）の枚数とドット数。 */
    land: count(island.filter((p) => p.base)),
    part: (key) => parts.find((p) => p.key === key),
  };
  placeClouds(scene, 0, 0);
  return scene;
}

/** 雲を置く。angle は島の回転（ラジアン）、progress は全体の進み具合（0〜1）。 */
export function placeClouds(scene, angle, progress) {
  for (const cloud of scene.clouds) {
    const { deg, r, drift } = cloud.spec;
    // 画面上の方位から島の回転を引くと、島の上での方位になる
    const at = rad(deg + drift * progress) - angle;
    cloud.dx = C + r * Math.cos(at) - (CLOUD_W - 1) / 2;
    cloud.dy = C + r * Math.sin(at) - (CLOUD_D - 1) / 2;
  }
}

/**
 * 絵が、地面の中心からどこまで広がるか（内部ピクセル）。島はどの角度にもなるものとして測る。
 * top = 中心より上、bottom = 中心より下、side = 中心より左右。
 * @param {number} squash 縦のつぶし率
 * @param {(z: number) => number} [liftOf] 高さ z の輪切りを地面からどれだけ上に描くか。書かなければ組みあがった状態
 * @param {boolean} [landOnly] はじめからある島（地面と木）だけを測る
 */
export function extent(scene, squash, liftOf = (z) => z - scene.deck, landOnly = false) {
  let top = 0;
  let bottom = 0;
  let side = 0;
  for (const slab of scene.slabs) {
    const part = scene.parts[slab.part];
    if (part.object !== 0 || (landOnly && !part.base)) continue;
    // 輪切りのいちばん遠いマスが、画面の奥に回ったときいちばん上に、手前に回ったときいちばん下に来る
    top = Math.max(top, liftOf(slab.z) + 1 + slab.reach * squash);
    bottom = Math.max(bottom, slab.reach * squash - liftOf(slab.z));
    side = Math.max(side, slab.reach);
  }
  if (landOnly) return { top, bottom, side };
  for (const { spec } of scene.clouds) {
    for (const deg of [spec.deg, spec.deg + spec.drift]) {
      const x = Math.abs(spec.r * Math.cos(rad(deg)));
      const back = Math.max(0, -spec.r * Math.sin(rad(deg)));
      top = Math.max(top, spec.z + CLOUD_H - scene.deck + (back + spec.half) * squash);
      side = Math.max(side, spec.half + x);
    }
  }
  return { top, bottom, side };
}
