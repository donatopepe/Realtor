#!/usr/bin/env bash
#
# Realtor — genera le icone multi-piattaforma da www/img/logo.png.
#
# Output:
#   www/img/icon-192.png, icon-512.png, icon-maskable-512.png, favicon-32.png,
#   apple-touch-icon-180.png          (PWA / web)
#   resources/android/icon-*.png      (densità Android: ldpi..xxxhdpi)
#   resources/ios/AppIcon-*.png       (set iOS: 20/29/40/60/76/83.5/1024)
#
# Requisiti: ImageMagick 6 (`convert`) o 7 (`magick`), bash.
# Uso: ./scripts/make-icons.sh
#
# MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/www/img/logo.png"
PWA_DIR="$ROOT/www/img"
ANDROID_DIR="$ROOT/resources/android"
IOS_DIR="$ROOT/resources/ios"
BACKGROUND="${ICON_BACKGROUND:-#1d1d1d}"

if [ ! -f "$SRC" ]; then
  echo "Sorgente non trovato: $SRC" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  IM="magick"
elif command -v convert >/dev/null 2>&1; then
  IM="convert"
else
  echo "ImageMagick non trovato (serve 'magick' o 'convert')." >&2
  exit 1
fi

mkdir -p "$PWA_DIR" "$ANDROID_DIR" "$IOS_DIR"

# Icona con sfondo trasparente, logo scalato al rapporto indicato.
icon_any() {
  local size="$1" out="$2" ratio="${3:-0.86}"
  local fit
  fit=$(awk "BEGIN{printf \"%d\", $size*$ratio}")
  "$IM" "$SRC" -resize "${fit}x${fit}" -background none -gravity center -extent "${size}x${size}" -depth 8 "$out"
}

# Icona con sfondo pieno (richiesto da maskable e da iOS/App Store).
icon_solid() {
  local size="$1" out="$2" ratio="${3:-0.74}"
  local fit
  fit=$(awk "BEGIN{printf \"%d\", $size*$ratio}")
  "$IM" -size "${size}x${size}" "xc:$BACKGROUND" \
    \( "$SRC" -resize "${fit}x${fit}" \) \
    -gravity center -composite -depth 8 "$out"
}

echo "PWA / web..."
icon_any  192 "$PWA_DIR/icon-192.png"
icon_any  512 "$PWA_DIR/icon-512.png"
icon_solid 512 "$PWA_DIR/icon-maskable-512.png" 0.58
icon_any  32  "$PWA_DIR/favicon-32.png" 0.98
icon_solid 180 "$PWA_DIR/apple-touch-icon-180.png"

echo "Android..."
declare -A ANDROID=( [ldpi]=36 [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192 )
for density in ldpi mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  icon_solid "${ANDROID[$density]}" "$ANDROID_DIR/icon-$density.png"
done

echo "iOS..."
# nome:lato
IOS_ICONS=(
  "20:20" "20@2x:40" "20@3x:60"
  "29:29" "29@2x:58" "29@3x:87"
  "40:40" "40@2x:80" "40@3x:120"
  "60@2x:120" "60@3x:180"
  "76:76" "76@2x:152"
  "83.5@2x:167"
  "1024:1024"
)
for entry in "${IOS_ICONS[@]}"; do
  name="${entry%%:*}"
  size="${entry##*:}"
  out="$IOS_DIR/AppIcon-${name//./_}.png"
  if [ "$name" = "1024" ]; then
    icon_solid "$size" "$out" 0.68
  else
    icon_solid "$size" "$out"
  fi
done

echo "Fatto. Icone generate con $IM (sfondo $BACKGROUND)."
ls -1 "$PWA_DIR" | sed 's/^/  www\/img\//'
ls -1 "$ANDROID_DIR" | sed 's/^/  resources\/android\//'
ls -1 "$IOS_DIR" | sed 's/^/  resources\/ios\//'
