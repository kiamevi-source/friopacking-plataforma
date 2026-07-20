/* ════════════════════════════════════════════════════════════════════
   views/inicio.js — KPIs, vencimientos, alertas de cumplimiento
   Dependencias: core.js (sb, escapeHtml, animateNumber, fmtDateShort, daysUntil)
   Expone: window.loadDashboard
   ════════════════════════════════════════════════════════════════════ */

window.loadDashboard = async function () {
  if (!window.sb) return;
  try {
    const today = new Date();

    // Projects activos
    const { data: projs, error: e1 } = await window.sb
      .from('proyectos')
      .select('id,nombre,estado,fecha_fin_contractual,valorizacion_pct')
      .eq('activo', true);
    if (e1) throw e1;
    if (!projs) throw new Error('No data');

    // Subset: solo proyectos "En progreso" (misma lógica que legacy.activeP())
    const enProgreso = projs.filter(
      (p) => (p.estado || '').trim().toLowerCase() === 'en progreso'
    );

    // Reportes (histórico completo, no-draft) — para derivar avance y "último reporte"
    // EXACTAMENTE como la vista Alertas (legacy), y que los KPIs coincidan.
    const { data: reps, error: e2 } = await window.sb
      .from('reportes')
      .select('nombre_proyecto,fecha_reporte,pct_ejecutado,spi')
      .not('es_draft', 'is', true)
      .order('fecha_reporte', { ascending: true });
    if (e2) console.warn('reportes fetch error', e2);

    // Agrupar por proyecto con dedup anti-zombi (réplica de index.legacy.html)
    const repByProj = {};
    (reps || []).forEach((r) => {
      const k = r.nombre_proyecto || '';
      if (!k) return;
      if (!repByProj[k]) repByProj[k] = [];
      const av = parseFloat(r.pct_ejecutado) || 0;
      const prev = repByProj[k][repByProj[k].length - 1];
      if (prev && av > 0 && av < 99.5 && av === prev.av) return; // avance no creció → zombi
      repByProj[k].push({ fecha: r.fecha_reporte || '', av, spi: r.spi ? parseFloat(r.spi) : null });
    });

    // Fecha de referencia "reportó hoy" (regla 6pm) + derivación por proyecto.
    const refDateStr = legacyRefDate();
    projs.forEach((p) => {
      let rs = repByProj[p.nombre];
      if (!rs || !rs.length) {
        const pNorm = normK(p.nombre || '');
        const altKey = Object.keys(repByProj).find((kk) => normK(kk) === pNorm);
        if (altKey) rs = repByProj[altKey];
      }
      rs = rs || [];
      const last = rs[rs.length - 1];
      const cerrado = (p.estado || '').toLowerCase().includes('cerrado');
      const lastOk = last && (last.av > 0 || (last.spi || 0) > 0);
      // _valp: avance del último reporte (fallback valorizacion_pct) — misma regla que el legacy
      p._valp = cerrado ? 100 : (lastOk ? last.av : (parseFloat(p.valorizacion_pct) || 0));
      p._lastFecha = last ? last.fecha : '';
      p._repRef = p._lastFecha === refDateStr; // ¿reportó en la fecha de referencia?
    });

    // KPI 1 — Sin reporte (solo proyectos en progreso). Réplica de "sin reporte hoy"
    // del legacy: no reportaron en la fecha de referencia (regla 6pm).
    const sinReporteList = enProgreso.filter((p) => !p._repRef);
    const sinReporte = sinReporteList.length;
    const elSin = document.getElementById('kpi-sin');
    elSin.innerHTML = '0';
    window.animateNumber(elSin, sinReporte);

    // KPI 2 — Valorización (estado contiene PEND VAL o VALORIZ)
    const valorizacionList = projs.filter((p) => {
      const e = (p.estado || '').toUpperCase();
      return e.includes('PEND VAL') || e.includes('VALORIZ');
    });
    const valorizacion = valorizacionList.length;
    const elVal = document.getElementById('kpi-val');
    elVal.innerHTML = '0';
    window.animateNumber(elVal, valorizacion);

    // KPI 3 — CF Vencidas (fin contractual pasado y avance < 99%). Réplica del legacy
    // (_getCFVencidas): fecha a mediodía vs. ahora, y avance derivado del último reporte.
    const nowFull = new Date();
    const cfVencidasList = enProgreso.filter((p) => {
      const cf = legacyParseD(p.fecha_fin_contractual);
      return cf && nowFull > cf && (p._valp || 0) < 99;
    });
    const cfVencidas = cfVencidasList.length;
    const elCf = document.getElementById('kpi-cf');
    elCf.innerHTML = '0';
    window.animateNumber(elCf, cfVencidas);

    // Próximos vencimientos (≤14 días)
    const upcoming = projs
      .filter((p) => p.fecha_fin_contractual)
      .map((p) => ({ ...p, _days: window.daysUntil(p.fecha_fin_contractual) }))
      .filter((p) => p._days >= 0 && p._days <= 14)
      .sort((a, b) => a._days - b._days)
      .slice(0, 3);

    const vencEl = document.getElementById('venc-list');
    if (vencEl) {
      if (upcoming.length) {
        vencEl.innerHTML = upcoming.map((p) => {
          const urgent = p._days <= 3;
          const whenLabel = p._days === 0 ? 'Hoy' : p._days === 1 ? 'Mañana' : `En ${p._days} días`;
          return `
            <a href="#alertas" class="tl-item">
              <span class="tl-node ${urgent ? 'crit' : ''}"></span>
              <div class="tl-body">
                <div class="tl-title">${window.escapeHtml(p.nombre || '—')}</div>
                <div class="tl-meta">Fin contractual · ${window.fmtDateShort(p.fecha_fin_contractual)}</div>
              </div>
              <span class="tl-when ${urgent ? 'urgent' : ''}">${whenLabel}</span>
            </a>`;
        }).join('');
      } else {
        vencEl.innerHTML = '<div class="home-empty"><i data-lucide="calendar-check"></i><span>Sin vencimientos próximos</span></div>';
      }
    }

    // Próximos a vencer ≤3 días (para estado operativo)
    const next3 = projs.filter((p) => {
      if (!p.fecha_fin_contractual) return false;
      const d = window.daysUntil(p.fecha_fin_contractual);
      return d >= 0 && d <= 3;
    }).length;

    // Alertas de cumplimiento
    const complianceAlerts = buildComplianceAlerts(projs, cfVencidas, sinReporte);
    renderComplianceAlerts(complianceAlerts);

    // ── Hero stats (alto nivel) ──
    setNum('stat-activos', projs.length);
    // Por vencer ≤30 días — MISMA definición que la vista Alertas (proximos30):
    // SOLO proyectos en progreso, con avance < 99%, y el mismo cálculo de días
    // que el legacy (fecha a mediodía + Math.round) para que los números coincidan.
    const porVencer30List = enProgreso.filter((p) => {
      const d = legacyDaysTo(p.fecha_fin_contractual);
      return d != null && d >= 0 && d <= 30 && (p._valp || 0) < 99;
    }).sort((a, b) => legacyDaysTo(a.fecha_fin_contractual) - legacyDaysTo(b.fecha_fin_contractual));
    const porVencer30 = porVencer30List.length;
    setNum('stat-porvencer', porVencer30);
    const alertasActivas = complianceAlerts.filter((a) => a.type === 'crit' || a.type === 'warn').length;
    setNum('stat-alertas', alertasActivas);
    renderEstado(cfVencidas, sinReporte, next3);

    // ── Proyectos críticos ──
    renderCriticos(projs, enProgreso, today);

    // ── Detalle clicable de cada KPI (ventana flotante) ──
    buildKpiDetails({
      projs,
      porVencer30List,
      sinReporteList,
      valorizacionList,
      cfVencidasList,
      alerts: complianceAlerts.filter((a) => a.type === 'crit' || a.type === 'warn'),
    });
    // Desglose de la cartera activa por estado (registra sus detalles DESPUÉS
    // de buildKpiDetails para que no los sobreescriba).
    renderEstadoSplit(projs);
    initKpiPopover();

    // ── Última sincronización ──
    const lastSync = document.getElementById('last-sync');
    if (lastSync) {
      const n = new Date();
      lastSync.textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    }

    // ── Actividad reciente (lectura adicional, no bloqueante) ──
    loadActividad();

    // Notif badge
    const notifTotal = sinReporte + cfVencidas;
    const notifEl = document.getElementById('notif-count');
    if (notifEl) {
      notifEl.textContent = notifTotal > 9 ? '9+' : (notifTotal || '');
      if (notifTotal === 0) notifEl.style.display = 'none';
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('[Dashboard] load error', err);
    ['kpi-sin', 'kpi-val', 'kpi-cf'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
  }
};

/* ════════════════════════════════════════════════════════════════════
   HELPERS DE RENDER — hero stats, estado, críticos, actividad
   (presentación; no alteran las reglas de negocio ni las queries)
   ════════════════════════════════════════════════════════════════════ */
function setNum(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '0';
  window.animateNumber(el, value);
}

function timeAgo(iso) {
  if (!iso) return '';
  const a = new Date(iso); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return window.fmtDateShort(iso);
}

function renderEstado(cfVencidas, sinReporte, next3) {
  const valEl = document.getElementById('stat-estado');
  const icEl  = document.getElementById('stat-estado-ic');
  if (!valEl || !icEl) return;
  let txt, cls, ico;
  if (cfVencidas > 0) {
    txt = 'Crítico'; cls = 'red'; ico = 'alert-octagon';
  } else if (sinReporte > 3 || next3 > 0) {
    txt = 'Requiere atención'; cls = 'amber'; ico = 'alert-triangle';
  } else {
    txt = 'Óptimo'; cls = 'green'; ico = 'check-circle-2';
  }
  valEl.textContent = txt;
  valEl.className = 'hstat-state-val' + (cls === 'green' ? '' : ' ' + cls);
  icEl.className = 'hstat-ic ' + cls;
  icEl.innerHTML = `<i data-lucide="${ico}" class="ic"></i>`;
}

function renderCriticos(projs, enProgreso, today) {
  const el = document.getElementById('crit-list');
  if (!el) return;
  const enProgSet = new Set(enProgreso.map((p) => p.id));
  const nowFull = new Date();

  const rows = [];
  projs.forEach((p) => {
    const chips = [];
    let severity = 0; // 1=warn 2=crit

    // CF vencida (fin contractual pasado + avance < 99%) — misma regla que el KPI/Alertas
    const cf = legacyParseD(p.fecha_fin_contractual);
    if (cf) {
      if (nowFull > cf && (p._valp || 0) < 99) {
        chips.push({ cls: 'crit', ico: 'calendar-x-2', t: 'CF vencida' });
        severity = Math.max(severity, 2);
      } else {
        const d = window.daysUntil(p.fecha_fin_contractual);
        if (d >= 0 && d <= 3) {
          chips.push({ cls: 'warn', ico: 'clock', t: d === 0 ? 'Vence hoy' : `Vence en ${d}d` });
          severity = Math.max(severity, 1);
        }
      }
    }

    // Sin reporte (solo proyectos en progreso) — réplica de "sin reporte hoy" (regla 6pm)
    if (enProgSet.has(p.id) && !p._repRef) {
      chips.push({ cls: 'warn', ico: 'clipboard-x', t: 'Sin reporte' });
      severity = Math.max(severity, 1);
    }

    if (chips.length) rows.push({ p, chips, severity });
  });

  rows.sort((a, b) => b.severity - a.severity);
  const top = rows.slice(0, 6);

  if (!top.length) {
    el.innerHTML = '<div class="home-empty"><i data-lucide="shield-check"></i><span>Sin proyectos críticos · todo en orden</span></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  el.innerHTML = top.map(({ p, chips, severity }) => `
    <a href="#proyectos" class="crit-item">
      <span class="crit-sev ${severity >= 2 ? 'crit' : 'warn'}"></span>
      <div class="crit-body">
        <div class="crit-name">${window.escapeHtml(p.nombre || '—')}</div>
        <div class="crit-meta">
          ${chips.map((c) => `<span class="crit-chip ${c.cls}"><i data-lucide="${c.ico}"></i>${c.t}</span>`).join('')}
        </div>
      </div>
      <i data-lucide="chevron-right" class="crit-arrow"></i>
    </a>`).join('');
  if (window.lucide) lucide.createIcons();
}

async function loadActividad() {
  const el = document.getElementById('act-list');
  if (!el || !window.sb) return;
  try {
    const { data, error } = await window.sb
      .from('reportes')
      .select('nombre_proyecto,fecha_reporte,pct_ejecutado')
      .order('fecha_reporte', { ascending: false })
      .limit(6);
    if (error) throw error;
    if (!data || !data.length) {
      el.innerHTML = '<div class="home-empty"><i data-lucide="inbox"></i><span>Sin actividad reciente</span></div>';
      if (window.lucide) lucide.createIcons();
      return;
    }
    el.innerHTML = data.map((r) => {
      const pct = (r.pct_ejecutado != null) ? ` · ${Math.round(r.pct_ejecutado)}% ejecutado` : '';
      return `
        <div class="tl-item">
          <span class="tl-node blue"></span>
          <div class="tl-body">
            <div class="tl-title">Reporte recibido — ${window.escapeHtml(r.nombre_proyecto || '—')}</div>
            <div class="tl-meta">Avance operativo${pct}</div>
          </div>
          <span class="tl-when">${timeAgo(r.fecha_reporte)}</span>
        </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    el.innerHTML = '<div class="home-empty"><i data-lucide="inbox"></i><span>Sin actividad reciente</span></div>';
    if (window.lucide) lucide.createIcons();
  }
}

/* ════════════════════════════════════════════════════════════════════
   ALERTAS DE CUMPLIMIENTO — reglas inteligentes por día/estado
   ════════════════════════════════════════════════════════════════════ */
function buildComplianceAlerts(projs, cfVencidasCount, sinReporteCount) {
  const alerts = [];
  const now = new Date();
  const dow = now.getDay(); // 0=dom 6=sáb
  const dayName = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][dow];

  // Day-of-week
  if (dow === 5) {
    alerts.push({ type: 'info', ico: 'calendar-check',
      t: 'Es viernes — sube el reporte semanal de Equipos',
      s: 'PDF/Excel del status de importaciones · Recordatorio operativo',
      href: 'index.html#equipos' });
  } else if (dow === 1) {
    alerts.push({ type: 'info', ico: 'sunrise',
      t: 'Inicio de semana — revisa avances del fin de semana',
      s: 'Confirma reportes pendientes',
      href: 'index.html#reportes' });
  } else if (dow === 0 || dow === 6) {
    alerts.push({ type: 'soft', ico: 'coffee',
      t: `Es ${dayName} — sin actividad operativa esperada`,
      s: 'Los reportes se reanudan el lunes', href: '#' });
  } else {
    alerts.push({ type: 'ok', ico: 'check-circle-2',
      t: `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} operativo`,
      s: 'Día regular de gestión PMO', href: '#' });
  }

  // CF vencidas
  if (cfVencidasCount > 0) {
    alerts.push({ type: 'crit', ico: 'alert-circle',
      t: `${cfVencidasCount} CF vencidas requieren atención`,
      s: 'Proyectos con fecha contractual pasada sin valorización completa',
      href: 'index.html#alertas' });
  }

  // Sin reporte
  if (sinReporteCount > 3) {
    alerts.push({ type: 'warn', ico: 'clipboard-x',
      t: `${sinReporteCount} proyectos sin reporte reciente`,
      s: 'Más de 24h sin actualización',
      href: 'index.html#alertas' });
  } else if (sinReporteCount > 0) {
    alerts.push({ type: 'warn', ico: 'clipboard-list',
      t: `${sinReporteCount} proyectos esperando reporte`,
      s: 'Verifica con supervisores',
      href: 'index.html#alertas' });
  }

  // Próximos a vencer (≤3 días)
  const next3 = projs.filter((p) => {
    if (!p.fecha_fin_contractual) return false;
    const d = window.daysUntil(p.fecha_fin_contractual);
    return d >= 0 && d <= 3;
  }).length;
  if (next3 > 0) {
    alerts.push({ type: 'warn', ico: 'clock',
      t: `${next3} proyecto${next3 > 1 ? 's' : ''} vence${next3 > 1 ? 'n' : ''} en ≤3 días`,
      s: 'Atención a la entrega contractual',
      href: 'index.html#proyectos' });
  }

  // All good fallback
  if (alerts.length <= 1) {
    alerts.push({ type: 'ok', ico: 'shield-check',
      t: 'Todo en orden operativo',
      s: 'Sin alertas críticas detectadas', href: '#' });
  }

  return alerts;
}

function renderComplianceAlerts(alerts) {
  const el = document.getElementById('alert-list');
  if (!el) return;
  el.innerHTML = alerts.map((a) => `
    <a href="${a.href}" class="compl-item" ${a.href === '#' ? 'onclick="event.preventDefault()"' : ''}>
      <div class="compl-ico ${a.type}">
        <i data-lucide="${a.ico}" class="ic"></i>
      </div>
      <div class="compl-content">
        <div class="compl-t">${window.escapeHtml(a.t)}</div>
        <div class="compl-s">${window.escapeHtml(a.s)}</div>
      </div>
      <i data-lucide="chevron-right" class="compl-arrow" style="width:16px;height:16px;stroke-width:1.8"></i>
    </a>
  `).join('');
  if (window.lucide) lucide.createIcons();
}

/* ════════════════════════════════════════════════════════════════════
   DÍAS AL CIERRE — mismo cálculo que el legacy (proximos30):
   fecha contractual a mediodía vs. hoy a medianoche, redondeado.
   Garantiza que "Por vencer · 30 días" del Inicio coincida con
   "Cierran en ≤30d" de la vista Alertas.
   ════════════════════════════════════════════════════════════════════ */
function legacyDaysTo(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

/* ════════════════════════════════════════════════════════════════════
   PARIDAD CON LA VISTA ALERTAS (index.legacy.html)
   Para que CF vencidas y Sin reporte den el MISMO número en ambas
   pantallas, replicamos aquí, byte a byte, la lógica del legacy:
   - parseD: fecha contractual a mediodía local (evita desfase UTC).
   - refDate (regla 6pm): antes de las 18h la referencia operativa es AYER.
   - normK: normaliza nombres de proyecto para casar reportes (PTO→PUERTO…).
   ════════════════════════════════════════════════════════════════════ */
function legacyParseD(s) {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + 'T12:00:00');
  return isNaN(d) ? null : d;
}
function legacyLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function legacyRefDate() {
  const ref = new Date();
  if (ref.getHours() < 18) ref.setDate(ref.getDate() - 1); // regla 6pm
  return legacyLocalISO(ref);
}
function normK(s) {
  return String(s || '').toUpperCase()
    .replace(/\bPTO\.?\b/g, 'PUERTO')
    .replace(/\bSTA\.?\b/g, 'SANTA')
    .replace(/[^A-Z0-9]/g, '');
}

/* ════════════════════════════════════════════════════════════════════
   DESGLOSE DE LA CARTERA ACTIVA POR ESTADO
   El indicador "Proyectos activos" sumaba 45 sin diferenciar el estado.
   Aquí se separa en un indicador independiente por cada estado real
   (En progreso, Por iniciar, Pendiente valorización, Cerrado c/obs, …),
   cada uno clicable con su propia ventana de detalle.
   ════════════════════════════════════════════════════════════════════ */
function estadoAccent(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('progreso')) return '#1f9a82';
  if (e.includes('iniciar') || e.includes('por inic')) return '#2E7DD1';
  if (e.includes('valoriz')) return '#c98800';
  if (e.includes('obs')) return '#e0883a';
  if (e.includes('suspend') || e.includes('paus') || e.includes('anula') || e.includes('cancel')) return '#94a3b8';
  if (e.includes('cerr') || e.includes('final') || e.includes('entreg')) return '#64748b';
  return '#6b7c93';
}

function renderEstadoSplit(projs) {
  const el = document.getElementById('estado-split');
  const totalEl = document.getElementById('split-total');
  if (totalEl) totalEl.textContent = projs.length;
  if (!el) return;

  // Agrupar por estado
  const groups = {};
  projs.forEach((p) => {
    const est = (p.estado || 'Sin estado').trim();
    (groups[est] = groups[est] || []).push(p);
  });

  // Orden: mayor cantidad primero
  const ordered = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  window._kpiDetails = window._kpiDetails || {};

  el.innerHTML = ordered.map(([est, list]) => {
    const accent = estadoAccent(est);
    const key = 'est:' + est;
    // Registrar el detalle clicable de este estado
    window._kpiDetails[key] = {
      title: est, ico: 'folder-kanban', accent,
      href: '#proyectos', hrefLabel: 'Ver proyectos',
      empty: 'Sin proyectos en este estado',
      rows: list.map((p) => ({
        name: p.nombre || '—',
        meta: p._valp != null ? `${Math.round(p._valp)}% avance` : '',
      })),
    };
    return `
      <a class="est-chip" style="--eacc:${accent}" data-kpi="${window.escapeHtml(key)}" href="#proyectos">
        <span class="est-num">${list.length}</span>
        <span class="est-lbl">${window.escapeHtml(est)}</span>
      </a>`;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

/* ════════════════════════════════════════════════════════════════════
   VENTANA FLOTANTE DE DETALLE POR KPI
   Al hacer clic en un indicador del Inicio se abre un popover pequeño
   con la lista de proyectos/alertas que componen ese número.
   ════════════════════════════════════════════════════════════════════ */
function buildKpiDetails(ctx) {
  const projRow = (p, metaFn) => ({
    name: p.nombre || '—',
    meta: metaFn ? metaFn(p) : '',
  });
  const avance = (p) =>
    p._valp != null ? ` · ${Math.round(p._valp)}% avance` : '';

  window._kpiDetails = {
    activos: {
      title: 'Proyectos activos', ico: 'folder-kanban', accent: '#2E7DD1',
      href: '#proyectos', hrefLabel: 'Ver todos los proyectos',
      empty: 'Sin proyectos activos',
      rows: ctx.projs.map((p) => projRow(p, (x) => (x.estado || '—') + avance(x))),
    },
    porvencer: {
      title: 'Por vencer · 30 días', ico: 'calendar-clock', accent: '#c98800',
      href: '#alertas', hrefLabel: 'Ver en Alertas',
      empty: 'Ningún proyecto en progreso vence en los próximos 30 días',
      rows: ctx.porVencer30List.map((p) => projRow(p, (x) => {
        const d = legacyDaysTo(x.fecha_fin_contractual);
        const when = d === 0 ? 'Vence hoy' : d === 1 ? 'Vence mañana' : `Cierra en ${d} días`;
        return when + avance(x);
      })),
    },
    alertas: {
      title: 'Alertas activas', ico: 'bell-ring', accent: '#dc2626',
      href: '#alertas', hrefLabel: 'Ver todas las alertas',
      empty: 'Sin alertas activas',
      rows: ctx.alerts.map((a) => ({ name: a.t, meta: a.s, sev: a.type })),
    },
    sin: {
      title: 'Sin reporte', ico: 'clipboard-list', accent: '#c98800',
      href: '#reportes', hrefLabel: 'Ir a Reportes',
      empty: 'Todos los proyectos en progreso reportaron',
      rows: ctx.sinReporteList.map((p) => projRow(p, (x) => x.estado || 'En progreso')),
    },
    val: {
      title: 'Valorización', ico: 'banknote', accent: '#1f9a82',
      href: '#valorizacion', hrefLabel: 'Ir a Valorización',
      empty: 'Sin proyectos en valorización',
      rows: ctx.valorizacionList.map((p) => projRow(p, (x) => x.estado || '—')),
    },
    cf: {
      title: 'CF vencidas', ico: 'calendar-x-2', accent: '#dc2626',
      href: '#valorizacion', hrefLabel: 'Ir a Valorización',
      empty: 'Sin fechas contractuales vencidas',
      rows: ctx.cfVencidasList.map((p) => projRow(p, (x) => {
        const d = legacyDaysTo(x.fecha_fin_contractual);
        const over = d != null && d < 0 ? `Venció hace ${-d} días` : 'Vencida';
        return over + avance(x);
      })),
    },
  };
}

function closeKpiPopover() {
  const p = document.getElementById('kpi-pop');
  if (p) p.remove();
}

function openKpiPopover(key, anchorEl) {
  const d = (window._kpiDetails || {})[key];
  if (!d) return;
  closeKpiPopover();

  const MAX = 8;
  const shown = d.rows.slice(0, MAX);
  const extra = d.rows.length - shown.length;

  const pop = document.createElement('div');
  pop.className = 'kpi-pop';
  pop.id = 'kpi-pop';
  pop.innerHTML = `
    <div class="kpi-pop-head" style="--kacc:${d.accent}">
      <span class="kpi-pop-ic"><i data-lucide="${d.ico}"></i></span>
      <div class="kpi-pop-ttl">${window.escapeHtml(d.title)}</div>
      <span class="kpi-pop-cnt">${d.rows.length}</span>
      <button class="kpi-pop-x" aria-label="Cerrar"><i data-lucide="x"></i></button>
    </div>
    <div class="kpi-pop-body">
      ${shown.length ? shown.map((r) => `
        <div class="kpi-pop-row">
          ${r.sev ? `<span class="kpi-pop-dot ${r.sev}"></span>` : ''}
          <div class="kpi-pop-rmain">
            <div class="kpi-pop-rname">${window.escapeHtml(r.name)}</div>
            ${r.meta ? `<div class="kpi-pop-rmeta">${window.escapeHtml(r.meta)}</div>` : ''}
          </div>
        </div>`).join('')
      : `<div class="kpi-pop-empty">${window.escapeHtml(d.empty)}</div>`}
      ${extra > 0 ? `<div class="kpi-pop-more">+${extra} más…</div>` : ''}
    </div>
    <a class="kpi-pop-foot" href="${d.href}">${window.escapeHtml(d.hrefLabel)} <i data-lucide="arrow-right"></i></a>`;
  document.body.appendChild(pop);

  // Posición (fixed) anclada bajo el KPI, sin salirse del viewport
  const r = anchorEl.getBoundingClientRect();
  const pw = 300, margin = 10;
  let left = r.left;
  if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
  if (left < margin) left = margin;
  pop.style.left = left + 'px';
  pop.style.top = (r.bottom + 8) + 'px';

  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - margin) {
      const above = r.top - pr.height - 8;
      if (above > margin) pop.style.top = above + 'px';
    }
    pop.classList.add('show');
  });

  pop.querySelector('.kpi-pop-foot').addEventListener('click', () => closeKpiPopover());
  pop.querySelector('.kpi-pop-x').addEventListener('click', (e) => { e.preventDefault(); closeKpiPopover(); });
  if (window.lucide) lucide.createIcons();
}

function initKpiPopover() {
  if (window._kpiPopInit) return;
  window._kpiPopInit = true;
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-kpi]');
    if (card) {
      e.preventDefault();
      openKpiPopover(card.getAttribute('data-kpi'), card);
      return;
    }
    if (!e.target.closest('#kpi-pop')) closeKpiPopover();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeKpiPopover(); });
  window.addEventListener('scroll', closeKpiPopover, true);
  window.addEventListener('resize', closeKpiPopover);
}

// ── Boot ──
window.loadDashboard();
