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

# The plate the icons sit on: the black the supplied artwork itself uses. The
# gold is brighter against it than against the app's slightly lifted #0B0D0D,
# and on a launcher nobody can see the difference between the two anyway.
PLATE='#000000'

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
# Pure white at FULL opacity. An earlier version derived the alpha from the
# artwork's luminance and landed on white at ~93% alpha, which the phone
# composites to a grey ghost — the "dull icon" in the status bar. The shape now
# comes from the trimmed mark's own alpha, so every inside pixel is solid white,
# and only the anti-aliased edge is partial.
whitecut () { # $1 = source, $2 = destination
  convert "$1" -channel A -threshold 45% +channel \
    -fill white -colorize 100 -depth 8 -strip "$2"
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

# 62% of the plate is the framing the supplied artwork uses (the monogram is
# 1.39x wider than it is tall, so a 62% width is a 45% height and its corners
# stay inside the 80% circle every launcher mask keeps).
plate 512 0.62 "$ICONS/icon-512.png"
plate 512 0.62 "$ICONS/icon-maskable-512.png"
plate 192 0.64 "$ICONS/icon-192.png"
plate 180 0.64 "$ICONS/apple-touch-icon.png"
# The tab sizes go SMALLER, not bigger. At 16–32px the counters between the two
# arches are only a couple of pixels wide, so art that fills the plate closes
# them and the mark turns into a solid block; 62% / 68% keeps both gaps open.
plate 32  0.68 "$ICONS/favicon-32.png"
plate 16  0.62 "$ICONS/favicon-16.png"
convert "$ICONS/favicon-16.png" "$ICONS/favicon-32.png" "$PUBLIC/favicon.ico"

# The notification's LARGE icon. This is the one the phone draws in colour, so
# it is the artwork itself on transparency rather than the plated app icon: at
# 64dp a black tile with a small mark reads as a dark smudge, while the mark
# itself is bright on both a white and a dark notification card.
convert -size 192x192 xc:none \( "$TMP/mark.png" -resize 176x \) \
  -gravity center -compose over -composite -depth 8 -strip "$ICONS/notification-192.png"

# the notification badge: a white silhouette on transparency, by platform rule —
# the only monochrome file in the set, and only because Android masks it
whitecut "$TMP/mark.png" "$TMP/badge.png"
convert -size 96x96 xc:none \( "$TMP/badge.png" -resize 80x \) \
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
whitecut "$TMP/mark.png" "$TMP/mark-white.png"
convert "$TMP/mark-white.png" -resize 1024x -depth 8 -strip "$BRAND/mynaai-mark-white.png"

echo "Brand files regenerated from $(basename "$ICON_SRC") and $(basename "$LOGO_ONLY_SRC")."
