"""Deniz Seviyesi Simülatörü için küçük yerel web sunucusu.

Kullanım: pythonw serve.py [port]
- Sunucu zaten çalışıyorsa yalnızca tarayıcıyı açar.
- 6 saat istek gelmezse kendiliğinden kapanır.
"""
import http.server
import os
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
OPEN_BROWSER = "--no-browser" not in sys.argv
PORT = int(ARGS[0]) if ARGS else 8770
URL = f"http://127.0.0.1:{PORT}/"
IDLE_LIMIT = 6 * 3600
last_hit = time.time()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".bin": "application/octet-stream",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ts": "text/plain; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        global last_hit
        last_hit = time.time()
        super().do_GET()

    def log_message(self, *args):
        pass


def watchdog(server):
    while True:
        time.sleep(300)
        if time.time() - last_hit > IDLE_LIMIT:
            server.shutdown()
            return


def main():
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        if OPEN_BROWSER:
            webbrowser.open(URL)  # büyük olasılıkla zaten çalışıyor
        return
    threading.Thread(target=watchdog, args=(server,), daemon=True).start()
    if OPEN_BROWSER:
        threading.Timer(0.4, lambda: webbrowser.open(URL)).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
