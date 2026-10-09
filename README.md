# Analítica de tienda física (prototipo)

Convierte el vídeo de las cámaras de una tienda en un embudo de venta medible: visitantes, recorrido por zonas, permanencia, paradas largas frente al producto y conversión cruzada con los tickets del TPV.

El vídeo se procesa en local y solo se guardan eventos anónimos (posición, zona, hora). No hay reconocimiento facial ni se almacenan imágenes de personas.

## Cómo funciona

1. **Detección y seguimiento:** YOLO detecta personas en cada fotograma y ByteTrack les asigna un identificador temporal mientras están en cámara.
2. **Zonas y líneas:** cada persona se ubica por el punto donde pisa (borde inferior de su caja) dentro de las zonas definidas en `config/*.json`. Se registran entradas, salidas, tiempo en zona y cruces de líneas virtuales.
3. **Eventos:** se guardan en `salida/eventos.sqlite` (tablas `visitas`, `estancias`, `cruces`).
4. **Métricas:** se cruzan los eventos con los tickets del TPV (`data/tickets_ejemplo.csv`) en la misma ventana de tiempo.
5. **Panel:** Streamlit muestra el embudo, la tabla por zona y el mapa de calor.

## Uso

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./scripts/descargar_videos.sh

# 1. Procesar el vídeo (descarga yolo11n.pt la primera vez)
python -m tienda_analytics.pipeline --video data/store-aisle-detection.mp4 \
    --config config/zonas_pasillo.json --salida salida --video-anotado

# 2. Ver las métricas en consola
python -m tienda_analytics.metricas --eventos salida/eventos.sqlite \
    --tickets data/tickets_ejemplo.csv --config config/zonas_pasillo.json

# 3. Abrir el panel
streamlit run tienda_analytics/panel.py -- --salida salida \
    --tickets data/tickets_ejemplo.csv --config config/zonas_pasillo.json

# Pruebas
pytest -q
```

Para usar una cámara en directo, pasa la URL RTSP en `--video` (por ejemplo `rtsp://usuario:clave@ip:554/stream`).

## Configurar una tienda nueva

Copia `config/zonas_pasillo.json` y ajusta:

- `zonas`: polígonos en píxeles de la imagen de la cámara, cada uno con la `categoria` de producto que se vende ahí (debe coincidir con las categorías de los tickets).
- `lineas`: líneas virtuales para contar cruces (por ejemplo, la puerta de entrada).
- `video_inicio`: fecha y hora real del primer fotograma, para cruzar con los tickets.
- `interaccion_segundos`: a partir de cuántos segundos en una zona cuenta como parada larga.

`salida/zonas.png` muestra las zonas dibujadas sobre la cámara para comprobar la calibración.

## Formato de tickets

```csv
ticket_id,fecha_hora,importe,categorias
T-1001,2026-10-09T11:00:21,18.50,vajilla
T-1002,2026-10-09T11:00:38,42.90,cuencos;vajilla
```

`data/tickets_ejemplo.csv` es inventado para la demo; el vídeo de prueba no tiene ventas reales asociadas.

## Limitaciones conocidas

- Una persona que sale de cámara y vuelve, o que queda tapada, puede contarse dos veces (cambio de identificador). El recorrido unificado entre cámaras está fuera de este prototipo.
- Sin GPU el procesamiento va más lento que el tiempo real con `--paso 1`; `--paso 2` (por defecto) procesa uno de cada dos fotogramas.
- El personal de la tienda aún no se excluye del conteo.

## Vídeo de prueba

`store-aisle-detection.mp4` de [intel-iot-devkit/sample-videos](https://github.com/intel-iot-devkit/sample-videos), licencia CC BY 4.0.
