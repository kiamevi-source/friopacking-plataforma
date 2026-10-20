// sync-equipos-sharepoint · trae el Excel de importaciones desde SharePoint a equipos_pmo
// (instancia Supervisor). Reemplaza la subida manual del viernes en el módulo Equipos.
//
// Lo dispara pg_cron cada 15 min (job «sync_equipos_sharepoint») y el botón «Traer de
// SharePoint» del módulo Equipos de Gerencia (body {"forzar": true}).
//
// 1. Pide un token a Microsoft con la app registrada por Sistemas (client credentials).
// 2. Lee los metadatos del archivo; si el eTag es el mismo de la última sincronización
//    buena, termina ahí (no descarga nada).
// 3. Descarga el .xlsx, lo lee con las MISMAS reglas que el importador de Gerencia
//    (parse.js) y, si pasa la validación, registra el historial en equipos_cambios y
//    hace upsert por `doc` en equipos_pmo. Igual que la importación manual, no borra
//    órdenes que ya no vienen en el archivo: solo las anota como «eliminado».
// 4. Deja una fila en equipos_sync_log con el resultado (la lee el chip del módulo).
//
// Secretos (Edge Functions → Secrets): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.
// Opcionales: SP_DRIVE_ID / SP_ITEM_ID si el archivo cambia de lugar.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { EQ_TRACK, elegirHoja, parseRows, toPmoRow, validar } from "./parse.js";

// IMPORTACION-X1-MLUJAN-2026.xlsx · OneDrive de sistemas@friopacking.pe
// (Importaciones/IMPORTACIONES/DASHBOARD 2026)
const DRIVE_ID = Deno.env.get("SP_DRIVE_ID") ?? "b!ONv-p8DbMkeLEx8LXMJ7L7Tnw7vYssRGkOvuDXoSJZI1SZa3uhQnTZzcpsnfpPKg";
const ITEM_ID = Deno.env.get("SP_ITEM_ID") ?? "01I4CQSCGISHSFBQRUKRGYY3QEZRLH777D";
const GRAPH = "https://graph.microsoft.com/v1.0";

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

async function registrar(fila: Record<string, unknown>) {
  const { error } = await db.from("equipos_sync_log").insert(fila);
  if (error) console.error("[sync equipos] no se pudo escribir el log:", error.message);
}

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

async function graph(token: string, path: string) {
  const res = await fetch(GRAPH + path, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const pista = res.status === 403 || res.status === 404
      ? " (la app no tiene permiso sobre el archivo, o el archivo se movió)" : "";
    throw new Error(`SharePoint respondió ${res.status}${pista}: ${txt.slice(0, 200)}`);
  }
  return res;
}

const nz = (v: unknown) => (v == null ? "" : String(v).trim());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const inicio = Date.now();
  let forzar = false;
  try { forzar = !!(await req.json())?.forzar; } catch { /* sin body = cron */ }
  const base: Record<string, unknown> = { disparo: forzar ? "manual" : "cron" };

  try {
    const token = await tokenMicrosoft();
    const meta = await (await graph(token, `/drives/${DRIVE_ID}/items/${ITEM_ID}?$select=name,eTag,lastModifiedDateTime,lastModifiedBy,webUrl`)).json();
    Object.assign(base, {
      etag: meta.eTag, archivo: meta.name, modificado_en: meta.lastModifiedDateTime,
      modificado_por: meta.lastModifiedBy?.user?.displayName ?? null,
    });

    if (!forzar) {
      const { data: ult } = await db.from("equipos_sync_log").select("etag")
        .eq("estado", "ok").order("ts", { ascending: false }).limit(1).maybeSingle();
      if (ult?.etag && ult.etag === meta.eTag) return json({ estado: "sin_cambios", ...base });
    }

    const ab = await (await graph(token, `/drives/${DRIVE_ID}/items/${ITEM_ID}/content`)).arrayBuffer();
    const wb = XLSX.read(new Uint8Array(ab), { type: "array" });
    const hoja = elegirHoja(XLSX, wb);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: "" });
    const filas = parseRows(raw);
    base.hoja = hoja;

    const val = validar(filas);
    if (!val.ok) {
      // Mismo freno que la importación manual: nada de columnas corridas a supervisores.
      await registrar({ ...base, estado: "bloqueado", filas: filas.length, mensaje: val.problemas.join(" · ") });
      return json({ estado: "bloqueado", problemas: val.problemas, ...base }, 422);
    }

    // El Excel a veces repite un documento en dos líneas: Postgres rechaza el upsert
    // entero si la clave viene dos veces. Gana la última línea, como en Gerencia.
    const ahora = new Date().toISOString();
    const uniq = new Map<string, Record<string, unknown>>();
    filas.filter((r: any) => nz(r.doc)).forEach((r: any) => { const p = toPmoRow(r, ahora); uniq.set(p.doc, p); });
    const payload = [...uniq.values()];

    // Historial: comparar contra lo que hay hoy en la tabla, antes de escribir.
    const { data: actual, error: eAct } = await db.from("equipos_pmo")
      .select("doc,proj,proj_csv,tipo,proveedor,eta,etd,fe,fer,so,st,mod").limit(5000);
    if (eAct) throw new Error("No se pudo leer equipos_pmo: " + eAct.message);
    const curMap = new Map((actual ?? []).map((c: any) => [c.doc, c]));
    const lote = ahora;
    const cambios: Record<string, unknown>[] = [];
    const fila = (p: any, extra: Record<string, unknown>) => ({
      doc: p.doc, proyecto: p.proj, proj_csv: p.proj_csv, tipo: p.tipo, proveedor: p.proveedor,
      lote, origen: "sharepoint", fecha_cambio: lote, ...extra,
    });
    for (const p of payload as any[]) {
      const cur: any = curMap.get(p.doc);
      if (!cur) { cambios.push(fila(p, { campo: "nuevo", valor_anterior: null, valor_nuevo: nz(p.proj) || nz(p.tipo) || p.doc })); continue; }
      for (const f of EQ_TRACK) {
        if (nz(cur[f]) !== nz(p[f])) cambios.push(fila(p, { campo: f, valor_anterior: nz(cur[f]) || null, valor_nuevo: nz(p[f]) || null }));
      }
    }
    // «Eliminado» solo la primera vez: la orden sigue en la tabla y no se repite en cada sync.
    const enArchivo = new Set(payload.map((p: any) => p.doc));
    const faltan = [...curMap.keys()].filter((d) => !enArchivo.has(d));
    if (faltan.length) {
      const { data: yaMarcados } = await db.rpc("equipos_ultimo_cambio", { docs: faltan });
      const marcados = new Set((yaMarcados ?? []).filter((x: any) => x.campo === "eliminado").map((x: any) => x.doc));
      for (const d of faltan) {
        if (marcados.has(d)) continue;
        const cur: any = curMap.get(d);
        cambios.push(fila({ ...cur, doc: d }, { campo: "eliminado", valor_anterior: nz(cur.st) || null, valor_nuevo: null }));
      }
    }
    for (let i = 0; i < cambios.length; i += 500) {
      const { error } = await db.from("equipos_cambios").insert(cambios.slice(i, i + 500));
      if (error) console.warn("[sync equipos] historial:", error.message);
    }

    // Upsert por lotes; si un lote falla se reintenta fila a fila para salvar el resto.
    let ok = 0;
    const fallos: { doc: string; error: string }[] = [];
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error } = await db.from("equipos_pmo").upsert(chunk, { onConflict: "doc" });
      if (!error) { ok += chunk.length; continue; }
      for (const r of chunk as any[]) {
        const { error: e2 } = await db.from("equipos_pmo").upsert([r], { onConflict: "doc" });
        if (e2) fallos.push({ doc: r.doc, error: e2.message }); else ok++;
      }
    }

    const resumen = {
      nuevos: cambios.filter((c) => c.campo === "nuevo").length,
      eliminados: cambios.filter((c) => c.campo === "eliminado").length,
      modificados: cambios.filter((c) => c.campo !== "nuevo" && c.campo !== "eliminado").length,
    };
    const estado = ok === 0 ? "error" : "ok";
    const mensaje = [
      filas.faltantes?.length ? `columnas no encontradas: ${filas.faltantes.join(", ")}` : "",
      fallos.length ? `${fallos.length} rechazadas (${fallos.slice(0, 3).map((f) => f.doc).join(", ")})` : "",
      filas.length - payload.length > 0 ? `${filas.length - payload.length} documentos repetidos unificados` : "",
    ].filter(Boolean).join(" · ") || null;
    await registrar({
      ...base, estado, filas: payload.length, escritas: ok, cambios: cambios.length, ...resumen,
      mensaje, duracion_ms: Date.now() - inicio,
    });
    return json({ estado, filas: payload.length, escritas: ok, cambios: cambios.length, ...resumen, mensaje, ...base });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (msg === "SIN_CREDENCIALES") {
      // Todavía no hay app de Microsoft: no se llena el log cada 15 min con el mismo aviso.
      return json({ estado: "sin_credenciales", mensaje: "Falta configurar MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET" }, 503);
    }
    console.error("[sync equipos]", msg);
    await registrar({ ...base, estado: "error", mensaje: msg.slice(0, 500), duracion_ms: Date.now() - inicio });
    return json({ estado: "error", mensaje: msg, ...base }, 500);
  }
});
