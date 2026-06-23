#!/bin/sh
# 100 Gün Ormanda - macOS/Linux tek-tık başlatıcı.  ./start.sh  veya çift tıkla.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js bulunamadı. Önce kur:  https://nodejs.org"
  echo ""
  exit 1
fi
exec node launch.cjs
