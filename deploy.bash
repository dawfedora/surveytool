#!/bin/bash
set -e

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Branch = $BRANCH"
if [ "$BRANCH" = "main" ]; then
  BRANCH="prod"
fi

STAMP=$(TZ=America/Los_Angeles date +%Y.%m.%d.%H%M)

VERSION="${BRANCH}-${STAMP}"
CACHE_NAME="edgewood-$VERSION"

cat > version.json <<EOF
{
  "version": "$VERSION",
  "branch": "$BRANCH",
  "cacheName": "$CACHE_NAME"
}
EOF

sed \
  "s/^\(const CACHE_NAME = \)'__CACHE_NAME__';/\1'${CACHE_NAME}';/" \
  sw.js.in > sw.js

if [ "$BRANCH" = "dev" ]; then
  magick icons/foe-icon-192-base.png \
    -fill orange \
    -stroke white \
    -strokewidth 1.5 \
    -draw "circle 168,24 168,12" \
    icons/foe-icon-192.png
  magick icons/foe-icon-512-base.png \
    -fill orange \
    -stroke white \
    -strokewidth 4 \
    -draw "circle 448,64 448,32" \
    icons/foe-icon-512.png
else
  cp icons/foe-icon-192-base.png icons/foe-icon-192.png
  cp icons/foe-icon-512-base.png icons/foe-icon-512.png
fi
