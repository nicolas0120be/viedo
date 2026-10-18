import numpy as np

from tienda_analytics.reid import Firma, Reidentificador, agrupar, duplicados


def _firma(vec, t0, t1, p0, p1, color=None):
    v = np.asarray(vec, dtype=np.float32)
    v /= np.linalg.norm(v)
    c = np.asarray(color if color is not None else vec, dtype=np.float32)
    c /= np.linalg.norm(c)
    return Firma(vectores=[v], colores=[c], t_inicio=t0, t_fin=t1, pos_inicio=p0, pos_fin=p1)


def _reid(firmas):
    r = Reidentificador(modelo=None)
    r.firmas = firmas
    r.diagonal = 1000.0
    return r


def test_cose_fragmentos_contiguos_de_la_misma_persona():
    r = _reid({
        1: _firma([1, 0, 0, 0], 0, 10, (100, 400), (300, 400)),
        2: _firma([1, 0.05, 0, 0], 10.5, 20, (310, 400), (500, 400)),  # sigue donde acabó 1
        3: _firma([0, 0, 1, 0], 0, 20, (800, 400), (800, 300)),
    })
    p = agrupar({1: (0, 10), 2: (10.5, 20), 3: (0, 20)}, r)
    assert p[1] == p[2]
    assert p[3] != p[1]


def test_simultaneos_nunca_son_la_misma_persona():
    r = _reid({
        1: _firma([1, 0, 0, 0], 0, 10, (100, 400), (300, 400)),
        2: _firma([1, 0, 0, 0], 5, 15, (300, 400), (500, 400)),
    })
    p = agrupar({1: (0, 10), 2: (5, 15)}, r)
    assert p[1] != p[2]


def test_reentrada_solo_con_apariencia_casi_identica():
    lejos = {1: (0, 10), 2: (60, 70), 3: (120, 130)}
    r = _reid({
        1: _firma([1, 0, 0, 0], 0, 10, (100, 400), (100, 400), color=[1, 0, 0, 0]),
        2: _firma([1, 0.02, 0, 0], 60, 70, (900, 100), (900, 100), color=[1, 0, 0, 0]),  # vuelve igual
        3: _firma([1, 0.6, 0, 0], 120, 130, (900, 100), (900, 100), color=[0, 1, 0, 0]),  # se parece, no igual
    })
    p = agrupar(lejos, r)
    assert p[1] == p[2]
    assert p[3] != p[1]


def test_descarta_caja_duplicada_encima_de_otra_persona():
    persona = np.array([100, 100, 200, 400.0])
    otra = np.array([400, 100, 500, 400.0])
    # El trayecto 3 es una segunda caja casi encima del 1 durante toda su vida; el 2 es otra persona.
    registro = [(k, [1, 2] + ([3] if 5 <= k < 15 else []),
                 [persona, otra] + ([persona + 8] if 5 <= k < 15 else [])) for k in range(30)]
    tramos = {1: (0.0, 3.0), 2: (0.0, 3.0), 3: (0.5, 1.5)}
    assert duplicados(registro, tramos) == {3}


def test_no_descarta_personas_que_se_cruzan_un_momento():
    a = np.array([100, 100, 200, 400.0])
    registro = [(k, [1, 2], [a, a + np.array([300 - 25 * k, 0, 300 - 25 * k, 0])]) for k in range(20)]
    tramos = {1: (0.0, 2.0), 2: (0.0, 1.9)}
    assert duplicados(registro, tramos) == set()

