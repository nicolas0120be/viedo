#!/usr/bin/env bash
# Descarga el modelo de re-identificación de personas (MARS, de Deep SORT) y lo
# convierte a ONNX en modelos/mars-small128.onnx.
#
# Licencia: el modelo procede de Deep SORT (https://github.com/nwojke/deep_sort),
# publicado bajo GPL-3.0. Revisa si encaja con tu uso comercial; para producción
# se recomienda sustituirlo por un modelo OSNet entrenado en MSMT17 exportado a ONNX
# (misma interfaz: entrada BGR 128x64 uint8).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p modelos
if [ -f modelos/mars-small128.onnx ]; then echo "Ya existe modelos/mars-small128.onnx"; exit 0; fi
tmp=$(mktemp -d)
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/theAIGuysCode/yolov4-deepsort.git "$tmp/repo"
git -C "$tmp/repo" sparse-checkout set --no-cone /model_data/mars-small128.pb
python3 -m venv "$tmp/venv"
"$tmp/venv/bin/pip" install -q tensorflow-cpu tf2onnx
"$tmp/venv/bin/python" -m tf2onnx.convert --graphdef "$tmp/repo/model_data/mars-small128.pb" \
    --inputs images:0 --outputs features:0 --opset 13 --output modelos/mars-small128.onnx
rm -rf "$tmp"
ls -lh modelos/mars-small128.onnx
