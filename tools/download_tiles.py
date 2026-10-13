"""Terrarium yukseklik karolarini (AWS Terrain Tiles) bolge bazinda indirir.

Kullanim:
  python -I download_tiles.py --out <klasor> --spec 8:18,30,50,48 --spec 9:18,30,50,48 [--log <dosya>]

- Kaldigi yerden devam eder (inmis dosyalari atlar).
- Her karoyu once .part olarak yazar, sonra yeniden adlandirir.
- Ilerlemeyi log dosyasina yazar.
"""
import argparse
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * (2 ** z)


def lat2y(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (2 ** z)


def tiles_for_spec(spec):
    z_str, bbox = spec.split(":")
    z = int(z_str)
    w, s, e, n = (float(v) for v in bbox.split(","))
    x0, x1 = int(math.floor(lon2x(w, z))), int(math.floor(lon2x(e, z) - 1e-9))
    y0, y1 = int(math.floor(lat2y(n, z))), int(math.floor(lat2y(s, z) - 1e-9))
    return [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def fetch(z, x, y, out_dir, retries=6):
    path = os.path.join(out_dir, str(z), f"{x}_{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return "skip", path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    delay = 1.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "Flooder-preprocess/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            return "ok", path
        except Exception as ex:  # noqa: BLE001
            if attempt == retries - 1:
                return f"fail: {ex}", path
            time.sleep(delay)
            delay = min(delay * 2, 30)
    return "fail", path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--spec", action="append", required=True, help="z:west,south,east,north")
    ap.add_argument("--log", default=None)
    ap.add_argument("--threads", type=int, default=16)
    args = ap.parse_args()

    log_f = open(args.log, "a", encoding="utf-8") if args.log else None

    def log(msg):
        line = time.strftime("%H:%M:%S ") + msg
        print(line, flush=True)
        if log_f:
            log_f.write(line + "\n")
            log_f.flush()

    jobs = []
    for spec in args.spec:
        t = tiles_for_spec(spec)
        log(f"spec {spec}: {len(t)} karo")
        jobs.extend(t)
    total = len(jobs)
    done = ok = skip = fail = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.threads) as ex:
        futs = [ex.submit(fetch, z, x, y, args.out) for (z, x, y) in jobs]
        for fu in as_completed(futs):
            status, path = fu.result()
            done += 1
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                fail += 1
                log(f"HATA {path}: {status}")
            if done % 100 == 0 or done == total:
                log(f"{done}/{total} (yeni {ok}, var {skip}, hata {fail}) {time.time() - t0:.0f} sn")
    log(f"BITTI toplam={total} yeni={ok} var={skip} hata={fail}")
    if log_f:
        log_f.close()
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
