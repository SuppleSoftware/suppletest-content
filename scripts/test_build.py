import json
import tempfile
import unittest
from pathlib import Path

import build

ASIG = "id,nombre,curso,cuatrimestre\n1,Redes,Tercero,Primero\n"
TEMA = "id,nombre,asignatura_id\n1,Teoría,1\n"
PREG = ("id,temario_id,numero,tipo,enunciado,comentario,imagen\n"
        "1,1,,OpcionUnica,¿Uno?,,\n"
        "2,1,,VerdaderoFalso,¿Dos?,Porque sí,\n")
RESP = ("pregunta_id,texto,correcta\n"
        "1,A,VERDADERO\n1,B,FALSO\n"
        "2,Verdadero,FALSO\n2,Falso,VERDADERO\n")


def hojas(**cambios):
    h = dict(Asignaturas=ASIG, Temarios=TEMA, Preguntas=PREG, Respuestas=RESP)
    h.update(cambios)
    return h


def errores_de(h, imagenes=Path("/no/existe")):
    try:
        build.construir(h, imagenes)
    except build.ErrorContenido as e:
        return "\n".join(e.errores)
    raise AssertionError("se esperaba un error")


class ConstruirTest(unittest.TestCase):

    def test_contenido_valido(self):
        c, imagenes, avisos = build.construir(hojas(), Path("/no/existe"))
        self.assertEqual([p["id"] for p in c["preguntas"]], [1, 2])
        self.assertEqual([p["numero"] for p in c["preguntas"]], [1, 2])  # numeración automática
        self.assertEqual(c["preguntas"][1]["comentario"], "Porque sí")
        self.assertIsNone(c["preguntas"][0]["comentario"])
        self.assertEqual([r["id"] for p in c["preguntas"] for r in p["respuestas"]], [1, 2, 3, 4])
        self.assertTrue(c["preguntas"][0]["respuestas"][0]["correcta"])
        self.assertEqual((imagenes, avisos), ({}, []))

    def test_booleanos_en_varios_idiomas(self):
        for v in ("TRUE", "true", "Verdadero", "sí", "1"):
            self.assertTrue(build.booleano(v, "H", 2, []))
        for v in ("FALSE", "Falso", "no", "0", ""):
            self.assertFalse(build.booleano(v, "H", 2, []))
        errores = []
        build.booleano("quizá", "H", 2, errores)
        self.assertEqual(len(errores), 1)

    def test_sin_respuesta_correcta(self):
        e = errores_de(hojas(Respuestas=RESP.replace("VERDADERO", "FALSO")))
        self.assertIn("ninguna respuesta marcada como correcta", e)

    def test_pregunta_sin_respuestas(self):
        e = errores_de(hojas(Respuestas="pregunta_id,texto,correcta\n1,A,TRUE\n"))
        self.assertIn("Preguntas fila 3 (id 2): no tiene respuestas", e)

    def test_ids_repetidos_con_fila(self):
        e = errores_de(hojas(Preguntas=PREG + "2,1,,OpcionUnica,Otra,,\n"))
        self.assertIn("Preguntas fila 4: id 2 repetido (ya está en la fila 3)", e)

    def test_referencias_rotas(self):
        e = errores_de(hojas(Temarios="id,nombre,asignatura_id\n1,Teoría,9\n",
                             Respuestas=RESP + "77,X,TRUE\n"))
        self.assertIn("asignatura_id 9 no existe", e)
        self.assertIn("pregunta_id 77 no existe", e)

    def test_tipo_invalido_y_columna_ausente(self):
        self.assertIn("tipo 'Otro' no válido", errores_de(hojas(Preguntas=PREG.replace("OpcionUnica", "Otro"))))
        self.assertIn("faltan las columnas", errores_de(hojas(Asignaturas="id,nombre\n1,Redes\n")))

    def test_acumula_todos_los_errores(self):
        e = errores_de(hojas(Preguntas=PREG.replace("OpcionUnica", "Otro").replace("¿Dos?", ""),
                             Temarios="id,nombre,asignatura_id\n1,Teoría,9\n"))
        self.assertGreaterEqual(len(e.splitlines()), 3)

    def test_avisos_de_tipo_incoherente(self):
        c, _, avisos = build.construir(hojas(Respuestas=RESP.replace("1,B,FALSO", "1,B,VERDADERO")), Path("/no/existe"))
        self.assertTrue(any("OpcionUnica" in a and "2 respuestas correctas" in a for a in avisos))

    def test_saltos_de_linea_y_comas_en_celdas(self):
        preg = 'id,temario_id,tipo,enunciado\n1,1,OpcionUnica,"línea 1\nlínea 2, con coma"\n'
        resp = "pregunta_id,texto,correcta\n1,A,TRUE\n"
        c, _, _ = build.construir(hojas(Preguntas=preg, Respuestas=resp), Path("/no/existe"))
        self.assertEqual(c["preguntas"][0]["enunciado"], "línea 1\nlínea 2, con coma")

    def test_ignora_filas_vacias_con_checkbox_y_columnas_auto(self):
        preg = "id,temario_id,tipo,enunciado,estado (auto)\n1,1,OpcionUnica,Hola,ok\n,,,,\n"
        resp = "pregunta_id,texto,correcta,pregunta (auto)\n1,A,TRUE,Hola\n,,FALSE,\n,,FALSE,\n"
        c, _, _ = build.construir(hojas(Preguntas=preg, Respuestas=resp), Path("/no/existe"))
        self.assertEqual(len(c["preguntas"]), 1)


class ImagenesTest(unittest.TestCase):

    def montar(self, bytes_):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "imagenes").mkdir()
        (tmp / "imagenes" / "grafo.png").write_bytes(bytes_)
        preg = PREG.replace("¿Uno?,,", "¿Uno?,,grafo.png")
        return tmp, hojas(Preguntas=preg)

    def test_archivo_publicado_cambia_con_el_contenido(self):
        tmp, h = self.montar(b"v1")
        c1, pub1, _ = build.construir(h, tmp / "imagenes")
        (tmp / "imagenes" / "grafo.png").write_bytes(b"v2")
        c2, pub2, _ = build.construir(h, tmp / "imagenes")
        self.assertNotEqual(c1["imagenes"][0]["archivo"], c2["imagenes"][0]["archivo"])
        self.assertEqual(c1["imagenes"][0]["id"], c2["imagenes"][0]["id"])  # el id es estable
        self.assertTrue(c1["imagenes"][0]["archivo"].startswith("images/grafo-"))

    def test_imagen_inexistente_o_con_formato_raro(self):
        tmp, h = self.montar(b"x")
        self.assertIn("no existe imagenes/falta.png",
                      errores_de(hojas(Preguntas=PREG.replace("¿Uno?,,", "¿Uno?,,falta.png")), tmp / "imagenes"))
        self.assertIn("debe ser", errores_de(hojas(Preguntas=PREG.replace("¿Uno?,,", "¿Uno?,,a.gif")), tmp / "imagenes"))

    def test_main_es_idempotente_y_limpia_imagenes_viejas(self):
        tmp, h = self.montar(b"v1")
        csvs = tmp / "csv"
        csvs.mkdir()
        for nombre, texto in h.items():
            (csvs / f"{nombre}.csv").write_text(texto, encoding="utf-8")
        args = ["--csv-dir", str(csvs), "--raiz", str(tmp)]
        (tmp / "images").mkdir()
        (tmp / "images" / "vieja.jpg").write_bytes(b"x")

        self.assertEqual(build.main(args), 0)
        contenido = (tmp / "content.json").read_text(encoding="utf-8")
        manifest = json.loads((tmp / "manifest.json").read_text())
        self.assertEqual(manifest["schema"], 1)
        self.assertEqual(len(manifest["version"]), 12)
        self.assertEqual([p.name.split("-")[0] for p in (tmp / "images").iterdir()], ["grafo"])

        self.assertEqual(build.main(args), 0)  # segunda ejecución: nada cambia
        self.assertEqual((tmp / "content.json").read_text(encoding="utf-8"), contenido)

    def test_con_errores_no_se_escribe_nada(self):
        tmp, h = self.montar(b"v1")
        csvs = tmp / "csv"
        csvs.mkdir()
        h["Respuestas"] = RESP.replace("VERDADERO", "FALSO")
        for nombre, texto in h.items():
            (csvs / f"{nombre}.csv").write_text(texto, encoding="utf-8")
        self.assertEqual(build.main(["--csv-dir", str(csvs), "--raiz", str(tmp)]), 1)
        self.assertFalse((tmp / "content.json").exists())
        self.assertFalse((tmp / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
