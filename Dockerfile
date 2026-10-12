# Front de analítica (Streamlit) con el análisis de vídeo en el servidor.
# Construir:  docker build -t analitica-tienda .
# Probar:     docker run -p 8080:8080 analitica-tienda   y abrir http://localhost:8080

# --- Etapa 1: convierte el modelo de re-identificación a ONNX (necesita TensorFlow solo aquí)
FROM python:3.11-slim AS modelos
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/descargar_modelos.sh scripts/
RUN ./scripts/descargar_modelos.sh

# --- Etapa 2: aplicación
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
# PyTorch solo CPU: la imagen pesa mucho menos y los servidores sin GPU no lo necesitan.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY --from=modelos /app/modelos ./modelos
COPY tienda_analytics ./tienda_analytics
COPY config ./config
COPY data/tickets_ejemplo.csv ./data/
# Descarga YOLO11n al construir para no hacerlo en cada arranque.
RUN python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"
ENV PORT=8080 STREAMLIT_SERVER_MAX_UPLOAD_SIZE=2048
EXPOSE 8080
CMD streamlit run tienda_analytics/app.py --server.port=$PORT --server.address=0.0.0.0 --server.headless=true
