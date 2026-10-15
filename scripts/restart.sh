#!/usr/bin/env bash
# Redémarre Cornelius en production : scripts/stop.sh puis scripts/start.sh.
# Usage : scripts/restart.sh [--build] [--no-perception] [--timeout SECONDES]
set -euo pipefail
"$(dirname "$0")/stop.sh"
exec "$(dirname "$0")/start.sh" "$@"
