#!/usr/bin/env bash
# Regenerate every My Naai brand file from the two supplied masters.
#
#   scripts/brand-icons.sh <app-icon.png> <logo.png>
#
# Both masters are treated the same way: the artwork is white on black, so the
# black is trimmed away, the luminance becomes the alpha channel and the art is
# recoloured white. That leaves transparent, dark-chrome-friendly artwork at any
# size — no plate, no ring, no CSS wordmark to drift out of sync.
#
#   app-icon.png  the M monogram alone  → generic icon / favicon / fallbacks
#   logo.png      the lockup (M + "My Naai" underneath) → headers, login, preview
#
# Requires ImageMagick 6 (`convert`). Everything it writes is committed, so this
# only has to run when the artwork itself changes.
set -euo pipefail

ICON_SRC=${1:?usage: brand-icons.sh <app-icon.png> <logo.png>}
LOGO_ONLY_SRC=${2:?usage: brand-icons.sh <app-icon.png> <logo.png>}

cd "$(dirname "$0")/.."
PUBLIC=public
BRAND=$PUBLIC/assets/brand
ICONS=$PUBLIC/icons
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# white art + alpha cut from luminance -------------------------------------
whitecut () { # $1 = source, $2 = destination
  local max
  max=$(convert "$1" -colorspace Gray -format "%[fx:maxima*100]" info:)
  convert "$1" -colorspace Gray -level "0%,${max}%" \( +clone \) -alpha off \
    -compose CopyOpacity -composite -fill white -colorize 100 -depth 8 -strip "$2"
}

# trim the black surround (5% fuzz tolerates the JPEG-ish edges of the master)
convert "$ICON_SRC" -fuzz 5% -trim +repage "$TMP/icon.png"
convert "$LOGO_ONLY_SRC" -fuzz 5% -trim +repage "$TMP/logo.png"
whitecut "$TMP/icon.png" "$TMP/mark.png"
whitecut "$TMP/logo.png" "$TMP/lockup.png"

# the committed, transparent artwork --------------------------------------
convert "$TMP/mark.png"   -resize 1024x -depth 8 -strip "$BRAND/mynaai-mark.png"
convert "$TMP/lockup.png" -resize 1280x -depth 8 -strip "$BRAND/mynaai-logo.png"

# square app-icon plates --------------------------------------------------
# The monogram is wider than it is tall, so it is sized by WIDTH as a fraction
# of the plate: 62% leaves the margin Android's maskable crop eats, 68% is the
# snugger fit used for the small sizes where that margin would swallow the art.
plate () { # $1 = size, $2 = art width fraction, $3 = destination
  local size=$1 fraction=$2 width
  width=$(python3 -c "print(round($size*$fraction))")
  convert -size "${size}x${size}" xc:'#000000' \
    \( "$TMP/mark.png" -resize "${width}x" \) \
    -gravity center -compose over -composite -depth 8 -strip "$3"
}

plate 512 0.56 "$ICONS/icon-512.png"
plate 512 0.56 "$ICONS/icon-maskable-512.png"
plate 192 0.62 "$ICONS/icon-192.png"
plate 180 0.62 "$ICONS/apple-touch-icon.png"
plate 32  0.68 "$ICONS/favicon-32.png"
plate 16  0.74 "$ICONS/favicon-16.png"
convert "$ICONS/favicon-16.png" "$ICONS/favicon-32.png" "$PUBLIC/favicon.ico"

# the notification badge: white art on transparent, sized for the status bar
convert -size 96x96 xc:none \( "$TMP/mark.png" -resize 76x \) \
  -gravity center -compose over -composite -depth 8 -strip "$ICONS/badge-96.png"

# Razorpay's checkout sheet loads a plain PNG from a stable path
plate 500 0.60 "$PUBLIC/assets/my_naai.png"

# link preview: the lockup centred on the app background
convert -size 1200x630 xc:'#080a0a' \
  \( "$TMP/lockup.png" -resize 520x \) -gravity center -compose over -composite \
  -depth 8 -strip "$BRAND/og-cover.png"

echo "Brand files regenerated from $(basename "$ICON_SRC") and $(basename "$LOGO_ONLY_SRC")."
