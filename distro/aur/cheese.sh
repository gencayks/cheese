#!/bin/sh
# Launch the locally installed Cheese web panel: serve the bundled static
# files on loopback (a secure context, so WebHID works) and open them in the
# default browser. If the port is taken, an earlier instance is already
# serving and the background server exits at once.
set -eu

ROOT=/usr/share/cheese
PORT=${CHEESE_PORT:-8080}

nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
exec xdg-open "http://127.0.0.1:$PORT/"
