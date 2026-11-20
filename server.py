#!/usr/bin/env python3
# Minimaler lokaler Webserver für den STL-Farbeditor (Linux und Windows).
# Feste MIME-Typen: Unter Windows liest Python sie sonst aus der Registry, wo .js
# manchmal als text/plain eingetragen ist – dann laden JavaScript-Module nicht.
import http.server
import os
import sys

TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
    '.md': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.gpx': 'application/gpx+xml',
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        return TYPES.get(os.path.splitext(path)[1].lower()) or super().guess_type(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else int(os.environ.get('PORT', 8765))
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except OSError as e:
        sys.exit(f'Port {port} ist belegt oder nicht verfügbar ({e}). Anderen Port wählen, z. B. PORT=8766.')
    url = f'http://localhost:{port}/index.html'
    print(f'STL-Farbeditor läuft auf {url}  (Beenden mit Strg+C)', flush=True)
    if '--open' in sys.argv:
        import webbrowser
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
