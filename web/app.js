/* global Motor */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const BASE = new URL("./", location.href).href;
  const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.min.js";
  const COLORES = ["#4287f5", "#3fae6a", "#e0962a", "#b956c9", "#2ab0c4", "#d9534f", "#8a7a2b", "#5b6bd9"];
  const fmtN = (x, d = 0) => Number(x).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = (x) => fmtN(x * 100) + " %";
  const fmtEur = (x) => fmtN(x, 2) + " €";
  const fmtHora = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtFecha = (d) => d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  const fmtDur = (s) => (s < 60 ? fmtN(s) + " s" : s < 3600 ? Math.floor(s / 60) + " min " + String(Math.round(s % 60)).padStart(2, "0") + " s" : Math.floor(s / 3600) + " h " + String(Math.round((s % 3600) / 60)).padStart(2, "0") + " min");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const EJEMPLO = {
    nombre: "Pasillo de menaje (ejemplo)", archivo: "ejemplo.mp4", inicio: "2026-10-09T11:00:00",
    config: {
      zonas: [
        { nombre: "pasillo_izquierdo", categoria: "vajilla", poligono: [[0, 404], [0, 250], [150, 110], [255, 95], [235, 404]] },
        { nombre: "mesa_central", categoria: "teteras", poligono: [[255, 95], [335, 95], [400, 404], [235, 404]] },
        { nombre: "pasillo_derecho", categoria: "cuencos", poligono: [[335, 95], [430, 95], [720, 330], [720, 404], [400, 404]] },
        { nombre: "fondo", categoria: "cristaleria", poligono: [[150, 20], [440, 20], [430, 95], [255, 95], [150, 110]] },
      ],
      lineas: [{ nombre: "acceso_fondo", a: [130, 115], b: [470, 115], entrada: -1 }],
      interaccion_segundos: 3, min_segundos_visita: 1,
    },
  };
  /* Vídeos de prueba publicados junto a la página, con su conteo manual de personas reales.
     tipo: tienda | validacion | estres | control. reales: null mientras no haya conteo manual. */
  const BIBLIOTECA = [
    {"id": "pasillo-tienda", "nombre": "Pasillo de menaje", "alias": ["Pasillo de menaje (vídeo de ejemplo)", "Pasillo de menaje (ejemplo)", "store-aisle-detection.mp4"], "tipo": "tienda", "archivo": "ejemplo.mp4", "miniatura": "mini/pasillo-tienda.jpg", "duracion": 65.4, "reales": 6, "aprox": false, "plantilla": "ejemplo", "inicio": "2026-10-09T11:00:00", "descripcion": "Cámara alta sobre un pasillo con clientes que se cruzan, se paran y vuelven a aparecer. Prueba principal de clientes únicos.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "entrada-tienda-calle", "nombre": "Puerta de tienda desde la calle", "tipo": "tienda", "archivo": "videos/entrada-tienda-calle.mp4", "miniatura": "mini/entrada-tienda-calle.jpg", "duracion": 19.7, "reales": 5, "aprox": false, "descripcion": "Puerta de un supermercado vista desde la acera: cuatro personas entran y una sale. Sirve para probar entradas y salidas con una línea.", "fuente": "Repositorio Amal-Emad/Detection-TrackingYolov8", "licencia": "Licencia no declarada: solo pruebas internas"},
    {"id": "entrada-cenital", "nombre": "Entrada vista desde arriba", "tipo": "tienda", "archivo": "videos/entrada-cenital.mp4", "miniatura": "mini/entrada-cenital.jpg", "duracion": 42.8, "reales": 10, "aprox": true, "descripcion": "Cámara cenital en una entrada, como las de conteo de puerta. Las personas se ven pequeñas y desde arriba.", "fuente": "Repositorio saimj7/People-Counting-in-Real-Time", "licencia": "Código MIT; origen del vídeo no declarado"},
    {"id": "personas-cruzando", "nombre": "Personas cruzando", "tipo": "validacion", "archivo": "videos/personas-cruzando.mp4", "miniatura": "mini/personas-cruzando.jpg", "duracion": 49.7, "reales": 7, "aprox": false, "descripcion": "Personas que cruzan la imagen solas o en grupo. Comprueba que no se junta a personas distintas.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "una-a-una", "nombre": "Una persona cada vez", "tipo": "validacion", "archivo": "videos/una-a-una.mp4", "miniatura": "mini/una-a-una.jpg", "duracion": 139.4, "reales": 6, "aprox": false, "descripcion": "Seis personas pasan de una en una. Caso fácil: cualquier error aquí es grave.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "caminar-y-pausa", "nombre": "Caminan, se paran y se van", "tipo": "validacion", "archivo": "videos/caminar-y-pausa.mp4", "miniatura": "mini/caminar-y-pausa.jpg", "duracion": 90.9, "reales": 7, "aprox": false, "descripcion": "Siete personas se acercan a la cámara, se quedan quietas unos segundos y salen. Mide el tiempo de permanencia y las personas muy cerca de la cámara.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "caminar-hacia-camara", "nombre": "Caminan hacia la cámara", "tipo": "validacion", "archivo": "videos/caminar-hacia-camara.mp4", "miniatura": "mini/caminar-hacia-camara.jpg", "duracion": 61.0, "reales": 7, "aprox": false, "descripcion": "Las mismas siete personas, sin pararse. Comparar con el vídeo anterior muestra cuánto afectan las paradas.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "zona-trabajo", "nombre": "Operarios con chaleco", "tipo": "validacion", "archivo": "videos/zona-trabajo.mp4", "miniatura": "mini/zona-trabajo.jpg", "duracion": 75.9, "reales": 4, "aprox": true, "descripcion": "Personas vestidas casi igual (chaleco naranja y casco) que salen y vuelven. Es el caso más difícil para reconocer a quien vuelve: como un equipo con uniforme.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "aula-sentados", "nombre": "Personas sentadas", "tipo": "validacion", "archivo": "videos/aula-sentados.mp4", "miniatura": "mini/aula-sentados.jpg", "duracion": 32.8, "reales": 4, "aprox": false, "descripcion": "Cuatro personas casi quietas todo el vídeo; una se levanta y vuelve a sentarse. Como una cola o una caja: nadie debería contarse dos veces.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"},
    {"id": "mercadillo-multitud", "nombre": "Mercadillo con mucha gente", "tipo": "estres", "archivo": "videos/mercadillo-multitud.mp4", "miniatura": "mini/mercadillo-multitud.jpg", "duracion": 23.5, "reales": null, "aprox": true, "descripcion": "Calle de puestos con decenas de personas a la vez. Sin conteo manual: sirve para ver cómo se comporta con mucha gente y cuánto tarda.", "fuente": "Repositorio Boo4kin/people-detection-yolo", "licencia": "Licencia no declarada: solo pruebas internas"},
    {"id": "cinta-sin-personas", "nombre": "Vídeo sin personas", "tipo": "control", "archivo": "videos/cinta-sin-personas.mp4", "miniatura": "mini/cinta-sin-personas.jpg", "duracion": 60.6, "reales": 0, "aprox": false, "descripcion": "Fruta y verdura pasando por una cinta. No hay nadie: cualquier persona detectada es una falsa alarma.", "fuente": "Intel IoT DevKit, sample-videos", "licencia": "CC BY 4.0"}
  ];
  const TIPOS = { tienda: "Tienda", validacion: "Validación", estres: "Estrés", control: "Control" };

  const TICKETS_EJEMPLO = "ticket_id,fecha_hora,importe,categorias\nT-1001,2026-10-09T11:00:21,18.50,vajilla\nT-1002,2026-10-09T11:00:38,42.90,cuencos;vajilla\nT-1003,2026-10-09T11:00:52,12.00,cuencos\nT-1004,2026-10-09T11:01:03,27.40,teteras\n";

  /* ------------------------------------------------------------ estado */
  const S = {
    db: null, puedeEscribir: true, downloads: null,
    analisis: [],            // [{id, creado, nombre, camara, inicio, duracion, conteo, unicos, datos?}]
    camaras: [],             // [{id, nombre, ancho, alto, config}]
    ticketsCsv: "",
    entrenos: [],            // vídeos revisados en Entrenamiento [{id, nombre, ancho, alto, fotogramas (JSON), actualizado}]
    pruebas: [],             // registro de pruebas [{id, fecha, version, video, ajustes, total, unicos, reales, aprox, fusiones, segundos, notas, creado}]
    editando: null,
    actual: null,            // id del análisis mostrado
    registros: new Map(),    // id -> registro de cajas para revisar (solo en memoria)
    video: null,             // {archivo|url, nombre, ancho, alto, duracion, fondo canvas}
    config: { zonas: [], lineas: [], interaccion_segundos: 3, min_segundos_visita: 1 },
    dib: null,               // {tipo, puntos}
    cancelar: false,
    pausado: false,          // análisis en pausa
    ritmo: 0,                // velocidad del análisis respecto al vídeo: 0 = la máxima posible
  };

  /* ------------------------------------------------------- navegación */
  function irA(sec) {
    document.querySelectorAll("nav button[data-sec]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.sec === sec)));
    ["ana", "res", "ven", "pru", "ent"].forEach((s) => ($("sec-" + s).hidden = s !== sec));
    if (sec === "res") pintarResultados();
    if (sec === "pru") { pintarPruebas(); pintarBiblioteca(); }
    if (sec === "ven") pintarVentas();
    if (sec === "ent") pintarEntrenos();
  }
  document.querySelectorAll("nav button[data-sec]").forEach((b) => b.addEventListener("click", () => irA(b.dataset.sec)));
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    ["afl", "zon", "per", "ven", "rev"].forEach((t) => ($("tab-" + t).hidden = t !== b.dataset.tab));
  }));

  /* ------------------------------------------------------ persistencia */
  async function iniciarDatos() {
    try {
      if (!window.claude || !window.claude.use) return;
      const [db, user, downloads] = await Promise.all([window.claude.use("db"), window.claude.use("user"), window.claude.use("downloads")]);
      S.downloads = downloads;
      if (user) { try { const c = await user.can("data.write"); if (c === false) S.puedeEscribir = false; } catch (_) {} }
      if (!db) return;
      S.db = db;
      const [an, cam, ven, ent] = await Promise.all([db.collection("analisis").get(), db.collection("camaras").get(), db.doc("ventas/tickets").get(), db.collection("entrenamiento").get()]);
      S.entrenos = ent.docs.map((d) => ({ id: d.id, ...d.data() }));
      db.collection("pruebas").onSnapshot((q) => {
        const locales = S.pruebas.filter((p) => p.soloLocal);
        S.pruebas = [...locales, ...q.docs.map((d) => ({ id: d.id, ...d.data() }))];
        if (!$("sec-pru").hidden) pintarPruebas();
      }, (e) => console.warn("pruebas", e));
      const previos = S.analisis.filter((a) => a.soloLocal);
      S.analisis = [...previos, ...an.docs.map((d) => ({ id: d.id, ...d.data() }))].sort((x, y) => (y.creado > x.creado ? 1 : -1));
      S.camaras = cam.docs.map((d) => ({ id: d.id, ...d.data(), config: JSON.parse(d.data().datos) }));
      if (ven.exists && !S.ticketsCsv) S.ticketsCsv = ven.data().csv || "";
      pintarPlantillas(); pintarSelector();
      if (!$("sec-res").hidden) pintarResultados();
      if (!$("sec-ven").hidden) pintarVentas();
      if (!$("sec-ent").hidden) pintarEntrenos();
      if (!S.puedeEscribir) $("f-prueba").hidden = true;
    } catch (e) { console.warn("datos", e); }
  }
  async function guardar(ruta, cuerpo) {
    if (!S.db || !S.puedeEscribir) return false;
    try { await S.db.doc(ruta).set(cuerpo); return true; } catch (e) {
      if (e && e.code === "invalid_argument") S.puedeEscribir = false;
      console.warn("guardar", e); return false;
    }
  }

  /* ---------------------------------------------------- motor (workers) */
  let motor = null;
  function crearMotor() {
    if (motor) return motor;
    const nDet = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    let sec = 0;
    const nuevo = (tipo, modelo) => {
      const w = new Worker(BASE + "trabajador.js"), pend = new Map();
      w.onmessage = (e) => { const p = pend.get(e.data.id); pend.delete(e.data.id); if (!p) return; e.data.ok ? p.ok(e.data) : p.mal(new Error(e.data.error)); };
      w.onerror = (e) => { for (const p of pend.values()) p.mal(new Error(e.message || "error del trabajador")); pend.clear(); };
      const llamar = (msg, transfer) => new Promise((ok, mal) => { const id = ++sec; pend.set(id, { ok, mal }); w.postMessage({ ...msg, id }, transfer || []); });
      const listo = llamar({ cmd: "iniciar", tipo, modelo, base: BASE, ortCdn: ORT_CDN });
      return { w, llamar, listo, ocupado: 0 };
    };
    const det = Array.from({ length: nDet }, () => nuevo("det", "yolo11n.onnx.b64.txt"));
    const reid = nuevo("reid", "mars.onnx.b64.txt");
    motor = {
      nDet,
      listo: Promise.all([...det.map((d) => d.listo), reid.listo]),
      detectar(pixeles, lb, minScore) {
        const t = det.reduce((a, b) => (b.ocupado < a.ocupado ? b : a));
        t.ocupado++;
        return t.llamar({ cmd: "detectar", pixeles, lb, minScore }, [pixeles]).finally(() => t.ocupado--);
      },
      embeber(lote, n) { return reid.llamar({ cmd: "embeber", lote, n }, [lote]); },
    };
    motor.listo.catch(() => { det.concat([reid]).forEach((d) => d.w.terminate()); motor = null; });
    return motor;
  }

  /* -------------------------------------------------- análisis de vídeo */
  function esperar(el, ev) { return new Promise((ok, mal) => { const f = () => { el.removeEventListener(ev, f); el.removeEventListener("error", g); ok(); }; const g = () => { el.removeEventListener(ev, f); mal(new Error("No se pudo leer el vídeo en este navegador (prueba con MP4 H.264).")); }; el.addEventListener(ev, f); el.addEventListener("error", g); }); }
  async function irAt(v, t) {
    if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return;
    v.currentTime = t;
    // Algunos navegadores no avisan del salto si el fotograma ya estaba listo: no esperamos para siempre.
    await Promise.race([esperar(v, "seeked"), new Promise((ok) => setTimeout(ok, 4000))]);
  }

  async function abrirVideo(url) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await esperar(v, "loadeddata");
    return v;
  }

  /* Analiza un vídeo. Devuelve {analisis, registro}. */
  async function analizar(url, meta, config, ajustes, alAvanzar) {
    const m = crearMotor();
    alAvanzar({ fase: "Cargando los modelos de detección…", frac: 0 });
    await m.listo;
    const v = await abrirVideo(url);
    const W = v.videoWidth, Hh = v.videoHeight, dur = v.duration;
    const lb = Motor.letterbox(W, Hh, 640);
    const lienzo = document.createElement("canvas"); lienzo.width = lienzo.height = 640;
    const cx = lienzo.getContext("2d", { willReadFrequently: true });
    const fps = ajustes.fps, N = Math.max(1, Math.floor(dur * fps));
    const tracker = new Motor.ByteTrack({ maxPerdido: Math.round(2 * fps) });
    const reid = new Motor.Reidentificador();
    const reg = new Motor.Registro(config, W, Hh);
    const registro = [];
    const embeds = [];
    let fondo = null, fondoN = Infinity;
    const aImg = (c) => [c[0] * lb.s + lb.dx, c[1] * lb.s + lb.dy, c[2] * lb.s + lb.dx, c[3] * lb.s + lb.dy].map(Math.round);
    const t0 = performance.now();

    async function capturar(k) {
      await irAt(v, Math.min(dur - 0.001, k / fps));
      cx.fillStyle = "rgb(114,114,114)"; cx.fillRect(0, 0, 640, 640);
      cx.drawImage(v, lb.dx, lb.dy, lb.nw, lb.nh);
      return cx.getImageData(0, 0, 640, 640).data.buffer;
    }
    function procesar(k, r) {
      const t = k / fps;
      const img = new ImageData(new Uint8ClampedArray(r.pixeles), 640, 640);
      const pistas = tracker.actualizar(r.cajas);
      reg.observar(t, pistas);
      registro.push([Math.round(t * 100) / 100, pistas.map((p) => [p.id, ...p.caja.map(Math.round)])]);
      const fiables = r.cajas.filter((c) => c[4] >= 0.35).length;
      if (fiables < fondoN) { fondoN = fiables; fondo = img; }
      const pedir = reid.observar(img, aImg, t, pistas, W, Hh);
      if (pedir.length) {
        const lote = new Uint8Array(pedir.length * 128 * 64 * 3);
        pedir.forEach((p, i) => Motor.recorteBGR(img, p.caja, lote, i * 128 * 64 * 3));
        embeds.push(m.embeber(lote.buffer, pedir.length).then((res) => res.vectores.forEach((vec, i) => {
          let n = 0; for (const x of vec) n += x * x; n = Math.sqrt(n) + 1e-9;
          pedir[i].firma.vectores.push(vec.map((x) => x / n));
        })));
      }
      return { img, pistas };
    }

    const enVuelo = new Map();
    let k = 0, sig = 0, enPausa = 0, ultimo = performance.now();
    const maxVuelo = m.nDet + 1;
    const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
    while (sig < N) {
      if (S.cancelar) throw new Error("cancelado");
      if (S.pausado) {
        const p0 = performance.now();
        alAvanzar({ fase: "En pausa", frac: sig / N, pausa: true });
        while (S.pausado && !S.cancelar) await dormir(120);
        enPausa += performance.now() - p0;
        continue;
      }
      // A velocidad limitada, cada fotograma se muestra el tiempo que dura en el vídeo dividido por el ritmo.
      if (S.ritmo > 0) { const falta = 1000 / fps / S.ritmo - (performance.now() - ultimo); if (falta > 0) await dormir(falta); }
      ultimo = performance.now();
      while (k < N && k - sig < maxVuelo) { const px = await capturar(k); enVuelo.set(k, m.detectar(px, lb, ajustes.minScore ?? 0.1)); k++; }
      const r = await enVuelo.get(sig); enVuelo.delete(sig);
      const { img, pistas } = procesar(sig, r);
      sig++;
      const seg = (performance.now() - t0 - enPausa) / 1000;
      const resta = S.ritmo > 0 ? Math.max((seg / sig) * (N - sig), (N - sig) / fps / S.ritmo) : (seg / sig) * (N - sig);
      alAvanzar({ fase: "Detectando y siguiendo personas", frac: sig / N, img, lb, pistas, t: sig / fps, dur, resta, trayectos: reg.tr.size });
    }
    reg.cerrar();
    alAvanzar({ fase: "Reconociendo a las personas que vuelven…", frac: 1 });
    await Promise.all(embeds);

    const validos = {};
    for (const tr of reg.tr.values()) if (tr.t1 - tr.t0 >= config.min_segundos_visita) validos[tr.id] = [tr.t0, tr.t1];
    const duplicados = Motor.duplicados(registro, validos);
    for (const id of duplicados) delete validos[id];
    const personas = Motor.agrupar(validos, ajustes.reid === false ? null : reid);
    const r2 = (x) => Math.round(x * 100) / 100;
    const trayectos = [...reg.tr.values()].filter((tr) => validos[tr.id]).map((tr) => ({
      id: tr.id, persona: personas[tr.id], t0: r2(tr.t0), t1: r2(tr.t1),
      estancias: tr.estancias.map(([z, a, b]) => [z, r2(a), r2(b)]), cruces: tr.cruces.map(([l, t, s]) => [l, r2(t), s]),
    }));

    // Fondo sin personas (o con las menos posibles) para el mapa de calor.
    let fondoUrl = "";
    if (fondo) {
      const c1 = document.createElement("canvas"); c1.width = 640; c1.height = 640; c1.getContext("2d").putImageData(fondo, 0, 0);
      const ancho = Math.min(560, W), alto = Math.round((ancho * Hh) / W);
      const c2 = document.createElement("canvas"); c2.width = ancho; c2.height = alto;
      c2.getContext("2d").drawImage(c1, lb.dx, lb.dy, lb.nw, lb.nh, 0, 0, ancho, alto);
      fondoUrl = c2.toDataURL("image/jpeg", 0.72);
    }
    const analisis = {
      id: "a" + Date.now().toString(36), creado: new Date().toISOString(), nombre: meta.nombre, camara: meta.camara, inicio: meta.inicio, biblio: meta.biblio || null,
      video: { ancho: W, alto: Hh, duracion: r2(dur) }, ajustes: { fps, reid: ajustes.reid !== false },
      config, trayectos, descartados: reg.tr.size - trayectos.length, duplicados: duplicados.length, detectados: reg.tr.size,
      calor: { gw: reg.gw, gh: reg.gh, v: Array.from(reg.calor) }, fondo: fondoUrl,
      segundosProceso: Math.round((performance.now() - t0 - enPausa) / 1000),
    };
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    return { analisis, registro, personas, reid, validos };
  }

  /* ------------------------------------------------ dibujo de zonas */
  function colorZona(i) { return COLORES[i % COLORES.length]; }
  function dibujarConfig(ctx, config, escala = 1, dib = null) {
    const lw = Math.max(1.5, 2 * escala);
    ctx.save(); ctx.lineWidth = lw; ctx.font = `600 ${Math.round(13 * escala)}px system-ui, sans-serif`;
    config.zonas.forEach((z, i) => {
      const c = colorZona(i);
      ctx.beginPath(); z.poligono.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = c + "33"; ctx.fill(); ctx.strokeStyle = c; ctx.stroke();
      const cxm = z.poligono.reduce((s, p) => s + p[0], 0) / z.poligono.length, cym = z.poligono.reduce((s, p) => s + p[1], 0) / z.poligono.length;
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 3 * escala; ctx.textAlign = "center";
      ctx.strokeText(z.nombre, cxm, cym); ctx.fillText(z.nombre, cxm, cym); ctx.lineWidth = lw;
    });
    config.lineas.forEach((l) => {
      ctx.strokeStyle = "#e5484d"; ctx.lineWidth = lw * 1.4;
      ctx.beginPath(); ctx.moveTo(...l.a); ctx.lineTo(...l.b); ctx.stroke();
      // Flecha hacia el lado que cuenta como «entra».
      const mx = (l.a[0] + l.b[0]) / 2, my = (l.a[1] + l.b[1]) / 2, dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], n = Math.hypot(dx, dy) || 1;
      const s = l.entrada || 1, ux = (-dy / n) * s, uy = (dx / n) * s, L = 26 * escala;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + ux * L, my + uy * L); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx + ux * L, my + uy * L); ctx.lineTo(mx + ux * (L - 8 * escala) - uy * 6 * escala, my + uy * (L - 8 * escala) + ux * 6 * escala);
      ctx.lineTo(mx + ux * (L - 8 * escala) + uy * 6 * escala, my + uy * (L - 8 * escala) - ux * 6 * escala); ctx.closePath(); ctx.fillStyle = "#e5484d"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 3 * escala; ctx.textAlign = "left";
      ctx.strokeText(l.nombre + " · entra", mx + ux * L + 6, my + uy * L); ctx.fillText(l.nombre + " · entra", mx + ux * L + 6, my + uy * L);
    });
    if (dib && dib.puntos.length) {
      ctx.strokeStyle = "#ffd60a"; ctx.fillStyle = "#ffd60a"; ctx.lineWidth = lw;
      ctx.beginPath(); dib.puntos.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      dib.puntos.forEach(([x, y], j) => { ctx.beginPath(); ctx.arc(x, y, (j === 0 ? 7 : 4) * escala, 0, 7); ctx.fill(); });
    }
    ctx.restore();
  }

  function pintarEditor() {
    const v = S.video; if (!v) return;
    const c = $("cv-editor"); c.width = v.ancho; c.height = v.alto;
    const ctx = c.getContext("2d");
    ctx.drawImage(v.fondo, 0, 0, v.ancho, v.alto);
    dibujarConfig(ctx, S.config, v.ancho / 720, S.dib);
    // Lista editable
    const it = $("items"); it.innerHTML = "";
    if (!S.config.zonas.length && !S.config.lineas.length) it.innerHTML = '<div class="empty">Sin zonas: se contarán clientes, afluencia y permanencia en toda la imagen.</div>';
    S.config.zonas.forEach((z, i) => {
      const d = document.createElement("div"); d.className = "item";
      d.innerHTML = `<span class="sw" style="background:${colorZona(i)}"></span><div class="campos"><input type="text" aria-label="Nombre de la zona" value="${esc(z.nombre)}"><input type="text" aria-label="Categoría" placeholder="Categoría de producto" value="${esc(z.categoria)}"></div><button class="btn small" aria-label="Quitar zona">Quitar</button>`;
      const [n, cat] = d.querySelectorAll("input");
      n.onchange = () => { z.nombre = n.value.trim() || z.nombre; pintarEditor(); };
      cat.onchange = () => { z.categoria = cat.value.trim(); };
      d.querySelector("button").onclick = () => { S.config.zonas.splice(i, 1); pintarEditor(); };
      it.appendChild(d);
    });
    S.config.lineas.forEach((l, i) => {
      const d = document.createElement("div"); d.className = "item";
      d.innerHTML = `<span class="sw" style="background:#e5484d;height:4px"></span><div class="campos"><input type="text" aria-label="Nombre de la línea" value="${esc(l.nombre)}"><button class="btn small">Invertir sentido de entrada</button></div><button class="btn small" aria-label="Quitar línea">Quitar</button>`;
      const n = d.querySelector("input"), [inv, quitar] = d.querySelectorAll("button");
      n.onchange = () => { l.nombre = n.value.trim() || l.nombre; pintarEditor(); };
      inv.onclick = () => { l.entrada = -(l.entrada || 1); pintarEditor(); };
      quitar.onclick = () => { S.config.lineas.splice(i, 1); pintarEditor(); };
      it.appendChild(d);
    });
    $("c-parada").value = S.config.interaccion_segundos; $("c-minimo").value = S.config.min_segundos_visita;
  }

  function empezarDibujo(tipo) {
    S.dib = { tipo, puntos: [] };
    $("lienzo").classList.add("dibujando");
    $("b-deshacer").hidden = $("b-cancelar-dib").hidden = false;
    $("b-zona").classList.toggle("on", tipo === "zona"); $("b-linea").classList.toggle("on", tipo === "linea");
    $("ayuda-dib").textContent = tipo === "zona" ? "Pulsa cada esquina; pulsa la primera para cerrar." : "Pulsa los dos extremos de la línea.";
    pintarEditor();
  }
  function terminarDibujo() {
    S.dib = null; $("lienzo").classList.remove("dibujando");
    $("b-deshacer").hidden = $("b-cancelar-dib").hidden = true; $("ayuda-dib").textContent = "";
    $("b-zona").classList.remove("on"); $("b-linea").classList.remove("on");
    pintarEditor();
  }
  $("b-zona").onclick = () => empezarDibujo("zona");
  $("b-linea").onclick = () => empezarDibujo("linea");
  $("b-cancelar-dib").onclick = terminarDibujo;
  $("b-deshacer").onclick = () => { if (S.dib) { S.dib.puntos.pop(); pintarEditor(); } };
  $("cv-editor").addEventListener("pointerdown", (e) => {
    if (!S.dib) return;
    const c = e.currentTarget, r = c.getBoundingClientRect();
    const p = [Math.round(((e.clientX - r.left) / r.width) * c.width), Math.round(((e.clientY - r.top) / r.height) * c.height)];
    const d = S.dib;
    if (d.tipo === "zona") {
      const p0 = d.puntos[0], radio = (14 * c.width) / r.width;
      if (p0 && d.puntos.length >= 3 && Math.hypot(p[0] - p0[0], p[1] - p0[1]) < radio) {
        S.config.zonas.push({ nombre: "zona_" + (S.config.zonas.length + 1), categoria: "", poligono: d.puntos });
        return terminarDibujo();
      }
      d.puntos.push(p);
    } else {
      d.puntos.push(p);
      if (d.puntos.length === 2) { S.config.lineas.push({ nombre: "linea_" + (S.config.lineas.length + 1), a: d.puntos[0], b: d.puntos[1], entrada: 1 }); return terminarDibujo(); }
    }
    pintarEditor();
  });
  $("c-parada").onchange = () => (S.config.interaccion_segundos = Math.max(1, +$("c-parada").value || 3));
  $("c-minimo").onchange = () => (S.config.min_segundos_visita = Math.max(0, +$("c-minimo").value || 0));

  function pintarPlantillas() {
    const sel = $("c-plantilla"), v = S.video;
    const ops = ['<option value="">Nueva (vacía)</option>'];
    S.camaras.forEach((c) => ops.push(`<option value="cam:${esc(c.id)}">${esc(c.nombre)} · ${c.ancho}×${c.alto}</option>`));
    if (!v || (v.ancho === 720 && v.alto === 404)) ops.push('<option value="ejemplo">Pasillo de menaje (ejemplo)</option>');
    const prev = sel.value; sel.innerHTML = ops.join(""); if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }
  $("c-plantilla").onchange = () => {
    const val = $("c-plantilla").value; let cfg = null, nombre = "";
    if (val === "ejemplo") { cfg = EJEMPLO.config; nombre = EJEMPLO.nombre; }
    else if (val.startsWith("cam:")) { const c = S.camaras.find((x) => "cam:" + x.id === val); if (c) { cfg = c.config; nombre = c.nombre; } }
    S.config = cfg ? JSON.parse(JSON.stringify(cfg)) : { zonas: [], lineas: [], interaccion_segundos: 3, min_segundos_visita: 1 };
    if (nombre && !$("c-nombre").value) $("c-nombre").value = nombre;
    if (S.video && cfg) escalarConfig(cfg, val);
    pintarEditor();
  };
  // Si la plantilla es de otra resolución, se reescala a la del vídeo.
  function escalarConfig(cfg, val) {
    const c = val === "ejemplo" ? { ancho: 720, alto: 404 } : S.camaras.find((x) => "cam:" + x.id === val);
    if (!c || (c.ancho === S.video.ancho && c.alto === S.video.alto)) return;
    const fx = S.video.ancho / c.ancho, fy = S.video.alto / c.alto, f = (p) => [Math.round(p[0] * fx), Math.round(p[1] * fy)];
    S.config.zonas.forEach((z) => (z.poligono = z.poligono.map(f)));
    S.config.lineas.forEach((l) => { l.a = f(l.a); l.b = f(l.b); });
  }
  $("b-guardar-cam").onclick = async () => {
    const nombre = $("c-nombre").value.trim() || "Cámara";
    const id = nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "camara";
    const cam = { id, nombre, ancho: S.video.ancho, alto: S.video.alto, config: JSON.parse(JSON.stringify(S.config)) };
    S.camaras = S.camaras.filter((c) => c.id !== id).concat([cam]);
    const ok = await guardar("camaras/" + id, { nombre, ancho: cam.ancho, alto: cam.alto, datos: JSON.stringify(cam.config) });
    pintarPlantillas(); $("c-plantilla").value = "cam:" + id;
    $("msg-cam").textContent = ok ? "Guardada. La podrás elegir con los próximos vídeos de esta cámara." : "Guardada solo mientras esta página siga abierta.";
  };

  /* ------------------------------------------------ carga del vídeo */
  async function cargarVideo(url, nombre, inicio, plantilla) {
    $("msg-error").hidden = true;
    let v;
    try { v = await abrirVideo(url); await irAt(v, Math.min(1, v.duration / 2)); } catch (e) { return mostrarError(e.message); }
    const fondo = document.createElement("canvas"); fondo.width = v.videoWidth; fondo.height = v.videoHeight;
    fondo.getContext("2d").drawImage(v, 0, 0);
    S.video = { url, nombre, ancho: v.videoWidth, alto: v.videoHeight, duracion: v.duration, fondo };
    $("v-nombre").textContent = nombre;
    $("v-info").textContent = `${v.videoWidth}×${v.videoHeight} · ${fmtDur(v.duration)}`;
    const d = inicio ? new Date(inicio) : new Date();
    $("c-fecha").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $("c-hora").value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    pintarPlantillas();
    const misma = S.camaras.find((c) => c.ancho === v.videoWidth && c.alto === v.videoHeight);
    $("c-plantilla").value = plantilla || (misma ? "cam:" + misma.id : "");
    if (!plantilla && !misma) $("c-nombre").value = "";
    v.removeAttribute("src"); v.load();
    $("c-plantilla").onchange();
    $("paso-subir").hidden = true; $("paso-config").hidden = false;
    estimar();
  }
  function estimar() {
    if (!S.video) return;
    const n = S.video.duracion * +$("c-fps").value, nDet = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    $("msg-analizar").textContent = `Tiempo estimado: unos ${fmtDur(Math.max(20, (n * 0.45) / nDet + 10))} en este equipo.`;
  }
  $("c-fps").onchange = estimar;
  $("in-video").onchange = (e) => { const f = e.target.files[0]; if (f) cargarVideo(URL.createObjectURL(f), f.name, null, null); e.target.value = ""; };
  $("b-ejemplo").onclick = async () => {
    const b = $("b-ejemplo"), txt = b.textContent;
    b.textContent = "Descargando el vídeo de ejemplo…"; b.disabled = true;
    try {
      const r = await fetch(BASE + EJEMPLO.archivo); if (!r.ok) throw new Error("HTTP " + r.status);
      await cargarVideo(URL.createObjectURL(await r.blob()), "Pasillo de menaje (vídeo de ejemplo)", EJEMPLO.inicio, "ejemplo");
    } catch (e) { mostrarError("No se pudo descargar el vídeo de ejemplo: " + e.message); }
    b.textContent = txt; b.disabled = false;
  };
  $("b-otro").onclick = () => { S.video = null; $("paso-config").hidden = true; $("paso-subir").hidden = false; };
  const drop = $("paso-subir");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(x.name));
    if (f) cargarVideo(URL.createObjectURL(f), f.name, null, null);
  });

  function mostrarError(msg) { const el = $("msg-error"); el.textContent = msg; el.hidden = false; }

  $("b-analizar").onclick = async () => {
    if (S.dib) terminarDibujo();
    const v = S.video; if (!v) return;
    const inicio = `${$("c-fecha").value || "2026-01-01"}T${($("c-hora").value || "00:00:00").padEnd(8, ":00").slice(0, 8)}`;
    const meta = { nombre: v.nombre, camara: $("c-nombre").value.trim() || "Cámara", inicio, biblio: v.biblio || null };
    const config = JSON.parse(JSON.stringify(S.config));
    S.cancelar = false; S.pausado = false; $("b-pausa").textContent = "Pausar";
    $("paso-config").hidden = true; $("paso-progreso").hidden = false; $("msg-error").hidden = true;
    const vivo = $("cv-vivo"), vctx = vivo.getContext("2d");
    const tmp = document.createElement("canvas"); tmp.width = tmp.height = 640;
    let ultimoPintado = 0;
    try {
      const res = await analizar(v.url, meta, config, { fps: +$("c-fps").value }, (p) => {
        $("barra").style.width = (p.frac * 100).toFixed(1) + "%";
        const partes = [p.fase];
        if (p.t !== undefined) partes.push(`${fmtDur(p.t)} de ${fmtDur(p.dur)}`, `${p.trayectos} tramos`, `quedan ~${fmtDur(Math.max(1, p.resta))}`);
        $("estado").textContent = partes.join(" · ");
        if (p.pausa) return;
        if (p.img && (S.ritmo > 0 || performance.now() - ultimoPintado > 150)) {
          ultimoPintado = performance.now();
          tmp.getContext("2d").putImageData(p.img, 0, 0);
          const lb = p.lb; vivo.width = lb.ancho; vivo.height = lb.alto;
          vctx.drawImage(tmp, lb.dx, lb.dy, lb.nw, lb.nh, 0, 0, lb.ancho, lb.alto);
          dibujarConfig(vctx, config, lb.ancho / 720);
          vctx.lineWidth = Math.max(2, lb.ancho / 360); vctx.font = `600 ${Math.round(lb.ancho / 50)}px system-ui`;
          for (const q of p.pistas) {
            const [x1, y1, x2, y2] = q.caja; vctx.strokeStyle = "#ffd60a"; vctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            vctx.fillStyle = "#ffd60a"; vctx.fillText("#" + q.id, x1 + 3, Math.max(14, y1 - 5));
          }
        }
      });
      const a = res.analisis;
      S.registros.set(a.id, { registro: res.registro, personas: res.personas, url: v.url.startsWith("blob:") ? null : v.url });
      if (v.url.startsWith("blob:")) S.video.url = null;
      const cuerpo = { creado: a.creado, nombre: a.nombre, camara: a.camara, inicio: a.inicio, duracion: a.video.duracion, conteo: a.trayectos.length, unicos: new Set(a.trayectos.map((t) => t.persona)).size, datos: JSON.stringify(a) };
      const regTxt = JSON.stringify(res.registro);
      if (cuerpo.datos.length + regTxt.length < 230000) cuerpo.registro = regTxt;
      const ok = await guardar("analisis/" + a.id, cuerpo);
      S.analisis.unshift({ id: a.id, ...cuerpo, soloLocal: !ok });
      S.actual = a.id;
      $("paso-progreso").hidden = true; $("paso-subir").hidden = false; S.video = null;
      pintarSelector(); irA("res");
    } catch (e) {
      $("paso-progreso").hidden = true; $("paso-config").hidden = false;
      if (String(e.message) !== "cancelado") mostrarError("No se pudo analizar el vídeo: " + (e.message || e) + ". Si el problema es el motor de detección, prueba con Chrome o Edge actualizados.");
    }
  };
  $("b-cancelar").onclick = () => { S.cancelar = true; S.pausado = false; };
  $("b-pausa").onclick = () => {
    S.pausado = !S.pausado;
    $("b-pausa").textContent = S.pausado ? "Reanudar" : "Pausar";
    if (S.pausado) $("estado").textContent = "En pausa. Pulsa «Reanudar» para seguir.";
  };
  $("c-ritmo").onchange = () => (S.ritmo = +$("c-ritmo").value);
  $("c-vel-rev").onchange = () => { const v = $("v-rev"); v.defaultPlaybackRate = v.playbackRate = +$("c-vel-rev").value; };

  /* ------------------------------------------------------- tickets */
  function parsearTickets(csv) {
    const lineas = csv.split(/\r?\n/).filter((l) => l.trim());
    if (!lineas.length) return [];
    const cab = lineas[0].split(",").map((x) => x.trim().toLowerCase());
    const ix = (n) => cab.indexOf(n);
    const out = [];
    for (const l of lineas.slice(1)) {
      const c = l.split(",");
      const f = new Date((c[ix("fecha_hora")] || "").trim().replace(" ", "T"));
      if (isNaN(f)) continue;
      out.push({ id: (c[ix("ticket_id")] || "").trim(), momento: f, importe: parseFloat(c[ix("importe")]) || 0, categorias: new Set((c[ix("categorias")] || "").split(";").map((x) => x.trim()).filter(Boolean)) });
    }
    return out.sort((a, b) => a.momento - b.momento);
  }
  function aCsv(ts) { return "ticket_id,fecha_hora,importe,categorias\n" + ts.map((t) => [t.id, isoLocal(t.momento), t.importe.toFixed(2), [...t.categorias].join(";")].join(",")).join("\n") + "\n"; }
  async function guardarTickets(nuevoCsv, modo) {
    const nuevos = parsearTickets(nuevoCsv);
    if (!nuevos.length) { $("msg-tickets").textContent = "No se encontraron tickets válidos (revisa las columnas)."; return; }
    const mapa = new Map((modo === "reemplazar" ? [] : parsearTickets(S.ticketsCsv)).map((t) => [t.id, t]));
    nuevos.forEach((t) => mapa.set(t.id, t));
    S.ticketsCsv = aCsv([...mapa.values()].sort((a, b) => a.momento - b.momento));
    const ok = await guardar("ventas/tickets", { csv: S.ticketsCsv });
    $("msg-tickets").textContent = `${nuevos.length} tickets cargados` + (ok ? "." : " (solo mientras esta página siga abierta).");
    pintarVentas();
  }
  $("in-tickets").onchange = async (e) => { const f = e.target.files[0]; if (f) await guardarTickets(await f.text(), $("v-modo").value); e.target.value = ""; };
  $("b-tk-ejemplo").onclick = () => guardarTickets(TICKETS_EJEMPLO, "anadir");

  function tabla(el, cab, filas, vacio) {
    if (!filas.length) { el.innerHTML = `<tr><td class="hint">${esc(vacio || "Sin datos")}</td></tr>`; return; }
    el.innerHTML = "<thead><tr>" + cab.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.t)}</th>`).join("") + "</tr></thead><tbody>" +
      filas.map((f) => "<tr>" + f.map((v, i) => `<td${cab[i].num ? ' class="num"' : cab[i].wrap ? ' class="wrap"' : ""}>${cab[i].html ? v : esc(v)}</td>`).join("") + "</tr>").join("") + "</tbody>";
  }
  function kpis(el, items) {
    el.innerHTML = items.map((k) => `<div class="kpi${k.hl ? " hl" : ""}"><span class="l">${esc(k.l)}</span><span class="v">${esc(k.v)}</span>${k.s ? `<span class="s">${esc(k.s)}</span>` : ""}</div>`).join("");
  }

  function pintarVentas() {
    const ts = parsearTickets(S.ticketsCsv), total = ts.reduce((s, t) => s + t.importe, 0);
    kpis($("kpis-v"), [{ l: "Tickets", v: fmtN(ts.length) }, { l: "Ventas", v: fmtEur(total) }, { l: "Ticket medio", v: fmtEur(ts.length ? total / ts.length : 0) }]);
    const cats = new Map();
    ts.forEach((t) => t.categorias.forEach((c) => { const x = cats.get(c) || { n: 0, imp: 0 }; x.n++; x.imp += t.importe; cats.set(c, x); }));
    tabla($("t-cat"), [{ t: "Categoría" }, { t: "Tickets", num: 1 }, { t: "Importe", num: 1 }], [...cats].sort((a, b) => b[1].imp - a[1].imp).map(([c, x]) => [c, fmtN(x.n), fmtEur(x.imp)]), "Aún no hay tickets.");
    tabla($("t-tickets"), [{ t: "Ticket" }, { t: "Fecha y hora" }, { t: "Importe", num: 1 }, { t: "Categorías" }], ts.slice().reverse().map((t) => [t.id, fmtFecha(t.momento) + " " + fmtHora(t.momento), fmtEur(t.importe), [...t.categorias].join(", ")]), "Aún no hay tickets.");
  }

  /* ------------------------------------------------------ resultados */
  function pintarSelector() {
    const sel = $("r-sel");
    sel.innerHTML = S.analisis.map((a) => `<option value="${esc(a.id)}">${esc(a.camara)} · ${esc(fmtFecha(new Date(a.inicio)))} ${esc(fmtHora(new Date(a.inicio)))} · ${esc(a.nombre)}</option>`).join("");
    if (!S.actual && S.analisis.length) S.actual = S.analisis[0].id;
    if (S.actual) sel.value = S.actual;
  }
  $("r-sel").onchange = () => { S.actual = $("r-sel").value; pintarResultados(); };

  function datosDe(id) {
    const fila = S.analisis.find((a) => a.id === id); if (!fila) return null;
    if (!fila._a) fila._a = JSON.parse(fila.datos);
    if (!S.registros.has(id) && fila.registro) {
      const a = fila._a, personas = {}; a.trayectos.forEach((t) => (personas[t.id] = t.persona));
      S.registros.set(id, { registro: JSON.parse(fila.registro), personas, url: null });
    }
    return fila._a;
  }

  function graficoBarras(el, etiquetas, valores, opciones = {}) {
    const W = 520, H = 180, ml = 30, mb = 24, mt = 8, n = valores.length, max = Math.max(1, ...valores);
    const paso = niceStep(max), top = Math.ceil(max / paso) * paso, bw = (W - ml) / Math.max(1, n);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opciones.aria || "")}">`;
    for (let y = 0; y <= top; y += paso) { const py = mt + (H - mt - mb) * (1 - y / top); s += `<line class="ax" x1="${ml}" x2="${W}" y1="${py}" y2="${py}"/><text x="${ml - 6}" y="${py + 4}" text-anchor="end">${y}</text>`; }
    valores.forEach((v, i) => { const h = (H - mt - mb) * (v / top); s += `<rect class="b" x="${ml + i * bw + bw * 0.15}" y="${H - mb - h}" width="${bw * 0.7}" height="${h}" rx="2"><title>${esc(etiquetas[i])}: ${v}</title></rect>`; });
    const cada = Math.ceil(n / 8);
    etiquetas.forEach((e, i) => { if (i % cada === 0) s += `<text x="${ml + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(e)}</text>`; });
    el.innerHTML = s + "</svg>";
  }
  function graficoArea(el, valores, etiqueta) {
    const W = 520, H = 180, ml = 30, mb = 24, mt = 8, n = valores.length, max = Math.max(1, ...valores);
    const paso = niceStep(max), top = Math.ceil(max / paso) * paso;
    const X = (i) => ml + ((W - ml) * i) / Math.max(1, n - 1), Y = (v) => mt + (H - mt - mb) * (1 - v / top);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Personas en cámara a lo largo del vídeo">`;
    for (let y = 0; y <= top; y += paso) s += `<line class="ax" x1="${ml}" x2="${W}" y1="${Y(y)}" y2="${Y(y)}"/><text x="${ml - 6}" y="${Y(y) + 4}" text-anchor="end">${y}</text>`;
    let d = `M${X(0)},${Y(0)}`; valores.forEach((v, i) => { d += `L${X(i)},${Y(v)}`; if (i < n - 1) d += `L${X(i + 1)},${Y(v)}`; }); d += `L${X(n - 1)},${Y(0)}Z`;
    s += `<path class="a" d="${d}"/>`;
    for (let k = 0; k <= 4; k++) { const i = Math.round(((n - 1) * k) / 4); s += `<text x="${X(i)}" y="${H - 6}" text-anchor="${k === 0 ? "start" : k === 4 ? "end" : "middle"}">${esc(etiqueta(i))}</text>`; }
    el.innerHTML = s + "</svg>";
  }
  function niceStep(max) { const r = max / 4, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p; return Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p); }

  function pintarCalor(a) {
    const c = $("cv-calor");
    const img = new Image();
    img.onload = () => {
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const { gw, gh, v } = a.calor, max = Math.max(1e-9, ...v);
      const g = document.createElement("canvas"); g.width = gw; g.height = gh; const gc = g.getContext("2d"), id = gc.createImageData(gw, gh);
      for (let i = 0; i < v.length; i++) {
        const x = Math.pow(v[i] / max, 0.45); if (x <= 0.04) continue;
        const [r, gg, b] = x < 0.5 ? [0, Math.round(510 * x), 255 - Math.round(510 * x)] : [Math.round(510 * (x - 0.5)), 255 - Math.round(510 * (x - 0.5)), 0];
        id.data.set([r, gg, b, Math.round(70 + 185 * x)], 4 * i);
      }
      gc.putImageData(id, 0, 0);
      ctx.save(); ctx.filter = `blur(${Math.round(img.width / 110)}px)`; ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.9; ctx.drawImage(g, 0, 0, img.width, img.height); ctx.restore();
      ctx.save(); ctx.scale(img.width / a.video.ancho, img.height / a.video.alto); ctx.globalAlpha = 0.85; dibujarConfig(ctx, a.config, a.video.ancho / 720); ctx.restore();
    };
    img.src = a.fondo;
  }

  function pintarResultados() {
    pintarSelector();
    const hay = S.analisis.length > 0;
    $("r-vacio").hidden = hay; $("r-cuerpo").hidden = !hay;
    if (!hay) { $("r-meta").textContent = ""; return; }
    const a = datosDe(S.actual); if (!a) return;
    const e = Motor.estadisticas(a, parsearTickets(S.ticketsCsv));
    const fila = S.analisis.find((x) => x.id === S.actual);
    $("r-meta").textContent = `${a.camara} · ${fmtFecha(e.desde)} · ${fmtHora(e.desde)}–${fmtHora(e.hasta)} · ${a.nombre}` + (fila.soloLocal ? " · no guardado: solo disponible mientras esta página siga abierta" : "");
    kpis($("kpis"), [
      { l: "Conteo total", v: fmtN(e.conteoTotal), s: "tramos de persona contados" },
      { l: "Clientes únicos", v: fmtN(e.unicos), s: "sin repetir a nadie", hl: true },
      { l: "Máx. a la vez", v: fmtN(e.maxSimultaneas), s: "a las " + fmtHora(e.momentoPico) },
      { l: "Tiempo mediano", v: fmtDur(e.permanenciaMediana), s: "en cámara por cliente" },
      { l: "Se detuvieron", v: a.config.zonas.length ? fmtN(e.pararon) : "—", s: a.config.zonas.length ? `≥ ${a.config.interaccion_segundos} s en una zona` : "sin zonas definidas" },
      { l: "Conversión", v: e.tickets.length ? fmtPct(e.conversion) : "—", s: e.tickets.length ? `${e.tickets.length} tickets` : "sube tickets en Ventas" },
    ]);
    // Afluencia
    const binTxt = e.bin < 60 ? `cada ${e.bin} s` : `cada ${e.bin / 60} min`;
    $("t-nuevos").textContent = `Clientes nuevos (${binTxt})`;
    graficoBarras($("g-nuevos"), e.afluencia.map((b) => fmtHora(b.desde).slice(e.bin < 60 ? 3 : 0, e.bin < 60 ? 8 : 5)), e.afluencia.map((b) => b.nuevos), { aria: "Clientes nuevos por intervalo" });
    const oc = e.ocupacion, paso = Math.max(1, Math.ceil(oc.length / 300)), red = [];
    for (let i = 0; i < oc.length; i += paso) red.push(Math.max(...oc.slice(i, i + paso)));
    graficoArea($("g-ocup"), red, (i) => fmtHora(e.reloj(i * paso)));
    const maxE = Math.max(1, e.embudo[0].n);
    $("funnel").innerHTML = e.embudo.map((f, i) => `<div class="frow"><span>${esc(f.etapa)}</span><div class="bar" style="width:${(100 * f.n) / maxE}%"></div><span class="n">${fmtN(f.n)}</span>${i ? `<span class="pct">${fmtPct(e.embudo[i - 1].n ? f.n / e.embudo[i - 1].n : 0)} del paso anterior</span>` : ""}</div>`).join("");
    graficoBarras($("g-perm"), e.permanencia.map((p) => p.etiqueta), e.permanencia.map((p) => p.n), { aria: "Clientes por tiempo en cámara" });
    $("perm-txt").textContent = `Mediana ${fmtDur(e.permanenciaMediana)}, media ${fmtDur(e.permanenciaMedia)}. Ocupación media ${fmtN(e.ocupacionMedia, 1)} personas.`;
    $("bloque-lineas").hidden = !a.config.lineas.length;
    tabla($("t-lineas"), [{ t: "Línea" }, { t: "Entran", num: 1 }, { t: "Salen", num: 1 }, { t: "Cruces", num: 1 }], e.lineas.map((l) => [l.linea, fmtN(l.entradas), fmtN(l.salidas), fmtN(l.cruces)]));
    tabla($("t-intervalos"), [{ t: "Desde" }, { t: "Hasta" }, { t: "Clientes nuevos", num: 1 }, { t: "Media en cámara", num: 1 }, { t: "Máximo a la vez", num: 1 }],
      e.afluencia.map((b) => [fmtHora(b.desde), fmtHora(b.hasta), fmtN(b.nuevos), fmtN(b.media, 1), fmtN(b.max)]));
    // Zonas
    tabla($("t-zonas"), [{ t: "Zona" }, { t: "Categoría" }, { t: "Clientes", num: 1 }, { t: "% del total", num: 1 }, { t: "Permanencia media", num: 1 }, { t: "Paradas largas", num: 1 }, { t: "Tickets con la categoría", num: 1 }, { t: "Conversión", num: 1 }],
      e.zonas.map((z) => [z.zona, z.categoria, fmtN(z.visitantes), fmtPct(z.pct), fmtDur(z.permanencia), fmtN(z.paradas), fmtN(z.tickets), z.visitantes ? fmtPct(z.conversion) : "—"]), "Este análisis no tiene zonas.");
    tabla($("t-rutas"), [{ t: "Recorrido", wrap: 1 }, { t: "Clientes", num: 1 }], e.recorridos.slice(0, 12).map((r) => [r.ruta, fmtN(r.n)]), "Sin recorridos (hacen falta zonas).");
    tabla($("t-trans"), [{ t: "De" }, { t: "A" }, { t: "Clientes", num: 1 }], e.transiciones.slice(0, 12).map((t) => [t.de, t.a, fmtN(t.n)]), "Nadie pasó de una zona a otra.");
    if (a.fondo) pintarCalor(a);
    // Clientes
    tabla($("t-personas"), [{ t: "Cliente", html: 1 }, { t: "Conteos", num: 1, html: 1 }, { t: "Desde" }, { t: "Hasta" }, { t: "Tiempo", num: 1 }, { t: "Se detuvo" }, { t: "Recorrido", wrap: 1 }],
      e.personas.map((p) => [`<span class="chip">P${p.persona}</span>`, p.conteos > 1 ? `<span class="chip multi">${p.conteos}</span>` : "1", fmtHora(p.desde), fmtHora(p.hasta), fmtDur(p.segundos), p.paro ? "Sí" : "No", p.recorrido.join(" → ") || "—"]));
    // Ventas del periodo
    tabla($("t-vper"), [{ t: "Ticket" }, { t: "Hora" }, { t: "Importe", num: 1 }, { t: "Categorías" }], e.tickets.map((t) => [t.id, fmtHora(t.momento), fmtEur(t.importe), [...t.categorias].join(", ")]), "No hay tickets dentro del periodo del vídeo.");
    // Revisión
    prepararRevision(a);
    S._est = e;
  }

  /* ------------------------------------------------------- revisión */
  let revRaf = 0;
  function prepararRevision(a) {
    const r = S.registros.get(a.id);
    const v = $("v-rev");
    cancelAnimationFrame(revRaf);
    $("visor").hidden = true; $("rev-sin").hidden = false;
    $("msg-rev").textContent = r ? "" : "Este análisis no guardó el detalle de cajas: no se puede revisar.";
    $("in-rev").parentElement.hidden = !r;
    if (!r) return;
    if (r.url) mostrarRevision(a, r, r.url);
    $("in-rev").onchange = (ev) => { const f = ev.target.files[0]; if (f) mostrarRevision(a, r, URL.createObjectURL(f)); ev.target.value = ""; };
    v.onloadedmetadata = () => {
      if (Math.abs(v.duration - a.video.duracion) > 1.5 || v.videoWidth !== a.video.ancho) $("msg-rev").textContent = "Ojo: este vídeo no parece el mismo que se analizó.";
    };
  }
  function mostrarRevision(a, r, url) {
    const v = $("v-rev"), c = $("cv-rev"), ctx = c.getContext("2d");
    v.src = url; v.defaultPlaybackRate = v.playbackRate = +$("c-vel-rev").value; $("visor").hidden = false;
    const reg = r.registro, pers = r.personas;
    const pinta = () => {
      if (c.width !== a.video.ancho) { c.width = a.video.ancho; c.height = a.video.alto; }
      ctx.clearRect(0, 0, c.width, c.height);
      dibujarConfig(ctx, a.config, a.video.ancho / 720);
      const t = v.currentTime;
      let lo = 0, hi = reg.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (reg[mid][0] <= t + 1e-3) lo = mid; else hi = mid - 1; }
      const fr = reg[lo];
      if (fr && Math.abs(fr[0] - t) < 0.5) {
        ctx.lineWidth = Math.max(2, a.video.ancho / 360); ctx.font = `700 ${Math.round(a.video.ancho / 45)}px system-ui`;
        for (const [id, x1, y1, x2, y2] of fr[1]) {
          const p = pers[id], col = p ? `hsl(${(p * 47) % 360} 90% 55%)` : "#9aa4a8";
          ctx.strokeStyle = col; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          const txt = p ? "P" + p : "corto", w = ctx.measureText(txt).width + 8, h = Math.round(a.video.ancho / 40);
          ctx.fillStyle = col; ctx.fillRect(x1, Math.max(0, y1 - h), w, h);
          ctx.fillStyle = "#000"; ctx.fillText(txt, x1 + 4, Math.max(h - 4, y1 - 5));
        }
      }
      revRaf = requestAnimationFrame(pinta);
    };
    cancelAnimationFrame(revRaf); pinta();
  }

  /* ---------------------------------------------------- exportación */
  async function descargar(nombre, filas) {
    const csv = filas.map((f) => f.map((x) => { const s = String(x ?? ""); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n") + "\n";
    if (!S.downloads) { $("msg-csv").textContent = "La descarga no está disponible en esta vista."; return; }
    try { await S.downloads.save({ filename: nombre, data: new Blob(["﻿" + csv], { type: "text/csv" }) }); $("msg-csv").textContent = ""; }
    catch (e) { $("msg-csv").textContent = e && e.code === "unavailable" ? "La descarga no está disponible en esta vista." : ""; }
  }
  const base = () => { const a = datosDe(S.actual); return (a.camara + "_" + a.inicio.slice(0, 16)).replace(/[^\w-]+/g, "_"); };
  $("b-csv-per").onclick = () => { const e = S._est; descargar(base() + "_clientes.csv", [["cliente", "conteos", "desde", "hasta", "segundos", "se_detuvo", "recorrido"], ...e.personas.map((p) => ["P" + p.persona, p.conteos, isoLocal(p.desde), isoLocal(p.hasta), p.segundos, p.paro ? 1 : 0, p.recorrido.join(" > ")])]); };
  $("b-csv-tr").onclick = () => {
    const a = datosDe(S.actual), ini = new Date(a.inicio), ts = (s) => isoLocal(new Date(ini.getTime() + s * 1000)), filas = [["tramo", "cliente", "tipo", "zona_o_linea", "desde", "hasta", "segundos", "sentido"]];
    for (const t of a.trayectos) {
      filas.push([t.id, "P" + t.persona, "tramo", "", ts(t.t0), ts(t.t1), (t.t1 - t.t0).toFixed(1), ""]);
      for (const [z, i, f] of t.estancias) filas.push([t.id, "P" + t.persona, "zona", z, ts(i), ts(f), (f - i).toFixed(1), ""]);
      for (const [l, tt, s] of t.cruces) { const lin = a.config.lineas.find((x) => x.nombre === l); filas.push([t.id, "P" + t.persona, "cruce", l, ts(tt), ts(tt), 0, s === ((lin && lin.entrada) || 1) ? "entra" : "sale"]); }
    }
    descargar(base() + "_tramos.csv", filas);
  };
  $("b-csv-int").onclick = () => { const e = S._est; descargar(base() + "_intervalos.csv", [["desde", "hasta", "clientes_nuevos", "media_en_camara", "maximo_a_la_vez"], ...e.afluencia.map((b) => [isoLocal(b.desde), isoLocal(b.hasta), b.nuevos, b.media.toFixed(2), b.max])]); };

  $("b-borrar").onclick = () => { $("b-borrar-ok").hidden = false; $("msg-borrar").textContent = "Se borrará para todos los que usan esta página."; };
  $("b-borrar-ok").onclick = async () => {
    const id = S.actual, fila = S.analisis.find((a) => a.id === id);
    if (S.db && fila && !fila.soloLocal) { try { await S.db.doc("analisis/" + id).delete(); } catch (e) { $("msg-borrar").textContent = "No se pudo borrar."; return; } }
    S.analisis = S.analisis.filter((a) => a.id !== id); S.registros.delete(id); S.actual = S.analisis[0] ? S.analisis[0].id : null;
    $("b-borrar-ok").hidden = true; $("msg-borrar").textContent = ""; pintarResultados();
  };


  /* ------------------------------------------------- registro de pruebas */
  const CAMPOS = ["fecha", "version", "video", "ajustes", "total", "unicos", "reales", "fusiones", "segundos", "notas"];
  const NUM = new Set(["total", "unicos", "reales", "fusiones", "segundos"]);
  function hoy() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function rellenarForm(p) {
    CAMPOS.forEach((c) => ($("p-" + c).value = p[c] ?? ""));
    $("p-aprox").checked = !!p.aprox;
  }
  function limpiarForm() {
    S.editando = null; rellenarForm({ fecha: hoy(), version: "Navegador", fusiones: 0 });
    $("f-titulo").textContent = "Añadir prueba"; $("b-p-cancelar").hidden = true;
  }
  function pintarPruebas() {
    const ps = [...S.pruebas].sort((a, b) => (b.fecha + (b.creado || "")).localeCompare(a.fecha + (a.creado || "")));
    const conReal = ps.filter((p) => Number.isFinite(p.reales) && Number.isFinite(p.unicos));
    const exactas = conReal.filter((p) => p.unicos === p.reales).length;
    const errMedio = conReal.length ? conReal.reduce((s, p) => s + Math.abs(p.unicos - p.reales), 0) / conReal.length : 0;
    const fus = ps.reduce((s, p) => s + (p.fusiones || 0), 0);
    kpis($("kpis-p"), [
      { l: "Pruebas", v: fmtN(ps.length) },
      { l: "Únicos exactos", v: conReal.length ? fmtPct(exactas / conReal.length) : "—", s: `${exactas} de ${conReal.length} con conteo manual`, hl: true },
      { l: "Error medio", v: conReal.length ? fmtN(errMedio, 1) : "—", s: "clientes de diferencia por vídeo" },
      { l: "Fusiones erróneas", v: fmtN(fus), s: "en todas las pruebas" },
    ]);
    const el = $("t-pruebas");
    if (!ps.length) { el.innerHTML = '<tr><td class="hint">Aún no hay pruebas anotadas.</td></tr>'; return; }
    const puede = S.puedeEscribir;
    el.innerHTML = "<thead><tr><th>Fecha</th><th>Versión</th><th>Vídeo</th><th>Ajustes</th><th class=num>Conteo total</th><th class=num>Únicos</th><th class=num>Reales</th><th class=num>Diferencia</th><th class=num>Fusiones erróneas</th><th class=num>Tiempo</th><th>Notas</th>" + (puede ? "<th></th>" : "") + "</tr></thead><tbody>" +
      ps.map((p) => {
        const dif = Number.isFinite(p.reales) && Number.isFinite(p.unicos) ? p.unicos - p.reales : null;
        const difTxt = dif === null ? "—" : `<span class="${dif === 0 ? "dif-0" : "dif-x"}">${dif > 0 ? "+" : ""}${dif}</span>`;
        const f = new Date(p.fecha + "T12:00:00");
        return `<tr><td>${esc(isNaN(f) ? p.fecha : fmtFecha(f))}</td><td>${esc(p.version)}</td><td>${esc(p.video)}</td><td>${esc(p.ajustes)}</td><td class=num>${esc(p.total ?? "—")}</td><td class=num>${esc(p.unicos ?? "—")}</td><td class=num>${p.aprox ? "~" : ""}${esc(p.reales ?? "—")}</td><td class=num>${difTxt}</td><td class=num>${esc(p.fusiones ?? "—")}</td><td class=num>${p.segundos ? esc(fmtDur(p.segundos)) : "—"}</td><td class="wrap">${esc(p.notas)}</td>` +
          (puede ? `<td><div class="row" style="flex-wrap:nowrap;gap:6px"><button class="btn small" data-ed="${esc(p.id)}">Editar</button><button class="btn small" data-bo="${esc(p.id)}">Borrar</button></div></td>` : "") + "</tr>";
      }).join("") + "</tbody>";
    el.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => {
      const p = S.pruebas.find((x) => x.id === b.dataset.ed); if (!p) return;
      S.editando = p.id; rellenarForm(p); $("f-titulo").textContent = "Editar prueba"; $("b-p-cancelar").hidden = false;
      $("f-prueba").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    el.querySelectorAll("[data-bo]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.ok !== "1") { b.dataset.ok = "1"; b.textContent = "¿Seguro?"; return; }
      const p = S.pruebas.find((x) => x.id === b.dataset.bo); if (!p) return;
      if (S.db && !p.soloLocal) { try { await S.db.doc("pruebas/" + p.id).delete(); } catch (e) { $("msg-p").textContent = "No se pudo borrar."; return; } }
      S.pruebas = S.pruebas.filter((x) => x.id !== p.id); pintarPruebas();
    }));
  }
  $("b-p-guardar").onclick = async () => {
    const p = {};
    for (const c of CAMPOS) { const v = $("p-" + c).value.trim(); p[c] = NUM.has(c) ? (v === "" ? null : Number(v)) : v; }
    p.aprox = $("p-aprox").checked;
    if (!p.video) { $("msg-p").textContent = "Falta el nombre del vídeo."; return; }
    const previa = S.editando && S.pruebas.find((x) => x.id === S.editando);
    const id = previa ? previa.id : "p" + Date.now().toString(36);
    p.creado = previa ? previa.creado : new Date().toISOString();
    const ok = await guardar("pruebas/" + id, p);
    S.pruebas = S.pruebas.filter((x) => x.id !== id).concat([{ id, ...p, soloLocal: !ok }]);
    $("msg-p").textContent = ok ? "Guardada." : "Guardada solo mientras esta página siga abierta.";
    limpiarForm(); pintarPruebas();
  };
  $("b-p-cancelar").onclick = () => { limpiarForm(); $("msg-p").textContent = ""; };
  $("b-anotar").onclick = () => {
    const a = datosDe(S.actual); if (!a) return;
    const unicos = new Set(a.trayectos.map((t) => t.persona)).size;
    limpiarForm();
    rellenarForm({
      fecha: hoy(), version: "Navegador", video: a.nombre, total: a.trayectos.length, unicos, fusiones: 0, segundos: a.segundosProceso,
      ajustes: `${a.ajustes.fps} fotogramas/s, visita mínima ${a.config.min_segundos_visita} s`,
    });
    const vb = BIBLIOTECA.find((b) => b.id === a.biblio || b.nombre === a.nombre || (b.alias || []).includes(a.nombre));
    if (vb && vb.reales !== null) { $("p-reales").value = vb.reales; $("p-aprox").checked = !!vb.aprox; }
    irA("pru");
    $("msg-p").textContent = vb && vb.reales !== null ? "Las personas reales vienen del conteo manual del vídeo de prueba. Revisa las fusiones y guarda." : "Cuenta las personas reales en el vídeo, revisa las fusiones y guarda.";
    $("p-reales").focus();
  };

  /* ------------------------------------------------- vídeos de prueba */
  function ultimaPrueba(b) {
    return S.pruebas.filter((p) => (p.video === b.nombre || (b.alias || []).includes(p.video)) && Number.isFinite(p.unicos))
      .sort((x, y) => (y.fecha + (y.creado || "")).localeCompare(x.fecha + (x.creado || "")))[0];
  }
  function pintarBiblioteca() {
    const el = $("biblio"); if (!el) return;
    el.innerHTML = BIBLIOTECA.map((b) => {
      const ult = ultimaPrueba(b);
      const real = b.reales === null ? "sin conteo manual" : `${b.aprox ? "~" : ""}${b.reales} ${b.reales === 1 ? "persona real" : "personas reales"}`;
      let res = '<span class="hint">Aún sin probar.</span>';
      if (ult) {
        const dif = Number.isFinite(ult.reales) ? ult.unicos - ult.reales : null;
        res = `<span>Última prueba: <b>${ult.unicos}</b> únicos` + (dif === null ? "" : ` <span class="${dif === 0 ? "dif-0" : "dif-x"}">(${dif === 0 ? "exacto" : (dif > 0 ? "+" : "") + dif})</span>`) + "</span>";
      }
      return `<article class="vcard" data-b="${esc(b.id)}">
        <div class="vthumb"><img src="${esc(BASE + b.miniatura)}" alt="" loading="lazy"><span class="vtipo t-${esc(b.tipo)}">${esc(TIPOS[b.tipo] || b.tipo)}</span><span class="vdur">${esc(fmtDur(b.duracion))}</span></div>
        <div class="vbody">
          <h4>${esc(b.nombre)}</h4>
          <p class="hint">${esc(b.descripcion)}</p>
          <div class="vreal"><span class="chip">${esc(real)}</span></div>
          <div class="vres">${res}</div>
          <div class="row"><button class="btn small primary" data-an="${esc(b.id)}">Analizar</button><button class="btn small" data-ver="${esc(b.id)}">Ver vídeo</button></div>
          <p class="vfuente">${esc(b.fuente)} · ${esc(b.licencia)}</p>
        </div></article>`;
    }).join("");
    el.querySelectorAll("[data-ver]").forEach((bt) => (bt.onclick = () => {
      const card = bt.closest(".vcard"), b = BIBLIOTECA.find((x) => x.id === bt.dataset.ver), th = card.querySelector(".vthumb");
      const vid = th.querySelector("video");
      if (vid) { vid.remove(); th.querySelector("img").hidden = false; bt.textContent = "Ver vídeo"; return; }
      const v = document.createElement("video"); v.src = BASE + b.archivo; v.controls = true; v.autoplay = true; v.muted = true; v.playsInline = true;
      th.querySelector("img").hidden = true; th.prepend(v); bt.textContent = "Cerrar vídeo";
    }));
    el.querySelectorAll("[data-an]").forEach((bt) => (bt.onclick = async () => {
      const b = BIBLIOTECA.find((x) => x.id === bt.dataset.an), txt = bt.textContent;
      bt.textContent = "Descargando…"; bt.disabled = true;
      try {
        const r = await fetch(BASE + b.archivo); if (!r.ok) throw new Error("HTTP " + r.status);
        irA("ana"); $("b-otro").onclick();
        await cargarVideo(URL.createObjectURL(await r.blob()), b.nombre, b.inicio || null, b.plantilla || null);
        if (S.video) S.video.biblio = b.id;
        if (!$("c-nombre").value) $("c-nombre").value = b.nombre;
      } catch (e) { irA("ana"); mostrarError("No se pudo descargar el vídeo de prueba: " + e.message); }
      bt.textContent = txt; bt.disabled = false;
    }));
  }

  /* ------------------------------------------------------ entrenamiento */
  // Revisión humana fotograma a fotograma. Cada caja: {c: [x1, y1, x2, y2], s: confianza, o: "m" modelo | "h" humano, e: "si" | "no" | "duda"}.
  const ALTA = 0.35;
  const E = { v: null, url: null, id: null, nombre: "", ancho: 0, alto: 0, duracion: 0, t: 0, cajas: [], deshacer: [], fotos: new Map(), arr: null, buscando: 0, jugando: false };
  const claveT = (t) => (Math.round(t * 100) / 100).toFixed(2);
  const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";

  function pintarEntrenos() {
    const el = $("ent-previos"); if (!el) return;
    const sel = $("ent-bib");
    if (sel.options.length <= 1) BIBLIOTECA.forEach((b) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(b.id)}">${esc(b.nombre)}</option>`));
    if (!S.entrenos.length) { el.innerHTML = ""; return; }
    el.innerHTML = '<h3 style="margin-top:6px">Vídeos ya revisados</h3><div class="tbl"><table><thead><tr><th>Vídeo</th><th class=num>Fotogramas</th><th class=num>Personas</th><th>Última revisión</th></tr></thead><tbody>' +
      S.entrenos.map((d) => {
        let n = 0, p = 0; try { const fs = JSON.parse(d.fotogramas); n = fs.length; fs.forEach((f) => (p += f.cajas.filter((c) => c[6] === "si").length)); } catch (_) {}
        return `<tr><td>${esc(d.nombre)}</td><td class=num>${n}</td><td class=num>${p}</td><td>${d.actualizado ? esc(fmtFecha(new Date(d.actualizado))) : "—"}</td></tr>`;
      }).join("") + '</tbody></table></div><p class="hint">Para seguir revisando uno de ellos, vuelve a abrir el mismo vídeo: sus fotogramas revisados se recuperan solos.</p>';
  }

  async function abrirEntreno(url, nombre) {
    $("ent-msg-err").hidden = true;
    let v;
    try { v = await abrirVideo(url); } catch (e) { $("ent-msg-err").textContent = e.message; $("ent-msg-err").hidden = false; return; }
    if (E.v) E.v.remove();
    v.className = "ent-oculto"; document.body.appendChild(v);
    Object.assign(E, { v, url, nombre, ancho: v.videoWidth, alto: v.videoHeight, duracion: v.duration, t: 0, cajas: [], deshacer: [], fotos: new Map(), jugando: false });
    E.id = slug(nombre) + "-" + E.ancho + "x" + E.alto;
    const previo = S.entrenos.find((d) => d.id === E.id);
    if (previo) { try { JSON.parse(previo.fotogramas).forEach((f) => E.fotos.set(claveT(f.t), f)); } catch (_) {} }
    const cv = $("ent-cv"); cv.width = E.ancho; cv.height = E.alto;
    $("ent-nombre").textContent = nombre;
    $("ent-info").textContent = `${E.ancho}×${E.alto} · ${fmtDur(E.duracion)}` + (E.fotos.size ? ` · ${E.fotos.size} fotogramas ya revisados` : "");
    const r = $("ent-t"); r.max = String(Math.max(0, E.duracion - 0.05)); r.value = "0";
    v.defaultPlaybackRate = v.playbackRate = +$("ent-vel").value;
    $("ent-subir").hidden = true; $("ent-trabajo").hidden = false;
    pintarListaEnt(); resumenEnt();
    await irAEnt(0);
  }

  async function irAEnt(t) {
    if (!E.v) return;
    pararEnt();
    t = Math.max(0, Math.min(E.duracion - 0.05, t));
    const turno = ++E.buscando;
    E.t = t; $("ent-t").value = String(t);
    await irAt(E.v, t);
    if (turno !== E.buscando) return;
    E.deshacer = [];
    const guardado = E.fotos.get(claveT(t));
    if (guardado) {
      E.cajas = guardado.cajas.map(([x1, y1, x2, y2, s, o, e]) => ({ c: [x1, y1, x2, y2], s, o, e }));
      pintarEnt(); $("ent-msg").textContent = "Fotograma ya revisado. Si cambias algo, vuelve a guardarlo.";
      return;
    }
    E.cajas = []; pintarEnt();
    $("ent-msg").textContent = "Buscando personas…";
    try {
      const m = crearMotor(); await m.listo;
      const lb = Motor.letterbox(E.ancho, E.alto, 640);
      const lz = document.createElement("canvas"); lz.width = lz.height = 640;
      const cx = lz.getContext("2d", { willReadFrequently: true });
      cx.fillStyle = "rgb(114,114,114)"; cx.fillRect(0, 0, 640, 640); cx.drawImage(E.v, lb.dx, lb.dy, lb.nw, lb.nh);
      const r = await m.detectar(cx.getImageData(0, 0, 640, 640).data.buffer, lb, 0.1);
      if (turno !== E.buscando) return;
      E.cajas = r.cajas.map(([x1, y1, x2, y2, s]) => ({ c: [x1, y1, x2, y2].map(Math.round), s: Math.round(s * 100) / 100, o: "m", e: s >= ALTA ? "si" : "duda" }));
      const n = E.cajas.filter((c) => c.e === "si").length, d = E.cajas.length - n;
      $("ent-msg").textContent = `La herramienta ve ${n} ${n === 1 ? "persona" : "personas"}` + (d ? ` y ${d} ${d === 1 ? "dudosa" : "dudosas"}.` : ".") + " Corrige lo que falte y guarda.";
    } catch (e) { $("ent-msg").textContent = "No se pudo ejecutar el detector: " + e.message; }
    pintarEnt();
  }

  const COL_ENT = { si: "#17a2c4", duda: "#e0b000", no: "#d9534f", h: "#2fbf5f" };
  function pintarEnt() {
    const cv = $("ent-cv"), ctx = cv.getContext("2d");
    if (E.v) ctx.drawImage(E.v, 0, 0, E.ancho, E.alto);
    if (E.jugando) return;
    const lw = Math.max(2, E.ancho / 320);
    for (const b of E.cajas) {
      const [x1, y1, x2, y2] = b.c, col = b.o === "h" ? COL_ENT.h : COL_ENT[b.e];
      ctx.lineWidth = b.o === "h" ? lw * 1.4 : lw; ctx.strokeStyle = col;
      ctx.setLineDash(b.e === "si" ? [] : [lw * 3, lw * 2]);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      if (b.e === "no") { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.moveTo(x2, y1); ctx.lineTo(x1, y2); ctx.stroke(); }
      if (b.o === "m" && b.e !== "no") {
        ctx.setLineDash([]); ctx.font = `600 ${Math.round(lw * 6)}px system-ui`; ctx.fillStyle = col;
        ctx.fillText(Math.round(b.s * 100) + "%", x1 + lw, Math.max(lw * 7, y1 - lw * 2));
      }
    }
    ctx.setLineDash([]);
    if (E.arr && E.arr.b) {
      const [a, b] = [E.arr.a, E.arr.b]; ctx.strokeStyle = COL_ENT.h; ctx.lineWidth = lw; ctx.setLineDash([lw * 2, lw * 2]);
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); ctx.setLineDash([]);
    }
    const n = (f) => E.cajas.filter(f).length;
    kpis($("ent-kpis-f"), [
      { l: "Personas en el fotograma", v: fmtN(n((b) => b.e === "si")), hl: true },
      { l: "Vistas por la herramienta", v: fmtN(n((b) => b.o === "m" && b.e === "si" && b.s >= ALTA)) },
      { l: "Añadidas o aceptadas por ti", v: fmtN(n((b) => b.o === "h" || (b.o === "m" && b.e === "si" && b.s < ALTA))) },
      { l: "Falsas alarmas quitadas", v: fmtN(n((b) => b.o === "m" && b.e === "no" && b.s >= ALTA)) },
    ]);
    $("ent-tiempo").textContent = `${fmtDur(E.t)} de ${fmtDur(E.duracion)}` + (E.fotos.has(claveT(E.t)) ? " · revisado" : "");
  }

  function puntoEnt(ev) {
    const r = $("ent-cv").getBoundingClientRect();
    return [Math.max(0, Math.min(E.ancho, ((ev.clientX - r.left) / r.width) * E.ancho)), Math.max(0, Math.min(E.alto, ((ev.clientY - r.top) / r.height) * E.alto))];
  }
  function cambiarEnt(fn) { E.deshacer.push(JSON.stringify(E.cajas)); fn(); pintarEnt(); }
  $("ent-cv").addEventListener("pointerdown", (ev) => {
    if (!E.v || E.jugando) return;
    ev.preventDefault(); $("ent-cv").setPointerCapture(ev.pointerId);
    E.arr = { a: puntoEnt(ev), b: null };
  });
  $("ent-cv").addEventListener("pointermove", (ev) => { if (E.arr) { E.arr.b = puntoEnt(ev); pintarEnt(); } });
  $("ent-cv").addEventListener("pointerup", (ev) => {
    if (!E.arr) return;
    const a = E.arr.a, b = puntoEnt(ev); E.arr = null;
    const min = Math.max(6, E.ancho / 120);
    if (Math.abs(b[0] - a[0]) > min && Math.abs(b[1] - a[1]) > min) {
      const c = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(Math.round);
      return cambiarEnt(() => E.cajas.push({ c, s: 1, o: "h", e: "si" }));
    }
    // Toque: la caja más pequeña que contiene el punto.
    const dentro = E.cajas.filter((x) => a[0] >= x.c[0] && a[0] <= x.c[2] && a[1] >= x.c[1] && a[1] <= x.c[3])
      .sort((x, y) => (x.c[2] - x.c[0]) * (x.c[3] - x.c[1]) - (y.c[2] - y.c[0]) * (y.c[3] - y.c[1]));
    if (!dentro.length) return pintarEnt();
    const x = dentro[0];
    cambiarEnt(() => {
      if (x.o === "h") E.cajas.splice(E.cajas.indexOf(x), 1);
      else x.e = x.e === "si" ? "no" : "si";
    });
  });
  $("ent-cv").addEventListener("pointercancel", () => { E.arr = null; pintarEnt(); });

  $("ent-deshacer").onclick = () => { if (E.deshacer.length) { E.cajas = JSON.parse(E.deshacer.pop()); pintarEnt(); } };
  $("ent-sig").onclick = () => irAEnt(E.t + +$("ent-paso").value);
  $("ent-ant").onclick = () => irAEnt(E.t - +$("ent-paso").value);
  $("ent-t").onchange = () => irAEnt(+$("ent-t").value);
  $("ent-t").oninput = () => { $("ent-tiempo").textContent = `${fmtDur(+$("ent-t").value)} de ${fmtDur(E.duracion)}`; };
  $("ent-vel").onchange = () => { if (E.v) E.v.defaultPlaybackRate = E.v.playbackRate = +$("ent-vel").value; };
  function pararEnt() {
    if (!E.jugando) return;
    E.jugando = false; E.v.pause(); $("ent-play").textContent = "Reproducir";
  }
  $("ent-play").onclick = async () => {
    if (!E.v) return;
    if (E.jugando) { pararEnt(); const t = E.v.currentTime; return irAEnt(t); }
    E.jugando = true; E.buscando++; $("ent-play").textContent = "Pausar"; $("ent-msg").textContent = "Pausa el vídeo donde quieras revisar.";
    E.v.playbackRate = +$("ent-vel").value;
    try { await E.v.play(); } catch (e) { pararEnt(); return; }
    const bucle = () => {
      if (!E.jugando) return;
      E.t = E.v.currentTime; $("ent-t").value = String(E.t); pintarEnt();
      $("ent-tiempo").textContent = `${fmtDur(E.t)} de ${fmtDur(E.duracion)}`;
      if (E.v.ended) { pararEnt(); return irAEnt(E.duracion - 0.05); }
      requestAnimationFrame(bucle);
    };
    requestAnimationFrame(bucle);
  };
  document.addEventListener("keydown", (ev) => {
    if ($("sec-ent").hidden || !E.v || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (ev.key === "ArrowRight") { ev.preventDefault(); $("ent-sig").onclick(); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); $("ent-ant").onclick(); }
    else if (ev.key === "Enter") { ev.preventDefault(); $("ent-guardar").onclick(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); $("ent-deshacer").onclick(); }
  });

  async function persistirEnt() {
    const fotogramas = [...E.fotos.values()].sort((a, b) => a.t - b.t);
    const doc = { nombre: E.nombre, ancho: E.ancho, alto: E.alto, duracion: Math.round(E.duracion * 100) / 100, fotogramas: JSON.stringify(fotogramas), actualizado: new Date().toISOString() };
    S.entrenos = S.entrenos.filter((d) => d.id !== E.id).concat([{ id: E.id, ...doc }]);
    return guardar("entrenamiento/" + E.id, doc);
  }
  $("ent-guardar").onclick = async () => {
    if (!E.v || E.jugando) return;
    const t = E.t;
    E.fotos.set(claveT(t), { t: Math.round(t * 100) / 100, cajas: E.cajas.map((b) => [...b.c, b.s, b.o, b.e]) });
    const ok = await persistirEnt();
    pintarListaEnt(); resumenEnt();
    $("ent-msg-guardado").textContent = ok ? "" : "Guardado solo mientras esta página siga abierta.";
    if (t + +$("ent-paso").value < E.duracion) irAEnt(t + +$("ent-paso").value);
    else { pintarEnt(); $("ent-msg").textContent = "Has llegado al final del vídeo."; }
  };
  function pintarListaEnt() {
    const el = $("ent-lista"), fs = [...E.fotos.values()].sort((a, b) => a.t - b.t);
    el.innerHTML = fs.length ? fs.map((f) => `<button class="chip" data-t="${f.t}">${esc(fmtDur(f.t))} · ${f.cajas.filter((c) => c[6] === "si").length}</button>`).join("") : '<span class="hint">Aún no has guardado ningún fotograma.</span>';
    el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => irAEnt(+b.dataset.t)));
  }
  function resumenEnt() {
    let vistas = 0, dudas = 0, manos = 0, falsas = 0;
    for (const f of E.fotos.values()) for (const [, , , , s, o, e] of f.cajas) {
      if (o === "h") manos++;
      else if (e === "si") (s >= ALTA ? vistas++ : dudas++);
      else if (e === "no" && s >= ALTA) falsas++;
    }
    const total = vistas + dudas + manos;
    kpis($("ent-resumen"), [
      { l: "Fotogramas revisados", v: fmtN(E.fotos.size) },
      { l: "Personas marcadas", v: fmtN(total) },
      { l: "Vistas por la herramienta", v: total ? fmtPct(vistas / total) : "—", s: `${manos} añadidas a mano, ${dudas} dudosas aceptadas`, hl: true },
      { l: "Falsas alarmas", v: fmtN(falsas), s: "cajas que no eran personas" },
    ]);
    $("ent-exportar").disabled = !E.fotos.size;
  }

  let zipCargado = null;
  function cargarZip() {
    if (window.JSZip) return Promise.resolve();
    return (zipCargado ||= new Promise((ok, mal) => {
      const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = ok; s.onerror = () => { zipCargado = null; mal(new Error("no se pudo cargar el compresor")); }; document.head.appendChild(s);
    }));
  }
  $("ent-exportar").onclick = async () => {
    if (!E.v || !E.fotos.size) return;
    const msg = $("ent-msg-exp"), b = $("ent-exportar");
    if (!S.downloads) { msg.textContent = "La descarga no está disponible en esta vista."; return; }
    pararEnt(); b.disabled = true;
    try {
      await cargarZip();
      const zip = new window.JSZip(), fs = [...E.fotos.values()].sort((a, b) => a.t - b.t);
      const esc2 = Math.min(1, 1280 / E.ancho), W = Math.round(E.ancho * esc2), H = Math.round(E.alto * esc2);
      const lz = document.createElement("canvas"); lz.width = W; lz.height = H; const cx = lz.getContext("2d");
      let i = 0;
      for (const f of fs) {
        msg.textContent = `Preparando fotograma ${++i} de ${fs.length}…`;
        await irAt(E.v, f.t); cx.drawImage(E.v, 0, 0, W, H);
        const jpg = await new Promise((ok) => lz.toBlob(ok, "image/jpeg", 0.9));
        const base = `${E.id}_${String(Math.round(f.t * 100)).padStart(6, "0")}`;
        zip.file(`images/${base}.jpg`, jpg);
        zip.file(`labels/${base}.txt`, f.cajas.filter((c) => c[6] === "si").map(([x1, y1, x2, y2]) =>
          ["0", (x1 + x2) / 2 / E.ancho, (y1 + y2) / 2 / E.alto, (x2 - x1) / E.ancho, (y2 - y1) / E.alto].map((x, k) => (k ? x.toFixed(6) : x)).join(" ")).join("\n"));
      }
      zip.file("data.yaml", "# Una sola clase: persona (clase 0 de COCO).\npath: .\ntrain: images\nval: images\nnames:\n  0: person\n");
      zip.file("anotaciones.json", JSON.stringify({ video: E.nombre, ancho: E.ancho, alto: E.alto, fotogramas: fs }, null, 1));
      zip.file("LEEME.txt", "Datos de entrenamiento del detector de personas, revisados a mano.\n\nimages/: fotogramas en JPG.\nlabels/: una línea por persona en formato YOLO (clase cx cy ancho alto, normalizado de 0 a 1).\nanotaciones.json: todas las cajas, incluidas las que se descartaron como falsas alarmas.\n\nPara reentrenar el detector con uno o varios de estos .zip:\n  python scripts/entrenar_detector.py entrenamiento-*.zip\n");
      msg.textContent = "Comprimiendo…";
      const blob = await zip.generateAsync({ type: "blob" });
      await S.downloads.save({ filename: `entrenamiento-${E.id}.zip`, data: blob });
      msg.textContent = `${fs.length} fotogramas exportados.`;
    } catch (e) {
      msg.textContent = e && e.code === "declined" ? "" : "No se pudo exportar: " + (e.message || e.code || e);
    }
    b.disabled = false; await irAEnt(E.t);
  };

  $("ent-in").onchange = (e) => { const f = e.target.files[0]; if (f) abrirEntreno(URL.createObjectURL(f), f.name); e.target.value = ""; };
  $("ent-bib").onchange = async () => {
    const b = BIBLIOTECA.find((x) => x.id === $("ent-bib").value); if (!b) return;
    $("ent-bib").disabled = true;
    try { const r = await fetch(BASE + b.archivo); if (!r.ok) throw new Error("HTTP " + r.status); await abrirEntreno(URL.createObjectURL(await r.blob()), b.nombre); }
    catch (e) { $("ent-msg-err").textContent = "No se pudo descargar el vídeo: " + e.message; $("ent-msg-err").hidden = false; }
    $("ent-bib").disabled = false; $("ent-bib").value = "";
  };
  const dropEnt = $("ent-subir");
  dropEnt.addEventListener("dragover", (e) => { e.preventDefault(); dropEnt.classList.add("over"); });
  dropEnt.addEventListener("dragleave", () => dropEnt.classList.remove("over"));
  dropEnt.addEventListener("drop", (e) => {
    e.preventDefault(); dropEnt.classList.remove("over");
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(x.name));
    if (f) abrirEntreno(URL.createObjectURL(f), f.name);
  });
  $("ent-otro").onclick = () => { pararEnt(); E.buscando++; if (E.v) E.v.remove(); E.v = null; $("ent-trabajo").hidden = true; $("ent-subir").hidden = false; pintarEntrenos(); };

  /* ----------------------------------------------------------- arranque */
  window.App = { analizar, estadisticas: Motor.estadisticas, EJEMPLO, BIBLIOTECA, S, crearMotor };
  pintarPlantillas(); pintarVentas(); pintarSelector(); limpiarForm(); pintarPruebas(); pintarBiblioteca();
  iniciarDatos();
})();
