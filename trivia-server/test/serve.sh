#!/usr/bin/env bash
# Start/stop the local stack: Worker on :8787, static client on :8000.
#
#   bash test/serve.sh start|stop|restart|status
#
# The restart is the point of this script. `wrangler dev` supervises its own
# workerd child and RESTARTS it when it dies, so killing workerd alone frees the
# port for about a second and then loses it again. The parent has to go first,
# and the port has to be observed free before starting a new one — otherwise the
# new instance dies on "Address already in use" and you are left debugging a
# server that silently is not running.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$SERVER_DIR/.." && pwd)"
LOG="${LS_OUT:-/tmp/late-signal}"
mkdir -p "$LOG"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
hash -r

port_busy() { (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$1 "; }

stop() {
  # Parents before children, or the supervisor just respawns them.
  for pat in "wrangler-dist/cli.js dev" "bin/wrangler dev"; do
    for p in $(pgrep -f "$pat" 2>/dev/null); do kill "$p" 2>/dev/null; done
  done
  sleep 1
  for p in $(pgrep -x workerd 2>/dev/null); do kill "$p" 2>/dev/null; done
  for p in $(pgrep -f "http.server 8000" 2>/dev/null); do kill "$p" 2>/dev/null; done
  sleep 1
  for p in $(pgrep -x workerd 2>/dev/null); do kill -9 "$p" 2>/dev/null; done

  for _ in $(seq 1 20); do
    port_busy 8787 || break
    sleep 1
  done
  if port_busy 8787; then
    echo "stop: 8787 still bound" >&2
    return 1
  fi
  echo "stopped"
}

start() {
  if port_busy 8787; then
    echo "start: 8787 already bound — run 'stop' first" >&2
    return 1
  fi
  ( cd "$SERVER_DIR" && setsid nohup npx wrangler dev --port 8787 --local \
      > "$LOG/wrangler.log" 2>&1 < /dev/null & )
  if ! port_busy 8000; then
    ( cd "$ROOT" && setsid nohup python3 -m http.server 8000 \
        > "$LOG/httpd.log" 2>&1 < /dev/null & )
  fi

  # Wait on /health answering, not on a guessed sleep.
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 2 http://localhost:8787/health >/dev/null 2>&1; then
      echo "worker  : up   http://localhost:8787/health"
      break
    fi
    sleep 1
  done
  if ! curl -fsS --max-time 2 http://localhost:8787/health >/dev/null 2>&1; then
    echo "worker  : FAILED — last lines of $LOG/wrangler.log:" >&2
    tail -12 "$LOG/wrangler.log" >&2
    return 1
  fi
  curl -fsS -o /dev/null --max-time 3 http://localhost:8000/trivia/ 2>/dev/null \
    && echo "client  : up   http://localhost:8000/trivia/" \
    || echo "client  : static server up, but /trivia/ did not answer"
}

status() {
  echo "worker  : $(curl -fsS --max-time 2 http://localhost:8787/health 2>/dev/null || echo down)"
  echo "workerd : $(pgrep -xc workerd 2>/dev/null || echo 0) proc(s)"
  echo "client  : HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:8000/trivia/ 2>/dev/null || echo down)"
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  *) echo "usage: $0 [start|stop|restart|status]"; exit 1 ;;
esac
