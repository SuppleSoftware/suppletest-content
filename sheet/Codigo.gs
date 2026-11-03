/**
 * SuppleTest · diseño del Sheet de contenido.
 *
 * Instalación: en el Sheet, Extensiones → Apps Script → pega este archivo → guarda → recarga el Sheet.
 * Aparece el menú «SuppleTest». Ejecuta «Aplicar diseño» (la primera vez pide permisos).
 *
 * No cambia ningún dato ni cabecera: el generador (scripts/build.py) lee las columnas por nombre, así que
 * las columnas «(auto)» que añade y la hoja «Panel» se ignoran al publicar.
 * Se puede volver a ejecutar cuando quieras (p. ej. tras añadir muchas filas) para extender fórmulas y formato.
 */

const COLOR = {
  cabecera: '#312e81',
  cabeceraAuto: '#64748b',
  banda: '#f5f3ff',
  auto: '#f1f5f9',
  textoAuto: '#64748b',
  ok: '#dcfce7',
  okTexto: '#166534',
  mal: '#fee2e2',
  malTexto: '#991b1b',
  aviso: '#fef3c7',
  panelFondo: '#f8fafc',
};
const FILAS_EXTRA = 150; // fórmulas de las columnas (auto) por encima de la última fila con datos
const MONO = 'Roboto Mono';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SuppleTest')
    .addItem('Aplicar diseño', 'aplicarDiseno')
    .addItem('Actualizar fórmulas (tras añadir filas)', 'aplicarDiseno')
    .addToUi();
}

function aplicarDiseno() {
  const ss = SpreadsheetApp.getActive();
  const hojas = {};
  ['Asignaturas', 'Temarios', 'Preguntas', 'Respuestas'].forEach(function (n) {
    hojas[n] = ss.getSheetByName(n);
    if (!hojas[n]) throw new Error('Falta la hoja «' + n + '»');
  });
  detectarSeparador(ss);

  const pasos = [
    ['Asignaturas', function () { disenoAsignaturas(hojas.Asignaturas); }],
    ['Temarios', function () { disenoTemarios(hojas.Temarios); }],
    ['Preguntas', function () { disenoPreguntas(hojas.Preguntas); }],
    ['Respuestas', function () { disenoRespuestas(hojas.Respuestas); }],
    ['Panel', function () { crearPanel(ss); }],
  ];
  const fallos = [];
  pasos.forEach(function (p) {
    ss.toast('Aplicando: ' + p[0], 'SuppleTest', 30);
    try {
      p[1]();
    } catch (e) {
      fallos.push(p[0] + ': ' + e.message + (e.stack ? ' [' + String(e.stack).split('\n')[0] + ']' : ''));
    }
    SpreadsheetApp.flush();
  });

  const panel = ss.getSheetByName('Panel');
  if (panel) { ss.setActiveSheet(panel); ss.moveActiveSheet(1); }
  if (fallos.length) {
    SpreadsheetApp.getUi().alert('Terminó con errores (cópialos y pásalos):\n\n' + fallos.join('\n'));
  } else {
    ss.toast('Diseño aplicado', 'SuppleTest', 5);
  }
}

// ---- Separador de argumentos según la configuración regional del Sheet (',' en en-US, ';' en es-ES...) ----
let SEP = null;

function detectarSeparador(ss) {
  const tmp = ss.insertSheet('tmp_sep');
  try {
    const r = tmp.getRange('A1');
    r.setFormula('=IF(TRUE,1,2)');
    SpreadsheetApp.flush();
    SEP = String(r.getDisplayValue()) === '1' ? ',' : ';';
  } finally {
    ss.deleteSheet(tmp);
  }
}

/** Convierte una fórmula escrita con comas al separador de la configuración regional. */
function conv(f) {
  if (SEP === null || SEP === ',') return f;
  let out = '', enTexto = false, llaves = 0;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '"') enTexto = !enTexto;
    if (!enTexto) {
      if (ch === '{') llaves++;
      else if (ch === '}') llaves--;
      else if (ch === ',') { out += llaves > 0 ? '\\' : ';'; continue; }
    }
    out += ch;
  }
  return out;
}

function convTodas(filas) {
  return filas.map(function (fila) { return fila.map(conv); });
}

// ---------------------------------------------------------------- utilidades

const CACHE_CAB = {};

function cabeceras(sh) {
  const k = sh.getName();
  if (!CACHE_CAB[k]) {
    const n = sh.getLastColumn();
    CACHE_CAB[k] = sh.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  }
  return CACHE_CAB[k];
}

/** Nº de columna (1-based) de la cabecera `nombre`; lanza error si no existe. */
function col(sh, nombre) {
  const i = cabeceras(sh).indexOf(nombre.toLowerCase());
  if (i < 0) throw new Error('«' + sh.getName() + '» no tiene la columna «' + nombre + '»');
  return i + 1;
}

function letra(sh, nombre) {
  return sh.getRange(1, col(sh, nombre)).getA1Notation().replace(/\d+/, '');
}

/** Devuelve el nº de columna de `nombre`, creándola al final si no existe. */
function asegurarColumna(sh, nombre) {
  const i = cabeceras(sh).indexOf(nombre.toLowerCase());
  if (i >= 0) return i + 1;
  const c = sh.getLastColumn() + 1;
  if (sh.getMaxColumns() < c) sh.insertColumnsAfter(sh.getMaxColumns(), c - sh.getMaxColumns());
  sh.getRange(1, c).setValue(nombre);
  delete CACHE_CAB[sh.getName()];
  return c;
}

function letraCol(sh, c) {
  return sh.getRange(1, c).getA1Notation().replace(/\d+/, '');
}

function filasTotales(sh) {
  const n = Math.max(sh.getLastRow() + FILAS_EXTRA, 100);
  if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows());
  return n;
}

/** Pone una fórmula en la fila 2 de la columna y la copia hacia abajo (referencias relativas). */
function formulaColumna(sh, c, formula, n) {
  const r2 = sh.getRange(2, c);
  r2.setFormula(conv(formula));
  if (n > 2) r2.copyTo(sh.getRange(3, c, n - 2, 1));
}

/**
 * Formato común: cabecera, fila congelada, bandas, filtro, anchos y alineación.
 * anchos: {cabecera: px}. auto: nombres de columnas calculadas. recortar: columnas con texto largo sin ajuste.
 */
function estiloBase(sh, anchos, auto, recortar, n) {
  const ultima = sh.getLastColumn();
  const cab = cabeceras(sh);

  sh.setFrozenRows(1);
  sh.setTabColor(COLOR.cabecera);

  // Tablas anteriores: limpiar bandas, filtro y avisos de protección propios.
  sh.getBandings().forEach(function (b) { b.remove(); });
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === 'SuppleTest auto') p.remove();
  });

  const todo = sh.getRange(1, 1, n, ultima);
  todo.setFontFamily('Inter').setFontSize(10).setVerticalAlignment('top');
  const cuerpo = sh.getRange(2, 1, n - 1, ultima);
  cuerpo.setBackground(null).setFontColor('#111827').setFontStyle('normal');
  cuerpo.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

  const banda = todo.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  banda.setHeaderRowColor(COLOR.cabecera).setFirstRowColor('#ffffff').setSecondRowColor(COLOR.banda);

  const h = sh.getRange(1, 1, 1, ultima);
  h.setBackground(COLOR.cabecera).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sh.setRowHeight(1, 34);
  sh.setRowHeights(2, n - 1, 30);

  cab.forEach(function (nombre, i) {
    const c = i + 1;
    if (anchos[nombre]) sh.setColumnWidth(c, anchos[nombre]);
    if (recortar.indexOf(nombre) >= 0) {
      sh.getRange(2, c, n - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  });

  auto.forEach(function (nombre) {
    const c = col(sh, nombre);
    sh.getRange(1, c).setBackground(COLOR.cabeceraAuto);
    const r = sh.getRange(2, c, n - 1, 1);
    r.setBackground(COLOR.auto).setFontColor(COLOR.textoAuto).setFontStyle('italic')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    const p = r.protect().setDescription('SuppleTest auto');
    p.setWarningOnly(true);
  });

  sh.getRange(1, 1, n, ultima).createFilter();
}

function centrar(sh, nombres, n) {
  nombres.forEach(function (nombre) {
    sh.getRange(2, col(sh, nombre), n - 1, 1).setHorizontalAlignment('center');
  });
}

function textoPlano(sh, nombres, n) {
  nombres.forEach(function (nombre) {
    sh.getRange(2, col(sh, nombre), n - 1, 1).setNumberFormat('@');
  });
}

function desplegable(sh, nombre, valores, n) {
  const regla = SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false)
    .setHelpText('Elige: ' + valores.join(', ')).build();
  sh.getRange(2, col(sh, nombre), n - 1, 1).setDataValidation(regla);
}

function referencia(sh, nombre, hojaDestino, colDestino, n) {
  const rango = hojaDestino.getRange(2, col(hojaDestino, colDestino), hojaDestino.getMaxRows() - 1, 1);
  const regla = SpreadsheetApp.newDataValidation().requireValueInRange(rango, false).setAllowInvalid(false)
    .setHelpText('Debe ser un id que exista en «' + hojaDestino.getName() + '»').build();
  sh.getRange(2, col(sh, nombre), n - 1, 1).setDataValidation(regla);
}

function reglas(sh, lista) {
  sh.setConditionalFormatRules(lista);
}

function reglaFormula(sh, rango, formula, fondo, texto) {
  const b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([rango]);
  if (fondo) b.setBackground(fondo);
  if (texto) b.setFontColor(texto);
  return b.build();
}

/** Resalta ids duplicados en la columna `nombre`. */
function reglaDuplicados(sh, nombre, n) {
  const L = letra(sh, nombre);
  return reglaFormula(sh, sh.getRange(2, col(sh, nombre), n - 1, 1),
    '=AND($' + L + '2<>"",COUNTIF($' + L + ':$' + L + ',$' + L + '2)>1)', COLOR.mal, COLOR.malTexto);
}

// ------------------------------------------------------------------- hojas

function disenoAsignaturas(sh) {
  const n = filasTotales(sh);
  const auto = ['temarios (auto)', 'preguntas (auto)'];
  const cTem = asegurarColumna(sh, auto[0]);
  const cPre = asegurarColumna(sh, auto[1]);
  const ss = sh.getParent();
  const T = ss.getSheetByName('Temarios');
  const P = ss.getSheetByName('Preguntas');
  const idL = letra(sh, 'id');

  formulaColumna(sh, cTem, '=IF($' + idL + '2="","",COUNTIF(Temarios!$' + letra(T, 'asignatura_id') + ':$' +
    letra(T, 'asignatura_id') + ',$' + idL + '2))', n);
  const pt = 'Preguntas!$' + letra(P, 'temario_id') + '$2:$' + letra(P, 'temario_id') + '$' + P.getMaxRows();
  const tId = 'Temarios!$' + letra(T, 'id') + '$2:$' + letra(T, 'id') + '$' + T.getMaxRows();
  const tAs = 'Temarios!$' + letra(T, 'asignatura_id') + '$2:$' + letra(T, 'asignatura_id') + '$' + T.getMaxRows();
  // Preguntas por asignatura: suma sobre sus temarios (sin temarios, FILTER falla: 0).
  sh.getRange(2, cPre).setFormula(conv('=IF($' + idL + '2="","",IFERROR(SUMPRODUCT(COUNTIF(' + pt + ',FILTER(' + tId + ',' +
    tAs + '=$' + idL + '2))),0))'));
  sh.getRange(2, cPre).copyTo(sh.getRange(3, cPre, n - 2, 1));

  estiloBase(sh, { id: 60, nombre: 340, curso: 110, cuatrimestre: 120, 'temarios (auto)': 120, 'preguntas (auto)': 130 },
    auto, [], n);
  centrar(sh, ['id', 'curso', 'cuatrimestre'].concat(auto), n);
  textoPlano(sh, ['nombre'], n);
  desplegable(sh, 'curso', ['Primero', 'Segundo', 'Tercero', 'Cuarto'], n);
  desplegable(sh, 'cuatrimestre', ['Primero', 'Segundo'], n);
  reglas(sh, [reglaDuplicados(sh, 'id', n)]);
}

function disenoTemarios(sh) {
  const n = filasTotales(sh);
  const ss = sh.getParent();
  const A = ss.getSheetByName('Asignaturas');
  const P = ss.getSheetByName('Preguntas');
  const auto = ['asignatura (auto)', 'tipo (auto)', 'preguntas (auto)'];
  const cAs = asegurarColumna(sh, auto[0]);
  const cTi = asegurarColumna(sh, auto[1]);
  const cPr = asegurarColumna(sh, auto[2]);
  const idL = letra(sh, 'id');
  const asL = letra(sh, 'asignatura_id');
  const noL = letra(sh, 'nombre');

  formulaColumna(sh, cAs, '=IF($' + asL + '2="","",IFERROR(INDEX(Asignaturas!$' + letra(A, 'nombre') + ':$' +
    letra(A, 'nombre') + ',MATCH($' + asL + '2,Asignaturas!$' + letra(A, 'id') + ':$' + letra(A, 'id') +
    ',0)),"⚠ no existe"))', n);
  formulaColumna(sh, cTi, '=IF($' + noL + '2="","",IF(ISNUMBER(SEARCH("Teorí",$' + noL + '2)),"Teoría","Práctico"))', n);
  formulaColumna(sh, cPr, '=IF($' + idL + '2="","",COUNTIF(Preguntas!$' + letra(P, 'temario_id') + ':$' +
    letra(P, 'temario_id') + ',$' + idL + '2))', n);

  estiloBase(sh, { id: 60, nombre: 300, asignatura_id: 110, 'asignatura (auto)': 280, 'tipo (auto)': 100, 'preguntas (auto)': 130 },
    auto, [], n);
  centrar(sh, ['id', 'asignatura_id', 'tipo (auto)', 'preguntas (auto)'], n);
  textoPlano(sh, ['nombre'], n);
  referencia(sh, 'asignatura_id', A, 'id', n);
  reglas(sh, [
    reglaDuplicados(sh, 'id', n),
    reglaFormula(sh, sh.getRange(2, cAs, n - 1, 1), '=LEFT($' + letraCol(sh, cAs) + '2,1)="⚠"',
      COLOR.mal, COLOR.malTexto),
  ]);
}

function disenoPreguntas(sh) {
  const n = filasTotales(sh);
  const ss = sh.getParent();
  const T = ss.getSheetByName('Temarios');
  const R = ss.getSheetByName('Respuestas');
  const auto = ['asignatura (auto)', 'temario (auto)', 'resp. (auto)', 'correctas (auto)', 'estado (auto)'];
  const c = auto.map(function (a) { return asegurarColumna(sh, a); });
  const idL = letra(sh, 'id');
  const teL = letra(sh, 'temario_id');
  const tiL = letra(sh, 'tipo');
  const cL = function (i) { return letraCol(sh, c[i]); };
  const tr = function (nombre) { return 'Temarios!$' + letra(T, nombre) + ':$' + letra(T, nombre); };
  const rp = 'Respuestas!$' + letra(R, 'pregunta_id') + ':$' + letra(R, 'pregunta_id');
  const rc = 'Respuestas!$' + letra(R, 'correcta') + ':$' + letra(R, 'correcta');

  const A = ss.getSheetByName('Asignaturas');
  sh.getRange(2, c[0]).setFormula(conv('=IF($' + teL + '2="","",IFERROR(INDEX(Asignaturas!$' + letra(A, 'nombre') + ':$' +
    letra(A, 'nombre') + ',MATCH(INDEX(' + tr('asignatura_id') + ',MATCH($' + teL + '2,' + tr('id') + ',0)),Asignaturas!$' +
    letra(A, 'id') + ':$' + letra(A, 'id') + ',0)),"⚠ no existe"))'));
  sh.getRange(2, c[0]).copyTo(sh.getRange(3, c[0], n - 2, 1));

  formulaColumna(sh, c[1], '=IF($' + teL + '2="","",IFERROR(INDEX(' + tr('nombre') + ',MATCH($' + teL + '2,' + tr('id') +
    ',0)),"⚠ no existe"))', n);
  formulaColumna(sh, c[2], '=IF($' + idL + '2="","",COUNTIF(' + rp + ',$' + idL + '2))', n);
  formulaColumna(sh, c[3], '=IF($' + idL + '2="","",COUNTIFS(' + rp + ',$' + idL + '2,' + rc + ',TRUE))', n);
  const nn = '$' + cL(2) + '2';
  const cc = '$' + cL(3) + '2';
  formulaColumna(sh, c[4], '=IF($' + idL + '2="","",IF(LEFT($' + cL(1) + '2,1)="⚠","⚠ temario no existe",' +
    'IF($' + tiL + '2="VerdaderoFalso",IF(AND(' + nn + '=2,' + cc + '=1),"✔","⚠ V/F: 2 resp. y 1 correcta"),' +
    'IF($' + tiL + '2="OpcionUnica",IF(AND(' + nn + '>=2,' + cc + '=1),"✔","⚠ debe tener 1 correcta"),' +
    'IF($' + tiL + '2="MultiRespuesta",IF(AND(' + nn + '>=2,' + cc + '>=1),"✔","⚠ revisar respuestas"),' +
    '"⚠ tipo no válido")))))', n);

  estiloBase(sh, {
    id: 60, temario_id: 90, numero: 80, tipo: 130, enunciado: 520, comentario: 260, imagen: 160,
    'asignatura (auto)': 220, 'temario (auto)': 200, 'resp. (auto)': 90, 'correctas (auto)': 110, 'estado (auto)': 210,
  }, auto, ['enunciado', 'comentario'], n);
  centrar(sh, ['id', 'temario_id', 'numero', 'tipo', 'resp. (auto)', 'correctas (auto)'], n);
  textoPlano(sh, ['enunciado', 'comentario'], n);
  sh.getRange(2, col(sh, 'enunciado'), n - 1, 1).setFontFamily(MONO).setFontSize(9);
  desplegable(sh, 'tipo', ['VerdaderoFalso', 'OpcionUnica', 'MultiRespuesta'], n);
  referencia(sh, 'temario_id', T, 'id', n);

  const est = sh.getRange(2, c[4], n - 1, 1);
  reglas(sh, [
    reglaDuplicados(sh, 'id', n),
    reglaFormula(sh, est, '=LEFT($' + cL(4) + '2,1)="⚠"', COLOR.aviso, COLOR.malTexto),
    reglaFormula(sh, est, '=$' + cL(4) + '2="✔"', COLOR.ok, COLOR.okTexto),
    reglaFormula(sh, sh.getRange(2, c[0], n - 1, 2), '=LEFT($' + cL(0) + '2,1)="⚠"', COLOR.mal, COLOR.malTexto),
  ]);
}

function disenoRespuestas(sh) {
  const n = filasTotales(sh);
  const ss = sh.getParent();
  const P = ss.getSheetByName('Preguntas');
  const auto = ['pregunta (auto)', 'tipo (auto)'];
  const cPr = asegurarColumna(sh, auto[0]);
  const cTi = asegurarColumna(sh, auto[1]);
  const pidL = letra(sh, 'pregunta_id');
  const pr = function (nombre) { return 'Preguntas!$' + letra(P, nombre) + ':$' + letra(P, nombre); };
  const pos = 'MATCH($' + pidL + '2,' + pr('id') + ',0)';

  formulaColumna(sh, cPr, '=IF($' + pidL + '2="","",IFERROR(LEFT(SUBSTITUTE(INDEX(' + pr('enunciado') + ',' + pos +
    '),CHAR(10)," "),80),"⚠ pregunta no existe"))', n);
  formulaColumna(sh, cTi, '=IF($' + pidL + '2="","",IFERROR(INDEX(' + pr('tipo') + ',' + pos + '),""))', n);

  estiloBase(sh, { pregunta_id: 100, texto: 480, correcta: 90, 'pregunta (auto)': 420, 'tipo (auto)': 130 },
    auto, ['texto'], n);
  centrar(sh, ['pregunta_id', 'correcta', 'tipo (auto)'], n);
  textoPlano(sh, ['texto'], n);
  const cc = sh.getRange(2, col(sh, 'correcta'), n - 1, 1);
  cc.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  referencia(sh, 'pregunta_id', P, 'id', n);

  const L = letra(sh, 'correcta');
  reglas(sh, [
    reglaFormula(sh, sh.getRange(2, 1, n - 1, sh.getLastColumn()), '=$' + L + '2=TRUE', COLOR.ok, COLOR.okTexto),
    reglaFormula(sh, sh.getRange(2, cPr, n - 1, 1), '=LEFT($' + letraCol(sh, cPr) + '2,1)="⚠"', COLOR.mal, COLOR.malTexto),
  ]);
}

// ------------------------------------------------------------------- panel

function crearPanel(ss) {
  let sh = ss.getSheetByName('Panel');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('Panel');
  sh.setTabColor('#f59e0b');
  sh.setHiddenGridlines(true);

  const A = ss.getSheetByName('Asignaturas');
  const T = ss.getSheetByName('Temarios');
  const P = ss.getSheetByName('Preguntas');
  const R = ss.getSheetByName('Respuestas');
  const rng = function (hoja, nombre) {
    const L = letra(hoja, nombre);
    return hoja.getName() + '!$' + L + '$2:$' + L + '$' + hoja.getMaxRows();
  };

  sh.getRange('A1:Q60').setBackground(COLOR.panelFondo).setFontFamily('Inter').setFontSize(10)
    .setVerticalAlignment('middle');
  sh.setColumnWidths(1, 17, 110);
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(7, 28);
  sh.setColumnWidth(8, 220);
  sh.setColumnWidth(9, 260);
  sh.setColumnWidth(12, 28);

  // Título
  sh.getRange('A1').setValue('SuppleTest · Panel de contenido')
    .setFontSize(20).setFontWeight('bold').setFontColor(COLOR.cabecera);
  sh.getRange('A2').setValue('Resumen automático del Sheet. Para publicar: GitHub → Actions → Publicar contenido → Run workflow.')
    .setFontColor('#64748b');
  sh.setRowHeight(1, 44);

  // Tarjetas (fila 4 etiqueta, fila 5 valor)
  const estadoL = letra(P, 'estado (auto)');
  const rEstado = 'Preguntas!$' + estadoL + '$2:$' + estadoL + '$' + P.getMaxRows();
  const tarjetas = [
    ['Asignaturas', '=COUNTA(' + rng(A, 'id') + ')', '#312e81'],
    ['Temarios', '=COUNTA(' + rng(T, 'id') + ')', '#0e7490'],
    ['Preguntas', '=COUNTA(' + rng(P, 'id') + ')', '#15803d'],
    ['Respuestas', '=COUNTA(' + rng(R, 'pregunta_id') + ')', '#a16207'],
    ['Con imagen', '=COUNTIF(' + rng(P, 'imagen') + ',"?*")', '#7e22ce'],
    ['⚠ Avisos', '=COUNTIF(' + rEstado + ',"⚠*")', '#b91c1c'],
  ];
  const colsTarjeta = [1, 2, 3, 4, 5, 6]; // A..F
  tarjetas.forEach(function (t, i) {
    const c = colsTarjeta[i];
    sh.getRange(4, c).setValue(t[0]).setFontSize(9).setFontWeight('bold').setFontColor('#ffffff')
      .setBackground(t[2]).setHorizontalAlignment('center');
    sh.getRange(5, c).setFormula(conv(t[1])).setFontSize(26).setFontWeight('bold').setFontColor(t[2])
      .setBackground('#ffffff').setHorizontalAlignment('center');
  });
  sh.setRowHeight(4, 24);
  sh.setRowHeight(5, 56);
  sh.getRange('A4:F5').setBorder(true, true, true, true, true, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  // Tabla por asignatura (A8:F..): 25 filas
  const inicioA = 8;
  sh.getRange(inicioA - 1, 1).setValue('Por asignatura').setFontSize(13).setFontWeight('bold').setFontColor(COLOR.cabecera);
  const cabA = ['Asignatura', 'Curso', 'Cuatrim.', 'Temarios', 'Preguntas', 'Avisos'];
  sh.getRange(inicioA, 1, 1, cabA.length).setValues([cabA]).setBackground(COLOR.cabecera).setFontColor('#ffffff')
    .setFontWeight('bold');
  const nA = 25;
  const fA = [];
  for (let k = 0; k < nA; k++) {
    const r = inicioA + 1 + k;
    const idx = 'INDEX(Asignaturas!$' + letra(A, 'id') + ':$' + letra(A, 'id') + ',' + (k + 2) + ')';
    const g = function (nombre) { return 'INDEX(Asignaturas!$' + letra(A, nombre) + ':$' + letra(A, nombre) + ',' + (k + 2) + ')'; };
    const aL = 'Preguntas!$' + letra(P, 'asignatura (auto)') + '$2:$' + letra(P, 'asignatura (auto)') + '$' + P.getMaxRows();
    fA.push([
      '=IF(' + idx + '="","",' + g('nombre') + ')',
      '=IF($A' + r + '="","",' + g('curso') + ')',
      '=IF($A' + r + '="","",' + g('cuatrimestre') + ')',
      '=IF($A' + r + '="","",' + g('temarios (auto)') + ')',
      '=IF($A' + r + '="","",' + g('preguntas (auto)') + ')',
      '=IF($A' + r + '="","",COUNTIFS(' + aL + ',$A' + r + ',' + rEstado + ',"⚠*"))',
    ]);
  }
  sh.getRange(inicioA + 1, 1, nA, 6).setFormulas(convTodas(fA)).setBackground('#ffffff');
  sh.getRange(inicioA + 1, 2, nA, 5).setHorizontalAlignment('center');
  sh.getRange(inicioA, 2, 1, 5).setHorizontalAlignment('center');
  sh.getRange(inicioA, 1, nA + 1, 6).setBorder(null, null, true, null, null, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  // Tabla por temario (H8:K..): 60 filas
  sh.getRange(inicioA - 1, 8).setValue('Por temario').setFontSize(13).setFontWeight('bold').setFontColor(COLOR.cabecera);
  const cabT = ['Asignatura', 'Temario', 'Preguntas', 'Avisos'];
  sh.getRange(inicioA, 8, 1, cabT.length).setValues([cabT]).setBackground(COLOR.cabecera).setFontColor('#ffffff')
    .setFontWeight('bold');
  const nT = 60;
  const fT = [];
  for (let k = 0; k < nT; k++) {
    const r = inicioA + 1 + k;
    const g = function (nombre) { return 'INDEX(Temarios!$' + letra(T, nombre) + ':$' + letra(T, nombre) + ',' + (k + 2) + ')'; };
    const tL = 'Preguntas!$' + letra(P, 'temario_id') + '$2:$' + letra(P, 'temario_id') + '$' + P.getMaxRows();
    fT.push([
      '=IF(' + g('id') + '="","",' + g('asignatura (auto)') + ')',
      '=IF($H' + r + '="","",' + g('nombre') + ')',
      '=IF($H' + r + '="","",COUNTIF(' + tL + ',' + g('id') + '))',
      '=IF($H' + r + '="","",COUNTIFS(' + tL + ',' + g('id') + ',' + rEstado + ',"⚠*"))',
    ]);
  }
  sh.getRange(inicioA + 1, 8, nT, 4).setFormulas(convTodas(fT)).setBackground('#ffffff');
  sh.getRange(inicioA, 10, nT + 1, 2).setHorizontalAlignment('center');
  sh.getRange(inicioA, 8, nT + 1, 4).setBorder(null, null, true, null, null, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  // Lista de avisos (A36...)
  const inicioAv = inicioA + nA + 3;
  sh.getRange(inicioAv - 1, 1).setValue('Preguntas con avisos').setFontSize(13).setFontWeight('bold')
    .setFontColor(COLOR.cabecera);
  sh.getRange(inicioAv, 1, 1, 5).setValues([['Aviso', 'id', 'Tipo', 'Asignatura', 'Temario']])
    .setBackground(COLOR.cabecera).setFontColor('#ffffff').setFontWeight('bold');
  const pc = function (nombre) { return 'Preguntas!$' + letra(P, nombre) + '$2:$' + letra(P, nombre) + '$' + P.getMaxRows(); };
  sh.getRange(inicioAv + 1, 1).setFormula(conv('=IFERROR(FILTER({' + pc('estado (auto)') + ',' + pc('id') + ',' + pc('tipo') + ',' +
    pc('asignatura (auto)') + ',' + pc('temario (auto)') + '},LEFT(' + pc('estado (auto)') + ',1)="⚠"),"✔ Sin avisos")'));
  sh.getRange(inicioAv + 1, 1, 200, 5).setBackground('#ffffff').setFontColor('#991b1b');

  // Gráfico: preguntas por asignatura
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  const grafico = sh.newChart().setChartType(Charts.ChartType.BAR)
    .addRange(sh.getRange(inicioA, 1, nA + 1, 1)).addRange(sh.getRange(inicioA, 5, nA + 1, 1))
    .setOption('title', 'Preguntas por asignatura').setOption('legend', { position: 'none' })
    .setOption('colors', [COLOR.cabecera]).setOption('backgroundColor', '#ffffff')
    .setNumHeaders(1).setPosition(2, 13, 0, 0).setOption('width', 520).setOption('height', 340).build();
  sh.insertChart(grafico);

  sh.setFrozenRows(2);
  sh.getRange('A1').activate();
}
