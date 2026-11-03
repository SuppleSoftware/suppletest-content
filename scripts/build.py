#!/usr/bin/env python3
"""Genera content.json, manifest.json e images/ a partir del Google Sheet.

Uso:
  python3 scripts/build.py                      # descarga el Sheet indicado en sheet.json
  python3 scripts/build.py --csv-dir DIR        # usa DIR/<Hoja>.csv en lugar de descargar
  python3 scripts/build.py --check              # valida sin escribir nada

Solo usa la librería estándar. Si el contenido tiene errores termina con código 1 y NO toca
ningún archivo, de modo que nunca se publica un contenido roto.
"""
import argparse
import csv
import hashlib
import io
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SCHEMA = 1
TIPOS = ("VerdaderoFalso", "OpcionUnica", "MultiRespuesta")
EXT_IMAGEN = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGEN = 2 * 1024 * 1024  # la app guarda las imágenes en SQLite

COLUMNAS = {
    "Asignaturas": ["id", "nombre", "curso", "cuatrimestre"],
    "Temarios": ["id", "nombre", "asignatura_id"],
    "Preguntas": ["id", "temario_id", "tipo", "enunciado"],  # obligatorias
    "Respuestas": ["pregunta_id", "texto", "correcta"],
}
OPCIONALES = {"Preguntas": ["numero", "comentario", "imagen"]}


class ErrorContenido(Exception):
    def __init__(self, errores):
        super().__init__("\n".join(errores))
        self.errores = errores


# ---------------------------------------------------------------- lectura

def descargar_hoja(sheet_id, gid, intentos=3):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    for n in range(1, intentos + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError) as e:
            if n == intentos:
                raise SystemExit(f"No se pudo descargar la hoja gid={gid}: {e}")
            time.sleep(2 * n)


def leer_hojas(args, raiz):
    if args.csv_dir:
        d = Path(args.csv_dir)
        return {h: (d / f"{h}.csv").read_text(encoding="utf-8") for h in COLUMNAS}
    config = json.loads((raiz / "sheet.json").read_text(encoding="utf-8"))
    if not config.get("id"):
        raise SystemExit("sheet.json no tiene el id del Sheet todavía")
    return {h: descargar_hoja(config["id"], config["hojas"][h]) for h in COLUMNAS}


def filas(hoja, texto, errores):
    """Devuelve [(nº de fila en el Sheet, {columna: valor})] ignorando filas vacías."""
    lector = csv.reader(io.StringIO(texto.lstrip("﻿"), newline=""))
    try:
        cabecera = [c.strip().lower() for c in next(lector)]
    except StopIteration:
        errores.append(f"{hoja}: la hoja está vacía")
        return []
    faltan = [c for c in COLUMNAS[hoja] if c not in cabecera]
    if faltan:
        errores.append(f"{hoja}: faltan las columnas {faltan} (cabecera encontrada: {cabecera})")
        return []
    resultado = []
    for n, fila in enumerate(lector, start=2):
        valores = {c: (fila[i].replace("\r\n", "\n").strip() if i < len(fila) else "") for i, c in enumerate(cabecera)}
        # Ignora filas vacías. Las columnas "(auto)" (fórmulas) y un checkbox sin marcar (FALSE) no cuentan como datos.
        datos = [v for c, v in valores.items() if not c.endswith("(auto)") and not (c == "correcta" and v.upper() == "FALSE")]
        if any(datos):
            resultado.append((n, valores))
    return resultado


def entero(valor, hoja, fila, campo, errores):
    try:
        return int(valor)
    except ValueError:
        errores.append(f"{hoja} fila {fila}: '{campo}' debe ser un número entero (es '{valor}')")
        return None


def booleano(valor, hoja, fila, errores):
    v = valor.strip().lower()
    if v in ("true", "verdadero", "sí", "si", "1", "x", "v"):
        return True
    if v in ("false", "falso", "no", "0", ""):
        return False
    errores.append(f"{hoja} fila {fila}: 'correcta' debe ser VERDADERO o FALSO (es '{valor}')")
    return False


# ------------------------------------------------------------ construcción

def id_imagen(nombre):
    """Id estable derivado del nombre: añadir imágenes no cambia el id de las demás."""
    return int(hashlib.sha256(nombre.encode()).hexdigest()[:7], 16) + 1


def construir(hojas, dir_imagenes):
    """Devuelve (contenido, imagenes_publicadas {ruta: Path origen}, avisos)."""
    errores, avisos = [], []

    def unico(hoja, n, valor, vistos, campo="id"):
        if valor is None:
            return
        if valor in vistos:
            errores.append(f"{hoja} fila {n}: {campo} {valor} repetido (ya está en la fila {vistos[valor]})")
        vistos[valor] = n

    # Asignaturas
    asignaturas, vistos, nombres = [], {}, {}
    for n, f in filas("Asignaturas", hojas["Asignaturas"], errores):
        i = entero(f["id"], "Asignaturas", n, "id", errores)
        unico("Asignaturas", n, i, vistos)
        for campo in ("nombre", "curso", "cuatrimestre"):
            if not f[campo]:
                errores.append(f"Asignaturas fila {n}: falta '{campo}'")
        unico("Asignaturas", n, f["nombre"], nombres, "nombre")
        asignaturas.append(dict(id=i, nombre=f["nombre"], curso=f["curso"], cuatrimestre=f["cuatrimestre"]))
    ids_asig = {a["id"] for a in asignaturas}

    # Temarios
    temarios, vistos = [], {}
    for n, f in filas("Temarios", hojas["Temarios"], errores):
        i = entero(f["id"], "Temarios", n, "id", errores)
        a = entero(f["asignatura_id"], "Temarios", n, "asignatura_id", errores)
        unico("Temarios", n, i, vistos)
        if not f["nombre"]:
            errores.append(f"Temarios fila {n}: falta 'nombre'")
        if a is not None and a not in ids_asig:
            errores.append(f"Temarios fila {n}: asignatura_id {a} no existe en Asignaturas")
        temarios.append(dict(id=i, nombre=f["nombre"], asignaturaId=a))
    ids_temario = {t["id"] for t in temarios}

    # Respuestas agrupadas por pregunta, en el orden del Sheet
    respuestas, filas_resp = {}, {}
    for n, f in filas("Respuestas", hojas["Respuestas"], errores):
        p = entero(f["pregunta_id"], "Respuestas", n, "pregunta_id", errores)
        if not f["texto"]:
            errores.append(f"Respuestas fila {n}: falta 'texto'")
        respuestas.setdefault(p, []).append(dict(texto=f["texto"], correcta=booleano(f["correcta"], "Respuestas", n, errores)))
        filas_resp.setdefault(p, n)

    # Preguntas
    preguntas, vistos, imagenes = [], {}, {}
    for n, f in filas("Preguntas", hojas["Preguntas"], errores):
        i = entero(f["id"], "Preguntas", n, "id", errores)
        t = entero(f["temario_id"], "Preguntas", n, "temario_id", errores)
        unico("Preguntas", n, i, vistos)
        if t is not None and t not in ids_temario:
            errores.append(f"Preguntas fila {n}: temario_id {t} no existe en Temarios")
        if f["tipo"] not in TIPOS:
            errores.append(f"Preguntas fila {n}: tipo '{f['tipo']}' no válido (usa {', '.join(TIPOS)})")
        if not f["enunciado"]:
            errores.append(f"Preguntas fila {n}: falta 'enunciado'")
        numero = entero(f["numero"], "Preguntas", n, "numero", errores) if f.get("numero") else None
        resp = respuestas.get(i, [])
        if not resp:
            errores.append(f"Preguntas fila {n} (id {i}): no tiene respuestas en la hoja Respuestas")
        elif not any(r["correcta"] for r in resp):
            errores.append(f"Preguntas fila {n} (id {i}): ninguna respuesta marcada como correcta")
        else:
            correctas = sum(r["correcta"] for r in resp)
            if f["tipo"] == "OpcionUnica" and correctas != 1:
                avisos.append(f"Pregunta {i}: es OpcionUnica pero tiene {correctas} respuestas correctas (¿MultiRespuesta?)")
            if f["tipo"] == "VerdaderoFalso" and (len(resp) != 2 or correctas != 1):
                avisos.append(f"Pregunta {i}: es VerdaderoFalso pero tiene {len(resp)} respuestas y {correctas} correctas")
        imagen = f.get("imagen", "")
        if imagen:
            origen = dir_imagenes / imagen
            if origen.suffix.lower() not in EXT_IMAGEN:
                errores.append(f"Preguntas fila {n}: la imagen '{imagen}' debe ser {', '.join(sorted(EXT_IMAGEN))}")
            elif not origen.is_file():
                errores.append(f"Preguntas fila {n}: no existe imagenes/{imagen}")
            elif origen.stat().st_size > MAX_IMAGEN:
                errores.append(f"Preguntas fila {n}: imagenes/{imagen} pesa más de {MAX_IMAGEN // 1024 // 1024} MB")
            else:
                imagenes[imagen] = origen
        preguntas.append(dict(id=i, temarioId=t, numero=numero, tipo=f["tipo"], enunciado=f["enunciado"],
                              comentario=f.get("comentario") or None, imagen=imagen or None))
    ids_preg = {p["id"] for p in preguntas}
    for p, n in filas_resp.items():
        if p not in ids_preg:
            errores.append(f"Respuestas fila {n}: pregunta_id {p} no existe en Preguntas")

    # Ids de imagen derivados del nombre: no deben colisionar
    ids_img = {}
    for nombre in imagenes:
        otro = ids_img.setdefault(id_imagen(nombre), nombre)
        if otro != nombre:
            errores.append(f"Las imágenes '{nombre}' y '{otro}' generan el mismo id; renombra una")

    if errores:
        raise ErrorContenido(errores)

    # Numeración automática dentro de cada temario, en el orden del Sheet
    contador = {}
    for p in preguntas:
        contador[p["temarioId"]] = contador.get(p["temarioId"], 0) + 1
        if p["numero"] is None:
            p["numero"] = contador[p["temarioId"]]

    # Archivos publicados: nombre + hash del contenido, para que cambien si la imagen cambia
    publicados, por_nombre = {}, {}
    for nombre, origen in sorted(imagenes.items()):
        sha = hashlib.sha256(origen.read_bytes()).hexdigest()[:8]
        ruta = f"images/{origen.stem}-{sha}{origen.suffix.lower()}"
        publicados[ruta] = origen
        por_nombre[nombre] = (id_imagen(nombre), ruta)

    # Ids de respuesta secuenciales, siguiendo el orden de id de pregunta
    siguiente = 1
    salida = []
    for p in sorted(preguntas, key=lambda p: p["id"]):
        resp = []
        for r in respuestas[p["id"]]:
            resp.append(dict(id=siguiente, texto=r["texto"], correcta=r["correcta"]))
            siguiente += 1
        p["_resp"] = resp
    for p in sorted(preguntas, key=lambda p: (p["temarioId"], p["numero"], p["id"])):
        salida.append(dict(
            id=p["id"], temarioId=p["temarioId"], numero=p["numero"], tipo=p["tipo"],
            enunciado=p["enunciado"], comentario=p["comentario"],
            imagenId=por_nombre[p["imagen"]][0] if p["imagen"] else None,
            respuestas=p["_resp"]))

    contenido = dict(
        asignaturas=sorted(asignaturas, key=lambda a: a["id"]),
        temarios=sorted(temarios, key=lambda t: t["id"]),
        preguntas=salida,
        imagenes=[dict(id=i, archivo=r) for i, r in sorted(por_nombre.values())])
    return contenido, publicados, avisos


# --------------------------------------------------------------- escritura

def serializar(contenido):
    cuerpo = json.dumps(contenido, ensure_ascii=False, indent=1) + "\n"
    version = hashlib.sha256(cuerpo.encode()).hexdigest()[:12]
    manifest = json.dumps(dict(schema=SCHEMA, version=version, content="content.json"), indent=1) + "\n"
    return cuerpo, manifest, version


def escribir_si_cambia(ruta, contenido):
    if ruta.exists() and ruta.read_text(encoding="utf-8") == contenido:
        return False
    ruta.write_text(contenido, encoding="utf-8")
    return True


def publicar(raiz, cuerpo, manifest, imagenes):
    cambios = [escribir_si_cambia(raiz / "content.json", cuerpo),
               escribir_si_cambia(raiz / "manifest.json", manifest)]
    destino = raiz / "images"
    destino.mkdir(exist_ok=True)
    for ruta, origen in imagenes.items():
        if not (raiz / ruta).exists():
            shutil.copyfile(origen, raiz / ruta)
            cambios.append(True)
    for existente in destino.iterdir():  # imágenes que ya no se usan
        if existente.is_file() and f"images/{existente.name}" not in imagenes:
            existente.unlink()
            cambios.append(True)
    return any(cambios)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv-dir", help="usa archivos <Hoja>.csv de esta carpeta en lugar de descargar el Sheet")
    ap.add_argument("--check", action="store_true", help="solo valida, no escribe nada")
    ap.add_argument("--raiz", default=str(Path(__file__).resolve().parent.parent), help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    raiz = Path(args.raiz)

    try:
        contenido, imagenes, avisos = construir(leer_hojas(args, raiz), raiz / "imagenes")
    except ErrorContenido as e:
        for err in e.errores:
            print(f"::error::{err}")
        print(f"\n{len(e.errores)} error(es): no se publica nada.", file=sys.stderr)
        return 1

    for aviso in avisos:
        print(f"::warning::{aviso}")
    cuerpo, manifest, version = serializar(contenido)
    resumen = (f"{len(contenido['asignaturas'])} asignaturas, {len(contenido['temarios'])} temarios, "
               f"{len(contenido['preguntas'])} preguntas, {len(contenido['imagenes'])} imágenes; versión {version}")
    if args.check:
        print(f"OK (sin escribir): {resumen}")
        return 0
    print(("Actualizado: " if publicar(raiz, cuerpo, manifest, imagenes) else "Sin cambios: ") + resumen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
