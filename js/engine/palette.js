// 素材（マテリアル）の色表。
// 1つの素材は明るさ4段（0 = いちばん暗い … 3 = いちばん明るい）を持つ。
// 暗い段ほど色相を青紫へ寄せる。同じ色を暗くするだけより、ドット絵らしく締まる。

const SHADOW_HUE = 245;

const tones = [[0, 0, 0, 0]]; // 0番は「空き」
const ids = {};

/** 素材を登録して番号を返す。color は上面の色1つか、暗い順の4段の配列。 */
export function material(name, color) {
  if (name in ids) return ids[name];
  const ramp = (Array.isArray(color) ? color : autoRamp(color)).map(pack);
  ids[name] = tones.length;
  tones.push(ramp);
  return ids[name];
}

/** 登録済みの全素材を、描画用の表（素材番号 × 4 + 明るさ）にする。 */
export function paletteTable() {
  const table = new Uint32Array(tones.length * 4);
  tones.forEach((ramp, i) => table.set(ramp, i * 4));
  return table;
}

export function pack(hex) {
  const n = parseInt(hex.slice(1), 16);
  // ImageData はリトルエンディアンで R, G, B, A の順
  return ((255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | (n >> 16)) >>> 0;
}

function autoRamp(hex) {
  const [h, s, l] = toHsl(hex);
  // 指定した色は、光の当たる上面の色（3）。そこから側面・陰・影へ暗くしていく
  return [
    fromHsl(toward(h, SHADOW_HUE, 24), s * 1.1, l * 0.52),
    fromHsl(toward(h, SHADOW_HUE, 14), s * 1.06, l * 0.68),
    fromHsl(toward(h, SHADOW_HUE, 5), s * 1.02, l * 0.84),
    hex,
  ];
}

// 色相 h を target のほうへ最大 by 度だけ寄せる
function toward(h, target, by) {
  const diff = ((target - h + 540) % 360) - 180;
  return (h + Math.sign(diff) * Math.min(Math.abs(diff), by) + 360) % 360;
}

function toHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (l > 0.5 ? 2 - max - min : max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h, s, l) {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
