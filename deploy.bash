#!/bin/bash
set -e

STAMP=$(TZ=America/Los_Angeles date +%y%m%d.%H%M)

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Branch = $BRANCH"

if [ "$BRANCH" = "main" ]; then
  VERSION="V${STAMP}"
else
  VERSION="V${STAMP}(${BRANCH})"
fi

CACHE_NAME="FoE:survey-$VERSION"
STORAGE_TAG="FoE:survey:${VERSION}"

cat > version.json <<EOF
{
  "branch": "$BRANCH",
  "version": "$VERSION",
  "storageTag": "$STORAGE_TAG",
  "cacheName": "$CACHE_NAME"
}
EOF

sed \
  "s/^\(const CACHE_NAME = \)'__CACHE_NAME__';/\1'${CACHE_NAME}';/" \
  sw.js.in > sw.js

IM="magick"
if ! command -v magick >/dev/null 2>&1; then
  IM="convert"
fi

$IM icons/foe-icon-192-base.png \
  -fill orange \
  -stroke white \
  -strokewidth 1.5 \
  -draw "circle 168,24 168,12" \
  icons/foe-icon-192.png

if [ "$BRANCH" = "dev" ]; then
  $IM icons/foe-icon-192-base.png \
    -fill orange \
    -stroke white \
    -strokewidth 1.5 \
    -draw "circle 168,24 168,12" \
    icons/foe-icon-192.png
  $IM icons/foe-icon-512-base.png \
    -fill orange \
    -stroke white \
    -strokewidth 4 \
    -draw "circle 448,64 448,32" \
    icons/foe-icon-512.png
else
  cp icons/foe-icon-192-base.png icons/foe-icon-192.png
  cp icons/foe-icon-512-base.png icons/foe-icon-512.png
fi
