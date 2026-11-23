// スプライトスタッキングの描画。
// 輪切りの絵を、同じ角度だけ回し、縦につぶし、高さぶん上へずらして重ねる。
// Canvas の drawImage は使わず、ドット単位の画面（内部バッファ）へ自前で描く。
// そうすると 1ドットごとに光の向きを計算でき、回しても影の向きが変わらない。
//
// 高い輪切りから順に描き、すでに埋まったドットは飛ばす。
// 低い順に塗り重ねるのと結果は同じで、隠れるドットの色を計算せずに済む。
// さらに、上の輪切りに隠れると前もって分かる部分は、はじめから描かない。
import { TILE_BITS, HIDDEN, solidRect } from './volume.js';

const LIGHT = normalize([-0.45, 0.35, 0.82]); // 左手前の上から。x = 右、y = 手前、z = 上
const TONE_STEPS = [0.7, 0.25, -0.15]; // これ以上なら明るさ 3 / 2 / 1、未満は 0

const INK = 0xff30251b; // 輪郭の色 #1b2530（ImageData の並びで A, B, G, R）

const EDGE_STEP = 2.5; // 別の部品なら、これだけ高ければ境目として濃くする
const EDGE_CLIFF = 7; // 同じ部品でも、これだけ高ければ境目
const DIM_WITHIN = 0.6; // すき間に対する割合
const DARK_WITHIN = 0.4;
const GAP_DARK = 0.45; // 離れた輪切りの、上の1枚の奥にもぐった部分を輪郭の色へ寄せる量
const HIDDEN_PALE = [0.72, 0.5]; // 「描く範囲」の表示で、重なると隠れるマスを背景の色へ寄せる量（縞の2色）
const UNPAINTED = 0.78; // 「描く順番」の表示で、まだ描いていない輪切りを背景の色へ寄せる量
const CELL_BITS = 3; // 「埋まったか」を数える、画面のます目の一辺（2^3 = 8ドット）
const CELL = 1 << CELL_BITS;
const FLYING = 128; // id の印：置き場所へ向かっている途中の輪切り。ふちどりはしない

const FLIGHT = 8; // 建つ途中、同時に宙にある輪切りの枚数
const SOLID_AT = 0.3; // 降りてくる輪切りは、道のりのこの割合までに点々から全部見えるようになる

// 4×4 の並び。値が fade 未満のマスだけ描くと、16段階で点々に見え隠れする
const DITHER = Uint8Array.of(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

export class Renderer {
  /**
   * @param {object} scene
   * @param {object[]} scene.slabs   輪切りの絵。高さ z、部品 part、タイル tiles、すぐ上の1枚 above
   * @param {object[]} scene.parts   部品。object（動かす単位）、z0、slices、drop（降りてくる距離）
   * @param {object[]} scene.objects 動かす単位ごとのずらし量。0番は島
   * @param {{x:number,y:number}} scene.center 回転の軸
   */
  constructor(canvas, scene, width, height) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    this.ctx = canvas.getContext('2d');
    this.image = this.ctx.createImageData(width, height);
    this.color = new Uint32Array(this.image.data.buffer);
    this.id = new Uint8Array(width * height); // 部品番号 + 1。0 は何もない
    this.depth = new Float32Array(width * height); // そのドットの高さ
    // 画面を 8×8 ドットのます目に分け、それぞれ何ドット描いたかを数える。埋まったます目に入る絵は描かずに済む
    this.cellsWide = Math.ceil(width / CELL);
    this.cells = new Uint8Array(this.cellsWide * Math.ceil(height / CELL));
    const count = scene.slabs.length;
    scene.slabs.forEach((slab, index) => { slab.index = index; });
    this.up = new Float32Array(count); // 1枚ごとの、基準からの高さ
    this.fade = new Uint8Array(count); // 0 = 出さない、1〜15 = 点々で一部だけ、16 = 全部
    this.landed = new Uint8Array(count); // 置き場所に着いているか
    this.cast = new Uint8Array(scene.parts.length + 1); // その部品（番号 + 1）が影を落としはじめたか
    this.order = [];
    this.seq = new Uint16Array(width * height); // そのドットを、高いほうから何番めの輪切りが描いたか（1〜）
    this.counts = new Uint32Array(count); // 何番めの輪切りが、何ドット描いたか
    /** 直前の1コマ：画面に描いた輪切りの高さの数、paintUpTo が指すのはそのうち上から何枚目か、その1枚が描いたドット数。 */
    this.drawn = { levels: 0, upTo: 0, dots: 0 };
  }

  /**
   * @param {object} view
   * @param {number} view.angle   島の回転（ラジアン）
   * @param {number} view.squash  見下ろす角度（縦のつぶし率）。小さいほど横から見る
   * @param {number} view.pivotX  島の地面の中心を置く位置（内部ピクセル）
   * @param {number} view.pivotY
   * @param {Float32Array} view.lift   島の高さ z の輪切りを、地面からどれだけ上に描くか
   * @param {Float32Array} view.reveal 部品ごとの建ち具合。0 = まだない、1 = 建っている
   * @param {number} view.clipTop      描く行の範囲（内部ピクセル）。画面に見えているところだけ
   * @param {number} view.clipBottom
   * @param {{x:number,y:number,rx:number,ry:number,color:number}} [view.floor] 床に落ちる影
   * @param {number} view.paper          背景の色。下の3つの表示で、うすく見せるときに寄せる先
   * @param {boolean} [view.markHidden]  「描く範囲」：重なると隠れるマスを、うすい縞で見せる
   * @param {number} [view.paintUpTo]    「描く順番」：画面に描く輪切りのうち、高いほうからこの割合（0〜1）までを描いたことにして、残りはうすく見せる
   * @param {boolean} [view.orderTint]   「描く順番」の動かない版：あとに描く輪切りほどうすく見せる
   */
  render(view) {
    const { scene, color, id, up, fade, landed, cast, order } = this;
    const { slabs, parts, objects } = scene;
    const { lift, reveal, squash } = view;

    color.fill(0);
    id.fill(0);
    this.cells.fill(0);
    this.clip0 = Math.max(0, Math.floor(view.clipTop));
    this.clip1 = Math.min(this.height - 1, Math.ceil(view.clipBottom));
    this.squash = squash;
    this.markHidden = view.markHidden === true;
    this.paper = view.paper;
    this.pivotX = view.pivotX;
    this.cos = Math.cos(view.angle);
    this.sin = Math.sin(view.angle);
    // 光を、回す前の絵の向きに直しておく
    this.lx = (this.cos * LIGHT[0] + this.sin * LIGHT[1]) / 127;
    this.ly = (-this.sin * LIGHT[0] + this.cos * LIGHT[1]) / 127;
    this.lz = LIGHT[2] / 127;

    // 1. 1枚ごとの高さと見えかたを決める。建つ途中の部品は、下の輪切りから順に降りてくる
    for (let p = 0; p < parts.length; p++) {
      cast[p + 1] = reveal[p] * (parts[p].slices + FLIGHT) >= FLIGHT ? 1 : 0; // いちばん下の1枚が着いたら
    }
    order.length = 0;
    for (let i = 0; i < slabs.length; i++) {
      const slab = slabs[i];
      const part = parts[slab.part];
      // 雲は、その高さにある島の輪切りといっしょに上下する（輪切りが離れると、雲も画面の上へ出ていく）
      let y = part.object === 0 ? lift[slab.z] : lift[objects[part.object].dz] + slab.z;
      let show = 16;
      let down = 1;
      if (reveal[slab.part] < 1) {
        const arrived = (reveal[slab.part] * (part.slices + FLIGHT) - (slab.z - part.z0)) / FLIGHT;
        if (arrived <= 0) show = 0;
        else if (arrived < 1) {
          y += part.drop * (1 - arrived) ** 1.5; // 着くまぎわほどゆっくり
          show = Math.min(16, Math.ceil((arrived / SOLID_AT) * 16));
          down = 0;
        }
      }
      up[i] = y;
      fade[i] = show;
      landed[i] = show && down;
      if (show) order.push(i);
    }
    order.sort((a, b) => up[b] - up[a] || slabs[b].z - slabs[a].z || b - a);

    // 2. 高い順に描く
    const all = order.length;
    this.counts.fill(0, 0, all);
    if (this.clip0 <= this.clip1) {
      for (let k = 0; k < all; k++) {
        const i = order[k];
        this.seqNow = k + 1;
        const slab = slabs[i];
        const object = objects[parts[slab.part].object];
        const above = slab.above === null ? -1 : slab.above.index;
        const stacked = above >= 0 && landed[i] === 1 && landed[above] === 1;
        const gap = stacked ? up[above] - up[i] : 0; // すぐ上の1枚とのあいだ（ドット）
        const tight = stacked && gap <= 1.001; // ぴったり重なっている
        // 画面の同じドットは、上の1枚では、見ている側へこれだけ進んだマスにあたる
        const shiftX = (this.sin * gap) / squash;
        const shiftY = (this.cos * gap) / squash;
        // すき間があいたら、上の1枚の手前のふちに近いほど（奥にもぐるほど）暗くする。
        // 画面では、上の1枚がすぐ上に見えているドットほど奥にある。DARK_WITHIN より近ければ濃く、DIM_WITHIN より近ければ少し暗い
        const dim = gap > 1.5 ? Math.round(gap * DIM_WITHIN) : 0;
        const dark = gap > 1.5 ? Math.round(gap * DARK_WITHIN) : 0;
        const tag = (slab.part + 1) | (landed[i] ? 0 : FLYING);
        const cy = view.pivotY - up[i];

        for (let t = 0; t < slab.tiles.length; t++) {
          const tile = slab.tiles[t];
          if (!stacked) {
            this.#drawRect(tile, tile.a0, tile.a1, tile.b0, tile.b1, object, cy, up[i], fade[i], tag, 0, 0);
            continue;
          }
          // タイルを 4つに割って、見える部分だけ描く。ぴったり重なっていれば、見えうるふちだけ。
          // すき間があれば、上の1枚の、ここにあたる範囲がすべて詰まっているところを飛ばす
          const bounds = tile.quarters;
          const x = tile.x0 + shiftX;
          const y = tile.y0 + shiftY;
          for (let q = tight ? 4 : 0; q < 32; q += 8) {
            const a0 = bounds[q];
            const a1 = bounds[q + 1];
            const b0 = bounds[q + 2];
            const b1 = bounds[q + 3];
            if (a0 > a1) continue;
            if (!tight && solidRect(
              slab.above,
              Math.floor(x + a0 - 0.01), Math.floor(y + b0 - 0.01), Math.ceil(x + a1 + 0.01), Math.ceil(y + b1 + 0.01),
            )) continue;
            this.#drawRect(tile, a0, a1, b0, b1, object, cy, up[i], fade[i], tag, dim, dark);
          }
        }
      }
      if (view.floor) this.#floorShadow(view.floor);
      this.#countDrawn(view.paintUpTo);
      if (this.paleFrom < all || view.orderTint === true) this.#pale(this.paleFrom, all, view.orderTint === true);
      this.#outline();
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  // 「描く順番」でどこまでを描いたことにするかを決める。
  // 同じ高さの輪切り（地面と木など、部品がちがうもの）はまとめて1枚と数え、
  // 画面の外にあって何も描かなかった高さは、順番に入れない
  #countDrawn(paintUpTo) {
    const { counts, drawn, order, up } = this;
    const all = order.length;
    let levels = 0;
    for (let k = 0, height = NaN, counted = false; k < all; k++) {
      if (up[order[k]] !== height) { height = up[order[k]]; counted = false; }
      if (!counted && counts[k] > 0) { counted = true; levels++; }
    }
    drawn.levels = levels;
    drawn.upTo = paintUpTo === undefined || paintUpTo >= 1 ? levels : Math.max(1, Math.ceil(paintUpTo * levels));
    drawn.dots = 0;
    this.paleFrom = all; // order のこの番号より後の輪切りを、うすくする
    for (let k = 0, height = NaN, counted = false, seen = 0; k < all; k++) {
      if (up[order[k]] !== height) {
        if (seen === drawn.upTo && drawn.upTo < levels) { this.paleFrom = k; break; }
        height = up[order[k]];
        counted = false;
      }
      if (counts[k] === 0) continue;
      if (!counted) { counted = true; seen++; }
      if (seen === drawn.upTo) drawn.dots += counts[k];
    }
  }

  /** 画面上のドットにある部品の key。何もなければ null。 */
  partAt(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const value = this.id[(y | 0) * this.width + (x | 0)] & ~FLYING;
    return value ? this.scene.parts[value - 1].key : null;
  }

  // タイル tile の、マス (a0, b0)〜(a1, b1) の範囲を描く。
  // dim / dark = この行数だけ上に、同じ部品のもっと高い輪切りが見えていたら暗くする（0 = しない）
  #drawRect(tile, a0, a1, b0, b1, object, cy, up, fade, tag, dim, dark) {
    const { width, color, id, depth, squash, pivotX, cos, sin, lx, ly, lz, cast, cells, cellsWide } = this;
    const { seq, counts, seqNow, paper } = this;
    const mark = this.markHidden;
    const { palette, center } = this.scene;
    const { m, n, ao } = tile;
    const tileX = tile.x0;
    const tileY = tile.y0;

    // タイルの左上マスの中心を、回転の軸から見た位置
    const ox = tile.x0 + object.dx - center.x;
    const oy = tile.y0 + object.dy - center.y;

    // 範囲を回したあとの外接四角（描く範囲）
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (let c = 0; c < 4; c++) {
      const wx = ox + (c & 1 ? a1 + 0.5 : a0 - 0.5);
      const wy = oy + (c & 2 ? b1 + 0.5 : b0 - 0.5);
      const sx = pivotX + wx * cos - wy * sin;
      const sy = cy + (wx * sin + wy * cos) * squash;
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(width - 1, Math.ceil(maxX));
    const y0 = Math.max(this.clip0, Math.floor(minY));
    const y1 = Math.min(this.clip1, Math.ceil(maxY));
    if (x0 > x1 || y0 > y1) return;

    // 描く範囲が、もっと高い輪切りですっかり埋まっていれば、何もしない
    let room = false;
    for (let gy = y0 >> CELL_BITS; gy <= y1 >> CELL_BITS && !room; gy++) {
      for (let gx = x0 >> CELL_BITS; gx <= x1 >> CELL_BITS; gx++) {
        if (cells[gy * cellsWide + gx] < CELL * CELL) { room = true; break; }
      }
    }
    if (!room) return;

    // 画面のドットから逆算した位置は、タイルごとではなく盤の上のマス番号で出す。
    // タイルごとに計算すると、境目ちょうどのドットが誤差でどちらのタイルにも入らないことがある
    const baseX = center.x - object.dx;
    const baseY = center.y - object.dy;
    const uLo = tileX + a0 - 0.5;
    const uHi = tileX + a1 + 0.5;
    const vLo = tileY + b0 - 0.5;
    const vHi = tileY + b1 + 0.5;
    const dimRows = dim * width;
    const darkRows = dark * width;

    for (let y = y0; y <= y1; y++) {
      // 画面の (x, y) が、盤のどのマスにあたるかを逆算する：u = x·cos + ub、v = −x·sin + vb
      const Y = (y - cy) / squash;
      const ub = Y * sin - pivotX * cos + baseX;
      const vb = Y * cos + pivotX * sin + baseY;

      // この行で、範囲に入る x だけを回る
      let xa = x0;
      let xb = x1;
      if (cos > 1e-6) {
        xa = Math.max(xa, Math.ceil((uLo - ub) / cos)); xb = Math.min(xb, Math.floor((uHi - ub) / cos));
      } else if (cos < -1e-6) {
        xa = Math.max(xa, Math.ceil((uHi - ub) / cos)); xb = Math.min(xb, Math.floor((uLo - ub) / cos));
      } else if (ub < uLo || ub > uHi) continue;
      if (sin > 1e-6) {
        xa = Math.max(xa, Math.ceil((vb - vHi) / sin)); xb = Math.min(xb, Math.floor((vb - vLo) / sin));
      } else if (sin < -1e-6) {
        xa = Math.max(xa, Math.ceil((vb - vLo) / sin)); xb = Math.min(xb, Math.floor((vb - vHi) / sin));
      } else if (vb < vLo || vb > vHi) continue;
      // 範囲の端は 1ドット広めに取る。どのマスかは下で確かめるので、広くても描きすぎない
      xa = Math.max(x0, xa - 1);
      xb = Math.min(x1, xb + 1);

      const row = y * width;
      const cellRow = (y >> CELL_BITS) * cellsWide;
      const lookUp = dim !== 0 && !mark && y - dim >= this.clip0; // 上の行を見て、すき間の陰をつけるか
      for (let x = xa; x <= xb; x++) {
        if (id[row + x] !== 0) continue; // もっと高い輪切りがすでに描いた
        const i = Math.floor(x * cos + ub + 0.5) - tileX;
        const j = Math.floor(vb - x * sin + 0.5) - tileY;
        if (i < a0 || j < b0 || i > a1 || j > b1) continue;
        const o = (j << TILE_BITS) | i;
        const mat = m[o];
        if (mat === 0) continue;
        if (fade < 16 && DITHER[(((j + tileY) & 3) << 2) | ((i + tileX) & 3)] >= fade) continue;

        const p = row + x;
        const dot = n[o * 3] * lx + n[o * 3 + 1] * ly + n[o * 3 + 2] * lz;
        let tone = dot >= TONE_STEPS[0] ? 3 : dot >= TONE_STEPS[1] ? 2 : dot >= TONE_STEPS[2] ? 1 : 0;
        const shade = ao[o];
        tone -= shade & 3;
        const extra = (shade >> 2) & 3;
        if (extra !== 0 && cast[tile.cast[o]] === 1) tone -= extra;
        if (mark && (shade & HIDDEN) !== 0) {
          // 「描く範囲」：重なると隠れるマスは、うすい縞にする
          color[p] = blend(palette[mat * 4 + 2], paper, HIDDEN_PALE[((tileX + i + tileY + j) >> 1) & 1]);
        } else {
          let deep = false;
          if (lookUp) {
            if (id[p - darkRows] === tag && depth[p - darkRows] > up) deep = true;
            else if (id[p - dimRows] === tag && depth[p - dimRows] > up) tone -= 2;
          }
          if (tone < 0) tone = 0;
          color[p] = deep ? blend(palette[mat * 4], INK, GAP_DARK) : palette[mat * 4 + tone];
        }
        id[p] = tag;
        depth[p] = up;
        seq[p] = seqNow;
        counts[seqNow - 1]++;
        cells[cellRow + (x >> CELL_BITS)]++;
      }
    }
  }

  // 「描く順番」：まだ描いていない輪切り（upTo 番めより後）のドットを、背景の色へ寄せてうすくする。
  // tint なら、あとに描く輪切りほどうすくする
  #pale(upTo, all, tint) {
    const { width, color, id, seq, paper } = this;
    for (let y = this.clip0; y <= this.clip1; y++) {
      for (let p = y * width, end = p + width; p < end; p++) {
        if (id[p] === 0) continue;
        if (tint) color[p] = blend(color[p], paper, (UNPAINTED * (seq[p] - 1)) / Math.max(1, all - 1));
        else if (seq[p] > upTo) color[p] = blend(color[p], paper, UNPAINTED);
      }
    }
  }

  // 外側の輪郭と、手前の物が奥の物に重なる境目を濃い色でなぞる
  #outline() {
    const { width, color, id, depth } = this;
    const y0 = Math.max(1, this.clip0);
    const y1 = Math.min(this.height - 2, this.clip1);

    for (let y = y0; y <= y1; y++) {
      for (let x = 1, p = y * width + 1; x < width - 1; x++, p++) {
        const self = id[p];
        if (self === 0) {
          // 外側の輪郭。となりのドットの色を濃くして使う
          const q = solid(id[p + width]) ? p + width : solid(id[p - width]) ? p - width
            : solid(id[p - 1]) ? p - 1 : solid(id[p + 1]) ? p + 1 : -1;
          if (q >= 0) color[p] = blend(color[q], INK, 0.62);
          continue;
        }
        if (self & FLYING) continue;
        const here = depth[p];
        let hit = false;
        for (let k = 0; k < 4 && !hit; k++) {
          const q = p + (k === 0 ? -1 : k === 1 ? 1 : k === 2 ? -width : width);
          const other = id[q];
          if (!solid(other)) continue;
          const rise = depth[q] - here;
          hit = rise > EDGE_CLIFF || (other !== self && rise > EDGE_STEP);
        }
        if (hit) color[p] = blend(color[p], INK, 0.5);
      }
    }
  }

  // 島が浮いて見えるよう、床に平たい楕円の影を置く。島の絵に重なるところは塗らない
  #floorShadow({ x, y, rx, ry, color: tint }) {
    const { width, color, id } = this;
    // 楕円の内側の行だけを塗る（外へ丸めると、決めた下端より1ドット下まで出る）
    const y0 = Math.max(this.clip0, Math.ceil(y - ry));
    const y1 = Math.min(this.clip1, Math.floor(y + ry));
    for (let py = y0; py <= y1; py++) {
      const half = rx * Math.sqrt(Math.max(0, 1 - ((py - y) / ry) ** 2));
      const x0 = Math.max(0, Math.round(x - half));
      const x1 = Math.min(width - 1, Math.round(x + half));
      for (let p = py * width + x0, end = py * width + x1; p <= end; p++) {
        if (id[p] === 0) color[p] = tint;
      }
    }
  }
}

// 置き場所に着いている輪切りのドットか
function solid(tag) {
  return tag !== 0 && (tag & FLYING) === 0;
}

// 色 c を、色 to へ amount だけ寄せる
function blend(c, to, amount) {
  const r = (c & 255) + ((to & 255) - (c & 255)) * amount;
  const g = ((c >> 8) & 255) + (((to >> 8) & 255) - ((c >> 8) & 255)) * amount;
  const b = ((c >> 16) & 255) + (((to >> 16) & 255) - ((c >> 16) & 255)) * amount;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function normalize([x, y, z]) {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}
