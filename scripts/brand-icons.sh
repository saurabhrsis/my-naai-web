#!/usr/bin/env bash
# Regenerate every My Naai brand file from the supplied artwork.
#
#   scripts/brand-icons.sh [app-icon.png] [logo.png]
#
# With no arguments it rebuilds from the two masters already in the repo
# (public/assets/brand/mynaai-mark.png and mynaai-logo.png), which is what you
# want after a palette tweak or a resize — the original JPEGs are not needed.
#
# THE ARTWORK KEEPS ITS OWN COLOUR. The monogram is gold (#F2B96B) on near-black;
# the gold is the logo, so no step here recolours it. The only exception is the
# Android notification badge, which must be a monochrome silhouette by platform
# rule — `whitecut` exists for that one file and nothing else.
#
#   app-icon  the M monogram             → tab icons, app icons, fallbacks
#   logo      the lockup (M + "My Naai") → headers, login, link preview
#
# Requires ImageMagick 6 (`convert`). Everything it writes is committed, so this
# only has to run when the artwork itself changes.
set -euo pipefail

cd "$(dirname "$0")/.."
PUBLIC=public
BRAND=$PUBLIC/assets/brand
ICONS=$PUBLIC/icons

ICON_SRC=${1:-$BRAND/mynaai-mark.png}
LOGO_ONLY_SRC=${2:-$BRAND/mynaai-logo.png}

# The plate the icons sit on: the app's own background, not pure black, so an
# installed icon and the app behind it are the same shade.
PLATE='#0B0D0D'

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ ! -f "$ICON_SRC" ] || [ ! -f "$LOGO_ONLY_SRC" ]; then
  echo "usage: brand-icons.sh [app-icon.png] [logo.png]  (missing source)" >&2
  exit 1
fi

# gold art, alpha kept (or cut from luminance for an opaque master) -----------
artcut () { # $1 = source, $2 = destination
  local has_alpha max
  has_alpha=$(identify -format '%A' "$1")
  if [ "$has_alpha" = "True" ]; then
    # Already transparent (the committed masters): keep the pixels exactly as
    # they are — this is the colour the client approved.
    convert "$1" -depth 8 -strip "$2"
    return
  fi
  # Opaque master: the art is bright on a dark surround, so luminance becomes the
  # alpha channel. The RGB channels are left alone — this is what makes the
  # result gold rather than white.
  max=$(convert "$1" -colorspace Gray -format '%[fx:maxima*100]' info:)
  convert "$1" \
    \( "$1" -colorspace Gray -level "0%,${max}%" \) \
    -alpha off -compose CopyOpacity -composite \
    -depth 8 -strip "$2"
}

# the monochrome silhouette the status bar needs (badge-96 only) --------------
whitecut () { # $1 = source, $2 = destination
  local max
  max=$(convert "$1" -colorspace Gray -format '%[fx:maxima*100]' info:)
  convert "$1" -colorspace Gray -level "0%,${max}%" \( +clone \) -alpha off \
    -compose CopyOpacity -composite -fill white -colorize 100 -depth 8 -strip "$2"
}

# trim the surround — transparent for the committed PNGs, black for a flat master
convert "$ICON_SRC" -fuzz 5% -trim +repage "$TMP/icon-trim.png"
convert "$LOGO_ONLY_SRC" -fuzz 5% -trim +repage "$TMP/logo-trim.png"

artcut "$TMP/icon-trim.png" "$TMP/mark.png"
artcut "$TMP/logo-trim.png" "$TMP/lockup.png"

# the committed, transparent artwork --------------------------------------
# Only rewritten when new masters are passed in: running with no arguments must
# not upscale the artwork it just read.
if [ $# -ge 1 ]; then
  convert "$TMP/mark.png"   -resize 1024x -depth 8 -strip "$BRAND/mynaai-mark.png"
  convert "$TMP/lockup.png" -resize 1280x -depth 8 -strip "$BRAND/mynaai-logo.png"
fi

# square app-icon plates --------------------------------------------------
# The monogram is wider than it is tall, so it is sized by WIDTH as a fraction
# of the plate: 56% leaves the margin Android's maskable crop eats, 62–68% is the
# snugger fit used for the small sizes where that margin would swallow the art.
plate () { # $1 = size, $2 = art width fraction, $3 = destination
  local size=$1 fraction=$2 width
  width=$(python3 -c "print(round($size*$fraction))")
  convert -size "${size}x${size}" xc:"$PLATE" \
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

# the notification badge: a white silhouette on transparency, by platform rule
whitecut "$TMP/icon-trim.png" "$TMP/badge.png"
convert -size 96x96 xc:none \( "$TMP/badge.png" -resize 76x \) \
  -gravity center -compose over -composite -depth 8 -strip "$ICONS/badge-96.png"

# Razorpay's checkout sheet loads a plain PNG from a stable path — gold on
# transparent, the same artwork as everywhere else.
convert -size 500x500 xc:none \( "$TMP/mark.png" -resize 300x \) \
  -gravity center -compose over -composite -depth 8 -strip "$PUBLIC/assets/my_naai.png"

# link preview: the lockup centred on the app background
convert -size 1200x630 xc:"$PLATE" \
  \( "$TMP/lockup.png" -resize 520x \) -gravity center -compose over -composite \
  -depth 8 -strip "$BRAND/og-cover.png"

# A white copy of the mark stays committed for surfaces that draw the logo over
# a photograph or an unknown background — it is a variant, not the icon.
whitecut "$TMP/icon-trim.png" "$TMP/mark-white.png"
convert "$TMP/mark-white.png" -resize 1024x -depth 8 -strip "$BRAND/mynaai-mark-white.png"

echo "Brand files regenerated from $(basename "$ICON_SRC") and $(basename "$LOGO_ONLY_SRC")."
