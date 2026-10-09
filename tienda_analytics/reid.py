"""Re-identificación para contar clientes únicos.

El seguidor (ByteTrack) pierde a una persona cuando queda tapada o sale de
cámara un instante y le asigna un identificador nuevo al volver. Si no se
corrige, una misma persona cuenta varias veces. Este módulo une esos fragmentos
en dos pasos:

1. **Costura de fragmentos:** un trayecto que empieza justo donde y cuando acabó
   otro (hueco corto, salto pequeño) y con apariencia compatible es la misma
   persona. Corrige la mayoría de los duplicados.
2. **Re-entrada:** dos trayectos separados en el tiempo se unen solo si la
   apariencia es casi idéntica (umbral alto). Con el modelo incluido es
   conservador a propósito: preferimos contar de más a fusionar a dos clientes.

Dos trayectos que estuvieron en cámara a la vez nunca son la misma persona.

Privacidad: no usa el rostro ni biometría. La apariencia (vector del modelo de
re-identificación y color de la ropa por franjas) vive solo en memoria durante
el procesado; a la base de datos solo llega el identificador de persona.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class Firma:
    """Apariencia y extremos de un trayecto."""

    vectores: list[np.ndarray] = field(default_factory=list)
    colores: list[np.ndarray] = field(default_factory=list)
    ultimo_t: float = -1e9  # última muestra tomada
    t_inicio: float | None = None
    t_fin: float = 0.0
    pos_inicio: tuple[float, float] = (0.0, 0.0)
    pos_fin: tuple[float, float] = (0.0, 0.0)


@dataclass
class ParametrosReid:
    umbral_costura: float = 0.65    # apariencia mínima para coser fragmentos contiguos
    umbral_reentrada: float = 0.93  # similitud del modelo para unir trayectos lejanos
    color_reentrada: float = 0.3    # y color de ropa mínimo (centrado) para lo mismo
    max_hueco_s: float = 2.0        # hueco máximo entre fragmentos contiguos
    max_salto: float = 0.15         # salto máximo, en fracción de la diagonal de la imagen
    solape_max_s: float = 0.5       # más solape que esto: son personas distintas


def _media(lista: list[np.ndarray], centro: np.ndarray | None = None) -> np.ndarray | None:
    """Media normalizada; con `centro`, tras restar la apariencia media del vídeo."""
    if not lista:
        return None
    x = np.asarray(lista, dtype=np.float32)
    if centro is not None:
        x = x - centro
        x /= np.linalg.norm(x, axis=1, keepdims=True) + 1e-9
    m = x.mean(axis=0)
    return m / (np.linalg.norm(m) + 1e-9)


def histograma_ropa(recorte: np.ndarray) -> np.ndarray:
    """Color por franjas: cabeza (pelo o gorra), torso y piernas. No mira el rostro."""
    h = recorte.shape[0]
    hsv = cv2.cvtColor(recorte, cv2.COLOR_BGR2HSV)
    partes = [hsv[:int(h * 0.18)], hsv[int(h * 0.18):int(h * 0.5)], hsv[int(h * 0.5):int(h * 0.9)]]
    hists = []
    for p in partes:
        if p.size == 0:
            hists.append(np.zeros(16 * 4 + 8, np.float32))
            continue
        hs = cv2.calcHist([p], [0, 1], None, [16, 4], [0, 180, 0, 256]).flatten()
        v = cv2.calcHist([p], [2], None, [8], [0, 256]).flatten()
        hists.append(np.concatenate([hs, v]))
    vec = np.sqrt(np.concatenate(hists))  # raíz: la similitud coseno pasa a ser Hellinger
    return vec / (np.linalg.norm(vec) + 1e-9)


def recorte_limpio(caja: np.ndarray, otras: np.ndarray, ancho: int, alto: int,
                   min_alto: int = 60, max_solape: float = 0.15) -> bool:
    """Descarta recortes pequeños, cortados por el borde o tapados por otra persona."""
    x1, y1, x2, y2 = caja
    if y2 - y1 < min_alto or x1 < 2 or x2 > ancho - 2 or y1 < 2:
        return False
    area = (x2 - x1) * (y2 - y1)
    for o in otras:
        ix = max(0.0, min(x2, o[2]) - max(x1, o[0]))
        iy = max(0.0, min(y2, o[3]) - max(y1, o[1]))
        if ix * iy / area > max_solape:
            return False
    return True


class Reidentificador:
    """Recoge la apariencia de cada trayecto durante el procesado.

    `modelo` puede ser un modelo ONNX de re-identificación de personas (entrada
    BGR 128x64 uint8, como `modelos/mars-small128.onnx`) o, si no hay, un
    clasificador de Ultralytics como respaldo (menos fiable).
    """

    def __init__(self, modelo: str | None = None, cada_segundos: float = 0.5,
                 max_muestras: int = 12, parametros: ParametrosReid | None = None):
        self.firmas: dict[int, Firma] = {}
        self.cada = cada_segundos
        self.max_muestras = max_muestras
        self.p = parametros or ParametrosReid()
        self.diagonal = 1.0
        self.onnx = None
        self.yolo = None
        if modelo and str(modelo).endswith(".onnx"):
            import onnxruntime as ort
            self.onnx = ort.InferenceSession(str(modelo), providers=["CPUExecutionProvider"])
        elif modelo:
            from ultralytics import YOLO
            self.yolo = YOLO(modelo)

    def _embeber(self, recortes: list[np.ndarray]) -> list[np.ndarray]:
        if self.onnx is not None:
            lote = np.stack([cv2.resize(r, (64, 128)) for r in recortes]).astype(np.uint8)
            entrada = self.onnx.get_inputs()[0].name
            return list(self.onnx.run(None, {entrada: lote})[0])
        if self.yolo is not None:
            return [e.cpu().numpy() for e in self.yolo.embed(recortes, verbose=False)]
        return []

    def observar(self, frame: np.ndarray, t: float, ids: list[int], cajas: np.ndarray) -> None:
        alto, ancho = frame.shape[:2]
        self.diagonal = float(np.hypot(ancho, alto))
        pendientes, recortes = [], []
        for i, (tid, caja) in enumerate(zip(ids, cajas)):
            f = self.firmas.setdefault(tid, Firma())
            pie = (float((caja[0] + caja[2]) / 2), float(caja[3]))
            if f.t_inicio is None:
                f.t_inicio, f.pos_inicio = t, pie
            f.t_fin, f.pos_fin = t, pie
            if len(f.colores) >= self.max_muestras or t - f.ultimo_t < self.cada:
                continue
            otras = np.delete(cajas, i, axis=0)
            if not recorte_limpio(caja, otras, ancho, alto):
                continue
            x1, y1, x2, y2 = caja.astype(int)
            rec = frame[y1:y2, x1:x2]
            f.ultimo_t = t
            f.colores.append(histograma_ropa(rec))
            pendientes.append(f)
            recortes.append(rec)
        if recortes:
            for f, emb in zip(pendientes, self._embeber(recortes)):
                v = np.asarray(emb, dtype=np.float32)
                f.vectores.append(v / (np.linalg.norm(v) + 1e-9))

    def continuidad(self, a: int, b: int) -> bool:
        """¿Uno empieza justo donde y cuando acaba el otro? (cambio de id del seguidor)"""
        fa, fb = self.firmas.get(a), self.firmas.get(b)
        if fa is None or fb is None or fa.t_inicio is None or fb.t_inicio is None:
            return False
        if fb.t_inicio < fa.t_inicio:
            fa, fb = fb, fa
        hueco = fb.t_inicio - fa.t_fin
        salto = np.hypot(fb.pos_inicio[0] - fa.pos_fin[0], fb.pos_inicio[1] - fa.pos_fin[1])
        return -self.p.solape_max_s <= hueco <= self.p.max_hueco_s and salto <= self.p.max_salto * self.diagonal

    def comparar(self, a: int, b: int) -> tuple[float, float] | None:
        """(similitud del modelo, similitud de color centrada) o None sin muestras."""
        fa, fb = self.firmas.get(a), self.firmas.get(b)
        if fa is None or fb is None or not fa.colores or not fb.colores:
            return None
        colores = [v for f in self.firmas.values() for v in f.colores]
        centro = np.mean(colores, axis=0)
        color = float(_media(fa.colores, centro) @ _media(fb.colores, centro))
        va, vb = _media(fa.vectores), _media(fb.vectores)
        modelo = float(va @ vb) if va is not None and vb is not None else color
        return modelo, color

    def misma_persona(self, a: int, b: int) -> float | None:
        """Puntuación si a y b pueden ser la misma persona; None si no."""
        c = self.comparar(a, b)
        if c is None:
            return None
        modelo, color = c
        if self.continuidad(a, b):
            s = modelo + 0.5 * color
            return s if s >= self.p.umbral_costura else None
        if modelo >= self.p.umbral_reentrada and color >= self.p.color_reentrada:
            return modelo
        return None


def agrupar(tramos: dict[int, tuple[float, float]], reid: Reidentificador) -> dict[int, int]:
    """Asigna un id de persona (1, 2, ...) a cada trayecto de `tramos` {id: (inicio, fin)}.

    Une pares de trayectos de mayor a menor puntuación, sin juntar nunca dos
    grupos que tengan trayectos simultáneos.
    """
    ids = sorted(tramos)
    solape = reid.p.solape_max_s

    def simultaneos(a: int, b: int) -> bool:
        (a0, a1), (b0, b1) = tramos[a], tramos[b]
        return min(a1, b1) - max(a0, b0) > solape

    candidatos = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if not simultaneos(a, b):
                s = reid.misma_persona(a, b)
                if s is not None:
                    candidatos.append((s, a, b))

    grupo = {i: i for i in ids}
    miembros = {i: [i] for i in ids}
    for _, a, b in sorted(candidatos, reverse=True):
        ga, gb = grupo[a], grupo[b]
        if ga == gb or any(simultaneos(x, y) for x in miembros[ga] for y in miembros[gb]):
            continue
        for m in miembros[gb]:
            grupo[m] = ga
        miembros[ga].extend(miembros.pop(gb))

    orden = sorted(miembros.values(), key=lambda ms: min(tramos[m][0] for m in ms))
    return {m: n for n, ms in enumerate(orden, 1) for m in ms}
