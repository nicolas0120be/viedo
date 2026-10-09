"""Carga de la configuración de zonas y líneas, y geometría básica."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np


@dataclass
class Zona:
    nombre: str
    categoria: str | None
    poligono: np.ndarray  # (N, 2) int32

    def contiene(self, punto: tuple[float, float]) -> bool:
        return cv2.pointPolygonTest(self.poligono, (float(punto[0]), float(punto[1])), False) >= 0


@dataclass
class Linea:
    nombre: str
    a: tuple[float, float]
    b: tuple[float, float]

    def lado(self, punto: tuple[float, float]) -> int:
        """Signo del producto vectorial: en qué lado de la línea está el punto."""
        (x1, y1), (x2, y2) = self.a, self.b
        v = (x2 - x1) * (punto[1] - y1) - (y2 - y1) * (punto[0] - x1)
        return 0 if v == 0 else (1 if v > 0 else -1)

    def dentro_del_tramo(self, punto: tuple[float, float]) -> bool:
        xs = sorted((self.a[0], self.b[0]))
        return xs[0] <= punto[0] <= xs[1]


@dataclass
class Config:
    tienda: str
    video_inicio: datetime
    zonas: list[Zona]
    lineas: list[Linea]
    interaccion_segundos: float
    min_segundos_visita: float


def cargar_config(ruta: str | Path) -> Config:
    datos = json.loads(Path(ruta).read_text(encoding="utf-8"))
    zonas = [
        Zona(nombre, z.get("categoria"), np.array(z["poligono"], dtype=np.int32))
        for nombre, z in datos["zonas"].items()
    ]
    lineas = [Linea(nombre, tuple(p[0]), tuple(p[1])) for nombre, p in datos.get("lineas", {}).items()]
    return Config(
        tienda=datos.get("tienda", "tienda"),
        video_inicio=datetime.fromisoformat(datos["video_inicio"]),
        zonas=zonas,
        lineas=lineas,
        interaccion_segundos=float(datos.get("interaccion_segundos", 3.0)),
        min_segundos_visita=float(datos.get("min_segundos_visita", 1.0)),
    )


def dibujar_zonas(frame: np.ndarray, config: Config) -> np.ndarray:
    """Dibuja zonas y líneas sobre una copia del fotograma (para calibrar)."""
    salida = frame.copy()
    capa = frame.copy()
    colores = [(66, 135, 245), (80, 200, 120), (245, 166, 35), (200, 80, 200), (60, 200, 220)]
    for i, zona in enumerate(config.zonas):
        color = colores[i % len(colores)]
        cv2.fillPoly(capa, [zona.poligono], color)
        cv2.polylines(salida, [zona.poligono], True, color, 2)
        x, y = zona.poligono.mean(axis=0).astype(int)
        cv2.putText(salida, zona.nombre, (int(x) - 50, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
    salida = cv2.addWeighted(capa, 0.25, salida, 0.75, 0)
    for linea in config.lineas:
        a = tuple(int(v) for v in linea.a)
        b = tuple(int(v) for v in linea.b)
        cv2.line(salida, a, b, (0, 0, 255), 2)
        cv2.putText(salida, linea.nombre, (a[0], a[1] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
    return salida
