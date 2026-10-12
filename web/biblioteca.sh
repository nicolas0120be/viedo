#!/usr/bin/env bash
# Prepara la biblioteca de vídeos de prueba del front (sección Pruebas) en web/dist:
# vídeos MP4 H.264 ligeros (máx. 960 px, 15 fotogramas/s, sin audio) y una miniatura de cada uno.
# Los conteos manuales de personas reales están en BIBLIOTECA, dentro de app.js.
set -euo pipefail
cd "$(dirname "$0")"
RAIZ=..
DIST=dist
mkdir -p "$DIST/videos" "$DIST/mini"
[ -f "$RAIZ/data/entrada_tienda_calle.mp4" ] || "$RAIZ/scripts/descargar_videos.sh"

# id  origen  segundo-de-la-miniatura
while read -r id origen seg; do
  [ -n "$id" ] || continue
  if [ "$id" != pasillo-tienda ]; then
    ffmpeg -v error -y -i "$RAIZ/data/$origen" -an -vf "scale='min(960,iw)':-2,fps=15" \
      -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart "$DIST/videos/$id.mp4"
    fuente="$DIST/videos/$id.mp4"
  else
    fuente="$RAIZ/data/$origen"   # el pasillo se sirve como ejemplo.mp4
  fi
  ffmpeg -v error -y -ss "$seg" -i "$fuente" -frames:v 1 -vf "scale=480:-2" -q:v 5 "$DIST/mini/$id.jpg"
done <<'LISTA'
pasillo-tienda store-aisle-detection.mp4 30
entrada-tienda-calle entrada_tienda_calle.mp4 11.5
entrada-cenital entrada_cenital.mp4 13
personas-cruzando people-detection.mp4 30
una-a-una one-by-one-person-detection.mp4 30
caminar-y-pausa face-demographics-walking-and-pause.mp4 62
caminar-hacia-camara face-demographics-walking.mp4 40
zona-trabajo worker-zone-detection.mp4 37
aula-sentados classroom.mp4 2
mercadillo-multitud mercadillo_multitud.mp4 10
cinta-sin-personas fruit-and-vegetable-detection.mp4 36
LISTA
du -sh "$DIST/videos" "$DIST/mini"
