"""Front del prototipo: subir vídeos y tickets, procesarlos y ver los resultados.

Uso:
    streamlit run tienda_analytics/app.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from tienda_analytics.metricas import calcular  # noqa: E402
from tienda_analytics.pipeline import analizar  # noqa: E402
from tienda_analytics.zonas import cargar_config  # noqa: E402

# En un servidor, DATOS_APP apunta a un disco persistente para no perder los análisis.
DATOS = Path(os.environ.get("DATOS_APP", RAIZ / "datos_app"))
ANALISIS = DATOS / "analisis"
TICKETS = DATOS / "tickets.csv"
CONFIGS = RAIZ / "config"
MODELO_REID = RAIZ / "modelos" / "mars-small128.onnx"
COLUMNAS_TICKETS = ["ticket_id", "fecha_hora", "importe", "categorias"]


def pct(x: float) -> str:
    return f"{x * 100:.0f} %"


def leer_tickets() -> pd.DataFrame:
    if not TICKETS.exists():
        return pd.DataFrame(columns=COLUMNAS_TICKETS)
    df = pd.read_csv(TICKETS, dtype={"ticket_id": str, "categorias": str})
    df["fecha_hora"] = pd.to_datetime(df["fecha_hora"])
    return df


def lista_analisis() -> list[dict]:
    if not ANALISIS.exists():
        return []
    metas = []
    for d in ANALISIS.iterdir():
        meta = d / "meta.json"
        if meta.exists():
            metas.append(json.loads(meta.read_text(encoding="utf-8")) | {"carpeta": str(d)})
    return sorted(metas, key=lambda m: m["procesado"], reverse=True)


# ---------------------------------------------------------------- páginas

def pagina_subir() -> None:
    st.header("Subir y procesar un vídeo")
    video = st.file_uploader("Vídeo de la cámara", type=["mp4", "avi", "mov", "mkv"])
    configs = sorted(p.name for p in CONFIGS.glob("*.json"))
    col1, col2 = st.columns(2)
    nombre_config = col1.selectbox("Zonas de la cámara", configs)
    config_subida = col2.file_uploader("…o sube un JSON de zonas", type=["json"])
    config_base = cargar_config(CONFIGS / nombre_config)
    col3, col4 = st.columns(2)
    fecha = col3.date_input("Fecha de la grabación", config_base.video_inicio.date())
    hora = col4.time_input("Hora del primer fotograma", config_base.video_inicio.time(), step=60)
    with st.expander("Opciones avanzadas"):
        paso = st.slider("Procesar 1 de cada N fotogramas", 1, 6, 2,
                         help="Más alto = más rápido, menos preciso.")
        reid = st.checkbox("Contar clientes únicos (re-identificación)", True)
        anotado = st.checkbox("Generar vídeo anotado con cada persona", True)

    if not video or not st.button("Procesar", type="primary"):
        return

    ident = datetime.now().strftime("%Y%m%d-%H%M%S")
    carpeta = ANALISIS / ident
    carpeta.mkdir(parents=True, exist_ok=True)
    ruta_video = carpeta / f"original{Path(video.name).suffix}"
    ruta_video.write_bytes(video.getbuffer())

    datos_config = (json.loads(config_subida.getvalue()) if config_subida
                    else json.loads((CONFIGS / nombre_config).read_text(encoding="utf-8")))
    datos_config["video_inicio"] = datetime.combine(fecha, hora).isoformat()
    ruta_config = carpeta / "config.json"
    ruta_config.write_text(json.dumps(datos_config, indent=2, ensure_ascii=False), encoding="utf-8")

    barra = st.progress(0.0, "Detectando y siguiendo personas…")
    resumen = analizar(
        str(ruta_video), cargar_config(ruta_config), carpeta, paso=paso, video_anotado=anotado,
        modelo_reid=str(MODELO_REID) if reid else None,
        progreso=lambda f: barra.progress(f, f"Detectando y siguiendo personas… {f:.0%}"),
    )
    barra.progress(1.0, "Listo")
    ruta_video.unlink(missing_ok=True)  # no guardamos el vídeo original
    meta = {"id": ident, "video": video.name, "procesado": ident, "tienda": datos_config.get("tienda", ""),
            "inicio": datos_config["video_inicio"]} | resumen
    (carpeta / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    if "aviso" in resumen:
        st.warning(resumen["aviso"])
    st.success(f"Procesado: {resumen['conteo_total']} conteos, {resumen['personas_unicas']} clientes únicos. "
               "Míralo en Resultados.")


def pagina_ventas() -> None:
    st.header("Ventas (tickets del TPV)")
    st.caption("CSV con columnas: " + ", ".join(COLUMNAS_TICKETS) + ". Categorías separadas por «;».")
    subida = st.file_uploader("Subir tickets", type=["csv"])
    modo = st.radio("Al subir", ["Añadir a los existentes", "Reemplazar todo"], horizontal=True)
    if subida and st.button("Guardar tickets", type="primary"):
        nuevos = pd.read_csv(subida, dtype={"ticket_id": str, "categorias": str})
        faltan = set(COLUMNAS_TICKETS) - set(nuevos.columns)
        if faltan:
            st.error(f"Faltan columnas: {', '.join(sorted(faltan))}")
        else:
            nuevos["fecha_hora"] = pd.to_datetime(nuevos["fecha_hora"])
            df = nuevos if modo == "Reemplazar todo" else pd.concat([leer_tickets(), nuevos])
            df = df.drop_duplicates("ticket_id", keep="last").sort_values("fecha_hora")
            DATOS.mkdir(parents=True, exist_ok=True)
            df.to_csv(TICKETS, index=False, columns=COLUMNAS_TICKETS)
            st.success(f"{len(nuevos)} tickets guardados.")

    df = leer_tickets()
    if df.empty:
        st.info("Aún no hay tickets. Puedes probar con data/tickets_ejemplo.csv.")
        return
    c1, c2, c3 = st.columns(3)
    c1.metric("Tickets", len(df))
    c2.metric("Ventas", f"{df['importe'].sum():,.2f} €")
    c3.metric("Ticket medio", f"{df['importe'].mean():,.2f} €")
    st.subheader("Tickets")
    st.dataframe(df, hide_index=True, width="stretch")
    cat = df.assign(categoria=df["categorias"].fillna("").str.split(";")).explode("categoria")
    cat = cat[cat["categoria"].str.strip() != ""]
    st.subheader("Por categoría")
    st.dataframe(cat.groupby("categoria").agg(tickets=("ticket_id", "nunique"), importe=("importe", "sum"))
                 .reset_index(), hide_index=True, width="stretch")
    st.subheader("Por hora")
    st.bar_chart(df.groupby(df["fecha_hora"].dt.floor("h"))["importe"].sum())


def pagina_resultados() -> None:
    st.header("Resultados")
    analisis = lista_analisis()
    if not analisis:
        st.info("Aún no hay vídeos procesados.")
        return
    etiquetas = {f"{a['video']} · {a['inicio'].replace('T', ' ')}": a for a in analisis}
    a = etiquetas[st.selectbox("Vídeo", list(etiquetas))]
    carpeta = Path(a["carpeta"])

    tickets = TICKETS if TICKETS.exists() else None
    if tickets is None:
        # Sin tickets propios usamos un CSV vacío con cabecera para que las métricas funcionen.
        vacio = Path(tempfile.gettempdir()) / "tickets_vacio.csv"
        vacio.write_text(",".join(COLUMNAS_TICKETS) + "\n", encoding="utf-8")
        tickets = vacio
        st.warning("No hay tickets cargados: la conversión saldrá en 0. Súbelos en Ventas.")
    r = calcular(carpeta / "eventos.sqlite", tickets, carpeta / "config.json")
    st.caption(f"Periodo: {r.desde.replace('T', ' ')} a {r.hasta.replace('T', ' ')} · "
               f"re-identificación: {Path(a.get('reidentificacion', '—')).name}")

    c = st.columns(6)
    c[0].metric("Conteo total", r.conteo_total, help="Cada trayecto detectado cuenta una vez.")
    c[1].metric("Clientes únicos", r.visitantes, help="Trayectos de la misma persona unidos.")
    c[2].metric("Se detuvieron", r.interactuaron)
    c[3].metric("Tickets", r.tickets)
    c[4].metric("Conversión", pct(r.conversion), help="Tickets ÷ clientes únicos.")
    c[5].metric("Venta por cliente", f"{r.venta_por_visitante:.2f} €")

    pest = st.tabs(["Embudo y zonas", "Ventas del periodo", "Personas", "Vídeo y mapa"])
    with pest[0]:
        embudo = pd.DataFrame(r.embudo)
        st.bar_chart(embudo, x="etapa", y="personas", horizontal=True, sort=False)
        embudo["paso"] = embudo["tasa_desde_anterior"].map(pct)
        st.dataframe(embudo[["etapa", "personas", "paso"]], hide_index=True, width="stretch")
        zonas = pd.DataFrame([z.__dict__ for z in r.zonas])
        zonas["pct_visitantes"] = zonas["pct_visitantes"].map(pct)
        zonas["conversion_zona"] = zonas["conversion_zona"].map(pct)
        st.dataframe(zonas.rename(columns={
            "zona": "Zona", "categoria": "Categoría", "visitantes": "Clientes únicos",
            "pct_visitantes": "% del total", "permanencia_media_s": "Permanencia media (s)",
            "interacciones": "Paradas largas", "tickets_categoria": "Tickets con la categoría",
            "conversion_zona": "Conversión de zona",
        }), hide_index=True, width="stretch")

    with pest[1]:
        df = leer_tickets()
        if not df.empty:
            df = df[(df["fecha_hora"] >= r.desde) & (df["fecha_hora"] <= r.hasta)]
        st.caption("Tickets del TPV dentro del periodo del vídeo.")
        st.dataframe(df, hide_index=True, width="stretch")

    with pest[2]:
        con = sqlite3.connect(carpeta / "eventos.sqlite")
        visitas = pd.read_sql("SELECT * FROM visitas", con)
        estancias = pd.read_sql("SELECT visita_id, zona, segundos FROM estancias", con)
        con.close()
        zonas_por = estancias.groupby("visita_id")["zona"].apply(lambda z: " → ".join(dict.fromkeys(z)))
        visitas["zonas"] = visitas["id"].map(zonas_por).fillna("")
        personas = (visitas.groupby("persona_id")
                    .agg(conteos=("id", "count"), primera_vez=("inicio", "min"), ultima_vez=("fin", "max"),
                         segundos=("segundos", "sum"), zonas=("zonas", lambda z: " | ".join(x for x in z if x)))
                    .reset_index().rename(columns={"persona_id": "cliente"}))
        personas["cliente"] = "P" + personas["cliente"].astype(str)
        st.caption("Un cliente con varios conteos es una persona que el seguidor perdió y se volvió a "
                   "identificar. Compara con el vídeo anotado para validar.")
        st.dataframe(personas, hide_index=True, width="stretch")
        with st.expander("Detalle de cada conteo (trayecto)"):
            st.dataframe(visitas.rename(columns={"id": "trayecto", "persona_id": "cliente"}),
                         hide_index=True, width="stretch")

    with pest[3]:
        v = carpeta / "video_anotado.mp4"
        if v.exists():
            st.video(str(v))
        col1, col2 = st.columns(2)
        if (carpeta / "mapa_calor.png").exists():
            col1.image(str(carpeta / "mapa_calor.png"), caption="Mapa de calor", width="stretch")
        if (carpeta / "zonas.png").exists():
            col2.image(str(carpeta / "zonas.png"), caption="Zonas", width="stretch")


st.set_page_config(page_title="Analítica de tienda", layout="wide")
st.title("Analítica de tienda física")
pagina = st.sidebar.radio("Sección", ["Resultados", "Subir vídeo", "Ventas"])
{"Resultados": pagina_resultados, "Subir vídeo": pagina_subir, "Ventas": pagina_ventas}[pagina]()
