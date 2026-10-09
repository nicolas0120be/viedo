import sqlite3

from tienda_analytics.metricas import calcular
from tienda_analytics.zonas import Linea, cargar_config

CONFIG = "config/zonas_pasillo.json"


def _eventos(ruta):
    con = sqlite3.connect(ruta)
    con.executescript(
        """
        CREATE TABLE visitas (id INTEGER PRIMARY KEY, persona_id INTEGER, tienda TEXT, inicio TEXT, fin TEXT, segundos REAL);
        CREATE TABLE estancias (visita_id INTEGER, zona TEXT, categoria TEXT, inicio TEXT, fin TEXT, segundos REAL);
        CREATE TABLE cruces (visita_id INTEGER, linea TEXT, momento TEXT, sentido INTEGER);
        INSERT INTO visitas VALUES (1,1,'t','2026-10-09T11:00:00','2026-10-09T11:00:30',30);
        INSERT INTO visitas VALUES (2,2,'t','2026-10-09T11:00:10','2026-10-09T11:01:00',50);
        INSERT INTO estancias VALUES (1,'pasillo_izquierdo','vajilla','','',2);
        INSERT INTO estancias VALUES (1,'pasillo_izquierdo','vajilla','','',2);
        INSERT INTO estancias VALUES (2,'pasillo_derecho','cuencos','','',1);
        """
    )
    con.commit()
    con.close()


def test_embudo_y_conversion(tmp_path):
    db = tmp_path / "e.sqlite"
    _eventos(db)
    tickets = tmp_path / "t.csv"
    tickets.write_text(
        "ticket_id,fecha_hora,importe,categorias\n"
        "A,2026-10-09T11:00:20,10,vajilla\n"
        "B,2026-10-09T12:00:00,99,vajilla\n",  # fuera de la ventana: no cuenta
        encoding="utf-8",
    )
    r = calcular(db, tickets, CONFIG)
    assert r.visitantes == 2
    # 2 s + 2 s en la misma zona suman 4 s >= 3 s: cuenta como parada larga.
    assert r.interactuaron == 1
    assert r.tickets == 1
    assert r.conversion == 0.5
    izq = next(z for z in r.zonas if z.zona == "pasillo_izquierdo")
    assert izq.visitantes == 1
    assert izq.permanencia_media_s == 4.0
    assert izq.conversion_zona == 1.0


def test_sin_tickets(tmp_path):
    db = tmp_path / "e.sqlite"
    _eventos(db)
    r = calcular(db, None, CONFIG)
    assert r.tickets == 0
    assert r.conversion == 0.0


def test_lado_de_linea():
    linea = Linea("l", (0, 100), (200, 100))
    assert linea.lado((50, 50)) != linea.lado((50, 150))
    assert linea.dentro_del_tramo((50, 0))
    assert not linea.dentro_del_tramo((250, 0))


def test_config_carga_zonas():
    c = cargar_config(CONFIG)
    assert {z.nombre for z in c.zonas} >= {"pasillo_izquierdo", "pasillo_derecho"}
    izq = next(z for z in c.zonas if z.nombre == "pasillo_izquierdo")
    assert izq.contiene((100, 300))


def test_conteo_total_y_unico(tmp_path):
    db = tmp_path / "e.sqlite"
    _eventos(db)
    con = sqlite3.connect(db)
    # El trayecto 3 es la misma persona que el 1 (re-identificada).
    con.execute("INSERT INTO visitas VALUES (3,1,'t','2026-10-09T11:00:40','2026-10-09T11:00:50',10)")
    con.execute("INSERT INTO estancias VALUES (3,'pasillo_izquierdo','vajilla','','',5)")
    con.commit()
    con.close()
    r = calcular(db, None, CONFIG)
    assert r.conteo_total == 3
    assert r.visitantes == 2
    izq = next(z for z in r.zonas if z.zona == "pasillo_izquierdo")
    assert izq.visitantes == 1
    assert izq.permanencia_media_s == 9.0
