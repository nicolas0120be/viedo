/* Trabajador: carga un modelo ONNX y ejecuta detección de personas o re-identificación. */
/* global ort, Motor */
let sesion = null, tipo = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.cmd === "iniciar") {
      tipo = m.tipo;
      try { importScripts(m.base + "ort.min.js"); } catch (_) { importScripts(m.ortCdn); }
      importScripts(m.base + "motor.js");
      ort.env.wasm.wasmPaths = m.base;
      ort.env.wasm.numThreads = 1;
      // Los modelos se publican en base64 (.txt) porque el alojamiento no sirve archivos .onnx.
      let modelo = m.base + m.modelo;
      if (m.modelo.endsWith(".txt")) {
        const txt = await (await fetch(modelo)).text(), bin = atob(txt.trim()), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        modelo = bytes;
      }
      sesion = await ort.InferenceSession.create(modelo, { executionProviders: ["wasm"] });
      self.postMessage({ id: m.id, ok: true });
    } else if (m.cmd === "detectar") {
      // m.pixeles: RGBA 640x640 con el fotograma ya escalado y centrado.
      const n = 640 * 640, d = new Uint8ClampedArray(m.pixeles), f = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) { f[i] = d[4 * i] / 255; f[i + n] = d[4 * i + 1] / 255; f[i + 2 * n] = d[4 * i + 2] / 255; }
      const r = await sesion.run({ [sesion.inputNames[0]]: new ort.Tensor("float32", f, [1, 3, 640, 640]) });
      const o = r[sesion.outputNames[0]];
      const cajas = Motor.decodificarYolo(o.data, o.dims[2], m.lb, m.minScore, 0.7);
      self.postMessage({ id: m.id, ok: true, cajas, pixeles: m.pixeles }, [m.pixeles]);
    } else if (m.cmd === "embeber") {
      // m.lote: uint8 [N, 128, 64, 3] BGR
      const r = await sesion.run({ [sesion.inputNames[0]]: new ort.Tensor("uint8", new Uint8Array(m.lote), [m.n, 128, 64, 3]) });
      const o = r[sesion.outputNames[0]], dim = o.dims[1], vec = [];
      for (let i = 0; i < m.n; i++) vec.push(Array.from(o.data.slice(i * dim, (i + 1) * dim)));
      self.postMessage({ id: m.id, ok: true, vectores: vec });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
