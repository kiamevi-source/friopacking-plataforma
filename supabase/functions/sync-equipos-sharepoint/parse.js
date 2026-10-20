// Lectura del Excel de importaciones (IMPORTACION-X1-MLUJAN-2026, hoja «NISIRA FP").
//
// Es una copia fiel del importador de Gerencia (app-live/index.legacy.html:
// _eqParseRows, _eqParseDate, _eqFmtDate, _eqValidarImport, _eqToPmoRow) para que
// la sincronización automática deje en equipos_pmo exactamente lo mismo que dejaba
// subir el archivo a mano. Si cambias una regla allá, cámbiala aquí también.
// JavaScript plano (sin tipos) para poder probarlo con node fuera de Supabase.

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function mkDate(y, mes, dia) {
  if (!(y >= 1900 && y <= 2100) || !(mes >= 0 && mes <= 11) || !(dia >= 1 && dia <= 31)) return null;
  const d = new Date(Date.UTC(y, mes, dia));
  return isNaN(d) ? null : d;
}
function year(y) {
  const n = parseInt(y, 10);
  if (n >= 100) return n;
  return n < 80 ? 2000 + n : 1900 + n;
}

// Acepta Date, serial de Excel, dd-mmm-yy (es/en), dd/mm/yyyy e ISO. Devuelve fecha UTC a medianoche.
export function parseDate(s) {
  if (s == null || s === "") return null;
  if (s instanceof Date) return isNaN(s) ? null : new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  if (typeof s === "number" || (/^\d+(\.\d+)?$/.test(String(s).trim()) && Number(s) > 32000 && Number(s) < 55000)) {
    const n = Number(s);
    if (!isFinite(n) || n <= 0) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5);
  }
  const low = String(s).trim().toLowerCase();
  if (!low) return null;
  let m = low.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return mkDate(+m[1], +m[2] - 1, +m[3]);
  const meses = { ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5, jul: 6, ago: 7, aug: 7,
    sep: 8, set: 8, oct: 9, nov: 10, dic: 11, dec: 11 };
  m = low.match(/(\d{1,2})[\-\s\/]([a-záéíóú]{3,})[\-\s\/](\d{2,4})/);
  if (m) {
    const mes = meses[m[2].slice(0, 3)];
    if (mes !== undefined) return mkDate(year(m[3]), mes, +m[1]);
  }
  m = low.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);
  if (m) return mkDate(year(m[3]), +m[2] - 1, +m[1]);
  return null;
}

// Formato canónico del módulo: 26-oct-25
export function fmtDate(d) {
  if (!d) return "—";
  return String(d.getUTCDate()).padStart(2, "0") + "-" + MESES[d.getUTCMonth()] + "-" + String(d.getUTCFullYear()).slice(2);
}

// dd/mm/yyyy (formato del Excel de importaciones desde set-2026)
export function fmtDma(d) {
  return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
}

// Filas crudas (array de arrays, como sheet_to_json header:1) → registros del importador.
export function parseRows(raw) {
  const expected = ["documento", "fecha", "proveedor", "proyecto", "tipo", "origen",
    "entrega", "status", "etd", "eta", "modalidad", "dias", "pry", "columna1"];
  let hdrIdx = -1, bestScore = 0;
  for (let i = 0; i < Math.min(raw.length, 25); i++) {
    const cells = (raw[i] || []).map((c) => (c || "").toString().trim().toLowerCase()).filter(Boolean);
    if (!cells.length) continue;
    const score = expected.filter((e) => cells.some((c) => c.startsWith(e) || c === e)).length;
    if (score > bestScore) { bestScore = score; hdrIdx = i; }
  }
  if (hdrIdx < 0 || bestScore < 2) return [];
  // Un salto de línea dentro de un encabezado («Fecha de entrega⏎Real») se lee como espacio.
  const hdr = raw[hdrIdx].map((c) => (c || "").toString().replace(/\s*\n\s*/g, " ").trim().toLowerCase());
  const matchers = {
    doc: (h) => h === "documento" || h.startsWith("documento"),
    fecha: (h) => h === "fecha" || h === "fecha doc" || h === "fecha_doc",
    proveedor: (h) => h.startsWith("proveedor"),
    proyecto: (h) => h === "proyecto" || h === "cliente" || h === "pry numero",
    tipo: (h) => h.includes("tipo producto") || h.includes("tipo_producto") || h === "tipo",
    origen: (h) => h === "origen" || h.startsWith("origen"),
    f_entrega: (h) => h.includes("fecha entrega") || h.includes("fecha_entrega"),
    f_real: (h) => h.includes("entrega real") || h.includes("fecha de entrega real"),
    status_orig: (h) => h.includes("status de la entrega") || h.includes("status_orig") || h.includes("status origen"),
    etd: (h) => h === "etd" || h.includes("fecha etd") || h.includes("fecha de etd") || h.includes("fecha_etd") || h.startsWith("etd"),
    eta: (h) => h === "eta" || h.includes("fecha eta") || h.includes("fecha de eta") || h.includes("fecha_eta") || h.startsWith("eta"),
    status_dest: (h) => h.includes("status final") || h.includes("status_final") || h.includes("status destino") || h.includes("status dest"),
    modalidad: (h) => h.includes("modalidad"),
    ref: (h) => h.startsWith("ref.orden") || h.startsWith("ref orden") || h === "ref." || h === "referencia",
  };
  const idx = {};
  for (const k of Object.keys(matchers)) idx[k] = hdr.findIndex(matchers[k]);
  const faltantes = ["doc", "proyecto", "tipo", "eta", "etd", "status_dest"].filter((k) => idx[k] < 0);
  const get = (row, k) => { const v = idx[k] < 0 ? null : row[idx[k]]; return v == null ? "" : v.toString().trim(); };
  const getD = (row, k) => {
    const v = idx[k] < 0 ? null : row[idx[k]];
    if (v == null || v === "") return "";
    // Celdas de fecha reales → dd/mm/yyyy: es como quedaron guardadas en equipos_pmo con
    // las cargas de setiembre. Con otro formato cada fecha saldría como «cambio» falso.
    if (v instanceof Date || typeof v === "number") { const d = parseDate(v); return d ? fmtDma(d) : ""; }
    return v.toString().trim();
  };
  const rows = raw.slice(hdrIdx + 1)
    .filter((row) => (row || []).some((c) => c != null && c !== "" && c.toString().trim()))
    .map((row) => ({
      doc: get(row, "doc"), fecha: getD(row, "fecha"), proveedor: get(row, "proveedor"),
      proyecto: get(row, "proyecto"), tipo: get(row, "tipo"), origen: get(row, "origen"),
      f_entrega: getD(row, "f_entrega"), f_real: getD(row, "f_real"),
      status_orig: get(row, "status_orig"), etd: getD(row, "etd"), eta: getD(row, "eta"),
      status_dest: get(row, "status_dest"), modalidad: get(row, "modalidad"), ref: get(row, "ref"),
    }))
    .filter((r) => r.doc || r.proyecto);
  rows.faltantes = faltantes;
  return rows;
}

// Mismo control que bloquea la importación manual: columnas corridas, "#####", documentos raros.
export function validar(rows) {
  const filas = (rows || []).filter((r) => r && (r.doc || "").toString().trim());
  const problemas = [];
  if (!filas.length) return { ok: false, problemas: ["El archivo no trae ningún documento."] };
  const s = (v) => (v == null ? "" : v).toString().trim();
  const esFecha = (v) => v instanceof Date || typeof v === "number" ||
    /^\d{1,2}[\/\-. ](\d{1,2}|[a-zá-ú]{3,})\.?[\/\-. ]\d{2,4}$/i.test(s(v)) || /^\d{4}-\d{2}-\d{2}/.test(s(v));
  const nombres = { fecha: "Fecha", proveedor: "Proveedor", proyecto: "Proyecto", tipo: "Tipo producto",
    origen: "Origen", f_entrega: "Fecha entrega", f_real: "Fecha de entrega real", status_orig: "Status en origen",
    etd: "Fecha ETD", eta: "Fecha de ETA", status_dest: "Status final destino", modalidad: "Modalidad" };
  const pct = (n, d) => (d ? n / d : 0);
  Object.keys(nombres).forEach((k) => {
    const n = filas.filter((r) => /^#{3,}$/.test(s(r[k]))).length;
    if (pct(n, filas.length) > 0.05) problemas.push(`«${nombres[k]}» llegó como "#####" en ${n} filas.`);
  });
  ["fecha", "f_entrega", "f_real", "etd", "eta"].forEach((k) => {
    const llenas = filas.filter((r) => s(r[k]) && !/^#{3,}$/.test(s(r[k])));
    const malas = llenas.filter((r) => !esFecha(r[k])).length;
    if (llenas.length >= 10 && pct(malas, llenas.length) > 0.15) problemas.push(`«${nombres[k]}» trae texto en vez de fechas en ${malas} de ${llenas.length} filas (columnas corridas).`);
  });
  ["status_orig", "status_dest", "proveedor", "tipo"].forEach((k) => {
    const llenas = filas.filter((r) => s(r[k]));
    const malas = llenas.filter((r) => esFecha(r[k])).length;
    if (llenas.length >= 10 && pct(malas, llenas.length) > 0.15) problemas.push(`«${nombres[k]}» trae fechas en ${malas} de ${llenas.length} filas (columnas corridas).`);
  });
  const docsMalos = filas.filter((r) => !/\d{3,}/.test(s(r.doc))).length;
  if (docsMalos > 2 && pct(docsMalos, filas.length) > 0.02) problemas.push(`${docsMalos} filas tienen un «Documento» que no es un número de orden.`);
  return { ok: !problemas.length, problemas };
}

// Registro del importador → fila de equipos_pmo
export function toPmoRow(r, ahora) {
  const t = (v) => (v || "").toString().trim() || null;
  return {
    doc: (r.doc || "").toString().trim(), fecha: t(r.fecha), proveedor: t(r.proveedor),
    proj: t(r.proyecto), proj_csv: t(r.proyecto), tipo: t(r.tipo), origen: t(r.origen),
    fe: t(r.f_entrega), fer: t(r.f_real), so: t(r.status_orig), etd: t(r.etd), eta: t(r.eta),
    mod: t(r.modalidad), ref: t(r.ref), st: t(r.status_dest), updated_at: ahora,
  };
}

// Elige la hoja como el importador: «NISIRA…», si no la que tenga «Documento» arriba, si no la primera.
export function elegirHoja(XLSX, wb) {
  let nombre = wb.SheetNames.find((n) => /nisira/i.test(n));
  if (!nombre) {
    for (const n of wb.SheetNames) {
      const sample = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false });
      const head = sample.slice(0, 10).map((r) => (r || []).join("|").toLowerCase()).join("\n");
      if (head.includes("documento")) { nombre = n; break; }
    }
  }
  return nombre || wb.SheetNames[0];
}

// Campos cuyo cambio se registra en equipos_cambios (igual que Gerencia)
export const EQ_TRACK = ["eta", "etd", "fe", "fer", "so", "st", "mod", "proj", "proveedor"];
