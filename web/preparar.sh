#!/usr/bin/env bash
# Deja en web/dist todo lo que necesita el analizador del navegador:
# página, motor, ONNX Runtime Web, YOLO11n en ONNX, modelo de re-identificación y vídeo de ejemplo.
set -euo pipefail
cd "$(dirname "$0")"
RAIZ=..
DIST=dist
mkdir -p "$DIST"

python3 construir.py "$DIST"
cp motor.js trabajador.js "$DIST/"

# ONNX Runtime Web 1.17.3 (MIT): script y binario WebAssembly sin hilos.
if [ ! -f "$DIST/ort-wasm-simd.wasm" ]; then
  tmp=$(mktemp -d)
  curl -sSL https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.17.3.tgz | tar xz -C "$tmp"
  cp "$tmp/package/dist/ort.min.js" "$tmp/package/dist/ort-wasm-simd.wasm" "$DIST/"
  rm -rf "$tmp"
fi

# Detector: YOLO11n exportado a ONNX (entrada 640x640).
if [ ! -f "$DIST/yolo11n.onnx" ]; then
  (cd "$DIST" && python3 -c "from ultralytics import YOLO; YOLO('yolo11n.pt').export(format='onnx', imgsz=640, opset=12)")
fi
# El visor de Artifacts no sirve .onnx: los modelos viajan en base64 dentro de un .txt.
base64 -w0 "$DIST/yolo11n.onnx" > "$DIST/yolo11n.onnx.b64.txt"

# Re-identificación: el mismo modelo que usa el pipeline de Python.
[ -f "$RAIZ/modelos/mars-small128.onnx" ] || "$RAIZ/scripts/descargar_modelos.sh"
base64 -w0 "$RAIZ/modelos/mars-small128.onnx" > "$DIST/mars.onnx.b64.txt"

# Vídeo de ejemplo (pasillo de Intel, CC BY 4.0).
[ -f "$RAIZ/data/store-aisle-detection.mp4" ] || "$RAIZ/scripts/descargar_videos.sh"
cp "$RAIZ/data/store-aisle-detection.mp4" "$DIST/ejemplo.mp4"

echo "Listo. Sirve la carpeta con:  python3 -m http.server -d web/dist 8000  y abre http://localhost:8000/analitica-tienda.html"
