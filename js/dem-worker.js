// Yükseklik işçisi (Web Worker).
// - Terrarium karolarını (AWS Terrain Tiles) indirir ve çözer.
// - z9+ karolarda batimetri yoktur (deniz 0 m görünür); bu yüzden z8 karosundaki batimetriyle birleştirir.
// - "Bağlantılı" model için kapalı havza etiketlerini (z9) uygular: v = max(e, taşma seviyesi).
// - 3B için su yüzeyini düzleştirilmiş karo üretir.
// Çıktılar MapLibre'nin raster-dem kaynağına ImageBitmap (terrarium kodlu) olarak döner.
'use strict';

const HOSTS = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/',
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/',
  'https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/terrarium/',
];
const SIZE = 256;
const N = SIZE * SIZE;
const MERGE_Z = 8; // güvenilir batimetrinin bulunduğu en yüksek zoom
const LABEL_Z = 9; // havza etiketlerinin zoom'u
const SEA_EPS = 0.5; // bu değerin altındaki pikseller "deniz yüzeyi adayı" sayılır

class LRU {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  delete(k) { this.map.delete(k); }
}

const rawCache = new LRU(320);
const mergedCache = new LRU(220);
const condCache = new LRU(96);
const labelCache = new Map();

let labelIndex = new Map(); // "x_y" -> [offset, length]
let labelTilesXY = [];      // [[tx, ty, key]]
let labelBin = null;
let spill = new Float32Array(1);
let canvas = null;
let ctx = null;

function hostFor(z, x, y) {
  return HOSTS[(x * 7 + y * 13 + z) % HOSTS.length];
}

async function decodePNG(blob) {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (!canvas) {
    canvas = new OffscreenCanvas(SIZE, SIZE);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

async function fetchRaw(z, x, y) {
  const url = `${hostFor(z, x, y)}${z}/${x}/${y}.png`;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const px = await decodePNG(await res.blob());
      const out = new Float32Array(N);
      for (let i = 0, j = 0; i < N; i++, j += 4) out[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
      return out;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1) ** 2));
    }
  }
  throw lastErr;
}

function cached(cache, key, make) {
  let p = cache.get(key);
  if (!p) {
    p = make();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

const getRaw = (z, x, y) => cached(rawCache, `${z}/${x}/${y}`, () => fetchRaw(z, x, y));
const getMerged = (z, x, y) => cached(mergedCache, `${z}/${x}/${y}`, () => buildMerged(z, x, y));
const getCond = (z, x, y) => cached(condCache, `${z}/${x}/${y}`, () => buildCond(z, x, y));

async function buildMerged(z, x, y) {
  const hi = await getRaw(z, x, y);
  if (!hi) return null;
  const out = new Float32Array(N);
  if (z <= MERGE_Z) {
    for (let i = 0; i < N; i++) {
      const e = hi[i];
      out[i] = e <= SEA_EPS ? Math.min(e, -SEA_EPS) : e;
    }
    return out;
  }
  const dz = z - MERGE_Z;
  const s = 1 << dz;
  const x8 = x >> dz;
  const y8 = y >> dz;
  let lo = null;
  try { lo = await getRaw(MERGE_Z, x8, y8); } catch (e) { lo = null; }
  const ox = (x - x8 * s) * SIZE;
  const oy = (y - y8 * s) * SIZE;
  const inv = 1 / s;
  for (let j = 0; j < SIZE; j++) {
    const sy = (oy + j + 0.5) * inv - 0.5;
    let y0 = Math.floor(sy);
    let fy = sy - y0;
    if (y0 < 0) { y0 = 0; fy = 0; } else if (y0 > SIZE - 2) { y0 = SIZE - 2; fy = 1; }
    const r0 = y0 * SIZE;
    const r1 = r0 + SIZE;
    for (let i = 0; i < SIZE; i++) {
      const idx = j * SIZE + i;
      const e = hi[idx];
      if (e > SEA_EPS) { out[idx] = e; continue; }
      let b = -SEA_EPS;
      if (lo) {
        const sx = (ox + i + 0.5) * inv - 0.5;
        let x0 = Math.floor(sx);
        let fx = sx - x0;
        if (x0 < 0) { x0 = 0; fx = 0; } else if (x0 > SIZE - 2) { x0 = SIZE - 2; fx = 1; }
        const a = lo[r0 + x0] * (1 - fx) + lo[r0 + x0 + 1] * fx;
        const c = lo[r1 + x0] * (1 - fx) + lo[r1 + x0 + 1] * fx;
        b = a * (1 - fy) + c * fy;
      }
      out[idx] = Math.min(e, b, -SEA_EPS);
    }
  }
  return out;
}

function labelTile(tx, ty) {
  const key = `${tx}_${ty}`;
  const ent = labelIndex.get(key);
  if (!ent) return null;
  let p = labelCache.get(key);
  if (!p) {
    const [off, len] = ent;
    p = decodePNG(new Blob([labelBin.subarray(off, off + len)], { type: 'image/png' })).then((px) => {
      const out = new Uint16Array(N);
      for (let i = 0, j = 0; i < N; i++, j += 4) out[i] = (px[j] << 8) | px[j + 1];
      return out;
    });
    labelCache.set(key, p);
  }
  return p;
}

// (z, x, y) karosu için piksel başına havza etiketi (yoksa null)
async function getLabels(z, x, y) {
  if (!labelBin) return null;
  if (z >= LABEL_Z) {
    const dz = z - LABEL_Z;
    const s = 1 << dz;
    const tx = x >> dz;
    const ty = y >> dz;
    const p = labelTile(tx, ty);
    if (!p) return null;
    const src = await p;
    const out = new Uint16Array(N);
    const ox = (x - tx * s) * SIZE;
    const oy = (y - ty * s) * SIZE;
    let any = false;
    for (let j = 0; j < SIZE; j++) {
      const sy = Math.floor((oy + j + 0.5) / s) * SIZE;
      for (let i = 0; i < SIZE; i++) {
        const l = src[sy + Math.floor((ox + i + 0.5) / s)];
        if (l) { out[j * SIZE + i] = l; any = true; }
      }
    }
    return any ? out : null;
  }
  // Düşük zoom: karo birden çok etiket karosunu kapsar
  const dz = LABEL_Z - z;
  const s = 1 << dz;
  const tx0 = x * s;
  const ty0 = y * s;
  const found = new Map();
  for (const [tx, ty] of labelTilesXY) {
    if (tx >= tx0 && tx < tx0 + s && ty >= ty0 && ty < ty0 + s) found.set(tx * 65536 + ty, labelTile(tx, ty));
  }
  if (!found.size) return null;
  for (const [k, p] of found) found.set(k, await p);
  const out = new Uint16Array(N);
  let any = false;
  for (let j = 0; j < SIZE; j++) {
    const gy = Math.floor((y * SIZE + j + 0.5) * s);
    const ty = gy >> 8;
    const ly = (gy & 255) * SIZE;
    for (let i = 0; i < SIZE; i++) {
      const gx = Math.floor((x * SIZE + i + 0.5) * s);
      const t = found.get((gx >> 8) * 65536 + ty);
      if (t) {
        const l = t[ly + (gx & 255)];
        if (l) { out[j * SIZE + i] = l; any = true; }
      }
    }
  }
  return any ? out : null;
}

async function buildCond(z, x, y) {
  const m = await getMerged(z, x, y);
  if (!m) return null;
  const lab = await getLabels(z, x, y);
  if (!lab) return m;
  const out = new Float32Array(m);
  for (let i = 0; i < N; i++) {
    const l = lab[i];
    if (l) {
      const s = spill[l];
      if (out[i] < s) out[i] = s;
    }
  }
  return out;
}

async function build3d(z, x, y, level, connected) {
  const m = await getMerged(z, x, y);
  if (!m) return null;
  const c = connected ? await getCond(z, x, y) : m;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = c[i] < level ? level : m[i];
  return out;
}

function encode(arr) {
  const u8 = new Uint8ClampedArray(N * 4);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let t = arr[i] + 32768;
    if (!(t > 0)) t = 0; else if (t > 65535.99) t = 65535.99;
    const ti = Math.floor(t);
    u8[j] = ti >> 8;
    u8[j + 1] = ti & 255;
    u8[j + 2] = Math.floor((t - ti) * 256);
    u8[j + 3] = 255;
  }
  return createImageBitmap(new ImageData(u8, SIZE, SIZE), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

async function labelAt(lng, lat) {
  if (!labelBin) return 0;
  const [fx, fy] = lngLatToTile(lng, lat, LABEL_Z);
  const gx = Math.floor(fx * SIZE);
  const gy = Math.floor(fy * SIZE);
  const p = labelTile(gx >> 8, gy >> 8);
  if (!p) return 0;
  const t = await p;
  return t[(gy & 255) * SIZE + (gx & 255)];
}

async function sampleAt(lng, lat, z) {
  const [fx, fy] = lngLatToTile(lng, lat, z);
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const m = await getMerged(z, x, y);
  if (!m) return null;
  const px = (fx - x) * SIZE - 0.5;
  const py = (fy - y) * SIZE - 0.5;
  const x0 = Math.max(0, Math.min(SIZE - 2, Math.floor(px)));
  const y0 = Math.max(0, Math.min(SIZE - 2, Math.floor(py)));
  const tx = Math.max(0, Math.min(1, px - x0));
  const ty = Math.max(0, Math.min(1, py - y0));
  const i = y0 * SIZE + x0;
  const e = (m[i] * (1 - tx) + m[i + 1] * tx) * (1 - ty) + (m[i + SIZE] * (1 - tx) + m[i + SIZE + 1] * tx) * ty;
  const label = await labelAt(lng, lat);
  const sp = label ? spill[label] : null;
  return { e, label, spill: sp, v: label ? Math.max(e, sp) : e };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    labelIndex = new Map(Object.entries(msg.tiles || {}));
    labelTilesXY = [...labelIndex.keys()].map((k) => k.split('_').map(Number));
    labelBin = msg.bin ? new Uint8Array(msg.bin) : null;
    spill = Float32Array.from(msg.spill || [0]);
    labelCache.clear();
    condCache.map.clear();
    return;
  }
  const { id } = msg;
  try {
    if (msg.type === 'tile') {
      const { product, z, x, y } = msg;
      let arr = null;
      if (product === 'dem') arr = await getMerged(z, x, y);
      else if (product === 'cond') arr = await getCond(z, x, y);
      else if (product === '3d') arr = await build3d(z, x, y, msg.level, msg.connected);
      if (!arr) { self.postMessage({ id, empty: true }); return; }
      const bitmap = await encode(arr);
      self.postMessage({ id, bitmap }, [bitmap]);
    } else if (msg.type === 'sample') {
      self.postMessage({ id, result: await sampleAt(msg.lng, msg.lat, msg.z) });
    }
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
