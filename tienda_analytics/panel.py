"""Panel web del prototipo.

Uso:
    streamlit run tienda_analytics/panel.py -- --salida salida \
        --tickets data/tickets_ejemplo.csv --config config/zonas_pasillo.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tienda_analytics.metricas import calcular  # noqa: E402


def argumentos() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="salida")
    ap.add_argument("--tickets", default="data/tickets_ejemplo.csv")
    ap.add_argument("--config", default="config/zonas_pasillo.json")
    return ap.parse_args(sys.argv[1:])


def pct(x: float) -> str:
    return f"{x * 100:.0f} %"


args = argumentos()
salida = Path(args.salida)
st.set_page_config(page_title="Analítica de tienda", layout="wide")
st.title("Embudo de la tienda física")

eventos = salida / "eventos.sqlite"
if not eventos.exists():
    st.error(f"No hay eventos en {eventos}. Ejecuta antes el pipeline sobre un vídeo.")
    st.stop()

r = calcular(eventos, args.tickets, args.config)
st.caption(f"Periodo analizado: {r.desde} a {r.hasta}")

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Visitantes", r.visitantes)
c2.metric("Se detuvieron", r.interactuaron)
c3.metric("Tickets", r.tickets)
c4.metric("Conversión", pct(r.conversion))
c5.metric("Venta por visitante", f"{r.venta_por_visitante:.2f} €")

st.subheader("Embudo")
embudo = pd.DataFrame(r.embudo)
st.bar_chart(embudo, x="etapa", y="personas", horizontal=True, sort=False)
embudo["paso"] = embudo["tasa_desde_anterior"].map(pct)
st.dataframe(embudo[["etapa", "personas", "paso"]], hide_index=True, use_container_width=True)

st.subheader("Zonas")
zonas = pd.DataFrame([z.__dict__ for z in r.zonas])
zonas["pct_visitantes"] = zonas["pct_visitantes"].map(pct)
zonas["conversion_zona"] = zonas["conversion_zona"].map(pct)
zonas = zonas.rename(columns={
    "zona": "Zona", "categoria": "Categoría", "visitantes": "Visitantes",
    "pct_visitantes": "% del total", "permanencia_media_s": "Permanencia media (s)",
    "interacciones": "Paradas largas", "tickets_categoria": "Tickets con la categoría",
    "conversion_zona": "Conversión de zona",
})
st.dataframe(zonas, hide_index=True, use_container_width=True)

col_a, col_b = st.columns(2)
if (salida / "mapa_calor.png").exists():
    col_a.subheader("Mapa de calor")
    col_a.image(str(salida / "mapa_calor.png"), use_container_width=True)
if (salida / "zonas.png").exists():
    col_b.subheader("Zonas configuradas")
    col_b.image(str(salida / "zonas.png"), use_container_width=True)

if r.cruces_por_linea:
    st.subheader("Cruces de línea")
    st.dataframe(
        pd.DataFrame(list(r.cruces_por_linea.items()), columns=["Línea", "Cruces"]),
        hide_index=True,
    )
