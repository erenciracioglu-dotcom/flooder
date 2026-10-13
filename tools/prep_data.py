"""Uygulamanin veri dosyalarini uretir (kapali havzalar, il/Turkiye hipsometrisi, deniz istatistikleri).

Girdi : <work>/m9.npy + meta.json (prep_mosaic.py ciktisi), il sinirlari (geoBoundaries ADM1 GeoJSON)
Cikti : <out>/depressions.json, <out>/depr_z9.bin, <out>/stats.json, <out>/hyps.bin, <work>/v9.npy, <work>/lab9.npy

Model:
- Deniz (tohum): Akdeniz, Ege, Iyon, Adriyatik, Marmara, Karadeniz, Azak, Basra ve Suveys korfezleriyle bagli
  deniz pikselleri.
- Doldurulmus DEM (F), tohumlardan priority-flood (morfolojik geri catma) ile hesaplanir.
- Yalnizca gercekten kapali oldugu bilinen havzalar (beyaz liste) "baglanti" modelinde korunur.
  Bu cozunurlukte (~230 m) dar kanyonlar ve barajlar sahte cukur uretir; bunlar basit (kuvet) modele birakilir.

Kullanim: python -I prep_data.py --work <klasor> --adm1 <geojson> --out <data_klasoru>
"""
import argparse
import io
import json
import math
import os
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.morphology import reconstruction

SEA_SEEDS = [
    ("Levant", 34.0, 30.0), ("Iyon", 37.0, 19.5), ("Adriyatik", 41.5, 18.6), ("Ege", 39.0, 25.0),
    ("Marmara", 40.75, 28.0), ("Karadeniz", 43.0, 34.0), ("Azak", 46.0, 36.5),
    ("Basra Korfezi", 29.8, 49.0), ("Suveys Korfezi", 29.7, 32.55),
]

# (kimlik, Turkce ad, enlem, boylam) - noktanin bulundugu doldurulmus bolge korunur
BASINS = [
    ("van", "Van Gölü havzası", 38.65, 42.90),
    ("ercek", "Erçek Gölü havzası", 38.65, 43.58),
    ("tuz", "Tuz Gölü havzası", 38.75, 33.40),
    ("konya", "Konya Ovası (Konya Kapalı Havzası)", 37.713, 33.669),
    ("aksehir", "Akşehir–Eber gölleri havzası", 38.622, 31.513),
    ("burdur", "Burdur Gölü havzası", 37.73, 30.18),
    ("acigol", "Acıgöl havzası", 37.80, 29.88),
    ("salda", "Salda Gölü havzası", 37.55, 29.68),
    ("seyfe", "Seyfe Gölü havzası", 39.227, 34.400),
    ("sultansazligi", "Sultan Sazlığı havzası", 38.35, 35.25),
    ("elmali", "Elmalı Ovası (karstik kapalı havza)", 36.725, 29.810),
    ("nemrut", "Nemrut Krater Gölü", 38.62, 42.23),
    ("hazar", "Hazar Denizi ve Hazar Çöküntüsü", 42.0, 50.0),
    ("oludeniz", "Lut Gölü (Ölü Deniz) – Şeria Vadisi", 31.5, 35.5),
    ("urmiye", "Urmiye Gölü havzası", 37.7, 45.4),
    ("cebbul", "Cebbul Gölü havzası (Suriye)", 36.05, 37.5),
    ("ezrak", "Ezrak havzası (Ürdün)", 31.83, 36.82),
    ("sam", "Şam havzası (Suriye)", 33.38, 36.57),
    ("kattara", "Kattara Çöküntüsü (Mısır)", 29.8, 27.2),
]

# Denizler (L < 0 istatistikleri). Bogazlar bariyerle kesilir.
BARRIERS = [  # (bati, guney, dogu, kuzey)
    (28.95, 41.00, 29.15, 41.25),   # Istanbul Bogazi
    (26.15, 40.00, 26.75, 40.45),   # Canakkale Bogazi
    (36.10, 44.85, 37.90, 45.60),   # Kerc Bogazi + Taman yarimadasi limanlari
]
SEAS = [("karadeniz", "Karadeniz", 43.0, 34.0), ("azak", "Azak Denizi", 46.0, 36.5),
        ("marmara", "Marmara Denizi", 40.75, 28.0), ("akdeniz", "Akdeniz", 34.0, 30.0)]
AEGEAN_POLY = [(21.9, 41.3), (27.3, 41.3), (28.5, 37.2), (28.2, 36.65), (27.85, 36.2), (27.75, 35.85),
               (27.25, 35.4), (26.3, 35.25), (24.0, 35.45), (23.5, 35.55), (22.95, 36.25), (23.2, 36.45),
               (22.4, 36.6)]

# Hipsometri esikleri (m) - kara icin
LAND_BINS = np.concatenate([np.arange(0, 20, 0.25), np.arange(20, 100, 1.0), np.arange(100, 500, 5.0),
                            np.arange(500, 2000, 10.0), np.arange(2000, 5725, 25.0)]).astype(np.float64)
SEA_BINS = np.arange(-5300.0, 0.0 + 1e-9, 5.0)


class Grid:
    def __init__(self, meta):
        self.z = meta["z"]; self.x0 = meta["x0"]; self.y0 = meta["y0"]
        self.w = meta["width"]; self.h = meta["height"]
        self.n = 2 ** self.z * 256

    def ll2px(self, lat, lon):
        gx = (lon + 180.0) / 360.0 * self.n
        r = math.radians(lat)
        gy = (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * self.n
        return gx - self.x0 * 256, gy - self.y0 * 256

    def px2ll(self, px, py):
        gx = self.x0 * 256 + px + 0.5
        gy = self.y0 * 256 + py + 0.5
        lon = gx / self.n * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / self.n))))
        return lat, lon

    def row_area(self):
        gy = self.y0 * 256 + np.arange(self.h) + 0.5
        lat = np.arctan(np.sinh(np.pi * (1 - 2 * gy / self.n)))
        s = 40075016.686 * np.cos(lat) / self.n
        return s * s / 1e6


def despike(a):
    p = np.pad(a, 1, mode="edge")
    h, w = a.shape
    st = np.stack([p[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3) if not (dy == 1 and dx == 1)], 0)
    bad = np.all(a[None] - st > 800, 0) | np.all(st - a[None] > 800, 0)
    med = np.median(st, 0)
    a = np.where(bad, med, a).astype(np.float32)
    del st, med
    med5 = ndimage.median_filter(a, size=5)
    bad5 = np.abs(a - med5) > 1000
    a = np.where(bad5, med5, a).astype(np.float32)
    return a, int(bad.sum()), int(bad5.sum())


def rasterize(grid, polys_by_id, shape):
    img = Image.new("L", (shape[1], shape[0]), 0)
    dr = ImageDraw.Draw(img)
    for pid, geom in polys_by_id:
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            for ri, ring in enumerate(poly):
                pts = [grid.ll2px(lat, lon) for lon, lat in ring]
                dr.polygon(pts, fill=(pid if ri == 0 else 0))
    return np.asarray(img)


def compute_seas(g, m9, out_dir):
    st8 = np.ones((3, 3), bool)
    area_row = g.row_area()
    area_px = np.broadcast_to(area_row[:, None], m9.shape)
    sea = m9 < 0
    for (w_, s_, e_, n_) in BARRIERS:
        x0, y1 = g.ll2px(s_, w_)
        x1, y0 = g.ll2px(n_, e_)
        sea[int(y0):int(y1) + 1, int(x0):int(x1) + 1] = False
    slab, _ = ndimage.label(sea, structure=st8)
    img = Image.new("L", (g.w, g.h), 0)
    ImageDraw.Draw(img).polygon([g.ll2px(lat, lon) for lon, lat in AEGEAN_POLY], fill=1)
    aeg = np.asarray(img).astype(bool)
    seas_out = []
    sedges = np.concatenate([SEA_BINS, [1e9]])
    sea_rows = []
    for key, name, lat, lon in SEAS:
        x, y = (int(v) for v in g.ll2px(lat, lon))
        lid = int(slab[y, x])
        m = slab == lid
        groups = [(key, name, m & ~aeg)] if key != "akdeniz" else [("ege", "Ege Denizi", m & aeg), ("akdeniz", "Akdeniz (harita bölgesi)", m & ~aeg)]
        for k2, n2, mm in groups:
            e = m9[mm].astype(np.float64)
            a = area_px[mm]
            h_a, _ = np.histogram(e, bins=sedges, weights=a)
            h_ae, _ = np.histogram(e, bins=sedges, weights=a * e)
            below = np.count_nonzero(e < SEA_BINS[0])
            ca = np.concatenate([[0.0], np.cumsum(h_a)[:-1]])          # e < L_k alan
            cae = np.concatenate([[0.0], np.cumsum(h_ae)[:-1]])
            if below:
                print(f"  UYARI {n2}: {below} piksel {SEA_BINS[0]} altinda")
            vol = SEA_BINS * ca - cae  # km2*m -> /1000 km3
            sea_rows.append(ca)
            sea_rows.append(vol / 1000.0)
            dmin = float(e.min())
            seas_out.append({"key": k2, "name": n2, "area": round(float(a.sum()), 0), "volume_km3": round(float(-(a * e).sum() / 1000.0), 0),
                             "deepest": round(dmin, 0)})
            iy, ix = np.unravel_index(np.argmin(np.where(mm, m9, 1e9)), m9.shape)
            la, lo = g.px2ll(ix, iy)
            seas_out[-1]["deepest_at"] = [round(lo, 3), round(la, 3)]
            print(f"  {n2:28s} alan={a.sum():9.0f} km2 hacim={-(a * e).sum() / 1000:10.0f} km3 en derin={dmin:8.1f} @({la:.2f},{lo:.2f})", flush=True)
    np.array(sea_rows, np.float32).tofile(os.path.join(out_dir, "seas.bin"))

    return seas_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--adm1", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seas-only", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    meta = json.load(open(os.path.join(args.work, "meta.json")))
    g = Grid(meta)
    if args.seas_only:
        m9 = np.load(os.path.join(args.work, "m9f.npy"))
        stats = json.load(open(os.path.join(args.out, "stats.json"), encoding="utf-8"))
        stats["seas"] = compute_seas(g, m9, args.out)
        json.dump(stats, open(os.path.join(args.out, "stats.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        return

    m9 = np.load(os.path.join(args.work, "m9.npy"))
    m9 = np.where(m9 <= 0.5, np.minimum(m9, -0.5), m9).astype(np.float32)  # deniz yuzeyi adaylari <= -0.5
    m9, n1, n5 = despike(m9)
    print(f"sivri piksel: {n1} + {n5}  ({time.time() - t0:.0f} sn)", flush=True)
    np.save(os.path.join(args.work, "m9f.npy"), m9)

    # --- deniz tohumlari
    st8 = np.ones((3, 3), bool)
    lab, _ = ndimage.label(m9 < 0, structure=st8)
    ids = set()
    for name, lat, lon in SEA_SEEDS:
        x, y = (int(v) for v in g.ll2px(lat, lon))
        lid = int(lab[y, x])
        print(f"  tohum {name}: e={m9[y, x]:.1f} bilesen={lid}", flush=True)
        if lid:
            ids.add(lid)
    seed = np.isin(lab, list(ids))
    del lab

    # --- doldurma
    marker = np.where(seed, m9, float(m9.max()) + 1.0).astype(np.float64)
    f = reconstruction(marker, m9.astype(np.float64), method="erosion").astype(np.float32)
    del marker
    print(f"doldurma tamam ({time.time() - t0:.0f} sn)", flush=True)

    dep = (f - m9) > 0.01
    dlab, nd = ndimage.label(dep, structure=st8)
    del dep
    keep = []
    for key, name, lat, lon in BASINS:
        x, y = (int(v) for v in g.ll2px(lat, lon))
        lid = int(dlab[y, x]) if (0 <= x < g.w and 0 <= y < g.h) else 0
        if lid == 0:
            print(f"  UYARI havza bulunamadi: {name}")
            continue
        if any(k[0] == lid for k in keep):
            print(f"  {name}: zaten listede ({lid})")
            continue
        keep.append((lid, key, name))
    lab9 = np.zeros(m9.shape, np.uint16)
    area_row = g.row_area()
    basins_out = []
    for newid, (lid, key, name) in enumerate(keep, start=1):
        sl = ndimage.find_objects((dlab == lid).astype(np.uint8))[0]
        sub = dlab[sl] == lid
        spill = float(f[sl][sub].max())
        low = float(m9[sl][sub].min())
        area = float((sub * area_row[sl[0]][:, None]).sum())
        lab9[sl][sub] = newid
        lat_n, lon_w = g.px2ll(sl[1].start, sl[0].start)
        lat_s, lon_e = g.px2ll(sl[1].stop - 1, sl[0].stop - 1)
        basins_out.append({"id": newid, "key": key, "name": name, "spill": round(spill, 1), "low": round(low, 1),
                           "area": round(area, 1), "bbox": [round(lon_w, 3), round(lat_s, 3), round(lon_e, 3), round(lat_n, 3)]})
        print(f"  #{newid:2d} {name:42s} tasma={spill:8.1f} dip={low:8.1f} alan={area:9.1f} km2", flush=True)
    del dlab, f
    spill_arr = np.zeros(len(keep) + 1, np.float32)
    for b in basins_out:
        spill_arr[b["id"]] = b["spill"]

    # 1 piksel genislet (kenar uyumsuzluklarina karsi), mevcut etiketlerin uzerine yazmadan
    dil = ndimage.grey_dilation(lab9, footprint=st8)
    lab9 = np.where(lab9 == 0, dil, lab9).astype(np.uint16)
    del dil
    v9 = np.where(lab9 > 0, np.maximum(m9, spill_arr[lab9]), m9).astype(np.float32)
    np.save(os.path.join(args.work, "lab9.npy"), lab9)
    np.save(os.path.join(args.work, "v9.npy"), v9)

    # --- etiket karolari (z9, sadece dolu olanlar) + paket
    blob = io.BytesIO()
    index = {}
    for ty in range(g.h // 256):
        for tx in range(g.w // 256):
            blk = lab9[ty * 256:(ty + 1) * 256, tx * 256:(tx + 1) * 256]
            if not blk.any():
                continue
            rgb = np.zeros((256, 256, 3), np.uint8)
            rgb[:, :, 0] = blk >> 8
            rgb[:, :, 1] = blk & 255
            bio = io.BytesIO()
            Image.fromarray(rgb, "RGB").save(bio, format="PNG", optimize=True)
            data = bio.getvalue()
            index[f"{g.x0 + tx}_{g.y0 + ty}"] = [blob.tell(), len(data)]
            blob.write(data)
    with open(os.path.join(args.out, "depr_z9.bin"), "wb") as fo:
        fo.write(blob.getvalue())
    json.dump({"z": 9, "basins": basins_out, "tiles": index}, open(os.path.join(args.out, "depressions.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"etiket karosu: {len(index)}  paket {blob.tell() / 1024:.0f} KB  ({time.time() - t0:.0f} sn)", flush=True)

    # --- il rasteri
    gj = json.load(open(args.adm1, encoding="utf-8"))
    provs = []
    for ft in gj["features"]:
        plate = int(ft["properties"]["shapeISO"].split("-")[1])
        provs.append((plate, ft["properties"]["shapeName"], ft["geometry"]))
    prov = rasterize(g, [(p, geom) for p, _, geom in provs], m9.shape)
    land = m9 > 0.5
    area_px = np.broadcast_to(area_row[:, None], m9.shape)
    sel = (prov > 0) & land
    pid = prov[sel].astype(np.float64)
    ar = area_px[sel]
    eb = m9[sel].astype(np.float64)
    ec = v9[sel].astype(np.float64)
    edges = np.concatenate([LAND_BINS, [1e9]])
    pbins = np.arange(0.5, 82.5, 1.0)
    hb, _, _ = np.histogram2d(pid, eb, bins=[pbins, edges], weights=ar)
    hc, _, _ = np.histogram2d(pid, ec, bins=[pbins, edges], weights=ar)
    # A(L_k) = elev < L_k olan alan; L_0 = 0 -> 0
    cum_b = np.concatenate([np.zeros((81, 1)), np.cumsum(hb, 1)[:, :-1]], 1)
    cum_c = np.concatenate([np.zeros((81, 1)), np.cumsum(hc, 1)[:, :-1]], 1)
    tot = hb.sum(1)
    tr_b = cum_b.sum(0, keepdims=True)
    tr_c = cum_c.sum(0, keepdims=True)
    hyps = np.concatenate([tr_b, tr_c, cum_b, cum_c], 0).astype(np.float32)  # satirlar: TR_b, TR_c, 81 il b, 81 il c
    hyps.tofile(os.path.join(args.out, "hyps.bin"))
    prov_land = {int(p): round(float(tot[p - 1]), 1) for p, _, _ in provs}
    prov_max = {}
    prov_maxv = ndimage.maximum(m9, prov, index=np.arange(1, 82))
    for p in range(1, 82):
        prov_max[p] = round(float(prov_maxv[p - 1]), 1)
    print(f"Turkiye kara alani (model): {tot.sum():.0f} km2  ({time.time() - t0:.0f} sn)", flush=True)

    seas_out = compute_seas(g, m9, args.out)

    stats = {
        "land_bins": [round(float(v), 2) for v in LAND_BINS],
        "sea_bins": [float(SEA_BINS[0]), 5.0, int(len(SEA_BINS))],
        "hyps_layout": "rows: TR_bathtub, TR_connected, 81x province_bathtub (plaka 1..81), 81x province_connected; float32 km2 cumulative area with elevation < L",
        "province_land_km2": prov_land,
        "province_max_m": prov_max,
        "turkey_land_km2": round(float(tot.sum()), 1),
        "turkey_max_m": round(float(m9[prov > 0].max()), 1),
        "seas": seas_out,
        "seas_layout": "for each sea: row area_km2(e<L), row volume_km3(L) over sea_bins",
        "grid": meta,
    }
    json.dump(stats, open(os.path.join(args.out, "stats.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"bitti ({time.time() - t0:.0f} sn)", flush=True)


if __name__ == "__main__":
    main()
