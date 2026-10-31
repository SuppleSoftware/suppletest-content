# suppletest-content

Contenido (asignaturas, temarios, preguntas e imágenes) de la app **SuppleTest**. La app lo descarga
de `https://supplesoftware.github.io/suppletest-content/`, así que añadir o corregir preguntas no
requiere publicar una versión nueva.

```
Google Sheet ──(cada 30 min / a mano)──▶ GitHub Action ──▶ content.json + manifest.json + images/ ──▶ GitHub Pages ──▶ app
```

- **No edites** `content.json`, `manifest.json` ni `images/`: los genera el Action y se sobrescriben.
- Las imágenes originales van en `imagenes/` y el Sheet las referencia por nombre de archivo.
- Si el Sheet tiene errores, el Action **falla y no publica nada**: la app sigue con el contenido anterior.
  GitHub avisa por correo del fallo y el log indica la hoja y la fila de cada error.

## Estructura del Sheet

Cuatro hojas con **estos nombres y cabeceras exactos** (el orden de columnas da igual).

| Hoja | Columnas | Notas |
|---|---|---|
| `Asignaturas` | `id`, `nombre`, `curso`, `cuatrimestre` | `curso`: Primero…Cuarto. `cuatrimestre`: Primero/Segundo. Los filtros de la app usan estos textos. |
| `Temarios` | `id`, `nombre`, `asignatura_id` | Si el nombre contiene «Teorí», la app lo muestra como test de teoría; si no, como práctico. |
| `Preguntas` | `id`, `temario_id`, `tipo`, `enunciado`, `comentario`, `imagen`, `numero` | `comentario`, `imagen` y `numero` son opcionales. |
| `Respuestas` | `pregunta_id`, `texto`, `correcta` | Una fila por respuesta. `correcta`: VERDADERO/FALSO (o TRUE/FALSE). |

- `id` es un número único por hoja (`Asignaturas`, `Temarios`, `Preguntas`). Para una pregunta nueva usa el
  máximo + 1. `Respuestas` no necesita id: se enlaza con `pregunta_id`.
- `tipo`: `VerdaderoFalso`, `OpcionUnica` (se elige una) o `MultiRespuesta` (se eligen varias).
  Crea una validación de datos en la columna para que sea un desplegable.
- `imagen`: nombre de un archivo de `imagenes/` (`.jpg`, `.png` o `.webp`, máx. 2 MB), p. ej. `pregunta-12.png`.
- `numero`: si se deja vacío se numera sola por el orden de las filas dentro del temario.
- El orden de las respuestas en el Sheet da igual: la app las baraja.
- Los saltos de línea dentro de una celda (Alt+Intro) y el código se conservan.

> **Cuidado con el formato.** Marca las columnas de texto (`enunciado`, `comentario`, `texto`) como
> *Texto sin formato* (Formato → Número). Si no, Sheets puede convertir `=x`, `-1` o `01` en fórmulas o números.

### Avisos (no bloquean la publicación)

El Action muestra un aviso cuando una pregunta parece mal tipada: una `OpcionUnica` con varias respuestas
correctas **no se puede acertar** en la app (solo deja marcar una), y una `VerdaderoFalso` debería tener
exactamente 2 respuestas.

## Puesta en marcha (una sola vez)

1. En Google Sheets: **Archivo → Importar → Subir** el `.xlsx` con el contenido inicial → *Crear hoja de
   cálculo*. Se crean las 4 hojas.
2. **Compartir → Acceso general → Cualquier persona con el enlace → Lector.** (El contenido de las preguntas es
   público de todos modos; el Action lo descarga sin credenciales.)
3. Rellena `sheet.json`:
   - `id`: el tramo de la URL entre `/d/` y `/edit`.
   - `hojas`: el número `gid=` que aparece en la URL al abrir cada pestaña.
4. Haz commit y push. En **Actions → Publicar contenido → Run workflow** se lanza a mano; después se ejecuta solo
   cada 30 minutos y cuando cambia `imagenes/` o `scripts/`.

Hasta que `sheet.json` tenga el `id`, el workflow no hace nada.

## Subir una imagen

1. Copia el archivo a `imagenes/` (commit y push, o desde la web de GitHub con *Add file → Upload files*).
2. Escribe su nombre en la columna `imagen` de la pregunta.

El archivo publicado lleva un hash en el nombre (`images/pregunta-12-1a2b3c4d.png`): si sustituyes la imagen por
otra con el mismo nombre, la app la vuelve a descargar.

## Probar en local

```bash
python3 -m unittest discover -s scripts              # tests del generador
python3 scripts/build.py --check                     # valida el Sheet sin escribir nada
python3 scripts/build.py                             # genera content.json, manifest.json e images/
python3 scripts/build.py --csv-dir ./csv --check     # valida CSV exportados a mano (Asignaturas.csv, ...)
```

Para probar la app con otro origen (escritorio): `SUPPLETEST_CONTENT_URL=http://localhost:8000/ ./gradlew :app:desktop:run`.

## Deshacer un cambio

El historial de git guarda cada versión publicada. Pero ojo: el Action regenera todo desde el Sheet, así que
**revertir un commit no basta**: corrige el Sheet (Archivo → Historial de versiones permite restaurarlo) o
desactiva el workflow mientras tanto.

## Mantenimiento

GitHub desactiva los workflows programados tras 60 días sin actividad en el repo. Si el contenido deja de
actualizarse, entra en **Actions** y reactívalo.

## Formato publicado (contrato con la app)

`manifest.json`: `{ "schema": 1, "version": "<hash>", "content": "content.json" }`. La app solo descarga el
contenido si `version` cambia, y ignora el manifest si `schema` es mayor del que entiende. Cambiar `schema`
implica romper la compatibilidad con apps ya instaladas: hay que evitarlo.
