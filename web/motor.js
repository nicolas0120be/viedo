/* Motor de análisis: seguimiento (ByteTrack), re-identificación, zonas y estadísticas.
 * Puerto en JavaScript de tienda_analytics (pipeline.py, reid.py, metricas.py).
 * No guarda imágenes de personas: solo cajas, tiempos, zonas e identificadores. */
(function (G) {
  "use strict";
  const M = {};

  /* ------------------------------------------------------------ geometría */

  M.dentroPoligono = function (p, pol) {
    let dentro = false;
    for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
      const [xi, yi] = pol[i], [xj, yj] = pol[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  };

  M.ladoLinea = function (p, a, b) {
    const v = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return v === 0 ? 0 : v > 0 ? 1 : -1;
  };

  // El pie de la persona está a lo largo del tramo (proyección entre los extremos).
  M.dentroTramo = function (p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    return t >= 0 && t <= 1;
  };

  M.zonaDe = function (p, config) {
    for (const z of config.zonas) if (M.dentroPoligono(p, z.poligono)) return z.nombre;
    return null;
  };

  function iou(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy;
    const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return u > 0 ? inter / u : 0;
  }
  M.iou = iou;

  /* ------------------------------------------------- detección (YOLO11) */

  // Salida [1, 84, 8400]: filas 0-3 caja (cx, cy, w, h) en 640x640, fila 4 la clase persona.
  M.decodificarYolo = function (o, n, lb, minScore, iouNms) {
    const cand = [];
    for (let i = 0; i < n; i++) {
      const s = o[4 * n + i];
      if (s < minScore) continue;
      const cx = o[i], cy = o[n + i], w = o[2 * n + i], h = o[3 * n + i];
      cand.push([
        Math.max(0, Math.min(lb.ancho, (cx - w / 2 - lb.dx) / lb.s)),
        Math.max(0, Math.min(lb.alto, (cy - h / 2 - lb.dy) / lb.s)),
        Math.max(0, Math.min(lb.ancho, (cx + w / 2 - lb.dx) / lb.s)),
        Math.max(0, Math.min(lb.alto, (cy + h / 2 - lb.dy) / lb.s)),
        s,
      ]);
    }
    cand.sort((a, b) => b[4] - a[4]);
    const out = [];
    for (const c of cand) {
      if (out.every((k) => iou(k, c) <= iouNms)) out.push(c);
      if (out.length >= 300) break;
    }
    return out;
  };

  M.letterbox = function (ancho, alto, lado) {
    const s = Math.min(lado / ancho, lado / alto);
    const nw = Math.round(ancho * s), nh = Math.round(alto * s);
    return { s, nw, nh, dx: (lado - nw) / 2, dy: (lado - nh) / 2, ancho, alto, lado };
  };

  /* ------------------------------------------------ Kalman (x, y, a, h) */

  const WP = 1 / 20, WV = 1 / 160;
  function diag(v) { const m = v.map(() => v.map(() => 0)); v.forEach((x, i) => (m[i][i] = x)); return m; }
  function mul(A, B) {
    const n = A.length, m = B[0].length, k = B.length, C = [];
    for (let i = 0; i < n; i++) { C.push(new Array(m).fill(0)); for (let j = 0; j < m; j++) { let s = 0; for (let t = 0; t < k; t++) s += A[i][t] * B[t][j]; C[i][j] = s; } }
    return C;
  }
  function tr(A) { return A[0].map((_, j) => A.map((r) => r[j])); }
  function inv(A) {
    const n = A.length, M2 = A.map((r, i) => [...r, ...r.map((_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M2[r][c]) > Math.abs(M2[p][c])) p = r;
      [M2[c], M2[p]] = [M2[p], M2[c]];
      const d = M2[c][c] || 1e-9; for (let j = 0; j < 2 * n; j++) M2[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M2[r][c]; for (let j = 0; j < 2 * n; j++) M2[r][j] -= f * M2[c][j]; }
    }
    return M2.map((r) => r.slice(n));
  }
  const F = diag([1, 1, 1, 1, 1, 1, 1, 1]); for (let i = 0; i < 4; i++) F[i][i + 4] = 1;
  const FT = tr(F);
  const H = [0, 1, 2, 3].map((i) => [0, 1, 2, 3, 4, 5, 6, 7].map((j) => (i === j ? 1 : 0)));
  const HT = tr(H);

  const Kalman = {
    iniciar(z) {
      const h = z[3];
      const std = [2 * WP * h, 2 * WP * h, 1e-2, 2 * WP * h, 10 * WV * h, 10 * WV * h, 1e-5, 10 * WV * h];
      return { m: [...z, 0, 0, 0, 0], P: diag(std.map((s) => s * s)) };
    },
    predecir(k) {
      const h = k.m[3];
      const std = [WP * h, WP * h, 1e-2, WP * h, WV * h, WV * h, 1e-5, WV * h];
      k.m = mul(F, k.m.map((x) => [x])).map((r) => r[0]);
      const P = mul(mul(F, k.P), FT); std.forEach((s, i) => (P[i][i] += s * s)); k.P = P;
    },
    corregir(k, z) {
      const h = k.m[3];
      const R = [WP * h, WP * h, 1e-1, WP * h].map((s) => s * s);
      const S = mul(mul(H, k.P), HT); R.forEach((r, i) => (S[i][i] += r));
      const K = mul(mul(k.P, HT), inv(S));
      const y = z.map((v, i) => v - k.m[i]);
      k.m = k.m.map((v, i) => v + K[i].reduce((s, kk, j) => s + kk * y[j], 0));
      const KSK = mul(mul(K, S), tr(K));
      k.P = k.P.map((r, i) => r.map((v, j) => v - KSK[i][j]));
    },
  };

  function aXyah(c) { const w = c[2] - c[0], h = c[3] - c[1]; return [c[0] + w / 2, c[1] + h / 2, w / Math.max(h, 1e-6), h]; }
  function aXyxy(m) { const h = m[3], w = m[2] * h; return [m[0] - w / 2, m[1] - h / 2, m[0] + w / 2, m[1] + h / 2]; }

  /* ------------------------------------------------------ ByteTrack */

  function asignar(costes, umbral) {
    // costes: [[i, j, c]]; voraz por coste ascendente (escenas con pocas personas).
    costes.sort((a, b) => a[2] - b[2]);
    const ui = new Set(), uj = new Set(), pares = [];
    for (const [i, j, c] of costes) {
      if (c > umbral || ui.has(i) || uj.has(j)) continue;
      ui.add(i); uj.add(j); pares.push([i, j]);
    }
    return pares;
  }

  class ByteTrack {
    constructor(o = {}) {
      this.alta = o.alta ?? 0.35;      // detecciones fiables
      this.baja = o.baja ?? 0.1;       // segunda pasada (personas tapadas)
      this.nueva = o.nueva ?? 0.35;    // mínima para crear un trayecto
      this.match = o.match ?? 0.8;
      this.maxPerdido = o.maxPerdido ?? 30;
      this.frame = 0;
      this.siguiente = 1;
      this.activos = []; this.perdidos = [];
    }

    actualizar(dets) {
      this.frame++;
      const altas = dets.filter((d) => d[4] >= this.alta);
      const bajas = dets.filter((d) => d[4] >= this.baja && d[4] < this.alta);
      const sinConfirmar = this.activos.filter((t) => !t.confirmado);
      const seguidos = this.activos.filter((t) => t.confirmado);
      const pool = [...seguidos, ...this.perdidos];
      for (const t of pool) { if (t.estado !== "seguido") t.k.m[7] = 0; Kalman.predecir(t.k); t.caja = aXyxy(t.k.m); }

      const nuevosActivos = [], nuevosPerdidos = [];
      const usar = (t, d) => {
        Kalman.corregir(t.k, aXyah(d)); t.caja = aXyxy(t.k.m); t.score = d[4];
        t.ultimo = this.frame; t.estado = "seguido"; nuevosActivos.push(t);
      };

      // 1) detecciones fiables contra seguidos y perdidos (IoU x confianza)
      let c = [];
      pool.forEach((t, i) => altas.forEach((d, j) => { const v = 1 - iou(t.caja, d) * d[4]; if (v < 1) c.push([i, j, v]); }));
      let pares = asignar(c, this.match);
      const altasLibres = new Set(altas.map((_, j) => j)), poolLibre = new Set(pool.map((_, i) => i));
      for (const [i, j] of pares) { usar(pool[i], altas[j]); altasLibres.delete(j); poolLibre.delete(i); }

      // 2) detecciones dudosas contra los que seguían en cámara
      const resto = [...poolLibre].map((i) => pool[i]).filter((t) => t.estado === "seguido");
      c = [];
      resto.forEach((t, i) => bajas.forEach((d, j) => { const v = 1 - iou(t.caja, d); if (v < 1) c.push([i, j, v]); }));
      pares = asignar(c, 0.5);
      const restoUsado = new Set();
      for (const [i, j] of pares) { usar(resto[i], bajas[j]); restoUsado.add(i); }
      resto.forEach((t, i) => { if (!restoUsado.has(i)) { t.estado = "perdido"; nuevosPerdidos.push(t); } });
      for (const i of poolLibre) { const t = pool[i]; if (t.estado === "perdido" && !nuevosPerdidos.includes(t)) nuevosPerdidos.push(t); }

      // 3) trayectos de un solo fotograma contra lo que queda
      const libres = [...altasLibres].map((j) => altas[j]);
      c = [];
      sinConfirmar.forEach((t, i) => libres.forEach((d, j) => { const v = 1 - iou(t.caja, d) * d[4]; if (v < 1) c.push([i, j, v]); }));
      pares = asignar(c, 0.7);
      const libresUsadas = new Set();
      for (const [i, j] of pares) {
        const t = sinConfirmar[i]; t.confirmado = true; t.id = this.siguiente++; usar(t, libres[j]); libresUsadas.add(j);
      }

      // 4) personas nuevas
      libres.forEach((d, j) => {
        if (libresUsadas.has(j) || d[4] < this.nueva) return;
        const t = { k: Kalman.iniciar(aXyah(d)), caja: d.slice(0, 4), score: d[4], ultimo: this.frame, estado: "seguido", confirmado: this.frame === 1 };
        if (t.confirmado) t.id = this.siguiente++;
        nuevosActivos.push(t);
      });

      this.perdidos = nuevosPerdidos.filter((t) => this.frame - t.ultimo <= this.maxPerdido);
      // Duplicados: un seguido y un perdido sobre la misma persona -> sobra el perdido.
      this.perdidos = this.perdidos.filter((p) => !nuevosActivos.some((t) => t.confirmado && iou(p.caja, t.caja) > 0.85));
      this.activos = nuevosActivos;
      return this.activos.filter((t) => t.confirmado && t.ultimo === this.frame).map((t) => ({ id: t.id, caja: t.caja.slice() }));
    }
  }
  M.ByteTrack = ByteTrack;

  /* --------------------------------------------- re-identificación */

  M.PARAMETROS_REID = {
    umbralCostura: 0.65, umbralReentrada: 0.93, colorReentrada: 0.3,
    maxHuecoS: 2.0, maxSalto: 0.15, solapeMaxS: 0.5,
  };

  function norma(v) { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s) + 1e-9; }
  function normalizar(v) { const n = norma(v); return v.map((x) => x / n); }
  function punto(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function media(lista, centro) {
    if (!lista.length) return null;
    const d = lista[0].length, m = new Float64Array(d);
    for (let v of lista) {
      if (centro) { v = Array.from(v, (x, i) => x - centro[i]); v = normalizar(v); }
      for (let i = 0; i < d; i++) m[i] += v[i];
    }
    return normalizar(Array.from(m, (x) => x / lista.length));
  }

  // RGBA -> HSV con las escalas de OpenCV (H 0-180, S y V 0-255).
  function hsv(r, g, b) {
    const v = Math.max(r, g, b), mn = Math.min(r, g, b), d = v - mn;
    const s = v === 0 ? 0 : (255 * d) / v;
    let h = 0;
    if (d > 0) {
      if (v === r) h = (60 * (g - b)) / d; else if (v === g) h = 120 + (60 * (b - r)) / d; else h = 240 + (60 * (r - g)) / d;
      if (h < 0) h += 360;
    }
    return [h / 2, s, v];
  }

  // Color de la ropa por franjas: cabeza, torso y piernas. No mira el rostro.
  M.histogramaRopa = function (img, caja) {
    const [x1, y1, x2, y2] = caja.map(Math.round), alto = y2 - y1;
    const cortes = [[0, 0.18], [0.18, 0.5], [0.5, 0.9]];
    const vec = [];
    for (const [a, b] of cortes) {
      const hs = new Float64Array(64), vv = new Float64Array(8);
      const ya = y1 + Math.floor(alto * a), yb = y1 + Math.floor(alto * b);
      for (let y = ya; y < yb; y++) for (let x = x1; x < x2; x++) {
        const o = 4 * (y * img.width + x), [h, s, v] = hsv(img.data[o], img.data[o + 1], img.data[o + 2]);
        hs[Math.min(15, Math.floor(h / (180 / 16))) * 4 + Math.min(3, Math.floor(s / 64))]++;
        vv[Math.min(7, Math.floor(v / 32))]++;
      }
      vec.push(...hs, ...vv);
    }
    return normalizar(vec.map(Math.sqrt));
  };

  // Recorte 64x128 BGR (entrada del modelo de re-identificación), interpolación bilineal.
  M.recorteBGR = function (img, caja, out, off) {
    const [x1, y1, x2, y2] = caja, W = 64, Hh = 128, sx = (x2 - x1) / W, sy = (y2 - y1) / Hh;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const fx = Math.min(img.width - 1.001, Math.max(0, x1 + (x + 0.5) * sx - 0.5));
      const fy = Math.min(img.height - 1.001, Math.max(0, y1 + (y + 0.5) * sy - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < 3; c++) {
        const p = (yy, xx) => img.data[4 * (yy * img.width + xx) + c];
        const v = (1 - ay) * ((1 - ax) * p(y0, x0) + ax * p(y0, x0 + 1)) + ay * ((1 - ax) * p(y0 + 1, x0) + ax * p(y0 + 1, x0 + 1));
        out[off + (y * W + x) * 3 + (2 - c)] = Math.round(v);
      }
    }
  };

  M.recorteLimpio = function (caja, otras, ancho, alto, minAlto = 60, maxSolape = 0.15) {
    const [x1, y1, x2, y2] = caja;
    if (y2 - y1 < minAlto || x1 < 2 || x2 > ancho - 2 || y1 < 2) return false;
    const area = (x2 - x1) * (y2 - y1);
    for (const o of otras) {
      const ix = Math.max(0, Math.min(x2, o[2]) - Math.max(x1, o[0]));
      const iy = Math.max(0, Math.min(y2, o[3]) - Math.max(y1, o[1]));
      if ((ix * iy) / area > maxSolape) return false;
    }
    return true;
  };

  class Reidentificador {
    constructor(o = {}) {
      this.p = Object.assign({}, M.PARAMETROS_REID, o.parametros || {});
      this.cada = o.cadaSegundos ?? 0.5;
      this.maxMuestras = o.maxMuestras ?? 12;
      this.firmas = new Map();
      this.diagonal = 1;
    }
    firma(id) {
      if (!this.firmas.has(id)) this.firmas.set(id, { vectores: [], colores: [], ultimoT: -1e9, t0: null, t1: 0, p0: [0, 0], p1: [0, 0] });
      return this.firmas.get(id);
    }
    /* Devuelve los recortes a embeber: [{firma, caja}] con la caja en coordenadas de `img`. */
    observar(img, aImg, t, pistas, ancho, alto) {
      this.diagonal = Math.hypot(ancho, alto);
      const pedir = [];
      pistas.forEach((p, i) => {
        const f = this.firma(p.id), c = p.caja, pie = [(c[0] + c[2]) / 2, c[3]];
        if (f.t0 === null) { f.t0 = t; f.p0 = pie; }
        f.t1 = t; f.p1 = pie;
        if (f.colores.length >= this.maxMuestras || t - f.ultimoT < this.cada) return;
        const otras = pistas.filter((_, j) => j !== i).map((q) => q.caja);
        if (!M.recorteLimpio(c, otras, ancho, alto)) return;
        const ci = aImg(c);
        if (ci[2] - ci[0] < 4 || ci[3] - ci[1] < 8) return;
        f.ultimoT = t;
        f.colores.push(M.histogramaRopa(img, ci));
        pedir.push({ firma: f, caja: ci });
      });
      return pedir;
    }
    continuidad(a, b) {
      let fa = this.firmas.get(a), fb = this.firmas.get(b);
      if (!fa || !fb || fa.t0 === null || fb.t0 === null) return false;
      if (fb.t0 < fa.t0) [fa, fb] = [fb, fa];
      const hueco = fb.t0 - fa.t1, salto = Math.hypot(fb.p0[0] - fa.p1[0], fb.p0[1] - fa.p1[1]);
      return hueco >= -this.p.solapeMaxS && hueco <= this.p.maxHuecoS && salto <= this.p.maxSalto * this.diagonal;
    }
    centroColor() {
      if (this._centro) return this._centro;
      const todos = []; for (const f of this.firmas.values()) todos.push(...f.colores);
      if (!todos.length) return null;
      const c = new Float64Array(todos[0].length); for (const v of todos) for (let i = 0; i < c.length; i++) c[i] += v[i] / todos.length;
      return (this._centro = Array.from(c));
    }
    comparar(a, b) {
      const fa = this.firmas.get(a), fb = this.firmas.get(b);
      if (!fa || !fb || !fa.colores.length || !fb.colores.length) return null;
      const centro = this.centroColor();
      const color = punto(media(fa.colores, centro), media(fb.colores, centro));
      const va = media(fa.vectores), vb = media(fb.vectores);
      return [va && vb ? punto(va, vb) : color, color];
    }
    mismaPersona(a, b) {
      const c = this.comparar(a, b);
      if (!c) return null;
      const [modelo, color] = c;
      if (this.continuidad(a, b)) { const s = modelo + 0.5 * color; return s >= this.p.umbralCostura ? s : null; }
      if (modelo >= this.p.umbralReentrada && color >= this.p.colorReentrada) return modelo;
      return null;
    }
  }
  M.Reidentificador = Reidentificador;

  /* Id de persona (1, 2, ...) para cada trayecto {id: [t0, t1]}. Nunca une trayectos simultáneos. */
  M.agrupar = function (tramos, reid) {
    const ids = Object.keys(tramos).map(Number).sort((a, b) => a - b);
    const sol = reid ? reid.p.solapeMaxS : 0.5;
    const simult = (a, b) => Math.min(tramos[a][1], tramos[b][1]) - Math.max(tramos[a][0], tramos[b][0]) > sol;
    const cand = [];
    if (reid) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      if (simult(a, b)) continue;
      const s = reid.mismaPersona(a, b);
      if (s !== null) cand.push([s, a, b]);
    }
    cand.sort((x, y) => y[0] - x[0]);
    const grupo = new Map(ids.map((i) => [i, i])), miembros = new Map(ids.map((i) => [i, [i]]));
    for (const [, a, b] of cand) {
      const ga = grupo.get(a), gb = grupo.get(b);
      if (ga === gb) continue;
      if (miembros.get(ga).some((x) => miembros.get(gb).some((y) => simult(x, y)))) continue;
      for (const m of miembros.get(gb)) grupo.set(m, ga);
      miembros.get(ga).push(...miembros.get(gb)); miembros.delete(gb);
    }
    const orden = [...miembros.values()].sort((x, y) => Math.min(...x.map((m) => tramos[m][0])) - Math.min(...y.map((m) => tramos[m][0])));
    const out = {}; orden.forEach((ms, n) => ms.forEach((m) => (out[m] = n + 1)));
    return out;
  };

  /* --------------------------------------- trayectos, zonas y líneas */

  class Registro {
    constructor(config, ancho, alto) {
      this.config = config; this.ancho = ancho; this.alto = alto;
      this.tr = new Map();
      this.gw = 64; this.gh = Math.max(1, Math.round((64 * alto) / ancho));
      this.calor = new Float32Array(this.gw * this.gh);
    }
    observar(t, pistas) {
      for (const p of pistas) {
        const c = p.caja, pie = [(c[0] + c[2]) / 2, c[3]];
        let tr = this.tr.get(p.id);
        if (!tr) { tr = { id: p.id, t0: t, t1: t, zona: null, zt: 0, estancias: [], lados: {}, cruces: [], n: 0 }; this.tr.set(p.id, tr); }
        tr.t1 = t; tr.n++;
        const gx = Math.min(this.gw - 1, Math.max(0, Math.floor((pie[0] / this.ancho) * this.gw)));
        const gy = Math.min(this.gh - 1, Math.max(0, Math.floor((pie[1] / this.alto) * this.gh)));
        this.calor[gy * this.gw + gx]++;
        const z = M.zonaDe(pie, this.config);
        if (z !== tr.zona) {
          if (tr.zona !== null) tr.estancias.push([tr.zona, tr.zt, t]);
          tr.zona = z; tr.zt = t;
        }
        for (const l of this.config.lineas) {
          if (!M.dentroTramo(pie, l.a, l.b)) continue;
          const lado = M.ladoLinea(pie, l.a, l.b), previo = tr.lados[l.nombre];
          if (previo !== undefined && lado !== 0 && lado !== previo) tr.cruces.push([l.nombre, t, lado]);
          if (lado !== 0) tr.lados[l.nombre] = lado;
        }
      }
    }
    cerrar() {
      for (const tr of this.tr.values()) { if (tr.zona !== null) tr.estancias.push([tr.zona, tr.zt, tr.t1]); tr.zona = null; }
    }
  }
  M.Registro = Registro;

  /* ------------------------------------------------- estadísticas */

  const r1 = (x) => Math.round(x * 10) / 10;
  const tasa = (a, b) => (b ? a / b : 0);
  function mediana(v) { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  /* `a` es un análisis guardado; `tickets` [{id, momento: Date, importe, categorias: Set}]. */
  M.estadisticas = function (a, tickets) {
    const cfg = a.config, inicio = new Date(a.inicio);
    const reloj = (s) => new Date(inicio.getTime() + s * 1000);
    const trs = a.trayectos;
    const personas = new Map();
    for (const t of trs) {
      if (!personas.has(t.persona)) personas.set(t.persona, { persona: t.persona, trayectos: [], t0: t.t0, t1: t.t1, segundos: 0, zonas: {}, cruces: [] });
      const p = personas.get(t.persona);
      p.trayectos.push(t); p.t0 = Math.min(p.t0, t.t0); p.t1 = Math.max(p.t1, t.t1);
      for (const [z, i, f] of t.estancias) p.zonas[z] = (p.zonas[z] || 0) + (f - i);
      p.cruces.push(...t.cruces);
    }
    for (const p of personas.values()) {
      // Tiempo en cámara: unión de sus trayectos.
      const iv = p.trayectos.map((t) => [t.t0, t.t1]).sort((x, y) => x[0] - y[0]);
      let s = 0, ca = -1, cb = -1;
      for (const [i, f] of iv) { if (i > cb) { s += cb - ca; ca = i; cb = f; } else cb = Math.max(cb, f); }
      p.segundos = s + (cb - ca);
      // Recorrido: zonas en orden, ignorando roces de menos de 1 s.
      const est = p.trayectos.flatMap((t) => t.estancias).filter((e) => e[2] - e[1] >= 1).sort((x, y) => x[1] - y[1]);
      p.recorrido = [];
      for (const e of est) if (p.recorrido[p.recorrido.length - 1] !== e[0]) p.recorrido.push(e[0]);
    }
    const lista = [...personas.values()].sort((x, y) => x.persona - y.persona);
    const nUnicos = lista.length, umbral = cfg.interaccion_segundos;

    // Ocupación por segundo y afluencia (personas nuevas) por intervalo.
    const dur = Math.max(1, Math.ceil(a.video.duracion));
    const ocup = new Array(dur).fill(0);
    for (const p of lista) {
      const vistos = new Set();
      for (const t of p.trayectos) for (let s = Math.floor(t.t0); s <= Math.min(dur - 1, Math.floor(t.t1)); s++) vistos.add(s);
      for (const s of vistos) ocup[s]++;
    }
    const bin = dur <= 180 ? 10 : dur <= 1800 ? 60 : dur <= 4 * 3600 ? 300 : 900;
    const afluencia = [];
    for (let b = 0; b * bin < dur; b++) {
      const desde = b * bin, hasta = Math.min(dur, desde + bin);
      const sl = ocup.slice(desde, hasta);
      afluencia.push({
        desde: reloj(desde), hasta: reloj(hasta),
        nuevos: lista.filter((p) => p.t0 >= desde && p.t0 < hasta).length,
        media: sl.length ? sl.reduce((x, y) => x + y, 0) / sl.length : 0,
        max: sl.length ? Math.max(...sl) : 0,
      });
    }
    const maxSim = Math.max(0, ...ocup);
    const momentoPico = ocup.indexOf(maxSim);

    // Zonas.
    const desde = reloj(0), hasta = reloj(a.video.duracion);
    const tk = (tickets || []).filter((t) => t.momento >= desde && t.momento <= hasta);
    const zonas = cfg.zonas.map((z) => {
      const tiempos = lista.filter((p) => p.zonas[z.nombre] > 0).map((p) => p.zonas[z.nombre]);
      const tc = tk.filter((t) => z.categoria && t.categorias.has(z.categoria)).length;
      return {
        zona: z.nombre, categoria: z.categoria || "", visitantes: tiempos.length, pct: tasa(tiempos.length, nUnicos),
        permanencia: tiempos.length ? tiempos.reduce((x, y) => x + y, 0) / tiempos.length : 0,
        paradas: tiempos.filter((s) => s >= umbral).length, tickets: tc, conversion: tasa(tc, tiempos.length),
      };
    });
    const conZona = lista.filter((p) => Object.values(p.zonas).some((s) => s > 0)).length;
    const pararon = lista.filter((p) => Object.values(p.zonas).some((s) => s >= umbral)).length;

    // Recorridos y transiciones entre zonas.
    const rutas = new Map(), trans = new Map();
    for (const p of lista) {
      if (!p.recorrido.length) continue;
      const k = p.recorrido.join(" → "); rutas.set(k, (rutas.get(k) || 0) + 1);
      for (let i = 1; i < p.recorrido.length; i++) { const k2 = p.recorrido[i - 1] + "\u0000" + p.recorrido[i]; trans.set(k2, (trans.get(k2) || 0) + 1); }
    }
    const recorridos = [...rutas].map(([ruta, n]) => ({ ruta, n })).sort((x, y) => y.n - x.n);
    const transiciones = [...trans].map(([k, n]) => { const [de, a2] = k.split("\u0000"); return { de, a: a2, n }; }).sort((x, y) => y.n - x.n);

    // Líneas: entradas y salidas por persona única.
    const lineas = cfg.lineas.map((l) => {
      const ent = new Set(), sal = new Set(); let cruces = 0;
      for (const p of lista) for (const [nombre, , sentido] of p.cruces) {
        if (nombre !== l.nombre) continue;
        cruces++; (sentido === (l.entrada || 1) ? ent : sal).add(p.persona);
      }
      return { linea: l.nombre, cruces, entradas: ent.size, salidas: sal.size };
    });

    // Permanencia en cámara.
    const segs = lista.map((p) => p.segundos);
    const tramosPerm = [[0, 10, "< 10 s"], [10, 30, "10–30 s"], [30, 60, "30–60 s"], [60, 180, "1–3 min"], [180, 600, "3–10 min"], [600, Infinity, "> 10 min"]];
    const permanencia = tramosPerm.map(([i, f, et]) => ({ etiqueta: et, n: segs.filter((s) => s >= i && s < f).length }));

    const importe = tk.reduce((s, t) => s + t.importe, 0);
    const embudo = [
      { etapa: "Clientes únicos", n: nUnicos },
      { etapa: "Entraron en una zona", n: conZona },
      { etapa: `Se detuvieron ≥ ${umbral} s`, n: pararon },
      { etapa: "Compraron (tickets)", n: tk.length },
    ];
    if (!cfg.zonas.length) embudo.splice(1, 2);

    return {
      desde, hasta, conteoTotal: trs.length, unicos: nUnicos, descartados: a.descartados || 0,
      maxSimultaneas: maxSim, momentoPico: reloj(Math.max(0, momentoPico)),
      ocupacionMedia: ocup.reduce((x, y) => x + y, 0) / dur, ocupacion: ocup,
      permanenciaMediana: mediana(segs), permanenciaMedia: segs.length ? segs.reduce((x, y) => x + y, 0) / segs.length : 0,
      permanencia, afluencia, bin, zonas, conZona, pararon, recorridos, transiciones, lineas,
      tickets: tk, importe, conversion: tasa(tk.length, nUnicos), ticketMedio: tasa(importe, tk.length),
      ventaPorCliente: tasa(importe, nUnicos), embudo,
      personas: lista.map((p) => ({
        persona: p.persona, conteos: p.trayectos.length, desde: reloj(p.t0), hasta: reloj(p.t1), segundos: r1(p.segundos),
        recorrido: p.recorrido, zonas: p.zonas, paro: Object.values(p.zonas).some((s) => s >= umbral),
      })),
      reloj,
    };
  };

  G.Motor = M;
})(typeof self !== "undefined" ? self : globalThis);
