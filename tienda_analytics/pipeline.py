"""Procesa un vídeo: detecta y sigue personas, y genera eventos anónimos por zona.

Uso:
    python -m tienda_analytics.pipeline --video data/store-aisle-detection.mp4 \
        --config config/zonas_pasillo.json --salida salida/
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from .zonas import Config, cargar_config, dibujar_zonas

CLASE_PERSONA = 0


@dataclass
class Trayecto:
    """Estado de una persona seguida. Solo guarda posiciones, nunca imágenes."""

    id: int
    primer_t: float
    ultimo_t: float
    zona_actual: str | None = None
    entrada_zona_t: float = 0.0
    estancias: list[tuple[str, float, float]] = field(default_factory=list)
    lados: dict[str, int] = field(default_factory=dict)
    cruces: list[tuple[str, float, int]] = field(default_factory=list)

    def cerrar_zona(self, t: float) -> None:
        if self.zona_actual is not None:
            self.estancias.append((self.zona_actual, self.entrada_zona_t, t))
        self.zona_actual = None


def punto_pie(caja: np.ndarray) -> tuple[float, float]:
    """Centro del borde inferior de la caja: aproxima dónde pisa la persona."""
    x1, _, x2, y2 = caja
    return ((x1 + x2) / 2.0, float(y2))


def zona_de(punto: tuple[float, float], config: Config) -> str | None:
    for zona in config.zonas:
        if zona.contiene(punto):
            return zona.nombre
    return None


def procesar(
    video: str,
    config: Config,
    modelo: str = "yolo11n.pt",
    paso: int = 2,
    confianza: float = 0.35,
    video_anotado: Path | None = None,
    max_frames: int | None = None,
) -> tuple[dict[int, Trayecto], np.ndarray, np.ndarray, float]:
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(f"No se pudo abrir el vídeo: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    ancho = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    alto = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    yolo = YOLO(modelo)
    trayectos: dict[int, Trayecto] = {}
    calor = np.zeros((alto, ancho), dtype=np.float32)
    fondo = None
    escritor = None
    if video_anotado is not None:
        escritor = cv2.VideoWriter(
            str(video_anotado), cv2.VideoWriter_fourcc(*"mp4v"), fps / paso, (ancho, alto)
        )

    n = 0
    t = 0.0
    while True:
        ok, frame = cap.read()
        if not ok or (max_frames is not None and n >= max_frames):
            break
        t = n / fps
        n += 1
        if (n - 1) % paso:
            continue
        if fondo is None:
            fondo = frame.copy()

        res = yolo.track(
            frame, persist=True, classes=[CLASE_PERSONA], conf=confianza,
            tracker="bytetrack.yaml", verbose=False,
        )[0]
        cajas = res.boxes
        ids = cajas.id.int().tolist() if cajas.id is not None else []
        xyxy = cajas.xyxy.cpu().numpy() if len(ids) else np.empty((0, 4))

        for tid, caja in zip(ids, xyxy):
            p = punto_pie(caja)
            tr = trayectos.get(tid)
            if tr is None:
                tr = trayectos[tid] = Trayecto(tid, t, t)
            tr.ultimo_t = t

            cx, cy = int(min(max(p[0], 0), ancho - 1)), int(min(max(p[1], 0), alto - 1))
            cv2.circle(calor, (cx, cy), 12, 1.0, -1)

            zona = zona_de(p, config)
            if zona != tr.zona_actual:
                tr.cerrar_zona(t)
                if zona is not None:
                    tr.zona_actual, tr.entrada_zona_t = zona, t

            for linea in config.lineas:
                if not linea.dentro_del_tramo(p):
                    continue
                lado = linea.lado(p)
                previo = tr.lados.get(linea.nombre)
                if previo is not None and lado != 0 and lado != previo:
                    tr.cruces.append((linea.nombre, t, lado))
                if lado != 0:
                    tr.lados[linea.nombre] = lado

            if escritor is not None:
                x1, y1, x2, y2 = caja.astype(int)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 0), 2)
                cv2.putText(frame, f"#{tid} {zona or ''}", (x1, y1 - 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 220, 0), 1)

        if escritor is not None:
            escritor.write(dibujar_zonas(frame, config))

    for tr in trayectos.values():
        tr.cerrar_zona(tr.ultimo_t)
    cap.release()
    if escritor is not None:
        escritor.release()
    return trayectos, calor, fondo, t


def guardar_eventos(trayectos: dict[int, Trayecto], config: Config, ruta_db: Path) -> int:
    """Guarda visitas y estancias por zona en SQLite. Devuelve visitas válidas."""
    ruta_db.unlink(missing_ok=True)
    con = sqlite3.connect(ruta_db)
    con.executescript(
        """
        CREATE TABLE visitas (id INTEGER PRIMARY KEY, tienda TEXT, inicio TEXT, fin TEXT, segundos REAL);
        CREATE TABLE estancias (visita_id INTEGER, zona TEXT, categoria TEXT, inicio TEXT, fin TEXT, segundos REAL);
        CREATE TABLE cruces (visita_id INTEGER, linea TEXT, momento TEXT, sentido INTEGER);
        """
    )
    categorias = {z.nombre: z.categoria for z in config.zonas}
    base = config.video_inicio

    def ts(seg: float) -> str:
        return (base + timedelta(seconds=seg)).isoformat(timespec="seconds")

    validas = 0
    for tr in trayectos.values():
        dur = tr.ultimo_t - tr.primer_t
        if dur < config.min_segundos_visita:
            continue
        validas += 1
        con.execute("INSERT INTO visitas VALUES (?,?,?,?,?)",
                    (tr.id, config.tienda, ts(tr.primer_t), ts(tr.ultimo_t), round(dur, 2)))
        for zona, a, b in tr.estancias:
            con.execute("INSERT INTO estancias VALUES (?,?,?,?,?,?)",
                        (tr.id, zona, categorias.get(zona), ts(a), ts(b), round(b - a, 2)))
        for linea, t, sentido in tr.cruces:
            con.execute("INSERT INTO cruces VALUES (?,?,?,?)", (tr.id, linea, ts(t), sentido))
    con.commit()
    con.close()
    return validas


def guardar_mapa_calor(calor: np.ndarray, fondo: np.ndarray, ruta: Path) -> None:
    if calor.max() > 0:
        norm = cv2.GaussianBlur(calor, (0, 0), 15)
        norm = (255 * norm / norm.max()).astype(np.uint8)
    else:
        norm = calor.astype(np.uint8)
    color = cv2.applyColorMap(norm, cv2.COLORMAP_JET)
    mascara = (norm > 10)[..., None]
    mezcla = np.where(mascara, cv2.addWeighted(fondo, 0.45, color, 0.55, 0), fondo)
    cv2.imwrite(str(ruta), mezcla)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--salida", default="salida")
    ap.add_argument("--modelo", default="yolo11n.pt")
    ap.add_argument("--paso", type=int, default=2, help="procesar 1 de cada N fotogramas")
    ap.add_argument("--confianza", type=float, default=0.35)
    ap.add_argument("--video-anotado", action="store_true", help="guardar vídeo con cajas y zonas")
    ap.add_argument("--max-frames", type=int, default=None)
    args = ap.parse_args()

    salida = Path(args.salida)
    salida.mkdir(parents=True, exist_ok=True)
    config = cargar_config(args.config)
    trayectos, calor, fondo, dur = procesar(
        args.video, config, args.modelo, args.paso, args.confianza,
        salida / "video_anotado.mp4" if args.video_anotado else None, args.max_frames,
    )
    validas = guardar_eventos(trayectos, config, salida / "eventos.sqlite")
    if fondo is not None:
        guardar_mapa_calor(calor, fondo, salida / "mapa_calor.png")
        cv2.imwrite(str(salida / "zonas.png"), dibujar_zonas(fondo, config))
    resumen = {"segundos_video": round(dur, 1), "trayectos_detectados": len(trayectos), "visitas_validas": validas}
    (salida / "procesado.json").write_text(json.dumps(resumen, indent=2), encoding="utf-8")
    print(json.dumps(resumen, indent=2))


if __name__ == "__main__":
    main()
