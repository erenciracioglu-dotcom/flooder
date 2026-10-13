// Renk paletleri ve MapLibre color-relief rampaları.
// Rampalar yükseklik (m) cinsindendir; su rampası deniz seviyesine (L) göre yeniden kurulur.

// Su: derinlik (m) -> [r, g, b, opaklık]. Sığ su yarı saydamdır (alttaki kara/uydu görünür).
export const WATER = [
  [0, [128, 208, 216, 0.4]],
  [0.5, [106, 198, 212, 0.52]],
  [2, [76, 182, 206, 0.66]],
  [6, [52, 162, 198, 0.78]],
  [15, [38, 140, 188, 0.87]],
  [40, [29, 118, 174, 0.92]],
  [100, [23, 98, 158, 0.95]],
  [250, [19, 82, 142, 0.965]],
  [700, [15, 66, 122, 0.975]],
  [1500, [12, 52, 102, 0.982]],
  [3000, [9, 40, 82, 0.988]],
  [6000, [6, 28, 62, 0.992]],
  [13000, [3, 17, 43, 0.995]],
];

// Bugün kara olup su altında kalan alanlar (vurgu açıkken): turkuaz-yeşil tonlar
export const FLOOD = [
  [0, [168, 236, 214, 0.48]],
  [0.5, [138, 226, 206, 0.58]],
  [2, [96, 210, 196, 0.68]],
  [8, [58, 188, 186, 0.78]],
  [25, [38, 160, 176, 0.85]],
  [80, [30, 134, 164, 0.9]],
  [250, [26, 112, 150, 0.93]],
  [800, [22, 92, 136, 0.95]],
  [2500, [18, 74, 118, 0.965]],
  [8000, [12, 54, 96, 0.98]],
];

// Fiziki harita: kara (rakım -> renk)
export const LAND = [
  [0, [92, 140, 84]],
  [40, [108, 151, 90]],
  [150, [136, 168, 102]],
  [400, [174, 184, 122]],
  [700, [202, 194, 140]],
  [1000, [212, 190, 146]],
  [1400, [200, 170, 128]],
  [1900, [182, 148, 112]],
  [2500, [160, 132, 108]],
  [3100, [150, 134, 124]],
  [3700, [198, 192, 186]],
  [4300, [236, 236, 234]],
  [5800, [255, 255, 255]],
];

// Kuruyan deniz tabanı (rakım < 0)
export const SEABED = [
  [-6000, [88, 86, 86]],
  [-4000, [106, 101, 96]],
  [-2500, [126, 118, 108]],
  [-1500, [146, 136, 120]],
  [-700, [166, 153, 131]],
  [-250, [186, 170, 141]],
  [-60, [204, 188, 153]],
  [-1, [218, 203, 166]],
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function interp(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const t = clamp01((x - x0) / (x1 - x0));
      return c0.map((v, k) => v + (c1[k] - v) * t);
    }
  }
  return stops[stops.length - 1][1];
}

export function css(c) {
  const [r, g, b, a = 1] = c;
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;
}

// [yükseklik, renk] çiftlerini sıralar, çok yakın durakları ayıklar ve ifadeye çevirir.
function toExpression(pairs) {
  pairs.sort((a, b) => a[0] - b[0]);
  const out = [];
  let last = -Infinity;
  for (const [v, c] of pairs) {
    if (v - last < 0.02) continue; // terrarium paketlemesi 1/256 m; durakların ayrık kalması gerekir
    out.push(+v.toFixed(3), c);
    last = v;
  }
  return ['interpolate', ['linear'], ['elevation'], ...out];
}

const CLEAR = 'rgba(0,0,0,0)';

// Su katmanı rampası: v < L olan her piksel su; renk derinliğe (L - v) göre.
export function waterRamp(L, highlight) {
  const pairs = [];
  const shore = L - 0.04;
  if (highlight && L > 0.1) {
    for (const [d, c] of WATER) {
      const v = L - d;
      if (v < -0.04) pairs.push([v, css(c)]);
    }
    pairs.push([-0.03, css(interp(WATER, L + 0.03))]);
    pairs.push([0, css(interp(FLOOD, L))]);
    for (const [d, c] of FLOOD) {
      const v = L - d;
      if (v > 0.02 && v < shore - 0.02) pairs.push([v, css(c)]);
    }
    pairs.push([shore, css(FLOOD[0][1])]);
  } else {
    for (const [d, c] of WATER) {
      const v = L - d;
      if (v < shore - 0.02) pairs.push([v, css(c)]);
    }
    pairs.push([shore, css(WATER[0][1])]);
  }
  pairs.push([L, CLEAR]);
  pairs.push([L + 20000, CLEAR]);
  return toExpression(pairs);
}

// Zemin rampası. "phys": kara + deniz tabanı; "sat": sadece deniz tabanı (kara uydu görüntüsünden).
export function groundRamp(mode) {
  const pairs = [];
  for (const [v, c] of SEABED) pairs.push([v, css(c)]);
  pairs.push([-0.02, css(SEABED[SEABED.length - 1][1])]);
  if (mode === 'phys') {
    for (const [v, c] of LAND) pairs.push([v, css(c)]);
    pairs.push([9000, css(LAND[LAND.length - 1][1])]);
  } else {
    pairs.push([0, CLEAR]);
    pairs.push([9000, CLEAR]);
  }
  pairs.unshift([-12000, css(SEABED[0][1])]);
  return toExpression(pairs);
}

// Arayüzde kullanılan küçük renk örnekleri
export function waterSwatch(depth) {
  return css(interp(WATER, depth));
}
