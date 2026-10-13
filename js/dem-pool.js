// Yükseklik işçileri havuzu ve MapLibre özel protokolü ("fdem://").
//   fdem://dem/{z}/{x}/{y}                 birleşik DEM (kara + batimetri)
//   fdem://cond/{z}/{x}/{y}                kapalı havzalar için koşullandırılmış DEM
//   fdem://3d/{seviye}/{c|b}/{z}/{x}/{y}   3B için düzleştirilmiş su yüzeyi
export class DemPool {
  constructor(count) {
    const url = new URL('./dem-worker.js', import.meta.url);
    this.workers = Array.from({ length: count }, () => new Worker(url));
    this.pending = new Map();
    this.seq = 1;
    for (const w of this.workers) {
      w.onmessage = (ev) => this.done(ev.data);
      w.onerror = (ev) => console.error('DEM işçisi hatası', ev.message);
    }
  }

  init({ tiles, bin, spill }) {
    for (const w of this.workers) w.postMessage({ type: 'init', tiles, bin: bin ? bin.slice(0) : null, spill });
  }

  // Komşu 2x2 karolar aynı işçiye gider (ortak z8 batimetri karosu önbellekte kalır)
  pick(z, x, y) {
    const kx = x >> 1;
    const ky = y >> 1;
    const h = (Math.imul(kx, 73856093) ^ Math.imul(ky, 19349663) ^ Math.imul(z + 1, 83492791)) >>> 0;
    return this.workers[h % this.workers.length];
  }

  send(msg, signal) {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      this.pending.set(id, { resolve, reject });
      if (signal) {
        if (signal.aborted) {
          this.pending.delete(id);
          reject(new DOMException('İptal', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          if (this.pending.delete(id)) reject(new DOMException('İptal', 'AbortError'));
        }, { once: true });
      }
      this.pick(msg.z, msg.x, msg.y).postMessage({ ...msg, id });
    });
  }

  done(d) {
    const p = this.pending.get(d.id);
    if (!p) {
      if (d.bitmap) d.bitmap.close();
      return;
    }
    this.pending.delete(d.id);
    if (d.error) p.reject(new Error(d.error));
    else p.resolve(d);
  }

  async sample(lng, lat, z) {
    const n = 2 ** z;
    const s = Math.sin((lat * Math.PI) / 180);
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    const r = await this.send({ type: 'sample', lng, lat, z, x, y });
    return r.result;
  }

  registerProtocol(maplibregl) {
    maplibregl.addProtocol('fdem', async (params, abortController) => {
      const parts = params.url.slice('fdem://'.length).split('/');
      let msg;
      if (parts[0] === '3d') {
        msg = { type: 'tile', product: '3d', level: +parts[1], connected: parts[2] === 'c', z: +parts[3], x: +parts[4], y: +parts[5] };
      } else {
        msg = { type: 'tile', product: parts[0], z: +parts[1], x: +parts[2], y: +parts[3] };
      }
      const res = await this.send(msg, abortController.signal);
      return { data: res.empty ? null : res.bitmap };
    });
  }
}
