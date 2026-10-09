# Analítica de tienda física (prototipo)

Convierte el vídeo de las cámaras de una tienda en un embudo de venta medible: conteo total y clientes únicos, recorrido por zonas, permanencia, paradas largas frente al producto y conversión cruzada con los tickets del TPV.

El vídeo se procesa en local y solo se guardan eventos anónimos (posición, zona, hora, id de cliente). No hay reconocimiento facial ni se almacenan imágenes de personas; el front borra el vídeo original tras procesarlo.

## Cómo funciona

1. **Detección y seguimiento:** YOLO detecta personas en cada fotograma y ByteTrack les asigna un identificador temporal mientras están en cámara.
2. **Clientes únicos (re-identificación):** el seguidor pierde a una persona cuando queda tapada o sale de cámara y le da un id nuevo al volver. `reid.py` une esos trayectos:
   - **Costura:** un trayecto que empieza justo donde y cuando acabó otro, con apariencia compatible, es la misma persona.
   - **Re-entrada:** dos trayectos separados en el tiempo solo se unen si la apariencia es casi idéntica (umbral alto, ajustable con `--umbral-reentrada`).
   - Dos trayectos simultáneos nunca se unen.
   - La apariencia sale de un modelo de re-identificación de personas (cuerpo y ropa, no rostro) y del color de la ropa por franjas. Vive solo en memoria durante el procesado.
3. **Zonas y líneas:** cada persona se ubica por el punto donde pisa dentro de las zonas de `config/*.json`. Se registran entradas, salidas, tiempo en zona y cruces de líneas virtuales.
4. **Eventos:** `eventos.sqlite` con `visitas` (un trayecto por fila, con su `persona_id`), `estancias` y `cruces`.
5. **Métricas:** **conteo total** = trayectos contados; **clientes únicos** = personas distintas. La conversión usa clientes únicos.
6. **Front:** Streamlit para subir vídeos y tickets y ver embudo, zonas, ventas del periodo, personas, vídeo anotado y mapa de calor.

## Uso

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./scripts/descargar_videos.sh     # vídeos de prueba en data/
./scripts/descargar_modelos.sh    # modelo de re-identificación en modelos/

# Front: subir vídeos y tickets, ver resultados
streamlit run tienda_analytics/app.py

# O por línea de comandos
python -m tienda_analytics.pipeline --video data/store-aisle-detection.mp4 \
    --config config/zonas_pasillo.json --salida salida --video-anotado
python -m tienda_analytics.metricas --eventos salida/eventos.sqlite \
    --tickets data/tickets_ejemplo.csv --config config/zonas_pasillo.json

pytest -q
```

Sin `modelos/mars-small128.onnx` la re-identificación usa solo el color de la ropa y avisa. Para usar una cámara en directo, pasa la URL RTSP en `--video`.

## Validación del conteo único

Con los parámetros por defecto, frente a un conteo manual de cada vídeo:

| Vídeo | Conteo total | Clientes únicos | Personas reales | Fusiones erróneas |
| --- | --- | --- | --- | --- |
| store-aisle-detection (pasillo, 65 s) | 12 | 8 | 6 | 0 |
| people-detection (sala, 50 s) | 7 | 7 | 7 | 0 |
| one-by-one-person-detection (sala, 140 s) | 6 | 6 | 6 | 0 |
| entrada_cenital (paso peatonal, 43 s) | 8 | 8 | 8 | 0 |

El sistema está ajustado para no fusionar nunca a dos clientes distintos, aunque a cambio a veces cuente de más a alguien que desaparece varios segundos y vuelve a otra parte de la imagen. Con el modelo MARS incluido, personas distintas con ropa parecida llegan a puntuar más que la misma persona vista de nuevo, por eso la re-entrada lejana es muy estricta. Un modelo más fuerte (OSNet entrenado en MSMT17, exportado a ONNX con entrada BGR 128x64) permitiría bajar `--umbral-reentrada`.

## Configurar una tienda nueva

Copia `config/zonas_pasillo.json` y ajusta:

- `zonas`: polígonos en píxeles de la imagen de la cámara, cada uno con la `categoria` de producto que se vende ahí (debe coincidir con las categorías de los tickets).
- `lineas`: líneas virtuales para contar cruces (por ejemplo, la puerta de entrada).
- `video_inicio`: fecha y hora real del primer fotograma, para cruzar con los tickets (en el front se elige al subir el vídeo).
- `interaccion_segundos`: a partir de cuántos segundos en una zona cuenta como parada larga.

`zonas.png` muestra las zonas dibujadas sobre la cámara para comprobar la calibración.

## Formato de tickets

```csv
ticket_id,fecha_hora,importe,categorias
T-1001,2026-10-09T11:00:21,18.50,vajilla
T-1002,2026-10-09T11:00:38,42.90,cuencos;vajilla
```

`data/tickets_ejemplo.csv` es inventado para la demo; los vídeos de prueba no tienen ventas reales asociadas.

## Limitaciones conocidas

- Re-entradas tras varios segundos fuera de cámara pueden contarse como cliente nuevo (ver Validación).
- Sin GPU el procesamiento va más lento que el tiempo real; `--paso 2` (por defecto) procesa uno de cada dos fotogramas.
- El personal de la tienda aún no se excluye del conteo.
- Cada cámara se analiza por separado; el recorrido entre cámaras está fuera de este prototipo.

## Vídeos y modelos de terceros

- `store-aisle-detection.mp4`, `people-detection.mp4`, `one-by-one-person-detection.mp4`, `worker-zone-detection.mp4`: [intel-iot-devkit/sample-videos](https://github.com/intel-iot-devkit/sample-videos), CC BY 4.0.
- `entrada_cenital.mp4`: `test_1.mp4` de [saimj7/People-Counting-in-Real-Time](https://github.com/saimj7/People-Counting-in-Real-Time), MIT.
- `mars-small128`: modelo de re-identificación de [Deep SORT](https://github.com/nwojke/deep_sort), GPL-3.0. No se incluye en el repositorio; lo descarga `scripts/descargar_modelos.sh`.
