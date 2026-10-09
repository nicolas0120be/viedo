"""Procesa un vídeo: detecta y sigue personas, y genera eventos anónimos por zona.

Uso:
    python -m tienda_analytics.pipeline --video data/store-aisle-detection.mp4 \
        --config config/zonas_pasillo.json --salida salida/
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from .reid import ParametrosReid, Reidentificador, agrupar
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
    registro: list | None = None,
    max_frames: int | None = None,
    reid: Reidentificador | None = None,
    progreso=None,
) -> tuple[dict[int, Trayecto], np.ndarray, np.ndarray, float]:
    """Detecta, sigue y ubica en zonas a las personas del vídeo.

    Si se pasa `registro` (una lista), se le añade `(n_fotograma, ids, cajas)` por
    cada fotograma procesado, para dibujar luego el vídeo anotado.
    `progreso(fraccion)` se llama de vez en cuando si se pasa (para el front).
    """
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(f"No se pudo abrir el vídeo: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    ancho = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    alto = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    yolo = YOLO(modelo)
    trayectos: dict[int, Trayecto] = {}
    calor = np.zeros((alto, ancho), dtype=np.float32)
    fondo = None

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
        if progreso is not None and total and n % 50 == 1:
            progreso(min(n / total, 1.0))

        res = yolo.track(
            frame, persist=True, classes=[CLASE_PERSONA], conf=confianza,
            tracker="bytetrack.yaml", verbose=False,
        )[0]
        cajas = res.boxes
        ids = cajas.id.int().tolist() if cajas.id is not None else []
        xyxy = cajas.xyxy.cpu().numpy() if len(ids) else np.empty((0, 4))
        if reid is not None and ids:
            reid.observar(frame, t, ids, xyxy)
        if registro is not None:
            registro.append((n - 1, ids, xyxy))

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

    for tr in trayectos.values():
        tr.cerrar_zona(tr.ultimo_t)
    cap.release()
    return trayectos, calor, fondo, t


def escribir_video_anotado(video: str, registro: list, personas: dict[int, int],
                           config: Config, ruta: Path) -> Path:
    """Vuelve a leer el vídeo y dibuja cada persona con su id único (P1, P2...).

    Los trayectos descartados por cortos se dibujan en gris. Si hay ffmpeg, el
    resultado se recodifica en H.264 para que se pueda ver en el navegador.
    """
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    ancho = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    alto = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    paso = (registro[1][0] - registro[0][0]) if len(registro) > 1 else 1
    crudo = ruta.with_suffix(".tmp.mp4")
    escritor = cv2.VideoWriter(str(crudo), cv2.VideoWriter_fourcc(*"mp4v"), fps / paso, (ancho, alto))
    pendientes = iter(registro)
    actual = next(pendientes, None)
    n = 0
    while actual is not None:
        ok, frame = cap.read()
        if not ok:
            break
        if n == actual[0]:
            frame = dibujar_zonas(frame, config)
            for tid, caja in zip(actual[1], actual[2]):
                x1, y1, x2, y2 = caja.astype(int)
                pid = personas.get(tid)
                color = _color_persona(pid) if pid else (160, 160, 160)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                etiqueta = f"P{pid}" if pid else "corto"
                cv2.putText(frame, etiqueta, (x1, max(y1 - 6, 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            escritor.write(frame)
            actual = next(pendientes, None)
        n += 1
    cap.release()
    escritor.release()
    return _a_h264(crudo, ruta)


def _color_persona(pid: int) -> tuple[int, int, int]:
    tono = (pid * 47) % 180
    hsv = np.uint8([[[tono, 220, 255]]])
    return tuple(int(c) for c in cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0, 0])


def _ffmpeg() -> str | None:
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _a_h264(origen: Path, destino: Path) -> Path:
    ff = _ffmpeg()
    if ff is None:
        origen.replace(destino)
        return destino
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(origen), "-c:v", "libx264",
                        "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destino)])
    if r.returncode == 0:
        origen.unlink(missing_ok=True)
    else:
        origen.replace(destino)
    return destino


def personas_unicas(trayectos: dict[int, Trayecto], config: Config,
                    reid: Reidentificador | None) -> dict[int, int]:
    """Id de persona por trayecto válido; sin re-identificación, uno por trayecto."""
    validos = {i: (t.primer_t, t.ultimo_t) for i, t in trayectos.items()
               if t.ultimo_t - t.primer_t >= config.min_segundos_visita}
    if reid is None:
        return {i: n for n, i in enumerate(sorted(validos), 1)}
    return agrupar(validos, reid)


def guardar_eventos(trayectos: dict[int, Trayecto], config: Config, ruta_db: Path,
                    personas: dict[int, int] | None = None) -> int:
    """Guarda visitas y estancias por zona en SQLite. Devuelve visitas válidas.

    Cada fila de `visitas` es un trayecto (conteo total); `persona_id` agrupa los
    trayectos de la misma persona (conteo único).
    """
    ruta_db.unlink(missing_ok=True)
    con = sqlite3.connect(ruta_db)
    con.executescript(
        """
        CREATE TABLE visitas (id INTEGER PRIMARY KEY, persona_id INTEGER, tienda TEXT, inicio TEXT, fin TEXT, segundos REAL);
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
        persona = (personas or {}).get(tr.id, tr.id)
        con.execute("INSERT INTO visitas VALUES (?,?,?,?,?,?)",
                    (tr.id, persona, config.tienda, ts(tr.primer_t), ts(tr.ultimo_t), round(dur, 2)))
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


def analizar(video: str, config: Config, salida: Path, modelo: str = "yolo11n.pt",
             paso: int = 2, confianza: float = 0.35, video_anotado: bool = False,
             max_frames: int | None = None, modelo_reid: str | None = "modelos/mars-small128.onnx",
             parametros_reid: ParametrosReid | None = None, progreso=None) -> dict:
    """Procesa un vídeo de principio a fin y deja los resultados en `salida`.

    Con `modelo_reid=None` no se re-identifica: cada trayecto cuenta como persona.
    Si el modelo indicado no existe, se usa solo color de ropa y continuidad.
    """
    salida.mkdir(parents=True, exist_ok=True)
    reid = None
    aviso = None
    if modelo_reid is not None:
        if not Path(modelo_reid).exists():
            aviso = f"No se encontró {modelo_reid}; la re-identificación usa solo color de ropa."
            modelo_reid = ""
        reid = Reidentificador(modelo_reid or None, parametros=parametros_reid)
    registro: list | None = [] if video_anotado else None
    trayectos, calor, fondo, dur = procesar(
        video, config, modelo, paso, confianza, registro, max_frames, reid, progreso)
    personas = personas_unicas(trayectos, config, reid)
    validas = guardar_eventos(trayectos, config, salida / "eventos.sqlite", personas)
    if fondo is not None:
        guardar_mapa_calor(calor, fondo, salida / "mapa_calor.png")
        cv2.imwrite(str(salida / "zonas.png"), dibujar_zonas(fondo, config))
    if registro:
        escribir_video_anotado(video, registro, personas, config, salida / "video_anotado.mp4")
    resumen = {
        "segundos_video": round(dur, 1),
        "trayectos_detectados": len(trayectos),
        "conteo_total": validas,
        "personas_unicas": len(set(personas.values())),
        "reidentificacion": "desactivada" if reid is None else (modelo_reid or "solo color"),
    }
    if aviso:
        resumen["aviso"] = aviso
    (salida / "procesado.json").write_text(json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8")
    return resumen


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
    ap.add_argument("--sin-reid", action="store_true", help="no unir trayectos de la misma persona")
    ap.add_argument("--modelo-reid", default="modelos/mars-small128.onnx",
                    help="modelo ONNX de re-identificación (ver scripts/descargar_modelos.sh)")
    ap.add_argument("--umbral-reentrada", type=float, default=ParametrosReid.umbral_reentrada,
                    help="similitud para unir trayectos separados en el tiempo (más bajo = más fusiones)")
    args = ap.parse_args()

    resumen = analizar(
        args.video, cargar_config(args.config), Path(args.salida), args.modelo, args.paso,
        args.confianza, args.video_anotado, args.max_frames,
        None if args.sin_reid else args.modelo_reid,
        ParametrosReid(umbral_reentrada=args.umbral_reentrada),
    )
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
