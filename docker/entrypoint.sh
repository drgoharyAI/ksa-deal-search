#!/bin/sh
# Container entrypoint: virtual display, API Anything specs, then the Next.js server as PID of
# record (exec), so SIGTERM from tini reaches node directly.
set -eu

DISPLAY="${DISPLAY:-:99}"
export DISPLAY
DISPLAY_NUM="${DISPLAY#:}"
DISPLAY_NUM="${DISPLAY_NUM%%.*}"

# Xvfb: noon and SHEIN need a headed Chrome; this is its screen. Unix socket only (-nolisten tcp)
# and access control on (no -ac): a random MIT cookie in an Xauthority file only this user can
# read, as xvfb-run does. Chrome is spawned by node, inherits DISPLAY and XAUTHORITY, and so
# presents the cookie; any other local process without it is refused.
XAUTHORITY="${XAUTHORITY:-/tmp/.deal-search-Xauthority}"
export XAUTHORITY
rm -f "$XAUTHORITY"
(umask 077 && : >"$XAUTHORITY")
xauth -q -f "$XAUTHORITY" add "$DISPLAY" . "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"
Xvfb "$DISPLAY" -screen 0 1920x1080x24 -nolisten tcp -auth "$XAUTHORITY" >/tmp/xvfb.log 2>&1 &
i=0
while [ ! -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then
    echo "entrypoint: Xvfb did not start on $DISPLAY:" >&2
    cat /tmp/xvfb.log >&2 || true
    exit 1
  fi
  sleep 0.1
done
echo "entrypoint: Xvfb ready on $DISPLAY"

# No Chrome runs yet: a SingletonLock left in a profile belongs to an earlier container (its
# hostname differs after a recreate) and would make Chrome exit with code 21 "profile in use".
for d in "${NOON_PROFILE_DIR:-/data/noon-profile}" "${SHEIN_PROFILE_DIR:-/data/shein-profile}"; do
  rm -f "$d/SingletonLock" "$d/SingletonCookie" "$d/SingletonSocket" "$d/deal-search-port.json"
done

mkdir -p "$(dirname "${DEAL_SEARCH_DB:-/data/data.db}")" "${API_ANYTHING_HOME:-/data/aa-home}"
node scripts/install-specs.mjs || echo "entrypoint: WARNING install-specs failed; continuing" >&2

# Docker sets HOSTNAME to the container id; the server must listen on every interface.
export HOSTNAME=0.0.0.0
exec node server.js
