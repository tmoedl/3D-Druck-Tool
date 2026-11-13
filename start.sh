#!/usr/bin/env bash
# Startet den STL-Farbeditor im Browser (lokaler Webserver nötig wegen JS-Modulen).
cd "$(dirname "$0")"
PORT=${PORT:-8765}
URL="http://localhost:$PORT/index.html"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 0.7
echo "STL-Farbeditor läuft auf $URL  (Beenden mit Strg+C)"
(xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1) &
wait $SERVER
