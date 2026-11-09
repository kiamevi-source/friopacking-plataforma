// enviar-alertas-correo · manda por correo (Microsoft 365) las alertas de restricciones del
// reporte diario. Instancia Supervisor.
//
// El supervisor registra una restricción → app-sup crea una fila por destinatario en
// `restriccion_alertas` con correo_estado='pendiente'. Esta función las recoge y las envía.
//
// Lo dispara pg_cron cada 5 min (job «enviar_alertas_correo»). Se puede llamar a mano con
// body {"prueba": true}: arma los correos y responde qué mandaría, SIN enviar ni marcar nada.
//
// Restricción levantada (9-nov-2026): el trigger fn_restriccion_levantada_alerta crea una fila
// tipo='levantada' para cada persona que recibió la alerta original. Va en el mismo correo, en su
// propia sección («Ya se levantaron»), y si solo hay levantadas el correo es de buena noticia.
//
// Reglas:
// - Un correo por destinatario y por corrida: si a alguien le tocan 3 restricciones nuevas,
//   recibe 1 correo con las 3.
// - Fila sin correo (la contrata hoy) → 'sin_correo'.
// - Falla de envío → 'error' + correo_error; se reintenta hasta 3 veces.
// - Más de 7 días sin poder enviarse → 'vencido' (no se manda un aviso viejo de golpe).
// - Sin credenciales todavía → no toca nada; las alertas siguen 'pendiente'.
//
// Secretos (Edge Functions → Secrets), los mismos de sync-equipos-sharepoint:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET. Opcional MS_SENDER para cambiar el remitente.
// La app de Microsoft necesita el permiso de aplicación Mail.Send (consentido por un admin).
//
// Remitente: por ahora el buzón de Kiara (lo decidió el 9-nov-2026). Cuando Sistemas cree
// alertas@friopacking.pe, basta con poner el secreto MS_SENDER (o cambiar esta línea).
// No se guarda copia en Enviados para no llenarle el buzón.
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SENDER = Deno.env.get("MS_SENDER") || "kmedina@friopacking.pe";
const APP_URL = Deno.env.get("APP_SUP_URL") ?? "https://friopacking-plataforma.vercel.app/app-sup/";
const MAX_INTENTOS = 3;
const DIAS_VIGENCIA = 7;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function tokenMicrosoft(): Promise<string> {
  const tenant = Deno.env.get("MS_TENANT_ID"), id = Deno.env.get("MS_CLIENT_ID"), secreto = Deno.env.get("MS_CLIENT_SECRET");
  if (!tenant || !id || !secreto) throw new Error("SIN_CREDENCIALES");
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials", client_id: id, client_secret: secreto,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft rechazó las credenciales: ${body.error_description?.split("\r\n")[0] ?? res.status}`);
  return body.access_token;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fecha = (d: unknown) => {
  if (!d) return "";
  const [y, m, dd] = String(d).slice(0, 10).split("-");
  return `${dd}/${m}/${y}`;
};
const COLOR_IMPACTO: Record<string, string> = { alto: "#C0392B", medio: "#D68910", bajo: "#1E8449" };

type Alerta = Record<string, any>;

function tarjeta(a: Alerta) {
  const lev = a.tipo === "levantada";
  const imp = String(a.impacto ?? "").toLowerCase();
  const filas = [
    ["Obra", a.nombre_proyecto || a.cod_proyecto],
    ["Especialidad", a.especialidad],
    ["Contrata", a.contratista],
    [lev ? "Levantada por" : "Fecha objetivo", lev ? a.reportada_por : fecha(a.fecha_objetivo)],
    [lev ? "" : "Reportada por", lev ? "" : a.reportada_por],
    ["Te llega como", a.rol],
  ].filter(([k, v]) => k && v).map(([k, v]) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#5A6478;font-size:13px;white-space:nowrap">${k}</td><td style="padding:2px 0;font-size:13px;color:#1B2235">${esc(v)}</td></tr>`).join("");
  const borde = lev ? "#1E8449" : (COLOR_IMPACTO[imp] ?? "#38C0A8");
  return `
      <div style="border:1px solid #E3E7EF;border-left:4px solid ${borde};border-radius:8px;padding:14px 16px;margin:0 0 12px">
        <div style="font-size:15px;font-weight:700;color:#081860;margin:0 0 4px">${lev ? "✓ " : ""}${esc(a.titulo || "Restricción sin título")}</div>
        ${lev ? `<div style="font-size:12px;font-weight:700;color:#1E8449;text-transform:uppercase;margin:0 0 8px">Levantada</div>`
              : imp ? `<div style="font-size:12px;font-weight:700;color:${COLOR_IMPACTO[imp] ?? "#5A6478"};text-transform:uppercase;margin:0 0 8px">Impacto ${esc(imp)}</div>` : ""}
        ${a.detalle && !lev ? `<div style="font-size:14px;color:#1B2235;margin:0 0 10px;white-space:pre-wrap">${esc(a.detalle)}</div>` : ""}
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${filas}</table>
      </div>`;
}

function armarCorreo(nombre: string, alertas: Alerta[]) {
  const nuevas = alertas.filter((a) => a.tipo !== "levantada");
  const levantadas = alertas.filter((a) => a.tipo === "levantada");
  const obras = [...new Set(alertas.map((a) => a.nombre_proyecto || a.cod_proyecto).filter(Boolean))];
  const obrasTxt = `${obras.slice(0, 3).join(", ")}${obras.length > 3 ? "…" : ""}`;
  let asunto: string, titulo: string;
  if (!levantadas.length) {
    asunto = nuevas.length === 1
      ? `Restricción en ${obras[0] ?? "obra"}: ${nuevas[0].titulo ?? "sin título"}`
      : `${nuevas.length} restricciones nuevas · ${obrasTxt}`;
    titulo = nuevas.length === 1 ? "Nueva restricción reportada" : `${nuevas.length} restricciones nuevas`;
  } else if (!nuevas.length) {
    asunto = levantadas.length === 1
      ? `Levantada en ${obras[0] ?? "obra"}: ${levantadas[0].titulo ?? "restricción"}`
      : `${levantadas.length} restricciones levantadas · ${obrasTxt}`;
    titulo = levantadas.length === 1 ? "Restricción levantada" : `${levantadas.length} restricciones levantadas`;
  } else {
    asunto = `${nuevas.length} nueva${nuevas.length === 1 ? "" : "s"} y ${levantadas.length} levantada${levantadas.length === 1 ? "" : "s"} · ${obrasTxt}`;
    titulo = "Novedades de restricciones";
  }
  const sec = (t: string) => `<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5A6478;margin:6px 0 10px">${t}</div>`;
  const cuerpo = [
    nuevas.length ? (levantadas.length ? sec("Nuevas") : "") + nuevas.map(tarjeta).join("") : "",
    levantadas.length ? (nuevas.length ? sec("Ya se levantaron") : "") + levantadas.map(tarjeta).join("") : "",
  ].join("");
  const intro = !levantadas.length
    ? `el supervisor registró ${nuevas.length === 1 ? "esta restricción" : "estas restricciones"} en el reporte diario:`
    : !nuevas.length
      ? `${levantadas.length === 1 ? "esta restricción ya se levantó" : "estas restricciones ya se levantaron"}; ya no frena${levantadas.length === 1 ? "" : "n"} la obra:`
      : "hay novedades en las restricciones del reporte diario:";

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#F4F6FA;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px">
    <div style="background:#081860;color:#fff;border-radius:10px 10px 0 0;padding:16px 20px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#38C0A8;font-weight:700">Grupo Friopacking · Alerta de obra</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px">${titulo}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 10px 10px;padding:20px">
      <p style="font-size:14px;color:#1B2235;margin:0 0 16px">Hola ${esc(nombre.split(" ")[0] || "")}, ${intro}</p>
      ${cuerpo}
      <p style="margin:18px 0 0"><a href="${APP_URL}" style="display:inline-block;background:#38C0A8;color:#081860;font-weight:700;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:6px">Abrir la plataforma</a></p>
    </div>
    <p style="font-size:11px;color:#8A93A6;text-align:center;margin:14px 0 0">Correo automático de la Plataforma Friopacking.</p>
  </div></body></html>`;
  return { asunto, html };
}

async function enviar(token: string, para: string, asunto: string, html: string) {
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(SENDER)}/sendMail`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: para } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const pista = res.status === 403 ? " (falta el permiso Mail.Send o la app no puede usar ese buzón)" :
      res.status === 404 ? " (el buzón remitente no existe)" : "";
    throw new Error(`Microsoft respondió ${res.status}${pista}: ${txt.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let prueba = false;
  try { prueba = !!(await req.json())?.prueba; } catch { /* sin body = cron */ }

  const limite = new Date(Date.now() - DIAS_VIGENCIA * 864e5).toISOString();

  // 1. Limpieza que no necesita a Microsoft (en prueba no se toca nada).
  if (!prueba) {
    await db.from("restriccion_alertas").update({ correo_estado: "sin_correo" })
      .eq("correo_estado", "pendiente").or("destinatario_email.is.null,destinatario_email.eq.");
    await db.from("restriccion_alertas").update({ correo_estado: "vencido" })
      .in("correo_estado", ["pendiente", "error"]).lt("created_at", limite);
  }

  // 2. Lo que hay que mandar.
  const { data: filas, error } = await db.from("restriccion_alertas")
    .select("*")
    .in("correo_estado", ["pendiente", "error"])
    .lt("correo_intentos", MAX_INTENTOS)
    .gte("created_at", limite)
    .not("destinatario_email", "is", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return json({ estado: "error", mensaje: error.message }, 500);

  const porDest = new Map<string, Alerta[]>();
  for (const f of filas ?? []) {
    const mail = String(f.destinatario_email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) continue;
    if (!porDest.has(mail)) porDest.set(mail, []);
    porDest.get(mail)!.push(f);
  }
  if (!porDest.size) return json({ estado: "nada_pendiente" });

  if (prueba) {
    return json({
      estado: "prueba", correos: [...porDest].map(([para, al]) => ({
        para, nombre: al[0].destinatario_nombre, alertas: al.length, asunto: armarCorreo(al[0].destinatario_nombre ?? "", al).asunto,
      })),
    });
  }

  let token: string;
  try { token = await tokenMicrosoft(); }
  catch (e) {
    const msg = (e as Error).message;
    // Sin credenciales: no es un error de las alertas, siguen 'pendiente' sin gastar intentos.
    if (msg === "SIN_CREDENCIALES") return json({ estado: "sin_credenciales", remitente: SENDER, pendientes: filas!.length });
    return json({ estado: "error", mensaje: msg }, 502);
  }

  const resultado = { enviados: 0, fallidos: 0, alertas: 0, errores: [] as string[] };
  for (const [para, alertas] of porDest) {
    const ids = alertas.map((a) => a.id);
    try {
      const { asunto, html } = armarCorreo(alertas[0].destinatario_nombre ?? "", alertas);
      await enviar(token, para, asunto, html);
      await db.from("restriccion_alertas")
        .update({ correo_estado: "enviado", correo_at: new Date().toISOString(), correo_error: null })
        .in("id", ids);
      resultado.enviados++; resultado.alertas += ids.length;
    } catch (e) {
      const msg = (e as Error).message;
      for (const a of alertas) {
        await db.from("restriccion_alertas")
          .update({ correo_estado: "error", correo_error: msg.slice(0, 500), correo_intentos: (a.correo_intentos ?? 0) + 1 })
          .eq("id", a.id);
      }
      resultado.fallidos++; resultado.errores.push(`${para}: ${msg}`);
    }
  }
  return json({ estado: "ok", ...resultado });
});
