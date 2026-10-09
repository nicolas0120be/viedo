#!/usr/bin/env bash
# Descarga vídeos de prueba de Intel (licencia CC BY 4.0) en data/.
# https://github.com/intel-iot-devkit/sample-videos
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
tmp=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse https://github.com/intel-iot-devkit/sample-videos.git "$tmp"
git -C "$tmp" sparse-checkout set --no-cone /store-aisle-detection.mp4 /people-detection.mp4 /one-by-one-person-detection.mp4 /worker-zone-detection.mp4
cp "$tmp"/*.mp4 data/
rm -rf "$tmp"

# Vista cenital de un paso peatonal (útil para probar líneas de conteo de entrada).
tmp=$(mktemp -d)
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/saimj7/People-Counting-in-Real-Time.git "$tmp"
git -C "$tmp" sparse-checkout set --no-cone /utils/data/tests/test_1.mp4
cp "$tmp/utils/data/tests/test_1.mp4" data/entrada_cenital.mp4
rm -rf "$tmp"
ls -lh data/*.mp4
