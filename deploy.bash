#!/bin/bash
set -e

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Branch = $BRANCH"
if [ "$BRANCH" = "main" ]; then
  BRANCH="prod"
fi

STAMP=$(TZ=America/Los_Angeles date +%Y.%m.%d.%H%M)

VERSION="${BRANCH}-${STAMP}"
CACHE_NAME="edgewood-$BRANCH-$VERSION"

cat > version.json <<EOF
{
  "version": "$VERSION",
  "branch": "$BRANCH",
  "cacheName": "$CACHE_NAME"
}
EOF

sed \
  "s/__CACHE_NAME__/${CACHE_NAME}/g" \
  sw.js.in > sw.js
