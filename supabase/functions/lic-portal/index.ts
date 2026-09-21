// lic-portal · puerta única del contratista a las licitaciones (instancia PMO).
//
// El contratista inicia sesión en la instancia Contratas; su token no sirve en PMO.
// Esta función lo valida contra Contratas (/auth/v1/user), toma su correo y recién
// entonces lee o escribe en PMO con la llave de servicio, devolviendo SOLO lo suyo:
// sus invitaciones, el expediente de las licitaciones donde está invitado, SU oferta,
// las consultas públicas o propias y sus contratos. Nunca ofertas ni montos de otros.
import { createClient } from "npm:@supabase/supabase-js@2";

const CT_URL = "https://uijuokwcsvnlzxoyvrcj.supabase.co";
// llave pública (anon) de Contratas: solo se usa para preguntar «¿de quién es este token?»
const CT_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpanVva3djc3ZubHp4b3l2cmNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MTUwMDgsImV4cCI6MjA5NjA5MTAwOH0.-JtaWOf3QPRB5W1Z7rLp5Rabr83xdWIqX4GngkpFeJU";

const BUCKET = "lic-expediente";
// Lo que aún no está publicado: el borrador del supervisor, lo que espera aprobación de Gerencia
// y lo que Gerencia devolvió. El contratista no lo ve.
const OCULTAS = ["Borrador", "Preparación", "Por aprobar", "Observada"];
const ABIERTAS = ["Publicada", "Invitaciones", "Ofertas"];
// Eventos que el contratista puede ver (los mismos que muestra el portal). El detalle de
// «Adjudicación» y «Consulta respondida» se quita: podría nombrar a otra empresa o su monto.
const NOV = ["Documento cargado", "Plano cargado", "Nueva revisión de plano", "Adenda emitida",
  "Consulta respondida", "Cambio de estado", "Adjudicación"];
const SIN_DETALLE = ["Adjudicación", "Consulta respondida"];

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

// Escapa % y _ para comparar el correo con ilike sin comodines.
const likeExacto = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
// Igual que lzSafe del portal: la carpeta de adjuntos de cada contratista.
const seguro = (n: string) =>
  String(n || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const abierta = (L: any) => ABIERTAS.includes(L.estado) && (!L.fecha_limite || hoyLima() <= L.fecha_limite);
const sinError = <T>(r: { data: T; error: any }) => {
  if (r.error) throw new Falla(500, r.error.message);
  return r.data;
};

async function correoDelToken(req: Request): Promise<string> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Falla(401, "Sin sesión");
  const r = await fetch(CT_URL + "/auth/v1/user", { headers: { apikey: CT_ANON, Authorization: "Bearer " + token } });
  if (!r.ok) throw new Falla(401, "Sesión vencida: vuelve a ingresar");
  const u = await r.json();
  if (!u?.email) throw new Falla(401, "Sesión sin correo");
  return String(u.email).toLowerCase();
}

async function invitacion(email: string, lic: string) {
  // «Sugerido» = lo propuso el supervisor y Gerencia aún no lo invita: no cuenta.
  const r = sinError(await db.from("lic_invitados").select("*").eq("licitacion_id", lic)
    .ilike("email", likeExacto(email)).or("estado.is.null,estado.neq.Sugerido").order("invitado_at", { ascending: false }).limit(1));
  return (r as any[])[0] || null;
}
async function licitacion(lic: string) {
  return sinError(await db.from("lic_licitaciones").select("*").eq("id", lic).maybeSingle()) as any;
}
// El contratista cotiza en blanco: nunca ve el precio base de FrioPacking.
const sinPrecioLic = (L: any) => { if (!L) return L; const { presupuesto_base, ...resto } = L; return resto; };
const sinPrecioPartida = (p: any) => { const { pu_base, ...resto } = p; return resto; };
function eventosVisibles(ev: any[]) {
  return ev.filter((e) => NOV.includes(e.accion))
    .map((e) => (SIN_DETALLE.includes(e.accion) ? { ...e, detalle: null } : e));
}

const acciones: Record<string, (email: string, b: any) => Promise<unknown>> = {
  // Bandeja: invitaciones a licitaciones ya publicadas + novedades
  async invitaciones(email) {
    const invit = sinError(await db.from("lic_invitados").select("*").ilike("email", likeExacto(email))
      .or("estado.is.null,estado.neq.Sugerido")) as any[];
    const ids = invit.map((v) => v.licitacion_id);
    if (!ids.length) return { invit: [], lics: [], eventos: [] };
    const lics = (sinError(await db.from("lic_licitaciones").select("*").in("id", ids)) as any[])
      .filter((L) => !OCULTAS.includes(L.estado));
    const eventos = sinError(await db.from("lic_eventos").select("licitacion_id,accion,detalle,usuario,created_at")
      .in("licitacion_id", ids).in("accion", NOV).order("created_at", { ascending: false }).limit(500)) as any[];
    return { invit: invit.filter((v) => lics.some((L) => L.id === v.licitacion_id)), lics: lics.map(sinPrecioLic), eventos: eventosVisibles(eventos) };
  },

  async contratos(email) {
    return sinError(await db.from("lic_adjudicaciones").select("*").ilike("email", likeExacto(email))
      .order("fecha", { ascending: false }));
  },

  async requisitos(email) {
    return sinError(await db.from("lic_requisitos").select("*").ilike("email", likeExacto(email))
      .order("created_at", { ascending: false }));
  },

  async requisito(email, b) {
    if (!b?.id || typeof b.cumplimiento !== "object") throw new Falla(400, "Datos incompletos");
    const r = sinError(await db.from("lic_requisitos").update({ cumplimiento: b.cumplimiento })
      .eq("id", b.id).ilike("email", likeExacto(email)).select("id")) as any[];
    if (!r.length) throw new Falla(403, "Ese requisito no es tuyo");
    return { ok: true };
  },

  // Detalle de una licitación: solo si el contratista está invitado
  async detalle(email, b) {
    const lic = String(b?.id || "");
    const inv = await invitacion(email, lic);
    if (!inv) throw new Falla(403, "No estás invitado a esta licitación");
    const L = await licitacion(lic);
    if (!L || OCULTAS.includes(L.estado)) return { oculta: true };
    const [partidas, planos, adendas, consultas, docs, ofertas, adjs, eventos] = await Promise.all([
      db.from("lic_partidas").select("*").eq("licitacion_id", lic).order("orden"),
      db.from("lic_planos").select("*").eq("licitacion_id", lic).order("codigo"),
      db.from("lic_adendas").select("*").eq("licitacion_id", lic).order("numero"),
      db.from("lic_consultas").select("*").eq("licitacion_id", lic).order("created_at"),
      db.from("lic_documentos").select("*").eq("licitacion_id", lic).order("created_at"),
      db.from("lic_ofertas").select("*").eq("licitacion_id", lic).ilike("email", likeExacto(email))
        .order("created_at", { ascending: false }).limit(1),
      db.from("lic_adjudicaciones").select("licitacion_id,contratista,email,monto_adjudicado,contrato_codigo,moneda")
        .eq("licitacion_id", lic).limit(1),
      db.from("lic_eventos").select("licitacion_id,accion,detalle,usuario,created_at").eq("licitacion_id", lic)
        .in("accion", NOV).order("created_at", { ascending: false }).limit(100),
    ].map((p) => p.then(sinError)));
    const pids = (planos as any[]).map((p) => p.id);
    const oferta = (ofertas as any[])[0] || null;
    const [planoVers, ofItems] = await Promise.all([
      pids.length ? db.from("lic_plano_versiones").select("*").in("plano_id", pids).order("created_at").then(sinError) : [],
      oferta ? db.from("lic_oferta_items").select("*").eq("oferta_id", oferta.id).then(sinError) : [],
    ]);
    // Consultas: las respondidas y públicas, y todas las propias. Las de otros nunca.
    const mias = (q: any) => String(q.email || "").toLowerCase() === email;
    const cons = (consultas as any[]).filter((q) => mias(q) || (q.respuesta && q.publica))
      .map((q) => (mias(q) ? q : { ...q, email: null, contratista: null }));
    // Adjudicación: el detalle solo si ganó este contratista; si fue otra, solo que existe.
    const a = (adjs as any[])[0];
    const adj = !a ? null : String(a.email || "").toLowerCase() === email ? a : { licitacion_id: lic, otra: true, email: "" };
    return { L: sinPrecioLic(L), partidas: (partidas as any[]).map(sinPrecioPartida), planos, planoVers, adendas, consultas: cons, invit: inv, oferta, ofItems, docs, adj,
      eventos: eventosVisibles(eventos as any[]) };
  },

  async visto(email, b) {
    const inv = await invitacion(email, String(b?.id || ""));
    if (!inv) throw new Falla(403, "No estás invitado a esta licitación");
    const ahora = new Date().toISOString();
    sinError(await db.from("lic_invitados").update({ visto_at: ahora }).eq("id", inv.id));
    return { visto_at: ahora };
  },

  async participar(email, b) {
    const est = b?.estado;
    if (!["Confirmó", "No participa"].includes(est)) throw new Falla(400, "Estado no válido");
    const inv = await invitacion(email, String(b?.id || ""));
    if (!inv) throw new Falla(403, "No estás invitado a esta licitación");
    const L = await licitacion(inv.licitacion_id);
    if (!L || !abierta(L)) throw new Falla(409, "La recepción ya cerró");
    sinError(await db.from("lic_invitados").update({ estado: est, confirmado_at: est === "Confirmó" ? new Date().toISOString() : null }).eq("id", inv.id));
    sinError(await db.from("lic_eventos").insert({ licitacion_id: L.id, usuario: email, accion: "Participación", detalle: (inv.contratista || email) + ": " + est }));
    return { ok: true };
  },

  async consulta(email, b) {
    const t = String(b?.pregunta || "").trim().slice(0, 2000);
    if (!t) throw new Falla(400, "Escribe tu consulta");
    const inv = await invitacion(email, String(b?.id || ""));
    if (!inv) throw new Falla(403, "No estás invitado a esta licitación");
    const L = await licitacion(inv.licitacion_id);
    if (!L || !abierta(L)) throw new Falla(409, "La recepción ya cerró: no se pueden enviar consultas");
    sinError(await db.from("lic_consultas").insert({ licitacion_id: L.id, contratista: inv.contratista || email, email, pregunta: t, estado: "Pendiente" }));
    sinError(await db.from("lic_eventos").insert({ licitacion_id: L.id, usuario: email, accion: "Consulta", detalle: t.slice(0, 80) }));
    return { ok: true };
  },

  // Adjunto de la oferta: la ruta la pone el servidor, en la carpeta de este contratista
  async subir(email, b) {
    const inv = await invitacion(email, String(b?.id || ""));
    if (!inv) throw new Falla(403, "No estás invitado a esta licitación");
    if (inv.estado === "No participa") throw new Falla(409, "Marcaste que no participas");
    const L = await licitacion(inv.licitacion_id);
    if (!L || !abierta(L)) throw new Falla(409, "La recepción de ofertas ya cerró");
    const path = `${L.id}/ofertas/${seguro(email)}/${Date.now()}-${seguro(b?.nombre)}`;
    const r = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (r.error) throw new Falla(500, r.error.message);
    return { path, token: r.data.token };
  },

  // Descarga: expediente de una licitación donde está invitado, o sus propios adjuntos
  async descargar(email, b) {
    const path = String(b?.path || "");
    const lic = path.split("/")[0];
    if (!lic || path.includes("..")) throw new Falla(400, "Ruta no válida");
    const inv = await invitacion(email, lic);
    if (!inv) throw new Falla(403, "No tienes acceso a este archivo");
    if (path.includes("/ofertas/") && !path.startsWith(`${lic}/ofertas/${seguro(email)}/`))
      throw new Falla(403, "No tienes acceso a este archivo");
    const r = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (r.error) throw new Falla(404, "No se encontró el archivo");
    return { url: r.data.signedUrl };
  },

  async oferta(email, b) {
    const lic = String(b?.id || "");
    const inv = await invitacion(email, lic);
    if (!inv) throw new Falla(403, "No estás invitado a esta licitación");
    const propia = `${lic}/ofertas/${seguro(email)}/`;
    const adjuntos = (Array.isArray(b?.adjuntos) ? b.adjuntos : []).map((a: any) => ({
      nombre: String(a?.nombre || ""), tipo: a?.tipo ?? null, path: String(a?.path || ""),
      bytes: Number(a?.bytes) || null, subido_at: a?.subido_at || new Date().toISOString(),
    }));
    if (adjuntos.some((a: any) => !a.path.startsWith(propia))) throw new Falla(403, "Adjunto fuera de tu carpeta");
    const items = (Array.isArray(b?.items) ? b.items : []).map((it: any) => ({ partida_id: it?.partida_id, pu: Number(it?.pu) || 0 }));
    const plazo = b?.plazo_dias == null || b.plazo_dias === "" ? null : Math.round(Number(b.plazo_dias));
    const r = await db.rpc("lic_portal_guardar_oferta", { p_email: email, p_lic: lic, p_plazo: plazo, p_items: items, p_adjuntos: adjuntos });
    if (r.error) {
      const m = r.error.message || "";
      if (m.includes("recepcion_cerrada")) throw new Falla(409, "La recepción de ofertas ya cerró");
      if (m.includes("oferta_en_cero")) throw new Falla(400, "La oferta no puede ir en cero");
      if (m.includes("faltan_formatos")) throw new Falla(400, "Falta adjuntar: " + m.split("faltan_formatos:")[1].trim());
      if (m.includes("no_participa")) throw new Falla(409, "Marcaste que no participas");
      if (m.includes("no_invitado")) throw new Falla(403, "No estás invitado a esta licitación");
      throw new Falla(500, m);
    }
    return r.data;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);
  try {
    const email = await correoDelToken(req);
    const body = await req.json().catch(() => ({}));
    const fn = acciones[body?.accion];
    if (!fn) throw new Falla(400, "Acción desconocida");
    return json(await fn(email, body));
  } catch (e) {
    const status = e instanceof Falla ? e.status : 500;
    if (status >= 500) console.error("lic-portal", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
