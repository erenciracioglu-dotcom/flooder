// Dikey deniz seviyesi göstergesi (kaydırıcı).
// Ölçek simetrik-logaritmiktir: 0 civarında santim, uçlarda yüzlerce metre hassasiyet.
import { formatLevel, formatNum } from './format.js';

export const toT = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v));
export const fromT = (t) => Math.sign(t) * (10 ** Math.abs(t) - 1);

export function snapLevel(v) {
  const a = Math.abs(v);
  const step = a < 2 ? 0.1 : a < 20 ? 0.5 : a < 200 ? 1 : a < 1000 ? 5 : 10;
  return Math.round(v / step) * step;
}

// Klavye adımı: büyüklüğe göre artar; sıfıra doğru giderken küçük bölgenin adımı kullanılır.
export function keyStep(v, dir) {
  const a = Math.abs(v);
  const ref = v * dir >= 0 ? a : Math.max(0, a - 1e-6);
  const step = ref < 2 ? 0.1 : ref < 20 ? 0.5 : ref < 100 ? 1 : ref < 1000 ? 10 : 50;
  return +(Math.round((v + dir * step) / step) * step).toFixed(2);
}

const TICKS = [7000, 5000, 3000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0, -1, -2, -5, -10, -20, -50, -100, -200, -500, -1000, -2000, -3000, -5000];
const MINOR = [4000, 1500, 700, 300, 150, 70, 30, 15, 7, 3, -3, -7, -15, -30, -70, -150, -300, -700, -1500, -4000];

export class Gauge {
  constructor(root, { min, max, value, presets, onInput }) {
    this.root = root;
    this.min = min;
    this.max = max;
    this.tMin = toT(min);
    this.tMax = toT(max);
    this.value = value;
    this.onInput = onInput;
    this.presets = presets || [];
    this.play = null;
    this.tween = null;
    this.build();
    this.layout();
    this.render();
    new ResizeObserver(() => { this.layout(); this.render(); }).observe(this.track);
  }

  build() {
    this.root.innerHTML = `
      <div class="g-title">Deniz seviyesi</div>
      <div class="g-body">
        <div class="g-presets"></div>
        <div class="g-track" tabindex="0" role="slider" aria-label="Deniz seviyesi (metre)"
             aria-valuemin="${this.min}" aria-valuemax="${this.max}">
          <div class="g-sky"></div>
          <div class="g-water"><div class="g-surface"></div></div>
          <div class="g-ticks"></div>
          <div class="g-zero"><span>0</span></div>
          <div class="g-handle"><div class="g-pill"></div></div>
        </div>
      </div>
      <div class="g-play">
        <button type="button" class="g-btn" data-play="-1" title="Deniz seviyesini sürekli alçalt">▼</button>
        <button type="button" class="g-btn" data-play="1" title="Deniz seviyesini sürekli yükselt">▲</button>
      </div>`;
    this.track = this.root.querySelector('.g-track');
    this.water = this.root.querySelector('.g-water');
    this.handle = this.root.querySelector('.g-handle');
    this.pill = this.root.querySelector('.g-pill');
    this.ticksEl = this.root.querySelector('.g-ticks');
    this.zeroEl = this.root.querySelector('.g-zero');
    this.presetsEl = this.root.querySelector('.g-presets');

    const t = this.track;
    t.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.stopAnim();
      t.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.fromPointer(e);
      t.classList.add('dragging');
    });
    t.addEventListener('pointermove', (e) => { if (this.dragging) this.fromPointer(e); });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      t.classList.remove('dragging');
      try { t.releasePointerCapture(e.pointerId); } catch (_) { /* yok */ }
      this.onInput(this.value, 'end');
    };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
    t.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.stopAnim();
      const dt = -Math.sign(e.deltaY) * Math.min(0.06, Math.abs(e.deltaY) * 0.0006 + 0.012);
      this.setT(toT(this.value) + dt, true, 'wheel');
    }, { passive: false });
    t.addEventListener('keydown', (e) => {
      let v = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = keyStep(this.value, 1);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = keyStep(this.value, -1);
      else if (e.key === 'PageUp') v = snapLevel(fromT(toT(this.value) + 0.1));
      else if (e.key === 'PageDown') v = snapLevel(fromT(toT(this.value) - 0.1));
      else if (e.key === 'Home') v = 0;
      if (v === null) return;
      e.preventDefault();
      this.stopAnim();
      this.set(v, true, 'key');
    });
    this.root.querySelectorAll('[data-play]').forEach((b) => {
      b.addEventListener('click', () => this.togglePlay(+b.dataset.play));
    });
  }

  layout() {
    this.h = this.track.clientHeight;
    this.ticksEl.innerHTML = '';
    for (const v of MINOR) {
      const d = document.createElement('div');
      d.className = 'g-tick minor';
      d.style.top = `${this.yOf(v)}px`;
      this.ticksEl.appendChild(d);
    }
    for (const v of TICKS) {
      if (v === 0) continue;
      const d = document.createElement('div');
      d.className = 'g-tick';
      d.style.top = `${this.yOf(v)}px`;
      d.innerHTML = `<span>${v > 0 ? '+' : '−'}${formatNum(Math.abs(v))}</span>`;
      this.ticksEl.appendChild(d);
    }
    this.zeroEl.style.top = `${this.yOf(0)}px`;
    this.layoutPresets();
  }

  layoutPresets() {
    this.presetsEl.innerHTML = '';
    const items = this.presets
      .filter((p) => p.value >= this.min && p.value <= this.max)
      .map((p) => ({ ...p, y: this.yOf(p.value) }))
      .sort((a, b) => a.y - b.y);
    const gap = 19;
    // çakışmaları çöz: aşağı it, sonra alta taşanları yukarı çek
    items.forEach((p, i) => { p.ly = i ? Math.max(p.y, items[i - 1].ly + gap) : p.y; });
    const maxY = this.h - 6;
    for (let i = items.length - 1; i >= 0; i--) {
      const lim = i === items.length - 1 ? maxY : items[i + 1].ly - gap;
      if (items[i].ly > lim) items[i].ly = lim;
    }
    for (const p of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `g-preset${p.value < 0 ? ' neg' : p.value > 0 ? ' pos' : ' zero'}`;
      b.style.top = `${p.ly}px`;
      b.title = p.note ? `${p.label} — ${p.note}` : p.label;
      b.innerHTML = `<span class="lbl">${p.label}</span><span class="val">${formatLevel(p.value, true)}</span>`;
      const lead = document.createElement('i');
      lead.className = 'lead';
      const dy = p.y - p.ly;
      lead.style.transform = `translateY(${dy}px)`;
      b.appendChild(lead);
      b.addEventListener('click', () => this.animateTo(p.value));
      this.presetsEl.appendChild(b);
    }
  }

  yOf(v) {
    const t = toT(Math.max(this.min, Math.min(this.max, v)));
    return ((this.tMax - t) / (this.tMax - this.tMin)) * this.h;
  }

  tOfY(y) {
    return this.tMax - (Math.max(0, Math.min(this.h, y)) / this.h) * (this.tMax - this.tMin);
  }

  fromPointer(e) {
    const r = this.track.getBoundingClientRect();
    this.setT(this.tOfY(e.clientY - r.top), true, 'drag');
  }

  setT(t, emit, source) {
    const tt = Math.max(this.tMin, Math.min(this.tMax, t));
    this.set(source === 'anim' ? fromT(tt) : snapLevel(fromT(tt)), emit, source);
  }

  set(v, emit = false, source = 'api') {
    const nv = Math.max(this.min, Math.min(this.max, v));
    this.value = Math.abs(nv) < 1e-9 ? 0 : nv;
    this.render();
    if (emit) this.onInput(this.value, source);
  }

  render() {
    if (!this.h) return;
    const y = this.yOf(this.value);
    this.handle.style.top = `${y}px`;
    this.water.style.top = `${y}px`;
    this.pill.textContent = formatLevel(this.value);
    // değer etiketiyle çakışan hazır işaretleri soluklaştır
    for (const b of this.presetsEl.children) b.classList.toggle('under', Math.abs(parseFloat(b.style.top) - y) < 15);
    this.track.setAttribute('aria-valuenow', String(+this.value.toFixed(2)));
    this.track.setAttribute('aria-valuetext', formatLevel(this.value));
    this.root.classList.toggle('below', this.value < 0);
  }

  animateTo(target, ms = 900) {
    this.stopAnim();
    const t0 = toT(this.value);
    const t1 = toT(target);
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      if (k >= 1) {
        this.tween = null;
        this.set(target, true, 'end');
        return;
      }
      this.setT(t0 + (t1 - t0) * e, true, 'anim');
      this.tween = requestAnimationFrame(step);
    };
    this.tween = requestAnimationFrame(step);
  }

  togglePlay(dir) {
    if (this.play && this.play.dir === dir) { this.stopAnim(); return; }
    this.stopAnim();
    const rate = 0.32; // onluk/saniye
    let last = performance.now();
    if ((dir > 0 && this.value >= this.max) || (dir < 0 && this.value <= this.min)) this.set(0, true, 'api');
    const btn = this.root.querySelector(`[data-play="${dir}"]`);
    btn.classList.add('on');
    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = toT(this.value) + dir * rate * dt;
      if (t >= this.tMax || t <= this.tMin) {
        this.setT(t, true, 'anim');
        this.stopAnim();
        this.onInput(this.value, 'end');
        return;
      }
      this.setT(t, true, 'anim');
      this.play.raf = requestAnimationFrame(step);
    };
    this.play = { dir, raf: requestAnimationFrame(step), btn };
  }

  stopAnim() {
    if (this.tween) { cancelAnimationFrame(this.tween); this.tween = null; }
    if (this.play) {
      cancelAnimationFrame(this.play.raf);
      this.play.btn.classList.remove('on');
      this.play = null;
      this.onInput(this.value, 'end');
    }
  }
}
