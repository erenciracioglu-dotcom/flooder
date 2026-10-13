"""Denize bagli olmayan kapali cukurlari (endoreik havzalar) bulur.

Yontem: deniz bilesenlerinden (Akdeniz, Ege, Marmara, Karadeniz, Azak) baslayan
priority-flood / morfolojik geri catma (erosion) ile doldurulmus DEM (F) hesaplanir.
F(c) = c hucresine denizden ulasan en iyi yol uzerindeki en yuksek rakim.
Yani deniz seviyesi L > F(c) olunca c hucresi denizle baglanir (su basar).
D = F - E > 0 olan bolgeler kapali cukurlardir; her cukurun F'si (tasma seviyesi) sabittir.

Kullanim:
  python -I prep_depressions.py --work <klasor>
Girdi: m9.npy, meta.json   Cikti: m9c.npy (temizlenmis), f9.npy, dlab.npy, depressions_raw.json
"""
import argparse
import json
import math
import os
import time

import numpy as np
from scipy import ndimage
from skimage.morphology import reconstruction

SEA_SEEDS = [  # (ad, enlem, boylam)
    ("Levant", 34.0, 30.0),
    ("Iyon", 37.0, 19.5),
    ("Adriyatik", 41.5, 18.6),
    ("Ege", 39.0, 25.0),
    ("Marmara", 40.75, 28.0),
    ("Karadeniz", 43.0, 34.0),
    ("Azak", 46.0, 36.5),
]


def ll2px(lat, lon, meta):
    n = 2 ** meta["z"]
    gx = (lon + 180.0) / 360.0 * n * 256
    r = math.radians(lat)
    gy = (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n * 256
    return int(gx - meta["x0"] * 256), int(gy - meta["y0"] * 256)


def px2ll(px, py, meta):
    n = 2 ** meta["z"]
    gx = meta["x0"] * 256 + px + 0.5
    gy = meta["y0"] * 256 + py + 0.5
    lon = gx / (256 * n) * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / (256 * n)))))
    return lat, lon


def row_area_km2(meta):
    """Her satir icin piksel alani (km2), Web Mercator."""
    n = 2 ** meta["z"]
    gy = meta["y0"] * 256 + np.arange(meta["height"]) + 0.5
    lat = np.arctan(np.sinh(np.pi * (1 - 2 * gy / (256 * n))))
    s = 40075016.686 * np.cos(lat) / (256 * n)
    return (s * s / 1e6).astype(np.float64)


def despike(a, thr=800.0):
    """8 komsusunun hepsinden thr'den fazla farkli tek piksellik sivri degerleri duzeltir."""
    p = np.pad(a, 1, mode="edge")
    h, w = a.shape
    neigh = [p[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3) if not (dy == 1 and dx == 1)]
    st = np.stack(neigh, 0)
    hi = np.all(a[None] - st > thr, axis=0)
    lo = np.all(st - a[None] > thr, axis=0)
    bad = hi | lo
    med = np.median(st, axis=0)
    out = a.copy()
    out[bad] = med[bad]
    return out, int(bad.sum()), np.argwhere(bad)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    args = ap.parse_args()
    t0 = time.time()
    meta = json.load(open(os.path.join(args.work, "meta.json")))
    m9 = np.load(os.path.join(args.work, "m9.npy"))
    m9, nbad, badpos = despike(m9)
    print(f"sivri piksel duzeltildi: {nbad}", [tuple(round(v, 3) for v in px2ll(x, y, meta)) for y, x in badpos[:10]])
    np.save(os.path.join(args.work, "m9c.npy"), m9)

    sea = m9 < 0.0
    lab, nlab = ndimage.label(sea, structure=np.ones((3, 3), bool))
    seed_ids = set()
    for name, lat, lon in SEA_SEEDS:
        x, y = ll2px(lat, lon, meta)
        lid = int(lab[y, x])
        print(f"tohum {name}: px=({x},{y}) e={m9[y, x]:.1f} bilesen={lid}")
        if lid:
            seed_ids.add(lid)
    seed = np.isin(lab, list(seed_ids))
    del lab
    print(f"deniz tohum pikseli: {int(seed.sum())}  ({time.time() - t0:.0f} sn)")

    top = float(m9.max()) + 1.0
    marker = np.where(seed, m9, top).astype(np.float64)
    f = reconstruction(marker, m9.astype(np.float64), method="erosion").astype(np.float32)
    del marker
    print(f"doldurma tamam ({time.time() - t0:.0f} sn)")
    np.save(os.path.join(args.work, "f9.npy"), f)

    d = f - m9
    dep = d > 0.01
    dlab, nd = ndimage.label(dep, structure=np.ones((3, 3), bool))
    print(f"cukur bileseni: {nd}  ({time.time() - t0:.0f} sn)")
    area_row = row_area_km2(meta)
    area_px = np.broadcast_to(area_row[:, None], m9.shape)
    idx = np.arange(1, nd + 1)
    cnt = ndimage.sum(dep, dlab, idx)
    area = ndimage.sum(area_px, dlab, idx)
    maxd = ndimage.maximum(d, dlab, idx)
    spill_max = ndimage.maximum(f, dlab, idx)
    spill_min = ndimage.minimum(f, dlab, idx)
    low = ndimage.minimum(m9, dlab, idx)
    lowpos = ndimage.minimum_position(m9, dlab, idx)
    objs = ndimage.find_objects(dlab)
    recs = []
    for i in range(nd):
        ly, lx = lowpos[i]
        lat, lon = px2ll(lx, ly, meta)
        s = objs[i]
        n_lat, w_lon = px2ll(s[1].start, s[0].start, meta)
        s_lat, e_lon = px2ll(s[1].stop - 1, s[0].stop - 1, meta)
        recs.append({
            "id": i + 1, "px": int(cnt[i]), "area": round(float(area[i]), 3), "maxd": round(float(maxd[i]), 2),
            "spill": round(float(spill_max[i]), 2), "spill_min": round(float(spill_min[i]), 2),
            "low": round(float(low[i]), 2), "low_lat": round(lat, 4), "low_lon": round(lon, 4),
            "bbox": [round(w_lon, 4), round(s_lat, 4), round(e_lon, 4), round(n_lat, 4)],
        })
    np.save(os.path.join(args.work, "dlab.npy"), dlab.astype(np.int32))
    with open(os.path.join(args.work, "depressions_raw.json"), "w") as fo:
        json.dump(recs, fo)
    recs.sort(key=lambda r: -r["area"])
    print("en buyuk 40 cukur (alan):")
    for r in recs[:40]:
        print(f"  #{r['id']:7d} alan={r['area']:9.1f} km2 maxD={r['maxd']:7.1f} spill={r['spill']:8.1f} (min {r['spill_min']:8.1f}) dip={r['low']:8.1f} @({r['low_lat']},{r['low_lon']})")
    big = [r for r in recs if r["area"] >= 1.0]
    print(f"alan>=1 km2: {len(big)}  alan>=5: {sum(1 for r in recs if r['area'] >= 5)}  maxD>=10&alan>=1: {sum(1 for r in big if r['maxd'] >= 10)}")
    print(f"toplam sure {time.time() - t0:.0f} sn")


if __name__ == "__main__":
    main()
