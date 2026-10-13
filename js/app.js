// Türkiye Deniz Seviyesi Simülatörü — ana modül
import * as maplibregl from '../vendor/maplibre-gl/maplibre-gl.mjs';
import { DemPool } from './dem-pool.js';
import { loadData, Stats } from './data.js';
import { Gauge, snapLevel } from './gauge.js';
import { waterRamp, groundRamp, waterSwatch, css, FLOOD, SEABED } from './palette.js';
import { formatLevel, formatElev, formatArea, formatPct, formatPop, formatCoord, formatNum } from './format.js';
import { describeLevel, presets } from './scenarios.js';

const MIN = -5000;
const MAX = 7000;
const SETTINGS_KEY = 'flooder.ayarlar.v1';
const $ = (s, el = document) => el.querySelector(s);

const state = {
  level: 0,
  base: 'sat',        // 'sat' | 'phys'
  model: 'conn',      // 'conn' (denize bağlı) | 'bath' (basit)
  highlight: true,
  coast: true,
  hillshade: true,
  labels: true,
  cities: true,
  three: false,
  exag: 1.6,
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    for (const k of Object.keys(state)) if (k !== 'level' && k in s && typeof s[k] === typeof state[k]) state[k] = s[k];
  } catch (_) { /* depolama kapalı olabilir */ }
  const p = new URLSearchParams(location.hash.slice(1));
  const lv = parseFloat(p.get('seviye'));
  if (Number.isFinite(lv)) state.level = Math.max(MIN, Math.min(MAX, lv));
}

function saveSettings() {
  try {
    const { level, ...rest } = state;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  } catch (_) { /* yok say */ }
}

let hashTimer = null;
function updateHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    p.set('seviye', String(+state.level.toFixed(2)));
    const s = p.toString().replace(/%2F/g, '/');
    history.replaceState(null, '', `#${s}`);
  }, 250);
}

// ---------------------------------------------------------------- harita stili
const nameTr = ['coalesce', ['get', 'name:tr'], ['get', 'name:latin'], ['get', 'name']];
const vis = (on) => ({ visibility: on ? 'visible' : 'none' });
const LABEL_LAYERS = ['bnd-country-case', 'bnd-country', 'bnd-state', 'water-names', 'peaks', 'places-city', 'places-town', 'places-village', 'countries'];

function hillPaint() {
  const phys = state.base === 'phys';
  return {
    'hillshade-method': 'multidirectional',
    'hillshade-illumination-anchor': 'map',
    'hillshade-illumination-direction': [315, 250],
    'hillshade-illumination-altitude': [42, 30],
    'hillshade-exaggeration': phys ? 0.6 : 0.42,
    'hillshade-shadow-color': phys ? ['rgba(40,34,30,0.55)', 'rgba(30,40,60,0.35)'] : ['rgba(10,16,28,0.55)', 'rgba(10,16,28,0.3)'],
    'hillshade-highlight-color': ['rgba(255,252,240,0.32)', 'rgba(255,255,255,0.12)'],
    'hillshade-accent-color': 'rgba(0,0,0,0.25)',
  };
}

function cityExpr(L, wet, near, dry) {
  const z = state.model === 'conn' ? ['get', 'v'] : ['get', 'elev'];
  return ['case', ['<', z, L], wet, ['<', z, L + 10], near, dry];
}

function buildStyle(citiesGeo, provinceNames) {
  const L = state.level;
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Uydu: Esri, Maxar, Earthstar Geographics',
      },
      dem: {
        type: 'raster-dem', tiles: ['fdem://dem/{z}/{x}/{y}'], tileSize: 256, maxzoom: 13, encoding: 'terrarium',
        attribution: 'Yükseklik: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a> (SRTM, EU-DEM, GMTED2010, ETOPO1)',
      },
      demc: { type: 'raster-dem', tiles: ['fdem://cond/{z}/{x}/{y}'], tileSize: 256, maxzoom: 13, encoding: 'terrarium' },
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      cities: { type: 'geojson', data: citiesGeo, attribution: 'Nüfus: TÜİK ADNKS 2025' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#2a3640' } },
      { id: 'sat', type: 'raster', source: 'sat', layout: vis(state.base === 'sat'), paint: { 'raster-fade-duration': 200, 'raster-saturation': -0.06, 'raster-contrast': 0.04 } },
      { id: 'ground-sat', type: 'color-relief', source: 'demc', layout: vis(state.base === 'sat'), paint: { 'color-relief-color': groundRamp('sat') } },
      { id: 'ground-phys', type: 'color-relief', source: 'dem', layout: vis(state.base === 'phys'), paint: { 'color-relief-color': groundRamp('phys') } },
      {
        id: 'lakes', type: 'fill', source: 'ofm', 'source-layer': 'water', layout: vis(state.base === 'phys'),
        filter: ['!=', ['get', 'class'], 'ocean'], paint: { 'fill-color': '#4c8dbb' },
      },
      {
        id: 'rivers', type: 'line', source: 'ofm', 'source-layer': 'waterway', minzoom: 6, layout: vis(state.base === 'phys'),
        filter: ['==', ['get', 'class'], 'river'],
        paint: { 'line-color': '#4c8dbb', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 1.2, 14, 2.6] },
      },
      { id: 'hillshade', type: 'hillshade', source: 'dem', layout: vis(state.hillshade), paint: hillPaint() },
      { id: 'water-c', type: 'color-relief', source: 'demc', layout: vis(state.model === 'conn'), paint: { 'color-relief-color': waterRamp(L, state.highlight) } },
      { id: 'water-b', type: 'color-relief', source: 'dem', layout: vis(state.model === 'bath'), paint: { 'color-relief-color': waterRamp(L, state.highlight) } },
      {
        id: 'coast', type: 'line', source: 'ofm', 'source-layer': 'water', layout: { ...vis(state.coast), 'line-join': 'round' },
        filter: ['==', ['get', 'class'], 'ocean'],
        paint: {
          'line-color': '#fff6d5', 'line-opacity': 0.8, 'line-dasharray': [2.5, 2],
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.1, 14, 1.8],
        },
      },
      {
        id: 'bnd-state', type: 'line', source: 'ofm', 'source-layer': 'boundary', minzoom: 6.5, layout: vis(state.labels),
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': 'rgba(255,255,255,0.32)', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.4], 'line-dasharray': [3, 2] },
      },
      {
        id: 'bnd-country-case', type: 'line', source: 'ofm', 'source-layer': 'boundary', layout: vis(state.labels),
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': 'rgba(0,0,0,0.35)', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.2, 10, 4] },
      },
      {
        id: 'bnd-country', type: 'line', source: 'ofm', 'source-layer': 'boundary', layout: vis(state.labels),
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': 'rgba(255,240,220,0.75)', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 10, 1.6], 'line-dasharray': [4, 2] },
      },
      {
        id: 'water-names', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', layout: {
          ...vis(state.labels),
          'text-field': nameTr, 'text-font': ['Noto Sans Italic'], 'text-letter-spacing': 0.12, 'text-max-width': 7,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 8, 15],
        },
        filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        paint: { 'text-color': 'rgba(200,232,255,0.92)', 'text-halo-color': 'rgba(5,20,40,0.75)', 'text-halo-width': 1.2 },
      },
      {
        id: 'peaks', type: 'symbol', source: 'ofm', 'source-layer': 'mountain_peak', minzoom: 8, layout: {
          ...vis(state.labels),
          'icon-image': 'peak', 'icon-size': 0.9, 'text-anchor': 'top', 'text-offset': [0, 0.6],
          'text-field': ['case', ['has', 'ele'], ['concat', nameTr, '\n', ['to-string', ['get', 'ele']], ' m'], nameTr],
          'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8, 'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
        },
        filter: ['all', ['has', 'name'], ['<=', ['coalesce', ['get', 'rank'], 99], 6]],
        paint: { 'text-color': '#f3ead8', 'text-halo-color': 'rgba(20,16,10,0.85)', 'text-halo-width': 1.2 },
      },
      placeLayer('places-village', 'village', 11, 11),
      placeLayer('places-town', 'town', 8, 12),
      placeLayer('places-city', 'city', 6, 13, provinceNames),
      {
        id: 'countries', type: 'symbol', source: 'ofm', 'source-layer': 'place', maxzoom: 8, layout: {
          ...vis(state.labels),
          'text-field': nameTr, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.14,
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 15], 'text-max-width': 7,
        },
        filter: ['==', ['get', 'class'], 'country'],
        paint: { 'text-color': 'rgba(255,245,225,0.85)', 'text-halo-color': 'rgba(10,10,10,0.6)', 'text-halo-width': 1.2 },
      },
      {
        id: 'cities-dot', type: 'circle', source: 'cities', layout: vis(state.cities),
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            4, ['interpolate', ['linear'], ['get', 'pop'], 80000, 2.6, 16000000, 6.5],
            10, ['interpolate', ['linear'], ['get', 'pop'], 80000, 5, 16000000, 10]],
          'circle-color': cityExpr(L, '#38d6ff', '#ffc857', '#ffffff'),
          'circle-stroke-color': 'rgba(6,14,26,0.9)', 'circle-stroke-width': 1.4,
        },
      },
      {
        id: 'cities-label', type: 'symbol', source: 'cities', layout: {
          ...vis(state.cities),
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['linear'], ['get', 'pop'], 80000, 10, 16000000, 13.5], 10, 16],
          'text-anchor': 'top', 'text-offset': [0, 0.75], 'text-padding': 3, 'symbol-sort-key': ['-', 0, ['get', 'pop']],
        },
        paint: {
          'text-color': cityExpr(L, '#9eeaff', '#ffe2a3', '#ffffff'),
          'text-halo-color': 'rgba(6,14,26,0.92)', 'text-halo-width': 1.5,
        },
      },
    ],
  };
}

function placeLayer(id, cls, minzoom, size, exclude) {
  const filter = ['all', ['==', ['get', 'class'], cls]];
  if (exclude) filter.push(['!', ['in', nameTr, ['literal', exclude]]]);
  return {
    id, type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom, layout: {
      ...vis(state.labels),
      'text-field': nameTr, 'text-font': ['Noto Sans Regular'], 'text-size': size, 'text-max-width': 8,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    filter,
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(8,16,28,0.85)', 'text-halo-width': 1.3 },
  };
}

function peakImage() {
  const s = 20;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(s / 2, 3); g.lineTo(s - 3, s - 4); g.lineTo(3, s - 4); g.closePath();
  g.fillStyle = '#f3ead8'; g.strokeStyle = 'rgba(20,16,10,0.9)'; g.lineWidth = 2;
  g.fill(); g.stroke();
  return g.getImageData(0, 0, s, s);
}

// ---------------------------------------------------------------- uygulama
async function main() {
  loadSettings();
  const loading = $('#loading');
  const pool = new DemPool(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2)));
  pool.registerProtocol(maplibregl);

  let data;
  try {
    data = await loadData();
  } catch (err) {
    loading.innerHTML = `<div class="err">Veri dosyaları yüklenemedi (${err.message}).<br>Sayfa bir web sunucusu üzerinden açılmalıdır (yerelde <b>Baslat.bat</b> veya <code>python serve.py</code>); dosyaya çift tıklayarak açmak çalışmaz.</div>`;
    return;
  }
  const basins = data.depr.basins;
  const spill = [0];
  for (const b of basins) spill[b.id] = b.spill;
  pool.init({ tiles: data.depr.tiles, bin: data.bin, spill });
  const stats = new Stats(data);
  const basinByKey = Object.fromEntries(basins.map((b) => [b.key, b]));
  const turkeyMax = stats.meta.turkey_max_m;
  const half = findHalf(stats);

  const cities = data.cities.cities.map((c) => ({ ...c, v: c.spill ? Math.max(c.elev, c.spill) : c.elev }));
  const citiesGeo = {
    type: 'FeatureCollection',
    features: cities.map((c) => ({
      type: 'Feature', id: c.plate, geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { plate: c.plate, name: c.merkez, il: c.il, elev: c.elev, v: c.v, pop: c.pop },
    })),
  };

  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(citiesGeo, cities.map((c) => c.merkez)),
    bounds: [[25.4, 35.6], [45.0, 42.3]],
    fitBoundsOptions: { padding: fitPadding() },
    minZoom: 4,
    maxZoom: 17.5,
    maxBounds: [[17.5, 29.6], [47.8, 48.6]],
    maxPitch: 78,
    hash: 'harita',
    attributionControl: { compact: true },
    fadeDuration: 120,
    canvasContextAttributes: { antialias: true },
  });
  window.__map = map;
  map.addImage('peak', peakImage(), { pixelRatio: 2 });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-right');

  // ------------------------------------------------ seviye göstergesi
  const gauge = new Gauge($('#gauge'), {
    min: MIN, max: MAX, value: state.level, presets: presets({ half }),
    onInput: (v, src) => setLevel(v, src === 'end' ? 'end' : 'gauge'),
  });

  const levelInput = $('#levelInput');
  levelInput.addEventListener('change', () => {
    const v = parseFloat(String(levelInput.value).replace(',', '.'));
    if (Number.isFinite(v)) setLevel(Math.max(MIN, Math.min(MAX, v)), 'input');
  });
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const v = Math.max(MIN, Math.min(MAX, +(state.level + +b.dataset.step).toFixed(2)));
    setLevel(v, 'input');
  }));

  window.addEventListener('hashchange', () => {
    const lv = parseFloat(new URLSearchParams(location.hash.slice(1)).get('seviye'));
    if (Number.isFinite(lv) && Math.abs(lv - state.level) > 1e-6) setLevel(Math.max(MIN, Math.min(MAX, lv)), 'api');
  });

  let raf = null;
  let lastSrc = 'api';
  function setLevel(v, src = 'api') {
    state.level = Math.abs(v) < 1e-9 ? 0 : v;
    lastSrc = src;
    if (src !== 'gauge') gauge.set(state.level);
    if (!raf) raf = requestAnimationFrame(applyLevel);
    schedule3d(src === 'end' || src === 'input' || src === 'api');
    updateHash();
  }

  function applyLevel() {
    raf = null;
    const L = state.level;
    const ramp = waterRamp(L, state.highlight);
    if (map.getLayer('water-c')) {
      map.setPaintProperty(state.model === 'conn' ? 'water-c' : 'water-b', 'color-relief-color', ramp);
      map.setPaintProperty('cities-dot', 'circle-color', cityExpr(L, '#38d6ff', '#ffc857', '#ffffff'));
      map.setPaintProperty('cities-label', 'text-color', cityExpr(L, '#9eeaff', '#ffe2a3', '#ffffff'));
    }
    if (document.activeElement !== levelInput) levelInput.value = String(+L.toFixed(2));
    renderLevel();
    scheduleStats();
    refreshReadout();
  }

  // ------------------------------------------------ seviye kartı + istatistik
  function renderLevel() {
    const L = state.level;
    const card = $('#levelCard');
    card.classList.toggle('neg', L < -0.04);
    card.classList.toggle('pos', L > 0.04);
    $('#levelValue').textContent = formatLevel(L, true);
    const d = describeLevel(L, { turkeyMax });
    $('#scenarioTitle').textContent = d.title;
    $('#scenarioText').textContent = d.text;
  }

  let statsTimer = null;
  function scheduleStats() {
    if (statsTimer) return;
    statsTimer = setTimeout(() => { statsTimer = null; renderStats(); renderCities(); }, lastSrc === 'gauge' || lastSrc === 'anim' ? 90 : 0);
  }

  function renderStats() {
    const L = state.level;
    const conn = state.model === 'conn';
    const el = $('#stats');
    if (L >= 0) {
      const land = stats.turkeyLand();
      const fl = stats.turkeyFlooded(L, conn);
      const frac = Math.min(1, fl / land);
      const wet = cities.filter((c) => (conn ? c.v : c.elev) < L);
      const pop = wet.reduce((s, c) => s + c.pop, 0);
      const top = [];
      for (const c of cities) {
        const a = stats.provinceFlooded(c.plate, L, conn);
        const t = stats.provinceLand(c.plate);
        if (a > 0.05) top.push({ c, f: Math.min(1, a / t), a });
      }
      top.sort((x, y) => y.f - x.f);
      el.innerHTML = `
        <div class="stat">
          <div class="stat-label">Türkiye’de su altında kalan kara</div>
          <div class="stat-value">${formatArea(fl)} <small>${formatPct(frac)}</small></div>
          <div class="bar"><i style="width:${(frac * 100).toFixed(2)}%"></i></div>
        </div>
        <div class="stat-row">
          <div class="stat mini"><div class="stat-label">Su altındaki il merkezi</div><div class="stat-value">${wet.length}<small> / 81</small></div></div>
          <div class="stat mini"><div class="stat-label">Bu illerin nüfusu</div><div class="stat-value">${wet.length ? formatPop(pop) : '—'}</div></div>
        </div>
        ${top.length ? `<div class="stat"><div class="stat-label">Alanının en büyük kısmı su altında kalan iller</div>
          <ol class="toplist">${top.slice(0, 5).map((t) => `<li><button type="button" data-plate="${t.c.plate}"><span>${t.c.il}</span><b>${formatPct(t.f)}</b><i style="width:${(t.f * 100).toFixed(1)}%"></i></button></li>`).join('')}</ol></div>` : ''}
        ${legendHtml(L)}`;
    } else {
      const seas = stats.seaState(L);
      const gained = seas.reduce((s, x) => s + (x.area0 - x.area), 0);
      el.innerHTML = `
        <div class="stat">
          <div class="stat-label">Denizden açığa çıkan kara (harita bölgesi)</div>
          <div class="stat-value">${formatArea(gained)}</div>
        </div>
        <div class="stat"><div class="stat-label">Denizlerde kalan su <span class="hint">(alan · hacim)</span></div>
          <ul class="seas">${seas.map((s) => {
            const fa = s.area0 ? s.area / s.area0 : 0;
            const fv = s.vol0 ? s.vol / s.vol0 : 0;
            return `<li><div class="sea-head"><span>${s.name}</span><b>${formatPct(fa)}</b><em>${formatPct(fv)}</em></div>
              <div class="bar sea"><i style="width:${(fa * 100).toFixed(2)}%"></i><u style="width:${(fv * 100).toFixed(2)}%"></u></div></li>`;
          }).join('')}</ul>
        </div>
        ${legendHtml(L)}`;
    }
    el.querySelectorAll('[data-plate]').forEach((b) => b.addEventListener('click', () => flyToCity(+b.dataset.plate)));
  }

  function legendHtml(L) {
    const grad = [0, 2, 10, 40, 150, 600, 2000, 6000].map((d, i, a) => `${waterSwatch(d)} ${(i / (a.length - 1)) * 100}%`).join(',');
    return `<div class="legend">
      <div class="legend-row"><span class="lg-grad" style="background:linear-gradient(90deg,${grad})"></span></div>
      <div class="legend-scale"><span>0</span><span>10</span><span>150</span><span>2.000</span><span>6.000 m</span></div>
      <div class="legend-keys">
        ${state.highlight && L > 0 ? `<span><i style="background:${css(FLOOD[3][1])}"></i>Bugün kara olan, su basan alan</span>` : ''}
        ${L < 0 ? `<span><i style="background:${css(SEABED[5][1])}"></i>Kuruyan deniz tabanı</span>` : ''}
        ${state.coast ? '<span><i class="dash"></i>Bugünkü kıyı çizgisi</span>' : ''}
      </div></div>`;
  }

  // ------------------------------------------------ il listesi
  const list = $('#cityList');
  const search = $('#citySearch');
  const rows = new Map();
  for (const c of cities) {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="city">
        <span class="plate">${String(c.plate).padStart(2, '0')}</span>
        <span class="nm"><span class="n1">${c.merkez}${c.merkez !== c.il ? ` <em>(${c.il})</em>` : ''}</span><span class="n2">${formatElev(c.elev)} · ${formatPop(c.pop)}</span><span class="pbar"><i></i></span></span>
        <span class="st"></span></button>`;
    li.querySelector('button').addEventListener('click', () => flyToCity(c.plate));
    rows.set(c.plate, li);
    list.appendChild(li);
  }
  search.addEventListener('input', renderCities);

  function renderCities() {
    const L = state.level;
    const conn = state.model === 'conn';
    const q = search.value.trim().toLocaleLowerCase('tr');
    const sorted = [...cities].sort((a, b) => (conn ? a.v : a.elev) - (conn ? b.v : b.elev));
    for (const c of sorted) {
      const li = rows.get(c.plate);
      const z = conn ? c.v : c.elev;
      const wet = z < L;
      const margin = c.elev - L;
      li.hidden = !!q && !(`${c.merkez} ${c.il} ${c.plate}`.toLocaleLowerCase('tr').includes(q));
      li.className = wet ? 'wet' : margin < 10 && L >= 0 ? 'near' : '';
      const st = li.querySelector('.st');
      if (wet) st.innerHTML = `<b>${formatElev(L - c.elev)}</b><small>su altında</small>`;
      else if (conn && c.spill && L > c.elev) st.innerHTML = `<b>kuru</b><small>kapalı havza</small>`;
      else st.innerHTML = `<b>${formatLevel(margin)}</b><small>${margin >= 0 ? 'denizden yüksek' : ''}</small>`;
      const pb = li.querySelector('.pbar');
      if (L > 0) {
        const f = Math.min(1, stats.provinceFlooded(c.plate, L, conn) / Math.max(1, stats.provinceLand(c.plate)));
        pb.firstChild.style.width = `${(f * 100).toFixed(1)}%`;
        pb.title = `İl alanının ${formatPct(f)} kadarı su altında`;
        pb.hidden = f <= 0;
      } else pb.hidden = true;
      list.appendChild(li);
    }
  }

  const pickMarkerEl = document.createElement('div');
  pickMarkerEl.className = 'pick-marker';
  const pickMarker = new maplibregl.Marker({ element: pickMarkerEl });
  function flyToCity(plate) {
    const c = cities.find((x) => x.plate === plate);
    if (!c) return;
    map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 11), speed: 1.4, essential: true });
    pickMarker.setLngLat([c.lon, c.lat]).addTo(map);
    showInfo({ lng: c.lon, lat: c.lat }, c);
  }

  // ------------------------------------------------ imleç bilgisi / tıklama
  const readout = $('#readout');
  let hoverLL = null;
  let sampling = false;
  let lastSample = null;
  function sampleZoom() { return Math.max(3, Math.min(13, Math.round(map.getZoom() + 1))); }
  async function doSample() {
    if (sampling || !hoverLL) return;
    sampling = true;
    const ll = hoverLL;
    try {
      const r = await pool.sample(ll.lng, ll.lat, sampleZoom());
      lastSample = r ? { ...r, ll } : null;
      refreshReadout();
    } catch (_) { /* karo yüklenemedi */ }
    sampling = false;
    if (hoverLL !== ll) doSample();
  }
  map.on('mousemove', (e) => { hoverLL = e.lngLat; doSample(); });
  map.on('mouseout', () => { hoverLL = null; readout.hidden = true; });

  function describePoint(r, L) {
    const conn = state.model === 'conn';
    const decide = conn ? r.v : r.e;
    const wet = decide < L;
    const basin = r.label ? basins[r.label - 1] : null;
    let html = `<span class="r-coord">${formatCoord(r.ll.lat, r.ll.lng)}</span><span>Rakım <b>${formatElev(r.e)}</b></span>`;
    if (wet) html += `<span class="r-wet">Su altında · derinlik <b>${formatElev(L - r.e)}</b></span>`;
    else if (conn && basin && r.e < L) html += `<span class="r-basin">Kuru · kapalı havza (deniz <b>${formatElev(basin.spill)}</b> üstüne çıkınca dolar)</span>`;
    else html += `<span class="r-dry">Deniz seviyesinin <b>${formatElev(r.e - L)}</b> üstünde</span>`;
    return { html, wet, basin };
  }

  function refreshReadout() {
    if (!lastSample || !hoverLL) return;
    readout.innerHTML = describePoint(lastSample, state.level).html;
    readout.hidden = false;
  }

  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', className: 'info-popup' });
  async function showInfo(ll, city) {
    let r = null;
    try { r = await pool.sample(ll.lng, ll.lat, 13); } catch (_) { /* yok */ }
    if (!r) return;
    const d = describePoint({ ...r, ll }, state.level);
    let head = '';
    if (city) head = `<div class="pp-title">${city.merkez}${city.merkez !== city.il ? ` <small>(${city.il})</small>` : ''}</div><div class="pp-sub">İl nüfusu ${formatPop(city.pop)} · il merkezi rakımı ${formatElev(city.elev)}</div>`;
    else head = `<div class="pp-title">Nokta bilgisi</div>`;
    const basinNote = d.basin ? `<div class="pp-note">Bu nokta denize doğal çıkışı olmayan <b>${d.basin.name}</b> içinde. “Gerçekçi” modelde deniz bu havzaya ancak <b>${formatElev(d.basin.spill)}</b> seviyesini aşınca girer.</div>` : '';
    popup.setLngLat(ll).setHTML(`${head}<div class="pp-body">${d.html}</div>${basinNote}`).addTo(map);
  }
  map.on('click', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['cities-dot', 'cities-label'] })[0];
    if (f) {
      const c = cities.find((x) => x.plate === f.properties.plate);
      showInfo({ lng: c.lon, lat: c.lat }, c);
    } else showInfo(e.lngLat, null);
  });
  map.on('mouseenter', 'cities-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'cities-dot', () => { map.getCanvas().style.cursor = ''; });

  // ------------------------------------------------ 3B
  let t3 = null;
  function dem3dUrl() {
    return `fdem://3d/${+state.level.toFixed(2)}/${state.model === 'conn' ? 'c' : 'b'}/{z}/{x}/{y}`;
  }
  function schedule3d(now) {
    if (!state.three) return;
    clearTimeout(t3);
    t3 = setTimeout(() => {
      const src = map.getSource('dem3d');
      if (src) src.setTiles([dem3dUrl()]);
    }, now ? 0 : 350);
  }
  function apply3d(animate = true) {
    if (state.three) {
      if (!map.getSource('dem3d')) {
        map.addSource('dem3d', { type: 'raster-dem', tiles: [dem3dUrl()], tileSize: 256, maxzoom: 12, encoding: 'terrarium' });
      } else map.getSource('dem3d').setTiles([dem3dUrl()]);
      map.setTerrain({ source: 'dem3d', exaggeration: state.exag });
      map.setSky({
        'sky-color': '#6fa3d8', 'horizon-color': '#cfe1f2', 'fog-color': '#d9e6f2',
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
      });
      if (animate && map.getPitch() < 30) map.easeTo({ pitch: 58, duration: 900 });
    } else {
      map.setTerrain(null);
      if (animate && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
    $('#exagRow').hidden = !state.three;
  }

  // ------------------------------------------------ ayarlar
  function setSeg(name, value) {
    document.querySelectorAll(`[data-seg="${name}"] button`).forEach((b) => b.classList.toggle('on', b.dataset.value === value));
  }
  function applyBase() {
    const sat = state.base === 'sat';
    map.setLayoutProperty('sat', 'visibility', sat ? 'visible' : 'none');
    map.setLayoutProperty('ground-sat', 'visibility', sat ? 'visible' : 'none');
    for (const id of ['ground-phys', 'lakes', 'rivers']) map.setLayoutProperty(id, 'visibility', sat ? 'none' : 'visible');
    for (const [k, v] of Object.entries(hillPaint())) map.setPaintProperty('hillshade', k, v);
    setSeg('base', state.base);
  }
  function applyModel() {
    const conn = state.model === 'conn';
    map.setLayoutProperty('water-c', 'visibility', conn ? 'visible' : 'none');
    map.setLayoutProperty('water-b', 'visibility', conn ? 'none' : 'visible');
    setSeg('model', state.model);
    applyLevel();
    schedule3d(true);
  }
  function applyToggles() {
    map.setLayoutProperty('hillshade', 'visibility', state.hillshade ? 'visible' : 'none');
    map.setLayoutProperty('coast', 'visibility', state.coast ? 'visible' : 'none');
    for (const id of LABEL_LAYERS) map.setLayoutProperty(id, 'visibility', state.labels ? 'visible' : 'none');
    for (const id of ['cities-dot', 'cities-label']) map.setLayoutProperty(id, 'visibility', state.cities ? 'visible' : 'none');
    for (const k of ['highlight', 'coast', 'hillshade', 'labels', 'cities', 'three']) {
      const inp = document.querySelector(`[data-toggle="${k}"]`);
      if (inp) inp.checked = state[k];
    }
  }
  document.querySelectorAll('[data-seg]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state[seg.dataset.seg] = b.dataset.value;
      if (seg.dataset.seg === 'base') applyBase(); else applyModel();
      saveSettings();
    });
  });
  document.querySelectorAll('[data-toggle]').forEach((inp) => {
    inp.addEventListener('change', () => {
      state[inp.dataset.toggle] = inp.checked;
      if (inp.dataset.toggle === 'three') apply3d();
      else if (inp.dataset.toggle === 'highlight') applyLevel();
      else applyToggles();
      if (inp.dataset.toggle === 'coast') renderStats();
      saveSettings();
    });
  });
  const exag = $('#exag');
  exag.value = String(state.exag);
  $('#exagVal').textContent = `${formatNum(state.exag, 1)}×`;
  exag.addEventListener('input', () => {
    state.exag = +exag.value;
    $('#exagVal').textContent = `${formatNum(state.exag, 1)}×`;
    if (state.three) map.setTerrain({ source: 'dem3d', exaggeration: state.exag });
    saveSettings();
  });

  // panel daralt/genişlet
  $('#panelToggle').addEventListener('click', () => {
    document.body.classList.toggle('panel-collapsed');
    setTimeout(() => map.resize(), 260);
  });
  $('#aboutBtn').addEventListener('click', () => $('#about').showModal());
  $('#aboutClose').addEventListener('click', () => $('#about').close());

  // klavye: harita odaktayken de ↑/↓ seviye
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, .g-track, dialog')) return;
    if (e.key === '+' || e.key === '=') { setLevel(snapLevel(stepUp(state.level, 1)), 'input'); e.preventDefault(); }
    if (e.key === '-' || e.key === '_') { setLevel(snapLevel(stepUp(state.level, -1)), 'input'); e.preventDefault(); }
  });

  // Yükleme ekranı: stil hazır olunca kısa süre sonra kalkar; karolar arkadan akmaya devam eder.
  let ready = false;
  const hideLoading = () => {
    if (!loading.isConnected || loading.classList.contains('done')) return;
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 600);
  };
  const onReady = () => {
    if (ready) return;
    ready = true;
    applyBase();
    applyToggles();
    setSeg('model', state.model);
    apply3d(false);
    applyLevel();
    setTimeout(hideLoading, 1200);
  };
  map.on('style.load', onReady);
  map.on('load', () => { onReady(); hideLoading(); });
  let errCount = 0;
  map.on('error', (e) => {
    const msg = String((e.error && e.error.message) || '');
    if (/İptal|Abort/i.test(msg)) return;
    errCount++;
    if (errCount === 6) toast('Bazı harita karoları yüklenemedi. İnternet bağlantınızı kontrol edin.');
    console.warn('Harita hatası:', msg);
  });
  renderLevel();
  renderStats();
  renderCities();
}

function stepUp(v, dir) {
  const a = Math.abs(v);
  const step = a < 2 ? 0.1 : a < 20 ? 0.5 : a < 100 ? 1 : a < 1000 ? 10 : 50;
  return v + dir * step;
}

function findHalf(stats) {
  const land = stats.turkeyLand();
  let lo = 0;
  let hi = 5200;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (stats.turkeyFlooded(m, true) < land / 2) lo = m; else hi = m;
  }
  return Math.round(hi / 5) * 5;
}

function fitPadding() {
  const w = window.innerWidth;
  if (w < 760) return { top: 30, bottom: 30, left: 20, right: 90 };
  return { top: 40, bottom: 40, left: 400, right: 230 };
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 6000);
}

main().catch((err) => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.innerHTML = `<div class="err">Beklenmeyen hata: ${err.message}</div>`;
});
