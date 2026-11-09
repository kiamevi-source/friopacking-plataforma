// enviar-alertas-correo · manda por correo (Microsoft 365) las alertas de restricciones del
// reporte diario. Instancia Supervisor.
//
// El supervisor registra una restricción → app-sup crea una fila por destinatario en
// `restriccion_alertas` con correo_estado='pendiente'. Esta función las recoge y las envía.
//
// Lo dispara pg_cron cada 5 min (job «enviar_alertas_correo»). Se puede llamar a mano con
// body {"prueba": true}: arma los correos y responde qué mandaría, SIN enviar ni marcar nada.
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
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET  + MS_SENDER (ej. alertas@friopacking.pe)
// La app de Microsoft necesita el permiso de aplicación Mail.Send (consentido por un admin).
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.microsoft.com/v1.0";
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
  if (!tenant || !id || !secreto || !Deno.env.get("MS_SENDER")) throw new Error("SIN_CREDENCIALES");
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

function armarCorreo(nombre: string, alertas: Alerta[]) {
  const obras = [...new Set(alertas.map((a) => a.nombre_proyecto || a.cod_proyecto).filter(Boolean))];
  const asunto = alertas.length === 1
    ? `Restricción en ${obras[0] ?? "obra"}: ${alertas[0].titulo ?? "sin título"}`
    : `${alertas.length} restricciones nuevas · ${obras.slice(0, 3).join(", ")}${obras.length > 3 ? "…" : ""}`;

  const tarjetas = alertas.map((a) => {
    const imp = String(a.impacto ?? "").toLowerCase();
    const filas = [
      ["Obra", a.nombre_proyecto || a.cod_proyecto],
      ["Especialidad", a.especialidad],
      ["Contrata", a.contratista],
      ["Fecha objetivo", fecha(a.fecha_objetivo)],
      ["Reportada por", a.reportada_por],
      ["Te llega como", a.rol],
    ].filter(([, v]) => v).map(([k, v]) =>
      `<tr><td style="padding:2px 12px 2px 0;color:#5A6478;font-size:13px;white-space:nowrap">${k}</td><td style="padding:2px 0;font-size:13px;color:#1B2235">${esc(v)}</td></tr>`).join("");
    return `
      <div style="border:1px solid #E3E7EF;border-left:4px solid ${COLOR_IMPACTO[imp] ?? "#38C0A8"};border-radius:8px;padding:14px 16px;margin:0 0 12px">
        <div style="font-size:15px;font-weight:700;color:#081860;margin:0 0 4px">${esc(a.titulo || "Restricción sin título")}</div>
        ${imp ? `<div style="font-size:12px;font-weight:700;color:${COLOR_IMPACTO[imp] ?? "#5A6478"};text-transform:uppercase;margin:0 0 8px">Impacto ${esc(imp)}</div>` : ""}
        ${a.detalle ? `<div style="font-size:14px;color:#1B2235;margin:0 0 10px;white-space:pre-wrap">${esc(a.detalle)}</div>` : ""}
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${filas}</table>
      </div>`;
  }).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px">
    <div style="background:#081860;color:#fff;border-radius:10px 10px 0 0;padding:16px 20px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#38C0A8;font-weight:700">Grupo Friopacking · Alerta de obra</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px">${alertas.length === 1 ? "Nueva restricción reportada" : `${alertas.length} restricciones nuevas`}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 10px 10px;padding:20px">
      <p style="font-size:14px;color:#1B2235;margin:0 0 16px">Hola ${esc(nombre.split(" ")[0] || "")}, el supervisor registró ${alertas.length === 1 ? "esta restricción" : "estas restricciones"} en el reporte diario:</p>
      ${tarjetas}
      <p style="margin:18px 0 0"><a href="${APP_URL}" style="display:inline-block;background:#38C0A8;color:#081860;font-weight:700;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:6px">Abrir la plataforma</a></p>
    </div>
    <p style="font-size:11px;color:#8A93A6;text-align:center;margin:14px 0 0">Correo automático de la Plataforma Friopacking. No respondas a este mensaje.</p>
  </div></body></html>`;
  return { asunto, html };
}

async function enviar(token: string, para: string, asunto: string, html: string) {
  const sender = Deno.env.get("MS_SENDER")!;
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: para } }],
      },
      saveToSentItems: true,
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
    if (msg === "SIN_CREDENCIALES") return json({ estado: "sin_credenciales", pendientes: filas!.length });
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
