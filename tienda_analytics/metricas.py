"""Calcula el embudo físico y las métricas por zona a partir de eventos y tickets.

Uso:
    python -m tienda_analytics.metricas --eventos salida/eventos.sqlite \
        --tickets data/tickets_ejemplo.csv --config config/zonas_pasillo.json
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from .zonas import cargar_config


@dataclass
class MetricaZona:
    zona: str
    categoria: str | None
    visitantes: int
    pct_visitantes: float
    permanencia_media_s: float
    interacciones: int
    tickets_categoria: int
    conversion_zona: float


@dataclass
class Resumen:
    desde: str
    hasta: str
    conteo_total: int       # trayectos contados (una persona puede sumar varios)
    visitantes: int         # personas únicas tras re-identificación
    interactuaron: int
    tickets: int
    importe_total: float
    conversion: float
    ticket_medio: float
    venta_por_visitante: float
    cruces_por_linea: dict[str, int]
    embudo: list[dict]
    zonas: list[MetricaZona]


def leer_tickets(ruta: str | Path, desde: datetime, hasta: datetime) -> list[dict]:
    """Tickets del TPV dentro de la ventana [desde, hasta]."""
    tickets = []
    with open(ruta, newline="", encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            momento = datetime.fromisoformat(fila["fecha_hora"])
            if desde <= momento <= hasta:
                tickets.append({
                    "id": fila["ticket_id"],
                    "momento": momento,
                    "importe": float(fila["importe"]),
                    "categorias": {c.strip() for c in fila.get("categorias", "").split(";") if c.strip()},
                })
    return tickets


def _tasa(a: float, b: float) -> float:
    return round(a / b, 4) if b else 0.0


def calcular(eventos: str | Path, tickets_csv: str | Path | None, config_ruta: str | Path) -> Resumen:
    config = cargar_config(config_ruta)
    con = sqlite3.connect(eventos)
    visitas = con.execute("SELECT id, persona_id, inicio, fin FROM visitas").fetchall()
    estancias = con.execute("SELECT visita_id, zona, categoria, segundos FROM estancias").fetchall()
    cruces = con.execute("SELECT linea, COUNT(*) FROM cruces GROUP BY linea").fetchall()
    con.close()

    if visitas:
        desde = min(datetime.fromisoformat(v[2]) for v in visitas)
        hasta = max(datetime.fromisoformat(v[3]) for v in visitas)
    else:
        desde = hasta = config.video_inicio
    tickets = leer_tickets(tickets_csv, desde, hasta) if tickets_csv else []

    persona_de = {v[0]: (v[1] if v[1] is not None else v[0]) for v in visitas}
    n_visitas = len(set(persona_de.values()))
    # Tiempo total por persona y zona (una persona puede entrar y salir varias veces).
    por_zona: dict[str, dict[int, float]] = {z.nombre: {} for z in config.zonas}
    for visita_id, zona, _, seg in estancias:
        persona = persona_de.get(visita_id, visita_id)
        por_zona.setdefault(zona, {})
        por_zona[zona][persona] = por_zona[zona].get(persona, 0.0) + seg

    umbral = config.interaccion_segundos
    interactuaron = {
        vid for tiempos in por_zona.values() for vid, seg in tiempos.items() if seg >= umbral
    }
    zonas = []
    for z in config.zonas:
        tiempos = por_zona.get(z.nombre, {})
        tickets_cat = sum(1 for t in tickets if z.categoria and z.categoria in t["categorias"])
        zonas.append(MetricaZona(
            zona=z.nombre,
            categoria=z.categoria,
            visitantes=len(tiempos),
            pct_visitantes=_tasa(len(tiempos), n_visitas),
            permanencia_media_s=round(sum(tiempos.values()) / len(tiempos), 1) if tiempos else 0.0,
            interacciones=sum(1 for s in tiempos.values() if s >= umbral),
            tickets_categoria=tickets_cat,
            conversion_zona=_tasa(tickets_cat, len(tiempos)),
        ))

    importe = round(sum(t["importe"] for t in tickets), 2)
    embudo = [
        {"etapa": "Visitantes únicos", "personas": n_visitas},
        {"etapa": f"Se detuvieron ≥{umbral:g} s en una zona", "personas": len(interactuaron)},
        {"etapa": "Compraron (tickets)", "personas": len(tickets)},
    ]
    for i, paso in enumerate(embudo):
        paso["tasa_desde_anterior"] = 1.0 if i == 0 else _tasa(paso["personas"], embudo[i - 1]["personas"])

    return Resumen(
        desde=desde.isoformat(timespec="seconds"),
        hasta=hasta.isoformat(timespec="seconds"),
        conteo_total=len(visitas),
        visitantes=n_visitas,
        interactuaron=len(interactuaron),
        tickets=len(tickets),
        importe_total=importe,
        conversion=_tasa(len(tickets), n_visitas),
        ticket_medio=round(importe / len(tickets), 2) if tickets else 0.0,
        venta_por_visitante=round(importe / n_visitas, 2) if n_visitas else 0.0,
        cruces_por_linea=dict(cruces),
        embudo=embudo,
        zonas=zonas,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eventos", required=True)
    ap.add_argument("--tickets", default=None)
    ap.add_argument("--config", required=True)
    ap.add_argument("--json", default=None, help="guardar el resumen en este archivo")
    args = ap.parse_args()
    r = calcular(args.eventos, args.tickets, args.config)
    texto = json.dumps(asdict(r), indent=2, ensure_ascii=False)
    if args.json:
        Path(args.json).write_text(texto, encoding="utf-8")
    print(texto)


if __name__ == "__main__":
    main()
