// Önceden hesaplanmış verileri yükler ve istatistik fonksiyonlarını sağlar.
// hyps.bin  : float32 satırlar [TR_küvet, TR_bağlantılı, 81 il küvet, 81 il bağlantılı], her satır land_bins boyunda,
//             değer = rakımı L'den düşük olan kara alanı (km²)
// seas.bin  : her deniz için [alan(e<L) km², hacim(L) km³] satırları, sea_bins boyunca
export async function loadData() {
  const get = (p, kind) => fetch(p).then((r) => {
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return kind === 'json' ? r.json() : r.arrayBuffer();
  });
  const [cities, stats, depr, hyps, seas, bin] = await Promise.all([
    get('data/cities.json', 'json'),
    get('data/stats.json', 'json'),
    get('data/depressions.json', 'json'),
    get('data/hyps.bin', 'bin'),
    get('data/seas.bin', 'bin'),
    get('data/depr_z9.bin', 'bin'),
  ]);
  return { cities, stats, depr, hyps, seas, bin };
}

function makeInterp(bins) {
  const n = bins.length;
  return (row, x) => {
    if (x <= bins[0]) return row[0];
    if (x >= bins[n - 1]) return row[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (bins[m] <= x) lo = m; else hi = m;
    }
    const t = (x - bins[lo]) / (bins[hi] - bins[lo]);
    return row[lo] + (row[hi] - row[lo]) * t;
  };
}

export class Stats {
  constructor({ stats, hyps, seas, depr }) {
    this.meta = stats;
    this.bins = Float64Array.from(stats.land_bins);
    this.nb = this.bins.length;
    this.h = new Float32Array(hyps);
    this.interp = makeInterp(this.bins);
    const [s0, step, count] = stats.sea_bins;
    this.seaBins = Float64Array.from({ length: count }, (_, i) => s0 + i * step);
    this.seaInterp = makeInterp(this.seaBins);
    this.s = new Float32Array(seas);
    this.seaCount = count;
    this.seas = stats.seas.map((m, i) => ({
      ...m,
      areaRow: this.s.subarray((2 * i) * count, (2 * i + 1) * count),
      volRow: this.s.subarray((2 * i + 1) * count, (2 * i + 2) * count),
    }));
    this.basins = depr.basins;
  }

  row(r) { return this.h.subarray(r * this.nb, (r + 1) * this.nb); }

  turkeyLand() { return this.meta.turkey_land_km2; }

  turkeyFlooded(L, connected) {
    if (L <= 0) return 0;
    return this.interp(this.row(connected ? 1 : 0), L);
  }

  provinceLand(plate) { return this.meta.province_land_km2[plate] || 0; }

  provinceFlooded(plate, L, connected) {
    if (L <= 0) return 0;
    return this.interp(this.row(2 + (connected ? 81 : 0) + (plate - 1)), L);
  }

  // L < 0 için deniz durumu: kalan alan/hacim ve açığa çıkan taban
  seaState(L) {
    return this.seas.map((s) => {
      const a0 = s.areaRow[this.seaCount - 1];
      const v0 = s.volRow[this.seaCount - 1];
      const a = L >= 0 ? a0 : this.seaInterp(s.areaRow, L);
      const v = L >= 0 ? v0 : Math.max(0, this.seaInterp(s.volRow, L));
      return { key: s.key, name: s.name, area0: a0, area: a, vol0: v0, vol: v, deepest: s.deepest };
    });
  }
}
