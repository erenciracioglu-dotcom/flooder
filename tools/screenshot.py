"""Geliştirme aracı: başsız Chrome + CDP ile uygulamanın ekran görüntüsünü alır (harita boşa düşene kadar bekler).
Gerekenler: Google Chrome, pip install websocket-client. Sunucu çalışıyor olmalı (serve.py).

Kullanım: python shot.py <cikti.png> <url> [js_adim ...] [--size 1707x1000] [--dpr 1]
Her js_adim sayfada çalıştırılır (await desteklenir), ardından harita 'idle' beklenir.
"""
import base64
import json
import os
import subprocess
import tempfile
import sys
import time
import urllib.request

import websocket

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333
PROFILE = os.path.join(tempfile.gettempdir(), "flooder-chrome-prof")

WAIT_IDLE = """
(async () => {
  const t0 = performance.now();
  while (!(window.__map && window.__map.isStyleLoaded && window.__map.isStyleLoaded())) {
    if (performance.now() - t0 > 30000) return 'timeout-style';
    await new Promise(r => setTimeout(r, 100));
  }
  const m = window.__map;
  await new Promise(r => setTimeout(r, 300));
  const ok = await Promise.race([
    new Promise(r => { if (m.loaded() && !m.isMoving()) { m.triggerRepaint(); m.once('idle', () => r('idle')); } else m.once('idle', () => r('idle')); }),
    new Promise(r => setTimeout(() => r('timeout-idle'), 40000)),
  ]);
  await new Promise(r => setTimeout(r, 400));
  return ok;
})()
"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = {a.split("=")[0]: (a.split("=")[1] if "=" in a else True) for a in sys.argv[1:] if a.startswith("--")}
    out, url, steps = args[0], args[1], args[2:]
    w, h = (int(v) for v in str(opts.get("--size", "1707x1000")).split("x"))
    dpr = float(opts.get("--dpr", 1))
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}",
                             "--hide-scrollbars", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", f"--window-size={w},{h}", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=1))
                page = next(t for t in tabs if t.get("type") == "page")
                break
            except Exception:
                time.sleep(0.1)
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=120, suppress_origin=True)
        seq = [0]

        def call(method, **params):
            seq[0] += 1
            mid = seq[0]
            ws.send(json.dumps({"id": mid, "method": method, "params": params}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == mid:
                    if "error" in msg:
                        raise RuntimeError(f"{method}: {msg['error']}")
                    return msg.get("result", {})

        def ev(expr):
            r = call("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True, timeout=90000)
            if "exceptionDetails" in r:
                return "EXC: " + json.dumps(r["exceptionDetails"])[:400]
            return r.get("result", {}).get("value")

        call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=dpr, mobile=False)
        call("Page.enable")
        call("Runtime.enable")
        call("Page.navigate", url=url)
        time.sleep(1.0)
        print("yukleme:", ev(WAIT_IDLE))
        for st in steps:
            print("adim:", ev(f"(async () => {{ {st} }})()"))
            print("bekle:", ev(WAIT_IDLE))
        logs = ev("JSON.stringify(window.__errors || [])")
        if logs and logs != "[]":
            print("hatalar:", logs)
        shot = call("Page.captureScreenshot", format="png")
        with open(out, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print("kaydedildi:", out)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
