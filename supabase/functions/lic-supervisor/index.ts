// lic-supervisor · el supervisor arma licitaciones desde app-sup (instancia PMO).
//
// El supervisor inicia sesión en la instancia Supervisor; su token no sirve en PMO.
// Esta función lo valida contra Supervisor (/auth/v1/user), toma su correo y verifica
// en PMO.proyecto_accesos que tenga la obra. Solo deja crear y editar borradores propios
// (Borrador / Observada, origen supervisor) y enviarlos a Gerencia («Por aprobar»).
// Nunca ve ofertas ni montos de contratistas. El precio base lo calcula el servidor
// desde el presupuesto (mano de obra) y el código LIC-AAAA-NNNN también.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUP_URL = "https://iiceeajjmugtuzcfqggs.supabase.co";
// llave pública (anon) de Supervisor: solo para validar el token y leer la vista con ese token
const SUP_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpY2VlYWpqbXVndHV6Y2ZxZ2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODg5OTUsImV4cCI6MjA5NDc2NDk5NX0.xeOFlxEGoPsqO5mBLz2_o6UqMCiUw5t8Aghg0ieRqs4";
// Los mismos administradores que reconoce tiene_acceso() en Supervisor
const ADMINS = ["kmedina@friopacking.pe", "dfuentes@friopacking.pe", "gparedes@friopacking.pe", "ccalderon@friopacking.pe"];

const BUCKET = "lic-expediente";
const EDITABLES = ["Borrador", "Observada"];
const TIPOS = ["Plano", "Especificación técnica", "Metrado", "Bases", "Cronograma referencial", "Foto", "Otro"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class Falla extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sinError = <T>(r: { data: T; error: any }) => {
  if (r.error) throw new Falla(500, r.error.message);
  return r.data;
};
const seguro = (n: string) =>
  String(n || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

type Quien = { email: string; token: string };

async function quien(req: Request): Promise<Quien> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Falla(401, "Sin sesión");
  const r = await fetch(SUP_URL + "/auth/v1/user", { headers: { apikey: SUP_ANON, Authorization: "Bearer " + token } });
  if (!r.ok) throw new Falla(401, "Sesión vencida: vuelve a ingresar");
  const u = await r.json();
  if (!u?.email) throw new Falla(401, "Sesión sin correo");
  return { email: String(u.email).toLowerCase(), token };
}

async function tieneAcceso(email: string, cod: string) {
  if (ADMINS.includes(email)) return true;
  const r = sinError(await db.from("proyecto_accesos").select("id").eq("cod_proyecto", cod).eq("activo", true)
    .ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c)).limit(1)) as any[];
  return r.length > 0;
}
async function obra(cod: string) {
  const p = (sinError(await db.from("proyectos").select("id,cod_proyecto,nombre,direccion,distrito,provincia,departamento,zona")
    .eq("cod_proyecto", cod).limit(1)) as any[])[0];
  if (!p) throw new Falla(404, "La obra no existe en Gerencia");
  return p;
}
async function obraConAcceso(q: Quien, cod: string) {
  if (!cod) throw new Falla(400, "Falta la obra");
  if (!(await tieneAcceso(q.email, cod))) throw new Falla(403, "No tienes acceso a esta obra");
  return obra(cod);
}
// Licitación de una obra a la que el supervisor tiene acceso
async function licDeObra(q: Quien, id: string) {
  const L = sinError(await db.from("lic_licitaciones").select("*").eq("id", id).maybeSingle()) as any;
  if (!L) throw new Falla(404, "No existe la licitación");
  const p = L.proyecto_id ? (sinError(await db.from("proyectos").select("cod_proyecto").eq("id", L.proyecto_id).maybeSingle()) as any) : null;
  if (!p?.cod_proyecto || !(await tieneAcceso(q.email, p.cod_proyecto))) throw new Falla(403, "No tienes acceso a esta licitación");
  return L;
}
const editable = (L: any) => (L.origen || "gerencia") === "supervisor" && EDITABLES.includes(L.estado);

// Partidas licitables del presupuesto de la obra (vista de Supervisor, leída con el token del supervisor)
async function licitables(q: Quien, nombreObra: string) {
  const u = SUP_URL + "/rest/v1/v_partidas_licitables?select=*&nombre_proyecto=eq." + encodeURIComponent(nombreObra) + "&order=item";
  const r = await fetch(u, { headers: { apikey: SUP_ANON, Authorization: "Bearer " + q.token } });
  if (!r.ok) throw new Falla(502, "No se pudo leer el presupuesto de la obra");
  return (await r.json()) as any[];
}

const acciones: Record<string, (q: Quien, b: any) => Promise<unknown>> = {
  // Obras donde puede licitar
  async obras(q) {
    if (ADMINS.includes(q.email)) {
      return sinError(await db.from("proyectos").select("cod_proyecto,nombre,estado").not("cod_proyecto", "is", null).order("nombre"));
    }
    const acc = sinError(await db.from("proyecto_accesos").select("cod_proyecto").eq("activo", true)
      .ilike("email", q.email.replace(/[\\%_]/g, (c) => "\\" + c))) as any[];
    const cods = [...new Set(acc.map((a) => a.cod_proyecto))];
    if (!cods.length) return [];
    return sinError(await db.from("proyectos").select("cod_proyecto,nombre,estado").in("cod_proyecto", cods).order("nombre"));
  },

  // Licitaciones de la obra: todas se ven (con su estado); solo se editan los borradores propios
  async listar(q, b) {
    const p = await obraConAcceso(q, String(b?.cod_proyecto || ""));
    const lics = sinError(await db.from("lic_licitaciones")
      .select("id,codigo,nombre,estado,origen,especialidad,moneda,fecha_limite,plazo_dias,alcance_desc,exclusiones,entregables,direccion,creado_por_email,enviado_at,aprobado_por,aprobado_at,observacion_gerencia,created_at,updated_at")
      .eq("proyecto_id", p.id).order("created_at", { ascending: false })) as any[];
    const ids = lics.map((l) => l.id);
    const [partidas, docs, sug] = ids.length ? await Promise.all([
      db.from("lic_partidas").select("id,licitacion_id,orden,codigo,descripcion,unidad,cantidad,especificacion,origen_presupuesto_ids").in("licitacion_id", ids).order("orden").then(sinError),
      db.from("lic_documentos").select("id,licitacion_id,carpeta,nombre,descripcion,path,archivo_nombre,archivo_bytes,cargado_por,created_at").in("licitacion_id", ids).order("created_at").then(sinError),
      db.from("lic_invitados").select("licitacion_id,contratista,email,estado").in("licitacion_id", ids).then(sinError),
    ]) : [[], [], []];
    return lics.map((L) => ({
      ...L, editable: editable(L),
      partidas: (partidas as any[]).filter((x) => x.licitacion_id === L.id),
      adjuntos: (docs as any[]).filter((x) => x.licitacion_id === L.id),
      // invitados: nombre y estado (Sugerido / Invitado / …); nunca montos
      invitados: (sug as any[]).filter((x) => x.licitacion_id === L.id),
    }));
  },

  // Partidas del presupuesto que se pueden licitar, con la licitación donde ya estén
  async partidas_licitables(q, b) {
    const p = await obraConAcceso(q, String(b?.cod_proyecto || ""));
    const filas = await licitables(q, p.nombre);
    const ids = filas.map((f) => f.presupuesto_id);
    const usadas = ids.length ? (sinError(await db.from("lic_partidas").select("licitacion_id,origen_presupuesto_id,origen_presupuesto_ids")
      .or(`origen_presupuesto_id.in.(${ids.join(",")}),origen_presupuesto_ids.ov.{${ids.join(",")}}`)) as any[]) : [];
    const licIds = [...new Set(usadas.map((u) => u.licitacion_id))];
    const lics = licIds.length ? (sinError(await db.from("lic_licitaciones").select("id,codigo,estado").in("id", licIds)) as any[]) : [];
    const donde = new Map<number, any>();
    for (const u of usadas) {
      const L = lics.find((l) => l.id === u.licitacion_id);
      if (!L || L.estado === "Desierta" || L.estado === "Cancelada") continue;
      for (const pid of [u.origen_presupuesto_id, ...(u.origen_presupuesto_ids || [])]) if (pid) donde.set(Number(pid), { codigo: L.codigo, estado: L.estado, id: L.id });
    }
    return filas.map((f) => ({ ...f, licitacion: donde.get(Number(f.presupuesto_id)) || null }));
  },

  // Crea o actualiza el borrador (cabecera + partidas + sugeridos)
  async guardar(q, b) {
    const c = b?.licitacion || {};
    const p = await obraConAcceso(q, String(c.cod_proyecto || ""));
    if (c.id) {
      const L = await licDeObra(q, String(c.id));
      if (L.proyecto_id !== p.id) throw new Falla(400, "La licitación es de otra obra");
      if (!editable(L)) throw new Falla(409, "Solo se editan borradores u observadas del supervisor");
    }
    // costo de mano de obra del presupuesto, por partida → pu_base = costo / cantidad (lo decide el servidor)
    const filas = await licitables(q, p.nombre);
    const costo = new Map(filas.map((f) => [Number(f.presupuesto_id), Number(f.mano_obra_costo) || 0]));
    const partidas = (Array.isArray(b?.partidas) ? b.partidas : []).map((it: any) => {
      const ids = (Array.isArray(it?.origen_presupuesto_ids) ? it.origen_presupuesto_ids : []).map(Number).filter((n: number) => costo.has(n));
      const cant = num(it?.cantidad);
      const total = ids.reduce((s: number, id: number) => s + (costo.get(id) || 0), 0);
      return {
        codigo: it?.codigo ?? null, descripcion: String(it?.descripcion || "").slice(0, 2000), unidad: it?.unidad ?? null,
        cantidad: cant, especificacion: it?.especificacion ? String(it.especificacion).slice(0, 4000) : null,
        origen_presupuesto_ids: ids,
        pu_base: ids.length && cant ? Math.round((total / cant) * 100) / 100 : null,
      };
    }).filter((x: any) => x.descripcion);
    const sugeridos = (Array.isArray(b?.sugeridos) ? b.sugeridos : [])
      .map((s: any) => (typeof s === "string" ? { email: s } : s))
      .filter((s: any) => s?.email && /@/.test(s.email))
      .map((s: any) => ({ email: String(s.email).toLowerCase().trim(), contratista: s.contratista || null }));
    const ubicacion = [p.distrito, p.provincia, p.departamento].filter(Boolean).join(", ") || null;
    const cab = {
      id: c.id || null, nombre: String(c.nombre || "").trim(), especialidad: c.especialidad || null, moneda: c.moneda || null,
      fecha_limite: c.fecha_limite || null, plazo_dias: c.plazo_dias ?? null, alcance_desc: c.alcance_desc || null,
      exclusiones: c.exclusiones || null, entregables: c.entregables || null,
      // de la ficha de la obra en Gerencia, nunca del cliente
      proyecto: p.nombre, proyecto_id: p.id, cliente: c.cliente || null, ubicacion, direccion: p.direccion || c.direccion || null, zona: p.zona || null,
    };
    const r = await db.rpc("lic_sup_guardar", { p_email: q.email, p_cab: cab, p_partidas: partidas, p_sugeridos: sugeridos });
    if (r.error) {
      const m = r.error.message || "";
      if (m.includes("falta_nombre")) throw new Falla(400, "Ponle nombre a la licitación");
      if (m.includes("no_editable")) throw new Falla(409, "Solo se editan borradores u observadas del supervisor");
      throw new Falla(500, m);
    }
    return r.data;
  },

  // Adjunto del expediente: la ruta la pone el servidor; la fila queda en lic_documentos
  async subir(q, b) {
    const L = await licDeObra(q, String(b?.id || ""));
    if (!editable(L)) throw new Falla(409, "La licitación ya no se puede editar");
    const tipo = TIPOS.includes(b?.tipo) ? b.tipo : "Otro";
    const path = `${L.id}/adjuntos/${Date.now()}-${seguro(b?.nombre)}`;
    const up = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (up.error) throw new Falla(500, up.error.message);
    const doc = sinError(await db.from("lic_documentos").insert({
      licitacion_id: L.id, carpeta: tipo, nombre: String(b?.nombre || "archivo").slice(0, 300),
      descripcion: b?.descripcion ? String(b.descripcion).slice(0, 2000) : null, path,
      archivo_nombre: b?.nombre || null, archivo_bytes: num(b?.bytes), cargado_por: q.email, estado: "Vigente",
    }).select("id").single()) as any;
    return { doc_id: doc.id, path, token: up.data.token };
  },

  async quitar_adjunto(q, b) {
    const d = sinError(await db.from("lic_documentos").select("id,licitacion_id,path").eq("id", String(b?.doc_id || "")).maybeSingle()) as any;
    if (!d) throw new Falla(404, "No existe el adjunto");
    const L = await licDeObra(q, d.licitacion_id);
    if (!editable(L)) throw new Falla(409, "La licitación ya no se puede editar");
    if (d.path) await db.storage.from(BUCKET).remove([d.path]);
    sinError(await db.from("lic_documentos").delete().eq("id", d.id));
    return { ok: true };
  },

  // Descarga del expediente de una licitación de su obra (nunca las ofertas)
  async descargar(q, b) {
    const path = String(b?.path || "");
    const lic = path.split("/")[0];
    if (!lic || path.includes("..") || path.includes("/ofertas/")) throw new Falla(403, "No tienes acceso a este archivo");
    await licDeObra(q, lic);
    const r = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (r.error) throw new Falla(404, "No se encontró el archivo");
    return { url: r.data.signedUrl };
  },

  // Enviar a Gerencia para aprobación
  async enviar(q, b) {
    const L = await licDeObra(q, String(b?.id || ""));
    if (!editable(L)) throw new Falla(409, "Ya fue enviada");
    const n = sinError(await db.from("lic_partidas").select("id", { count: "exact", head: false }).eq("licitacion_id", L.id)) as any[];
    if (!n.length) throw new Falla(400, "Agrega al menos una partida antes de enviar");
    sinError(await db.from("lic_licitaciones").update({ estado: "Por aprobar", enviado_at: new Date().toISOString(), observacion_gerencia: null }).eq("id", L.id));
    sinError(await db.from("lic_eventos").insert({ licitacion_id: L.id, usuario: q.email, accion: "Cambio de estado", detalle: L.estado + " → Por aprobar" }));
    return { ok: true, estado: "Por aprobar" };
  },

  // Estado de licitación por partida del presupuesto (reemplaza las lecturas anónimas de app-sup)
  async estados(q, b) {
    const ids = (Array.isArray(b?.presupuesto_ids) ? b.presupuesto_ids : []).map(Number).filter((n: number) => n > 0).slice(0, 2000);
    if (!ids.length) return [];
    const parts = sinError(await db.from("lic_partidas").select("licitacion_id,origen_presupuesto_id,origen_presupuesto_ids")
      .or(`origen_presupuesto_id.in.(${ids.join(",")}),origen_presupuesto_ids.ov.{${ids.join(",")}}`)) as any[];
    const licIds = [...new Set(parts.map((x) => x.licitacion_id))];
    const lics = licIds.length ? (sinError(await db.from("lic_licitaciones").select("id,codigo,nombre,estado").in("id", licIds)) as any[]) : [];
    const out: any[] = [];
    for (const x of parts) {
      const L = lics.find((l) => l.id === x.licitacion_id); if (!L) continue;
      for (const pid of [x.origen_presupuesto_id, ...(x.origen_presupuesto_ids || [])])
        if (pid && ids.includes(Number(pid))) out.push({ presupuesto_id: Number(pid), licitacion_id: L.id, codigo: L.codigo, nombre: L.nombre, estado: L.estado });
    }
    return out;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);
  try {
    const q = await quien(req);
    const body = await req.json().catch(() => ({}));
    const fn = acciones[body?.accion];
    if (!fn) throw new Falla(400, "Acción desconocida");
    return json(await fn(q, body));
  } catch (e) {
    const status = e instanceof Falla ? e.status : 500;
    if (status >= 500) console.error("lic-supervisor", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
