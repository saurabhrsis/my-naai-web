#!/usr/bin/env bash
# Copies the shop-tabs frontend bundle into a my-naai-frontend checkout.
# NOTHING is deleted or removed — new files are added, existing files are
# overwritten with the new versions.
#
# Usage: ./copy-to-frontend.sh /path/to/my-naai-frontend
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/my-naai-frontend"
  exit 1
fi

TARGET="$1"
SRC="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$TARGET/package.json" ] || ! grep -q vite "$TARGET/package.json"; then
  echo "ERROR: $TARGET does not look like the Vite frontend repo (no vite in package.json)"
  exit 1
fi

echo "Copying into $TARGET (nothing will be deleted)..."

# New files
cp "$SRC/src/pages/ShopProducts.jsx"             "$TARGET/src/pages/"
cp "$SRC/src/pages/Distributors.jsx"             "$TARGET/src/pages/"
cp "$SRC/src/pages/ShopOrders.jsx"               "$TARGET/src/pages/"
cp "$SRC/src/pages/DistributorPortal.jsx"        "$TARGET/src/pages/"
cp "$SRC/src/components/ShopProductModal.jsx"    "$TARGET/src/components/"
cp "$SRC/src/components/DistributorModal.jsx"    "$TARGET/src/components/"
cp "$SRC/src/components/ShopOrderDetailModal.jsx" "$TARGET/src/components/"

# Overwrites (newer versions of existing files)
cp "$SRC/src/App.jsx"                            "$TARGET/src/"
cp "$SRC/src/pages/Login.jsx"                    "$TARGET/src/pages/"
cp "$SRC/src/services/communication.jsx"         "$TARGET/src/services/"
cp "$SRC/src/utils/TabArray.js"                  "$TARGET/src/utils/"
cp "$SRC/src/components/Layout.jsx"              "$TARGET/src/components/"
cp "$SRC/src/contexts/UserContext.jsx"           "$TARGET/src/contexts/"
cp "$SRC/vite.config.js"                         "$TARGET/"

echo
echo "Done. 14 files copied (7 new + 7 overwritten). Nothing deleted."
echo "Next: cd $TARGET && npm run build"
