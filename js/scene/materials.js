// 島で使う素材。色を1つ決めると、明暗4段は palette.js が作る。光るものや水は4段を直接決める。
import { material } from '../engine/palette.js';

const flat = (hex) => [hex, hex, hex, hex];

export const M = {
  // 地面
  grass: material('grass', '#62b04a'),
  grassDark: material('grassDark', '#4c9c41'),
  grassLight: material('grassLight', '#7dc65b'),
  flowerWhite: material('flowerWhite', '#f5f1e2'),
  flowerYellow: material('flowerYellow', '#f6cf45'),
  flowerPink: material('flowerPink', '#f08fb0'),
  soil: material('soil', '#80532f'),
  soilDark: material('soilDark', '#6a432a'),
  rock: material('rock', '#7d706b'),
  rockDark: material('rockDark', '#655a57'),
  rockLight: material('rockLight', '#968a85'),
  path: material('path', '#dfcea2'),
  pathDark: material('pathDark', '#cbb787'),
  sand: material('sand', '#e8d9ab'),
  pave: material('pave', '#d3cbb9'),
  paveDark: material('paveDark', '#b9b09d'),
  water: material('water', ['#3b8db3', '#4aa3c7', '#4aa3c7', '#62b6d6']),
  waterLight: material('waterLight', flat('#8fd0e4')),
  lily: material('lily', '#3f9a5a'),

  // 石・鉄・木
  stone: material('stone', '#aaa69d'),
  stoneDark: material('stoneDark', '#8e8981'),
  iron: material('iron', '#47505c'),
  black: material('black', '#2a2e38'),
  timber: material('timber', '#7c4d2e'),
  woodDark: material('woodDark', '#5a3f30'),
  bench: material('bench', '#a06f3e'),

  // 灯台
  white: material('white', '#f2eee3'),
  red: material('red', '#d4432f'),
  navy: material('navy', '#2e3a55'),
  glass: material('glass', flat('#ffd960')),
  lamp: material('lamp', flat('#ffe58a')),

  // パン屋
  cream: material('cream', '#f0e3c4'),
  teal: material('teal', '#2f8d86'),
  tealLight: material('tealLight', '#41a79d'),
  brick: material('brick', '#a8573d'),
  brickDark: material('brickDark', '#8f4633'),
  awningRed: material('awningRed', '#d9503c'),
  awningWhite: material('awningWhite', '#f4efe1'),
  window: material('window', ['#3f7397', '#4d88ad', '#5b9cc4', '#8fc4e0']),
  door: material('door', '#6a3f24'),

  // 銭湯
  plaster: material('plaster', '#ece6d8'),
  slate: material('slate', '#4e5b6a'),
  slateLight: material('slateLight', '#647487'),
  indigo: material('indigo', '#2d4f90'),

  // 神社
  vermilion: material('vermilion', '#d8452c'),
  shrineWood: material('shrineWood', '#8c5c3b'),
  copper: material('copper', '#4d9c86'),
  copperLight: material('copperLight', '#69b69e'),

  // 木
  trunk: material('trunk', '#7b5331'),
  trunkDark: material('trunkDark', '#62412a'),
  leaf: material('leaf', '#3f9a4a'),
  leafLight: material('leafLight', '#5bb653'),
  leafDark: material('leafDark', '#2f7f45'),
  fruit: material('fruit', '#f2a12e'),
  pine: material('pine', '#2f6f52'),
  pineLight: material('pineLight', '#3d8a63'),
  round: material('round', '#74c25c'),
  roundLight: material('roundLight', '#93d470'),

  // 雲
  cloud: material('cloud', ['#c4d5e3', '#dbe7f0', '#f0f5f9', '#ffffff']),
};
