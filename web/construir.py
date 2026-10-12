"""Une fuente.html, motor.js y app.js en una sola página: python3 construir.py <carpeta_salida>"""
import pathlib
import sys

d = pathlib.Path(__file__).parent
salida = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else d / "dist")
salida.mkdir(parents=True, exist_ok=True)
s = (d / "fuente.html").read_text(encoding="utf-8")
s = s.replace("<script>/*MOTOR*/</script>", "<script>\n" + (d / "motor.js").read_text(encoding="utf-8") + "</script>")
s = s.replace("<script>/*APP*/</script>", "<script>\n" + (d / "app.js").read_text(encoding="utf-8") + "</script>")
# Página completa para abrirla servida en local (el visor de Artifacts añade este esqueleto él mismo).
html = ('<!doctype html><html lang="es"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + s + "</body></html>")
(salida / "analitica-tienda.html").write_text(html, encoding="utf-8")
