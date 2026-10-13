"""81 il merkezinin yuksekligini harita ile ayni veriden (Terrarium z12) orneklenmis olarak cikarir.

Koordinatlar: Wikidata (il -> baskent, P625); Cankiri, Siirt, Giresun, Bitlis, Canakkale, Izmir (Konak),
K.Maras, Zonguldak tarihi merkeze gore duzeltildi, Bingol eklendi.
Nufus: TUIK ADNKS 2025 (il nufusu), --pop ile verilen JSON.

Kullanim: python -I prep_cities.py --tiles <karo_klasoru> --work <klasor> --pop <pop2025.json> --out <data>/cities.json
"""
import argparse
import json
import math
import os
import urllib.request

import numpy as np
from PIL import Image

# plaka, il, merkez, enlem, boylam, wikidata_rakim
CITIES = [
    (1, "Adana", "Adana", 36.98636, 35.32529, 23), (2, "Adıyaman", "Adıyaman", 37.76339, 38.27714, 683),
    (3, "Afyonkarahisar", "Afyonkarahisar", 38.75806, 30.53861, 1021), (4, "Ağrı", "Ağrı", 39.72250, 43.05444, 1640),
    (5, "Amasya", "Amasya", 40.65000, 35.83333, 405), (6, "Ankara", "Ankara", 39.93576, 32.83869, 938),
    (7, "Antalya", "Antalya", 36.90812, 30.69556, 30), (8, "Artvin", "Artvin", 41.18308, 41.82874, 345),
    (9, "Aydın", "Aydın", 37.84806, 27.84528, 65), (10, "Balıkesir", "Balıkesir", 39.65111, 27.88417, 70),
    (11, "Bilecik", "Bilecik", 40.14306, 29.97917, 850), (12, "Bingöl", "Bingöl", 38.88470, 40.49820, None),
    (13, "Bitlis", "Bitlis", 38.40060, 42.10950, 1500), (14, "Bolu", "Bolu", 40.73333, 31.60000, 733),
    (15, "Burdur", "Burdur", 37.71667, 30.28333, None), (16, "Bursa", "Bursa", 40.19133, 29.08054, 100),
    (17, "Çanakkale", "Çanakkale", 40.14670, 26.40860, 6), (18, "Çankırı", "Çankırı", 40.60130, 33.61340, 730),
    (19, "Çorum", "Çorum", 40.54889, 34.95333, 801), (20, "Denizli", "Denizli", 37.78333, 29.09639, 324),
    (21, "Diyarbakır", "Diyarbakır", 37.91583, 40.21889, 675), (22, "Edirne", "Edirne", 41.67304, 26.57361, 42),
    (23, "Elazığ", "Elazığ", 38.66667, 39.21667, 1067), (24, "Erzincan", "Erzincan", 39.74639, 39.49139, 1185),
    (25, "Erzurum", "Erzurum", 39.90972, 41.27556, 1900), (26, "Eskişehir", "Eskişehir", 39.77667, 30.52056, 788),
    (27, "Gaziantep", "Gaziantep", 37.06278, 37.37917, 850), (28, "Giresun", "Giresun", 40.91500, 38.38800, 10),
    (29, "Gümüşhane", "Gümüşhane", 40.45972, 39.47778, 1227), (30, "Hakkâri", "Hakkâri", 37.57444, 43.74083, 1720),
    (31, "Hatay", "Antakya", 36.20250, 36.16056, 67), (32, "Isparta", "Isparta", 37.76667, 30.55000, 1035),
    (33, "Mersin", "Mersin", 36.80000, 34.61667, 10), (34, "İstanbul", "İstanbul", 41.01000, 28.96028, None),
    (35, "İzmir", "İzmir", 38.41890, 27.12870, 9), (36, "Kars", "Kars", 40.60778, 43.09583, 1768),
    (37, "Kastamonu", "Kastamonu", 41.38333, 33.78333, 774), (38, "Kayseri", "Kayseri", 38.72250, 35.48750, 1050),
    (39, "Kırklareli", "Kırklareli", 41.73472, 27.22528, 203), (40, "Kırşehir", "Kırşehir", 39.14500, 34.16083, 1027),
    (41, "Kocaeli", "İzmit", 40.76540, 29.94080, None), (42, "Konya", "Konya", 37.84705, 32.51610, 1019),
    (43, "Kütahya", "Kütahya", 39.42417, 29.98333, 970), (44, "Malatya", "Malatya", 38.35062, 38.30940, 954),
    (45, "Manisa", "Manisa", 38.61194, 27.42639, 71), (46, "Kahramanmaraş", "Kahramanmaraş", 37.57600, 36.92900, None),
    (47, "Mardin", "Mardin", 37.31306, 40.73500, 1083), (48, "Muğla", "Muğla", 37.21667, 28.36667, 660),
    (49, "Muş", "Muş", 38.73333, 41.49111, 1400), (50, "Nevşehir", "Nevşehir", 38.62500, 34.71222, 1224),
    (51, "Niğde", "Niğde", 37.96667, 34.67917, 1229), (52, "Ordu", "Ordu", 40.98333, 37.88333, 5),
    (53, "Rize", "Rize", 41.02482, 40.51991, 6), (54, "Sakarya", "Adapazarı", 40.77625, 30.40256, 31),
    (55, "Samsun", "Samsun", 41.28667, 36.33000, 20), (56, "Siirt", "Siirt", 37.93000, 41.94500, 895),
    (57, "Sinop", "Sinop", 42.02667, 35.15111, None), (58, "Sivas", "Sivas", 39.75000, 37.01667, 1285),
    (59, "Tekirdağ", "Tekirdağ", 40.98333, 27.51667, 37), (60, "Tokat", "Tokat", 40.30972, 36.55417, 623),
    (61, "Trabzon", "Trabzon", 41.00500, 39.72250, None), (62, "Tunceli", "Tunceli", 39.10611, 39.54806, 940),
    (63, "Şanlıurfa", "Şanlıurfa", 37.15833, 38.79167, 515), (64, "Uşak", "Uşak", 38.68333, 29.40000, 890),
    (65, "Van", "Van", 38.50194, 43.41667, 1730), (66, "Yozgat", "Yozgat", 39.82083, 34.80833, 1406),
    (67, "Zonguldak", "Zonguldak", 41.45350, 31.78940, 60), (68, "Aksaray", "Aksaray", 38.36860, 34.02970, 980),
    (69, "Bayburt", "Bayburt", 40.25464, 40.22600, 1555), (70, "Karaman", "Karaman", 37.18333, 33.21667, 1039),
    (71, "Kırıkkale", "Kırıkkale", 39.84167, 33.51389, 713), (72, "Batman", "Batman", 37.88333, 41.13333, 540),
    (73, "Şırnak", "Şırnak", 37.51639, 42.46111, 1650), (74, "Bartın", "Bartın", 41.63444, 32.33750, None),
    (75, "Ardahan", "Ardahan", 41.11667, 42.70000, 1811), (76, "Iğdır", "Iğdır", 39.92371, 44.04500, 850),
    (77, "Yalova", "Yalova", 40.65556, 29.27500, 30), (78, "Karabük", "Karabük", 41.20000, 32.63333, 354),
    (79, "Kilis", "Kilis", 36.71667, 37.11667, 632), (80, "Osmaniye", "Osmaniye", 37.07500, 36.25000, 125),
    (81, "Düzce", "Düzce", 40.84167, 31.15833, 160),
]
POP_NAME = {"Hakkâri": "Hakkâri"}

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lat, lon, z):
    n = 2 ** z
    r = math.radians(lat)
    return (lon + 180.0) / 360.0 * n, (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n


def load_tile(tile_dir, z, x, y):
    p = os.path.join(tile_dir, str(z), f"{x}_{y}.png")
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "Flooder-preprocess/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(p + ".part", "wb") as f:
            f.write(data)
        os.replace(p + ".part", p)
    a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768


def sample(tile_dir, lat, lon, z=12):
    fx, fy = tile_xy(lat, lon, z)
    x, y = int(fx), int(fy)
    e = load_tile(tile_dir, z, x, y)
    px, py = (fx - x) * 256 - 0.5, (fy - y) * 256 - 0.5
    x0, y0 = max(0, min(254, int(math.floor(px)))), max(0, min(254, int(math.floor(py))))
    tx, ty = min(1, max(0, px - x0)), min(1, max(0, py - y0))
    v = (e[y0, x0] * (1 - tx) * (1 - ty) + e[y0, x0 + 1] * tx * (1 - ty) + e[y0 + 1, x0] * (1 - tx) * ty + e[y0 + 1, x0 + 1] * tx * ty)
    return float(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--pop", required=True)
    ap.add_argument("--data", required=True)
    args = ap.parse_args()
    pop = json.load(open(args.pop, encoding="utf-8"))
    meta = json.load(open(os.path.join(args.work, "meta.json")))
    lab9 = np.load(os.path.join(args.work, "lab9.npy"), mmap_mode="r")
    depr = json.load(open(os.path.join(args.data, "depressions.json"), encoding="utf-8"))
    basins = {b["id"]: b for b in depr["basins"]}
    out = []
    for plate, il, merkez, lat, lon, wd in CITIES:
        e = sample(args.tiles, lat, lon, 12)
        fx, fy = tile_xy(lat, lon, 9)
        px, py = int(fx * 256) - meta["x0"] * 256, int(fy * 256) - meta["y0"] * 256
        lid = int(lab9[py, px])
        rec = {"plate": plate, "il": il, "merkez": merkez, "lat": lat, "lon": lon, "elev": round(e, 1),
               "pop": int(pop[POP_NAME.get(il, il)])}
        if lid:
            rec["basin"] = basins[lid]["key"]
            rec["spill"] = basins[lid]["spill"]
        out.append(rec)
        flag = "" if wd is None or abs(e - wd) < 60 else "  <-- FARK"
        print(f"{plate:2d} {merkez:15s} DEM={e:7.1f} wikidata={wd}{flag}{'  havza=' + basins[lid]['key'] if lid else ''}")
    # Agri Dagi zirvesi (yuksek cozunurlukte en yuksek nokta)
    best = -1e9
    for dlat in np.linspace(-0.02, 0.02, 41):
        for dlon in np.linspace(-0.025, 0.025, 51):
            best = max(best, sample(args.tiles, 39.7019 + dlat, 44.2983 + dlon, 12))
    print("Agri Dagi z12 en yuksek:", round(best, 1))
    json.dump({"cities": out, "agri_max_z12": round(best, 1)}, open(os.path.join(args.data, "cities.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
