// ボクセルの入れもの。ここに形を置き、bake() で「輪切りの絵」に切り分ける。
// 座標は x = 右、y = 手前、z = 上。素材番号 0 は空き。

/** 位置から決まる 0〜1 の乱数。模様を毎回同じにするために使う。 */
export function hash(x, y = 0, z = 0) {
  let n = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + Math.floor(z) * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** 輪切りの絵は、一辺 2^TILE_BITS マスのタイルに分けて持つ。 */
export const TILE_BITS = 5;
const TILE = 1 << TILE_BITS;
const TILE_MASK = TILE - 1;

const NORMAL_REACH = 2; // 面の向きを調べる範囲（マス）
const AO_REACH = 2; // すぐ隣に立つものが落とす影を調べる範囲（横）
const AO_HEIGHT = 5; // 同じく高さ
const AO_SOME = 20; // 範囲にこれだけマスがあれば 1段、
const AO_MUCH = 70; // これだけあれば 2段暗くする
const COVER_FROM = 8; // 頭上の枝や軒が落とす影を調べる範囲
const COVER_TO = 32;
// 「この四角はすべて詰まっているか」をすぐ答えられるよう、輪切りごとに 2×2 マスのブロック単位の表を持つ
const BLOCK_BITS = 1;
const BLOCK = 1 << BLOCK_BITS;
const BLOCKS_PER_TILE = TILE >> BLOCK_BITS;
// ぴったり重なった輪切りは、ふちの数マスしか見えない。見下ろす角度のぶん、真上よりこれだけ広く
// 上の1枚が詰まっているマスは、どの向きから見ても隠れる（縦のつぶし率 0.45 まで）
const HIDDEN_REACH = 3;
/** ao の印：すぐ上の輪切りがぴったり重なると、どの向きから見ても隠れるマス。 */
export const HIDDEN = 16;
const HALF = TILE >> 1;

/**
 * 輪切り slab の、マス (x0, y0)〜(x1, y1) の四角がすべて詰まっているか。
 * ブロック単位で見るので、詰まっていても「いいえ」と答えることはあるが、その逆はない。
 */
export function solidRect(slab, x0, y0, x1, y1) {
  const bx0 = (x0 >> BLOCK_BITS) - slab.bx0;
  const by0 = (y0 >> BLOCK_BITS) - slab.by0;
  const bx1 = (x1 >> BLOCK_BITS) - slab.bx0;
  const by1 = (y1 >> BLOCK_BITS) - slab.by0;
  if (bx0 < 0 || by0 < 0 || bx1 >= slab.bw || by1 >= slab.bh) return false;
  // sums は、左上からそこまでの「詰まったブロックの数」
  const { sums } = slab;
  const stride = slab.bw + 1;
  const count = sums[(by1 + 1) * stride + bx1 + 1] - sums[by0 * stride + bx1 + 1]
    - sums[(by1 + 1) * stride + bx0] + sums[by0 * stride + bx0];
  return count === (bx1 - bx0 + 1) * (by1 - by0 + 1);
}

export class Volume {
  constructor(w, d, h) {
    this.w = w;
    this.d = d;
    this.h = h;
    this.mat = new Uint8Array(w * d * h);
    this.owner = new Uint8Array(w * d * h);
    this.parts = [];
    this.current = 0;
  }

  /**
   * ここから先に置くマスは、この部品のものになる。
   * base = いつでも出ている部品（地面など）。あとから建つ部品の影は、建ってから落とす。
   */
  beginPart(key, { base = false } = {}) {
    let index = this.parts.findIndex((p) => p.key === key);
    if (index < 0) index = this.parts.push({ key, base }) - 1;
    this.current = index;
    return this;
  }

  /** m = 0 を渡すと削る。 */
  put(x, y, z, m) {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.d || z >= this.h) return;
    const i = (z * this.d + y) * this.w + x;
    this.mat[i] = m;
    this.owner[i] = this.current;
  }

  /**
   * 向きを持った形を置く。
   * fn(u, f, k) の u は正面から見て右、f は正面方向、k は足もとからの高さ。
   * facing は正面が向く方位（ラジアン、+x が 0、+y が 90度）。
   */
  stamp({ x, y, z, facing = Math.PI / 2 }, reach, k0, k1, fn) {
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    for (let k = k0; k <= k1; k++) {
      for (let wy = Math.floor(y - reach); wy <= Math.ceil(y + reach); wy++) {
        for (let wx = Math.floor(x - reach); wx <= Math.ceil(x + reach); wx++) {
          const dx = wx - x;
          const dy = wy - y;
          const m = fn(dx * sin - dy * cos, dx * cos + dy * sin, k, wx, wy);
          if (m !== undefined) this.put(wx, wy, z + k, m);
        }
      }
    }
    return this;
  }

  /**
   * 輪切りの絵に切り分ける。1枚（slab）= ある部品の、ある高さのマスの集まり。
   * 1枚は一辺 32マスのタイルに分けて持つ。上の輪切りに隠れる部分を、描くときに飛ばせるように。
   * 各マスには素材のほかに「面の向き」と「近くの物が落とす影」を持たせて、
   * 描くときに光の方向を変えられるようにする。
   */
  bake() {
    const { w, d, h, mat, owner } = this;
    const parts = this.parts.map((p, index) => ({ ...p, index, z0: h, z1: -1 }));
    this.isBase = Uint8Array.from(parts, (p) => (p.base ? 1 : 0));

    // 1. マスを、部品・高さ・タイルごとに振り分ける
    const byKey = new Map();
    for (let z = 0, i = 0; z < h; z++) {
      for (let y = 0; y < d; y++) {
        for (let x = 0; x < w; x++, i++) {
          if (!mat[i]) continue;
          const part = parts[owner[i]];
          if (z < part.z0) part.z0 = z;
          if (z > part.z1) part.z1 = z;

          const key = owner[i] * 256 + z;
          let slab = byKey.get(key);
          if (!slab) byKey.set(key, (slab = { part: owner[i], z, cells: new Map(), tiles: [], above: null }));
          const tx = x >> TILE_BITS;
          const ty = y >> TILE_BITS;
          let tile = slab.cells.get(ty * 4096 + tx);
          if (!tile) {
            tile = {
              tx, ty, x0: tx << TILE_BITS, y0: ty << TILE_BITS,
              a0: TILE, a1: -1, b0: TILE, b1: -1, // マスのある範囲（タイルの中の位置）
              m: new Uint8Array(TILE * TILE),
              n: new Int8Array(TILE * TILE * 3),
              // 下位2ビット = いつもの影、次の2ビット = cast の部品が建っているときの影、HIDDEN = 重なると隠れる
              ao: new Uint8Array(TILE * TILE),
              cast: new Uint8Array(TILE * TILE), // その影を落とす部品の番号 + 1
            };
            slab.cells.set(ty * 4096 + tx, tile);
            slab.tiles.push(tile);
          }
          const a = x & TILE_MASK;
          const b = y & TILE_MASK;
          if (a < tile.a0) tile.a0 = a;
          if (a > tile.a1) tile.a1 = a;
          if (b < tile.b0) tile.b0 = b;
          if (b > tile.b1) tile.b1 = b;
          const o = (b << TILE_BITS) | a;
          tile.m[o] = mat[i];
          this.#shade(x, y, z, tile, o, owner[i]);
        }
      }
    }

    // 2. すぐ上の輪切り（同じ部品）とつなぎ、「詰まったブロック」の表を作る
    const slabs = [...byKey.values()];
    for (const slab of slabs) {
      slab.above = byKey.get(slab.part * 256 + slab.z + 1) ?? null;
      sumBlocks(slab);
      delete slab.cells;
    }

    // 3. 重なると隠れるマスに印をつけ、タイルを 4つに割って、それぞれのマスのある範囲を調べておく
    for (const slab of slabs) {
      for (const tile of slab.tiles) tile.quarters = quarterBounds(tile, slab.above);
    }

    for (const part of parts) part.slices = part.z1 - part.z0 + 1;
    return { slabs, parts };
  }

  // そのマスにあるものが、部品 self から見て「いつもそこにある」か（自分自身か、いつでも出ている部品）
  #solid(x, y, z, self) {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.d || z >= this.h) return false;
    const i = (z * this.d + y) * this.w + x;
    if (!this.mat[i]) return false;
    const o = this.owner[i];
    return o === self || this.isBase[o] === 1;
  }

  #shade(x, y, z, tile, o, self) {
    const open = !this.#solid(x, y, z + 1, self);
    const exposed = open || !this.#solid(x - 1, y, z, self) || !this.#solid(x + 1, y, z, self)
      || !this.#solid(x, y - 1, z, self) || !this.#solid(x, y + 1, z, self);

    // 面の向き：まわりの詰まっているマスの反対側を向く。埋もれたマスは真上向き
    let nx = 0;
    let ny = 0;
    let nz = 1;
    if (exposed) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let dz = -NORMAL_REACH; dz <= NORMAL_REACH; dz++) {
        for (let dy = -NORMAL_REACH; dy <= NORMAL_REACH; dy++) {
          for (let dx = -NORMAL_REACH; dx <= NORMAL_REACH; dx++) {
            if (!this.#solid(x + dx, y + dy, z + dz, self)) continue;
            sx -= dx; sy -= dy; sz -= dz;
          }
        }
      }
      const len = Math.hypot(sx, sy, sz);
      if (len > 0.5) { nx = sx / len; ny = sy / len; nz = sz / len; }
    }
    tile.n[o * 3] = Math.round(nx * 127);
    tile.n[o * 3 + 1] = Math.round(ny * 127);
    tile.n[o * 3 + 2] = Math.round(nz * 127);

    // 影：上が開いたマスだけ。壁ぎわと、枝や軒の下を1〜2段暗くする。
    // own = いつもそこにある物の影、all = あとから建つ部品もふくめた影。差は、その部品が建ってから足す
    if (!open) return;
    const { w, d, h, mat, owner, isBase } = this;
    let own = 0;
    let all = 0;
    let caster = 0;
    for (let dz = 1; dz <= AO_HEIGHT; dz++) {
      const zz = z + dz;
      if (zz >= h) break;
      for (let dy = -AO_REACH; dy <= AO_REACH; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= d) continue;
        for (let dx = -AO_REACH; dx <= AO_REACH; dx++) {
          const xx = x + dx;
          if ((!dx && !dy) || xx < 0 || xx >= w) continue;
          const i = (zz * d + yy) * w + xx;
          if (!mat[i]) continue;
          all++;
          if (owner[i] === self || isBase[owner[i]]) own++;
          else if (!caster) caster = owner[i] + 1;
        }
      }
    }
    let aoOwn = own >= AO_MUCH ? 2 : own >= AO_SOME ? 1 : 0;
    let aoAll = all >= AO_MUCH ? 2 : all >= AO_SOME ? 1 : 0;
    if (!aoOwn) {
      for (let dz = COVER_FROM; dz <= COVER_TO && z + dz < h; dz++) {
        const i = ((z + dz) * d + y) * w + x;
        if (!mat[i]) continue;
        if (!aoAll) aoAll = 1;
        if (owner[i] === self || isBase[owner[i]]) { aoOwn = 1; break; }
        if (!caster) caster = owner[i] + 1;
      }
    }
    tile.ao[o] = aoOwn | ((aoAll - aoOwn) << 2);
    tile.cast[o] = aoAll > aoOwn ? caster : 0;
  }
}

/**
 * タイルを 4つに割った、それぞれの描く範囲。1つにつき 8個の数：
 * [a0, a1, b0, b1] = マスのある範囲、[a0, a1, b0, b1] = そのうち、上の1枚 above がぴったり重なっても見えうる範囲。
 * 何もなければ a0 > a1。
 */
function quarterBounds(tile, above) {
  const bounds = new Int8Array(32);
  for (let q = 0; q < 4; q++) {
    const left = q & 1 ? HALF : 0;
    const top = q & 2 ? HALF : 0;
    const all = [TILE, -1, TILE, -1];
    const rim = [TILE, -1, TILE, -1];
    for (let b = top; b < top + HALF; b++) {
      for (let a = left; a < left + HALF; a++) {
        if (!tile.m[(b << TILE_BITS) | a]) continue;
        grow(all, a, b);
        const x = tile.x0 + a;
        const y = tile.y0 + b;
        const hidden = above !== null
          && solidRect(above, x - HIDDEN_REACH, y - HIDDEN_REACH, x + HIDDEN_REACH, y + HIDDEN_REACH);
        if (hidden) tile.ao[(b << TILE_BITS) | a] |= HIDDEN;
        else grow(rim, a, b);
      }
    }
    bounds.set(all, q * 8);
    bounds.set(rim, q * 8 + 4);
  }
  return bounds;
}

function grow(box, a, b) {
  if (a < box[0]) box[0] = a;
  if (a > box[1]) box[1] = a;
  if (b < box[2]) box[2] = b;
  if (b > box[3]) box[3] = b;
}

// 輪切り slab に、solidRect() が使う表（sums）を持たせる
function sumBlocks(slab) {
  let tx0 = Infinity; let tx1 = -1; let ty0 = Infinity; let ty1 = -1;
  for (const tile of slab.tiles) {
    tx0 = Math.min(tx0, tile.tx); tx1 = Math.max(tx1, tile.tx);
    ty0 = Math.min(ty0, tile.ty); ty1 = Math.max(ty1, tile.ty);
  }
  const bw = (tx1 - tx0 + 1) * BLOCKS_PER_TILE;
  const bh = (ty1 - ty0 + 1) * BLOCKS_PER_TILE;
  const stride = bw + 1;
  const sums = new Uint16Array(stride * (bh + 1));
  for (const tile of slab.tiles) {
    const left = (tile.tx - tx0) * BLOCKS_PER_TILE;
    const top = (tile.ty - ty0) * BLOCKS_PER_TILE;
    for (let by = 0; by < BLOCKS_PER_TILE; by++) {
      for (let bx = 0; bx < BLOCKS_PER_TILE; bx++) {
        let full = 1;
        for (let j = 0; j < BLOCK && full; j++) {
          for (let i = 0; i < BLOCK; i++) {
            if (!tile.m[(((by << BLOCK_BITS) + j) << TILE_BITS) | ((bx << BLOCK_BITS) + i)]) { full = 0; break; }
          }
        }
        sums[(top + by + 1) * stride + left + bx + 1] = full; // ひとまず、そのブロックが詰まっているかだけ
      }
    }
  }
  // 行ごと、列ごとに足しこんで「左上からそこまでの数」にする
  for (let y = 1; y <= bh; y++) {
    for (let x = 1; x <= bw; x++) {
      sums[y * stride + x] += sums[y * stride + x - 1] + sums[(y - 1) * stride + x] - sums[(y - 1) * stride + x - 1];
    }
  }
  Object.assign(slab, {
    bx0: tx0 * BLOCKS_PER_TILE, by0: ty0 * BLOCKS_PER_TILE, bw, bh, sums,
  });
}
