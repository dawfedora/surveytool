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
