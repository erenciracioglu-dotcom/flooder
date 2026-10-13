"""z8 ve z9 terrarium karolarindan birlesik (kara + deniz tabani) z9 mozaigi uretir.

z9+ karolarda bazi denizler 0 m gorunur (EU-DEM kaynakli, batimetri yok).
Bu yuzden: E9 <= 0.5 olan piksellerde min(E9, z8'den buyutulmus deger) kullanilir.

Kullanim:
  python -I prep_mosaic.py --tiles <karo_klasoru> --out <cikis_klasoru>
Cikis: m9.npy (float32), meta.json (bolge bilgisi)
"""
import argparse
import json
import os
import re

import numpy as np
from PIL import Image


def load_mosaic(tile_dir, z):
    d = os.path.join(tile_dir, str(z))
    xs, ys = set(), set()
    for fn in os.listdir(d):
        m = re.fullmatch(r"(\d+)_(\d+)\.png", fn)
        if m:
            xs.add(int(m.group(1)))
            ys.add(int(m.group(2)))
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    mos = np.zeros((h, w), dtype=np.float32)
    missing = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            p = os.path.join(d, f"{x}_{y}.png")
            if not os.path.exists(p):
                missing += 1
                continue
            a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
            e = a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0 - 32768.0
            mos[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = e
    return mos, (x0, y0, x1, y1), missing


def upsample2_bilinear(a):
    """Piksel merkezlerine hizali 2x bilinear buyutme."""
    h, w = a.shape
    # hedef piksel merkezi (i+0.5)/2 - 0.5 kaynak koordinatina karsilik gelir
    yi = (np.arange(2 * h) + 0.5) / 2.0 - 0.5
    xi = (np.arange(2 * w) + 0.5) / 2.0 - 0.5
    y0 = np.clip(np.floor(yi).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xi).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    fy = np.clip(yi - np.floor(yi), 0, 1).astype(np.float32)[:, None]
    fx = np.clip(xi - np.floor(xi), 0, 1).astype(np.float32)[None, :]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    e8, r8, miss8 = load_mosaic(args.tiles, 8)
    e9, r9, miss9 = load_mosaic(args.tiles, 9)
    print("z8", r8, e8.shape, "eksik", miss8, "min/max", e8.min(), e8.max())
    print("z9", r9, e9.shape, "eksik", miss9, "min/max", e9.min(), e9.max())

    # z8'i z9 cozunurlugune buyut ve z9 bolgesine kirp
    up = upsample2_bilinear(e8)
    ox = (r9[0] - 2 * r8[0]) * 256
    oy = (r9[1] - 2 * r8[1]) * 256
    up = up[oy:oy + e9.shape[0], ox:ox + e9.shape[1]]
    assert up.shape == e9.shape, (up.shape, e9.shape)

    sea_like = e9 <= 0.5
    m9 = np.where(sea_like, np.minimum(e9, up), e9).astype(np.float32)
    zero_sea = np.count_nonzero(np.abs(e9) < 0.01)
    print("z9'da |e|<0.01 olan piksel:", zero_sea, "birlesik sonra:", np.count_nonzero(np.abs(m9) < 0.01))

    # z8'de de 0 kalan deniz var mi? (batimetrisi olmayan bolge kontrolu)
    z8zero = np.count_nonzero(np.abs(e8) < 0.01)
    print("z8'de |e|<0.01 olan piksel:", z8zero, "/", e8.size)

    np.save(os.path.join(args.out, "m9.npy"), m9)
    np.save(os.path.join(args.out, "e8.npy"), e8)
    meta = {"z": 9, "x0": r9[0], "y0": r9[1], "x1": r9[2], "y1": r9[3],
            "width": int(e9.shape[1]), "height": int(e9.shape[0]),
            "z8": {"x0": r8[0], "y0": r8[1], "x1": r8[2], "y1": r8[3]}}
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("tamam", meta)


if __name__ == "__main__":
    main()
