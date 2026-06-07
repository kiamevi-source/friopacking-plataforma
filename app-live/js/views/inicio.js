/* ════════════════════════════════════════════════════════════════════
   views/inicio.js — KPIs, vencimientos, alertas de cumplimiento
   Dependencias: core.js (sb, escapeHtml, animateNumber, fmtDateShort, daysUntil)
   Expone: window.loadDashboard
   ════════════════════════════════════════════════════════════════════ */

window.loadDashboard = async function () {
  if (!window.sb) return;
  try {
    const today = new Date();
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - 1);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

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

    // Reports recientes — la tabla `reportes` se enlaza por `nombre_proyecto` (no proyecto_id)
    const { data: reps, error: e2 } = await window.sb
      .from('reportes')
      .select('nombre_proyecto,fecha_reporte')
      .gte('fecha_reporte', cutoffIso);
    if (e2) console.warn('reportes fetch error', e2);

    const reportedSet = new Set(
      (reps || []).map((r) => (r.nombre_proyecto || '').trim().toUpperCase()).filter(Boolean)
    );

    // KPI 1 — Sin reporte (solo proyectos en progreso, no todos los activos)
    const sinReporte = enProgreso.filter(
      (p) => !reportedSet.has((p.nombre || '').trim().toUpperCase())
    ).length;
    const elSin = document.getElementById('kpi-sin');
    elSin.innerHTML = '0';
    window.animateNumber(elSin, sinReporte);

    // KPI 2 — Valorización (estado contiene PEND VAL o VALORIZ)
    const valorizacion = projs.filter((p) => {
      const e = (p.estado || '').toUpperCase();
      return e.includes('PEND VAL') || e.includes('VALORIZ');
    }).length;
    const elVal = document.getElementById('kpi-val');
    elVal.innerHTML = '0';
    window.animateNumber(elVal, valorizacion);

    // KPI 3 — CF Vencidas (fin contractual pasado y val < 99%)
    const cfVencidas = projs.filter((p) => {
      if (!p.fecha_fin_contractual) return false;
      const cf = new Date(p.fecha_fin_contractual);
      return cf < today && (p.valorizacion_pct || 0) < 99;
    }).length;
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
    const complianceAlerts = buildComplianceAlerts(projs, reportedSet, cfVencidas, sinReporte);
    renderComplianceAlerts(complianceAlerts);

    // ── Hero stats (alto nivel) ──
    setNum('stat-activos', projs.length);
    const porVencer30 = projs.filter((p) => {
      if (!p.fecha_fin_contractual) return false;
      const d = window.daysUntil(p.fecha_fin_contractual);
      return d >= 0 && d <= 30;
    }).length;
    setNum('stat-porvencer', porVencer30);
    const alertasActivas = complianceAlerts.filter((a) => a.type === 'crit' || a.type === 'warn').length;
    setNum('stat-alertas', alertasActivas);
    renderEstado(cfVencidas, sinReporte, next3);

    // ── Proyectos críticos ──
    renderCriticos(projs, enProgreso, reportedSet, today);

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

function renderCriticos(projs, enProgreso, reportedSet, today) {
  const el = document.getElementById('crit-list');
  if (!el) return;
  const enProgSet = new Set(enProgreso.map((p) => p.id));

  const rows = [];
  projs.forEach((p) => {
    const chips = [];
    let severity = 0; // 1=warn 2=crit

    // CF vencida (fin contractual pasado + valorización < 99%)
    if (p.fecha_fin_contractual) {
      const cf = new Date(p.fecha_fin_contractual);
      if (cf < today && (p.valorizacion_pct || 0) < 99) {
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

    // Sin reporte (solo proyectos en progreso)
    if (enProgSet.has(p.id) && !reportedSet.has((p.nombre || '').trim().toUpperCase())) {
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
function buildComplianceAlerts(projs, reportedSet, cfVencidasCount, sinReporteCount) {
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
      href: 'index.html#cf-vencidas' });
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

// ── Boot ──
window.loadDashboard();
