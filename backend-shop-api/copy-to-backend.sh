#!/bin/sh
# Copies the backend shop-API files from this folder into your
# my_naai_backend clone, keeping the backend-repo paths.
#
# Usage:  sh copy-to-backend.sh /path/to/my_naai_backend
set -e

BACKEND_DIR="${1:-}"
if [ -z "$BACKEND_DIR" ]; then
  echo "Usage: sh copy-to-backend.sh /path/to/my_naai_backend"
  exit 1
fi
if [ ! -d "$BACKEND_DIR/.git" ]; then
  echo "Error: $BACKEND_DIR is not a git repository."
  echo "Point this script at your my_naai_backend clone."
  exit 1
fi

cd "$(dirname "$0")"
COPIED=0
for entry in *; do
  [ "$entry" = "INSTALL.md" ] && continue
  [ "$entry" = "copy-to-backend.sh" ] && continue
  if [ -d "$entry" ]; then
    cp -r "$entry" "$BACKEND_DIR/"
  else
    cp "$entry" "$BACKEND_DIR/$entry"
  fi
  COPIED=$((COPIED + 1))
done

echo "Copied $COPIED top-level items into: $BACKEND_DIR"
echo ""
echo "Next, in your backend repo:"
echo "  cd $BACKEND_DIR"
echo "  git add -A"
echo "  git commit -m \"Naai Shop e-commerce API: shop orders, dual-auth marketplace catalog, admin product management\""
echo "  git push origin HEAD:feature/naai-shop-ecommerce-api"
