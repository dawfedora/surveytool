#!/bin/bash
set -e

BRANCH="${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}"
echo "Branch = $BRANCH"

STAMP=$(date +"%Y.%m.%d-%H%M%S")

if [ "$BRANCH" = "main" ]; then
  VERSION="$STAMP"
  CACHE_NAME="edgewood-prod-$VERSION"
else
  VERSION="${BRANCH}-${STAMP}"
  CACHE_NAME="edgewood-dev"
fi

cat > version.json <<EOF
{
  "version": "$VERSION",
  "branch": "$BRANCH",
  "cacheName": "$CACHE_NAME"
}
EOF
