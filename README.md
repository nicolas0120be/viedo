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

## Analizar en el navegador (sin instalar nada)

`web/` contiene una versión del front que hace todo el análisis en el navegador de quien lo usa: sube el vídeo, dibuja zonas y líneas de paso sobre la imagen, y obtiene conteo total, clientes únicos, afluencia por intervalo, personas a la vez, embudo, recorridos entre zonas, entradas y salidas por línea, permanencia, mapa de calor, conversión con los tickets y una revisión del vídeo con cada cliente marcado. Usa los mismos modelos que el pipeline de Python (YOLO11n y MARS, con ONNX Runtime Web) y el mismo método de re-identificación, portado a JavaScript en `web/motor.js`.

```bash
./web/preparar.sh                       # deja página, motor y modelos en web/dist
python3 -m http.server -d web/dist 8000 # abre http://localhost:8000/analitica-tienda.html
```

Servida así no guarda historial (eso lo pone el visor de Artifacts de Claude); los resultados se pueden descargar en CSV.

## Desplegar en un servidor

`Dockerfile` empaqueta el front de Streamlit con el análisis en Python. `render.yaml` lo despliega en Render con un disco para los análisis (`DATOS_APP`). En Google Cloud Run las subidas están limitadas a 32 MB, poco para vídeo.

## Validación del conteo único

Con los parámetros por defecto, frente a un conteo manual de cada vídeo:

| Vídeo | Conteo total | Clientes únicos | Personas reales | Fusiones erróneas |
| --- | --- | --- | --- | --- |
| store-aisle-detection (pasillo, 65 s) | 12 | 8 | 6 | 0 |
| people-detection (sala, 50 s) | 7 | 7 | 7 | 0 |
| one-by-one-person-detection (sala, 140 s) | 6 | 6 | 6 | 0 |
| entrada_cenital (paso peatonal, 43 s) | 8 | 8 | 8 | 0 |

En el navegador (8 fotogramas por segundo) el resultado es el mismo en clientes únicos: pasillo 8, sala 7, sala uno a uno 6, entrada 8, sin fusiones erróneas, con menos tramos partidos en el pasillo (conteo total 9 frente a 12). En la entrada cenital hay unas 10 personas reales: dos cruzan en menos de 1 s y quedan fuera por la visita mínima; para cámaras de puerta conviene bajarla a 0,5 s.

### Navegador, tras la calibración (octubre de 2026)

El analizador del navegador descarta las cajas duplicadas: un trayecto que pasa más de la mitad de su tiempo encima de otro más largo (solape de cajas > 0,3). Además une los tramos de una misma persona aunque se solapen hasta 1 s. Resultados a 8 fotogramas por segundo con la biblioteca de vídeos de prueba (sección Pruebas del front):

| Vídeo | Conteo total | Clientes únicos | Personas reales |
| --- | --- | --- | --- |
| Pasillo de menaje | 8 | 6 | 6 |
| Puerta de tienda desde la calle | 5 | 5 | 5 |
| Entrada vista desde arriba | 8 | 8 | ~10 |
| Personas cruzando | 7 | 7 | 7 |
| Una persona cada vez | 6 | 6 | 6 |
| Caminan, se paran y se van | 7 | 7 | 7 |
| Caminan hacia la cámara | 7 | 7 | 7 |
| Operarios con chaleco | 6 | 5 | ~4 |
| Personas sentadas | 4 | 4 | 4 |
| Mercadillo con mucha gente | 34 | 29 | sin conteo |
| Vídeo sin personas | 0 | 0 | 0 |

Ninguno junta a dos personas distintas. `web/biblioteca.sh` prepara estos vídeos para el front.

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
- `face-demographics-walking-and-pause.mp4`, `face-demographics-walking.mp4`, `classroom.mp4`, `fruit-and-vegetable-detection.mp4`: también de intel-iot-devkit/sample-videos, CC BY 4.0.
- `entrada_tienda_calle.mp4` (`vid/peoplecount1.mp4` de [Amal-Emad/Detection-TrackingYolov8](https://github.com/Amal-Emad/Detection-TrackingYolov8)) y `mercadillo_multitud.mp4` (`crowd.mp4` de [Boo4kin/people-detection-yolo](https://github.com/Boo4kin/people-detection-yolo)): sus repositorios no declaran licencia, solo para pruebas internas.
- `entrada_cenital.mp4`: `test_1.mp4` de [saimj7/People-Counting-in-Real-Time](https://github.com/saimj7/People-Counting-in-Real-Time), MIT.
- `mars-small128`: modelo de re-identificación de [Deep SORT](https://github.com/nwojke/deep_sort), GPL-3.0. No se incluye en el repositorio; lo descarga `scripts/descargar_modelos.sh`.
- `yolo11n`: detector de [Ultralytics](https://github.com/ultralytics/ultralytics), AGPL-3.0 (para uso comercial cerrado hace falta su licencia empresarial).
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.17.3, MIT, para ejecutar los modelos en el navegador.
