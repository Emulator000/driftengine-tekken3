/**
 * The HUD's look, built on the original's: its colours (each ramp light to dark, as its palettes
 * shade them) set as smooth gradients, polished chrome where it had grey pixels, and type where it
 * had lettering. Colours are CSS `#rrggbb`.
 */
import type { TypeStyle } from '../2d/type.ts';
import { DISPLAY, NUMERALS } from '../2d/typefaces.ts';

type Ramp = readonly string[];

/** Polished metal, light to dark: the frames, end caps and rims. */
export const CHROME: Ramp = ['#ffffff', '#e4e4e4', '#b4b4b4', '#7a7a7a', '#454545', '#1e1e1e'];

/** A bar's three parts, light to dark: the health, the damage just taken, what is lost; and a Tekken Ball gauge's empty part. */
export const BAR_RAMPS: { readonly health: Ramp; readonly damage: Ramp; readonly lost: Ramp; readonly empty: Ramp } = {
  health: ['#50f8f0', '#28e0d8', '#00c8b8', '#00b0a0', '#009088', '#007870'],
  damage: ['#ffffff', '#f8f888', '#f8f808', '#f8e800', '#f8d800', '#f8c000'],
  lost: ['#ff2a1a', '#f00000', '#c80000', '#a00000', '#700000', '#400000'],
  empty: ['#525252', '#424242', '#393939', '#313131', '#212121', '#101010'],
};

/** A round mark's body, light to dark: lit gold, or empty gunmetal. */
export const MARK_RAMPS: { readonly lit: Ramp; readonly empty: Ramp } = {
  lit: ['#fffff0', '#f8f880', '#f8f820', '#f8d820', '#f8c020', '#f89020'],
  empty: ['#6a6a6a', '#585858', '#484848', '#383838', '#2c2626', '#1a1a1a'],
};

/** Tekken Force's three keys' metals, light to dark: copper, silver, gold. */
export const KEY_RAMPS: readonly Ramp[] = [
  ['#ffb090', '#e86848', '#c03a22', '#901c10', '#5a0c06'],
  ['#ffffff', '#e8eef2', '#b8c2ca', '#7e8890', '#444c54'],
  ['#fff4a0', '#ffd040', '#e8a010', '#b07008', '#6a3c00'],
];

/** Per costume, the name plate's ramp, light to dark. */
export const PLATE_RAMPS: readonly Ramp[] = [
  ['#f07888', '#e05068', '#d03048', '#b81830', '#a00018', '#780018', '#580010'],
  ['#68b0b8', '#489090', '#387878', '#286060', '#184848', '#083030', '#001018'],
  ['#f8d040', '#e0a818', '#d09008', '#b88000', '#a06800', '#784800', '#583800'],
  ['#98a8b0', '#788890', '#506070', '#303848', '#182028', '#081018', '#000810'],
];

/** Per costume, the name's colours: its fill light to dark, and its outline. */
export const NAME_COLOURS: readonly { readonly fill: Ramp; readonly outline: string }[] = [
  { fill: ['#ffffff', '#f0e8e8', '#d8b8b8'], outline: '#501818' },
  { fill: ['#ffffff', '#e8e8e8', '#b8c8c8'], outline: '#183030' },
  { fill: ['#ffffff', '#f0f0e0', '#e0d0a0'], outline: '#703808' },
  { fill: ['#ffffff', '#e8e8e8', '#c8c8c8'], outline: '#303030' },
];

type PrintColour = { readonly ramp: Ramp; readonly outline: string; readonly outer: string };

/**
 * The printer's colours by font and colour number (each font has palettes of its own), as the
 * original's palettes hold them: each ramp light to dark, with its outline and the dark around
 * it. The big font's calls: 1 red (K.O.), 2 gold (PERFECT!), 3 teal (TIME UP), 4 orange (YOU
 * WIN!), 5 ice (YOU LOSE), 6 violet (DRAW), 8 silver (ROUND 1), 9 fire (READY?); the small font's
 * 2 red (GAME OVER), 7 orange (REPLAY), 9 teal (WINNER, LOSER), and the menus' others.
 */
const PRINT_COLOURS: Readonly<Record<number, Readonly<Record<number, PrintColour>>>> = {
  0: {
    0: { ramp: ['#7352f7', '#6b4af7', '#6342e7', '#5231d6', '#4a29ce', '#3921ad', '#392194', '#312184', '#211073', '#21105a'], outline: '#101010', outer: '#000000' },
    1: { ramp: ['#00ce8c', '#00bd84', '#00a573', '#009c6b', '#008c63', '#007352', '#006b4a', '#005a42', '#004231', '#003929'], outline: '#101010', outer: '#000000' },
    2: { ramp: ['#ff1000', '#ef0800', '#de0800', '#c60800', '#bd0800', '#a50800', '#940800', '#730000', '#6b0000', '#420000'], outline: '#101010', outer: '#000000' },
    3: { ramp: ['#00adb5', '#009ca5', '#00949c', '#008c8c', '#008484', '#00737b', '#006b6b', '#006363', '#00525a', '#004a4a'], outline: '#101010', outer: '#000000' },
    5: { ramp: ['#ffce00', '#efbd00', '#dead00', '#ce9c00', '#bd9400', '#ad8400', '#a57300', '#946300', '#845200', '#734a00'], outline: '#101010', outer: '#000000' },
    6: { ramp: ['#ffffff', '#e7e7e7', '#cecece', '#adadad', '#949494', '#848484', '#737373', '#5a5a5a', '#4a4a4a', '#313131'], outline: '#211818', outer: '#000000' },
    7: { ramp: ['#ff7300', '#f75a00', '#d65200', '#bd4a00', '#b54200', '#a54200', '#943900', '#8c3100', '#7b2900', '#6b2900'], outline: '#101010', outer: '#000000' },
    10: { ramp: ['#addee7', '#94c6d6', '#8cb5bd', '#73a5b5', '#639ca5', '#5a9cad', '#5a949c', '#396b73', '#215263', '#18424a'], outline: '#212121', outer: '#000000' },
    11: { ramp: ['#00adb5', '#009ca5', '#00949c', '#008c8c', '#008484', '#00737b', '#006b6b', '#006363', '#00525a', '#004a4a'], outline: '#101010', outer: '#000000' },
  },
  1: {
    0: { ramp: ['#4252ff', '#394ae7', '#3942ce', '#3142b5', '#3139a5', '#31398c', '#293173', '#292963', '#21294a', '#212131'], outline: '#212121', outer: '#181818' },
    1: { ramp: ['#31ce7b', '#29bd73', '#29b56b', '#29a563', '#21945a', '#218c52', '#187b4a', '#186b42', '#186339', '#105231'], outline: '#181829', outer: '#181821' },
    2: { ramp: ['#e71818', '#d61818', '#c61818', '#b51010', '#a51010', '#9c1010', '#8c0808', '#7b0808', '#6b0808', '#5a0808'], outline: '#081810', outer: '#081008' },
    4: { ramp: ['#e74284', '#ce3973', '#bd396b', '#a53163', '#94315a', '#843152', '#6b2942', '#5a2939', '#422131', '#312129'], outline: '#212121', outer: '#101010' },
    5: { ramp: ['#ffad00', '#f7a500', '#e79c00', '#de8c00', '#d68400', '#c67b00', '#bd7300', '#b56300', '#ad5a00', '#9c5200'], outline: '#212121', outer: '#181818' },
    6: { ramp: ['#ffffff', '#efefef', '#dedede', '#cecece', '#b5bdbd', '#a5a5a5', '#949494', '#848484', '#737373', '#636363'], outline: '#212121', outer: '#181818' },
    7: { ramp: ['#ff6b00', '#f76300', '#e76300', '#d65a00', '#ce5200', '#bd4a00', '#ad4a00', '#9c4200', '#943900', '#843900'], outline: '#212121', outer: '#181818' },
    8: { ramp: ['#847bce', '#7b73bd', '#6b63ad', '#635aa5', '#525294', '#4a4284', '#423973', '#312963', '#29215a', '#18184a'], outline: '#001021', outer: '#081021' },
    9: { ramp: ['#4ac6c6', '#42b5b5', '#42a5a5', '#399c9c', '#398c8c', '#318484', '#297373', '#296b6b', '#215a5a', '#184a4a'], outline: '#212121', outer: '#181818' },
    10: { ramp: ['#424284', '#393973', '#31316b', '#313163', '#292952', '#21214a', '#212142', '#181831', '#101029', '#101021'], outline: '#080810', outer: '#000008' },
    11: { ramp: ['#b58400', '#a57b00', '#9c7300', '#946b00', '#846300', '#7b5a00', '#735200', '#634a00', '#5a4200', '#523900'], outline: '#181818', outer: '#101010' },
    12: { ramp: ['#ffd6e7', '#efbdde', '#deadce', '#bd9cbd', '#bd94bd', '#a58ca5', '#947b94', '#846b84', '#736373', '#635263'], outline: '#212121', outer: '#181818' },
    14: { ramp: ['#313163', '#29295a', '#292952', '#21214a', '#21214a', '#212142', '#181839', '#181831', '#181831', '#101029'], outline: '#101021', outer: '#101021' },
    15: { ramp: ['#ffffff', '#ffffce', '#ffff9c', '#ffff63', '#ffff31', '#ffff00', '#ffd600', '#ffad00', '#ff8400', '#c67300'], outline: '#846300', outer: '#181818' },
  },
  2: {
    0: { ramp: ['#ffffff', '#e7e7e7', '#d6d6d6', '#bdbdbd', '#a5a5a5', '#8c8c8c', '#737373', '#5a5a5a', '#424242', '#292929'], outline: '#212121', outer: '#101010' },
    1: { ramp: ['#ff6363', '#ff4a4a', '#ff3131', '#ff1818', '#ff0000', '#e70000', '#ce0000', '#b50000', '#9c0000', '#840000'], outline: '#101821', outer: '#081010' },
    2: { ramp: ['#ffefbd', '#ffde8c', '#f7ce63', '#f7c631', '#f7b508', '#d69c08', '#b57b08', '#946300', '#7b4a00', '#5a3100'], outline: '#101821', outer: '#080810' },
    3: { ramp: ['#8cd6de', '#6bc6ce', '#52b5bd', '#31a5ad', '#108c9c', '#107b8c', '#086b7b', '#085a63', '#004a52', '#003942'], outline: '#101821', outer: '#081010' },
    4: { ramp: ['#ffc68c', '#ffb56b', '#ffa542', '#f78c21', '#f77b00', '#f76300', '#f74a00', '#de3900', '#c62900', '#a51800'], outline: '#211829', outer: '#101018' },
    5: { ramp: ['#ceefef', '#a5d6de', '#7bbdc6', '#52adb5', '#398ca5', '#29739c', '#296384', '#215273', '#214263', '#183952'], outline: '#181821', outer: '#101018' },
    6: { ramp: ['#efefff', '#d6d6ef', '#bdb5de', '#9c94ce', '#847bbd', '#7363ad', '#635a9c', '#524a8c', '#42427b', '#293173'], outline: '#101821', outer: '#080810' },
    7: { ramp: ['#ffffff', '#ffffa5', '#ffff52', '#ffff00', '#ffde00', '#ffbd00', '#ffb500', '#e79c00', '#ce8c00', '#b57b00'], outline: '#212131', outer: '#181018' },
    8: { ramp: ['#ffffff', '#f7f7f7', '#e7e7e7', '#deded6', '#cecec6', '#c6bdb5', '#b5ad9c', '#a59c8c', '#948c73', '#5a5242'], outline: '#630800', outer: '#420000' },
    9: { ramp: ['#ffb500', '#ff9c00', '#ff8400', '#ff6b00', '#ff6300', '#ff5200', '#ff4a00', '#de3900', '#bd2900', '#9c1000'], outline: '#730000', outer: '#420000' },
    10: { ramp: ['#c6b58c', '#bda56b', '#b59c5a', '#ad8c39', '#a57b21', '#846310', '#634a08', '#4a3100', '#291800', '#100000'], outline: '#000000', outer: '#000000' },
  },
};

/**
 * A printed run's type in its font's colour: the original's shading run smooth (a dark bevel at the
 * capitals' top, a bright band, darkening to the foot, and a lit edge along the baseline), a dark
 * outline in its colour, and a soft shadow.
 */
export function printStyle(font: number, colour: number): TypeStyle {
  /* Font 3 is font 2's glyphs and palettes, set closer. */
  const { ramp, outline, outer } = PRINT_COLOURS[font === 3 ? 2 : font]?.[colour] ?? PRINT_COLOURS[2]![8]!;
  const r = (i: number): string => ramp[i - 1]!;
  return {
    face: DISPLAY,
    fill: [
      [0, r(7)],
      [0.1, r(4)],
      [0.2, r(1)],
      [0.42, r(1)],
      [0.55, r(4)],
      [0.72, r(6)],
      [0.9, r(9)],
      [0.96, r(8)],
      [1, r(3)],
    ],
    outlines: [
      [0.05, outer],
      [0.09, outline],
    ],
    tracking: 0.06,
    shadow: { x: 0.04, y: 0.08, blur: 0.12, colour: 'rgba(0, 0, 0, 0.55)' },
  };
}

/** A name in its costume's colours. */
export function nameStyle(costume: number): TypeStyle {
  const { fill, outline } = NAME_COLOURS[costume] ?? NAME_COLOURS[0]!;
  return {
    face: DISPLAY,
    fill: [
      [0, fill[0]!],
      [0.55, fill[1]!],
      [1, fill[2]!],
    ],
    outlines: [[0.14, outline]],
    tracking: 0.05,
    shadow: { x: 0.05, y: 0.08, blur: 0.1, colour: 'rgba(0, 0, 0, 0.5)' },
  };
}

/** The timer's numerals: white running to grey at the foot, a grey bevel under them, a black outline. */
export const TIMER_STYLE: TypeStyle = {
  face: NUMERALS,
  fill: [
    [0, '#ffffff'],
    [0.5, '#f0f0f0'],
    [0.8, '#d0d0d0'],
    [1, '#a8a8a8'],
  ],
  outlines: [
    [0.025, '#000000'],
    [0.07, '#202020'],
  ],
  tracking: 0,
  bevel: { x: 0.035, y: 0.035, colour: '#686868' },
  shadow: { x: 0.03, y: 0.05, blur: 0.08, colour: 'rgba(0, 0, 0, 0.5)' },
};
