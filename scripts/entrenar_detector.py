"""Reentrena el detector de personas con los fotogramas revisados en la pestaña Entrenamiento.

Uso:
    python scripts/entrenar_detector.py entrenamiento-*.zip [--epocas 30] [--base yolo11n.pt]

Cada .zip trae images/ y labels/ en formato YOLO (clase 0 = persona). El script los junta,
separa un 20 % de fotogramas para validar, ajusta YOLO11n y exporta el resultado a ONNX y a la
versión en base64 que carga el analizador del navegador (yolo11n.onnx.b64.txt).

Se conserva la cabeza de 80 clases de COCO para no perder lo que el modelo ya sabe; solo se
etiquetan personas, así que el resto de clases aprende a callarse en estas cámaras, lo que no
afecta al conteo. Con pocos fotogramas conviene pocas épocas: el registro de pruebas del front
dirá si el modelo nuevo mejora o empeora el conteo.
"""
from __future__ import annotations

import argparse
import base64
import random
import shutil
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def juntar(zips: list[Path], destino: Path) -> list[Path]:
    """Extrae todos los .zip en destino/images y destino/labels. Devuelve las imágenes."""
    (destino / "images").mkdir(parents=True, exist_ok=True)
    (destino / "labels").mkdir(parents=True, exist_ok=True)
    imagenes = []
    for z in zips:
        with zipfile.ZipFile(z) as f:
            for nombre in f.namelist():
                p = Path(nombre)
                if p.parent.name not in ("images", "labels") or not p.suffix:
                    continue
                salida = destino / p.parent.name / p.name
                salida.write_bytes(f.read(nombre))
                if p.parent.name == "images":
                    imagenes.append(salida)
    # Un fotograma sin personas lleva un .txt vacío: también enseña (fondo sin falsas alarmas).
    for img in imagenes:
        (destino / "labels" / (img.stem + ".txt")).touch(exist_ok=True)
    return sorted(imagenes)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("zips", nargs="+", type=Path, help="archivos .zip descargados desde la pestaña Entrenamiento")
    ap.add_argument("--base", default=str(RAIZ / "yolo11n.pt"), help="modelo de partida (por defecto yolo11n.pt)")
    ap.add_argument("--epocas", type=int, default=30)
    ap.add_argument("--lote", type=int, default=8)
    ap.add_argument("--validacion", type=float, default=0.2, help="fracción de fotogramas para validar")
    ap.add_argument("--salida", type=Path, default=RAIZ / "modelos" / "detector_tienda")
    ap.add_argument("--dispositivo", default=None, help="cpu, 0 (primera GPU)…; por defecto lo elige Ultralytics")
    a = ap.parse_args()

    from ultralytics import YOLO

    datos = a.salida / "datos"
    shutil.rmtree(datos, ignore_errors=True)
    imagenes = juntar(a.zips, datos)
    if len(imagenes) < 2:
        raise SystemExit("Hacen falta al menos 2 fotogramas revisados.")
    random.Random(0).shuffle(imagenes)
    n_val = max(1, round(len(imagenes) * a.validacion))
    (datos / "val.txt").write_text("\n".join(str(p) for p in imagenes[:n_val]) + "\n")
    (datos / "train.txt").write_text("\n".join(str(p) for p in imagenes[n_val:]) + "\n")

    modelo = YOLO(a.base)
    nombres = modelo.names  # las 80 clases de COCO; persona es la 0
    yaml = [f"path: {datos}", "train: train.txt", "val: val.txt", "names:"] + [f"  {k}: {v}" for k, v in nombres.items()]
    (datos / "data.yaml").write_text("\n".join(yaml) + "\n")
    print(f"{len(imagenes)} fotogramas: {len(imagenes) - n_val} para entrenar y {n_val} para validar.")

    modelo.train(data=str(datos / "data.yaml"), epochs=a.epocas, imgsz=640, batch=a.lote, workers=0,
                 project=str(a.salida), name="entreno", exist_ok=True, device=a.dispositivo,
                 classes=[0], plots=False, verbose=False)
    mejor = a.salida / "entreno" / "weights" / "best.pt"
    onnx = Path(YOLO(str(mejor)).export(format="onnx", imgsz=640, opset=12))
    b64 = a.salida / "yolo11n.onnx.b64.txt"
    b64.write_text(base64.b64encode(onnx.read_bytes()).decode())
    print(f"\nModelo nuevo: {mejor}\nONNX: {onnx}\nPara el navegador: {b64}")
    print("Cópialo a web/dist/yolo11n.onnx.b64.txt y vuelve a publicar el front; después repite las pruebas.")


if __name__ == "__main__":
    main()
