// Türkçe sayı biçimlendirme yardımcıları
const nf = new Map();
function fmt(digits) {
  if (!nf.has(digits)) nf.set(digits, new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: digits }));
  return nf.get(digits);
}

export const MINUS = '−';

export function formatNum(n, digits = 0) {
  const s = fmt(digits).format(Math.abs(n));
  return n < 0 && Math.abs(n) >= 0.5 * 10 ** -digits ? MINUS + s : s;
}

// Deniz seviyesi: "+70 m", "−120 m", "+1,5 m", "0 m"
export function formatLevel(v, compact = false) {
  const a = Math.abs(v);
  if (a < 0.05) return compact ? '0' : '0 m';
  const digits = a < 10 ? 1 : 0;
  const s = fmt(digits).format(a);
  return `${v > 0 ? '+' : MINUS}${s}${compact ? '' : ' m'}`;
}

// Rakım: "1.016 m"
export function formatElev(v) {
  const a = Math.abs(v);
  const s = fmt(a < 10 ? 1 : 0).format(a);
  return `${v < 0 ? MINUS : ''}${s} m`;
}

export function formatArea(km2) {
  if (km2 < 0.05) return '0 km²';
  if (km2 < 10) return `${fmt(1).format(km2)} km²`;
  return `${fmt(0).format(km2)} km²`;
}

export function formatPct(f) {
  const p = f * 100;
  if (p <= 0) return '%0';
  if (p < 0.1) return '<%0,1';
  if (p > 99.95 && p < 100) return '>%99,9';
  return `%${fmt(p < 10 ? 2 : 1).format(p)}`;
}

export function formatPop(n) {
  if (n >= 1e6) return `${fmt(n >= 1e7 ? 1 : 2).format(n / 1e6)} milyon`;
  if (n >= 1e3) return `${fmt(0).format(n / 1e3)} bin`;
  return fmt(0).format(n);
}

export function formatCoord(lat, lng) {
  const la = `${fmt(4).format(Math.abs(lat))}° ${lat >= 0 ? 'K' : 'G'}`;
  const lo = `${fmt(4).format(Math.abs(lng))}° ${lng >= 0 ? 'D' : 'B'}`;
  return `${la}, ${lo}`;
}
