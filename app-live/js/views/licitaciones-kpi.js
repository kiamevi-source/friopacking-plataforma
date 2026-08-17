/* ════════════════════════════════════════════════════════════════════
   views/licitaciones-kpi.js — Panel de KPIs de Licitación en el Home.
   Fuente única: vista `v_lic_kpis` (PMO). No rediseña el dashboard: solo
   alimenta el panel #lic-kpi-panel con indicadores en vivo (§18).
   Dependencias: core.js (window.sb), lucide (opcional)
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function money(n) {
    n = Number(n || 0);
    var neg = n < 0; var a = Math.abs(n);
    var s = a >= 1000 ? (a / 1000).toLocaleString('es-PE', { maximumFractionDigits: 0 }) + 'k' : String(a);
    return (neg ? '−' : '') + 'S/ ' + s;
  }

  function cell(num, lbl, sub, color) {
    return '<a href="#licitaciones" class="lic-kpi-cell" style="text-decoration:none;background:linear-gradient(180deg,#fff,#fcfdfe);border:1px solid rgba(15,23,42,.08);border-radius:12px;padding:13px 14px;display:block;box-shadow:0 1px 2px rgba(15,23,42,.05);transition:transform .15s,box-shadow .15s">' +
      '<div style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:' + color + '">' + num + '</div>' +
      '<div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-top:6px;line-height:1.2">' + lbl + '</div>' +
      (sub ? '<div style="font-size:11px;color:#64748b;font-weight:600;margin-top:3px">' + sub + '</div>' : '') +
      '</a>';
  }

  async function loadLicKpis() {
    var wrap = document.getElementById('lic-kpi-row');
    if (!wrap || !window.sb) return;
    try {
      var r = await window.sb.from('v_lic_kpis').select('*').single();
      if (r.error) throw r.error;
      var k = r.data || {};
      var ahorro = Number(k.ahorro || 0);
      var retr = Number(k.retrasadas || 0);
      wrap.innerHTML = [
        cell(k.activas || 0, 'Activas', (k.abiertas || 0) + ' abiertas · ' + (k.en_evaluacion || 0) + ' en eval.', '#0f1e35'),
        cell(money(k.monto_proceso), 'En proceso', 'presupuesto en curso', '#0ea5a4'),
        cell(money(k.monto_adjudicado), 'Adjudicado', (k.adjudicadas || 0) + ' contrato(s)', '#10b981'),
        cell(money(ahorro), 'Ahorro vs presup.', 'en adjudicadas', ahorro >= 0 ? '#10b981' : '#e2685f'),
        cell((k.tasa_adjudicacion != null ? k.tasa_adjudicacion : '—') + '%', 'Tasa adjudicación', (k.dias_promedio != null ? k.dias_promedio + 'd promedio' : ''), '#2E7DD1'),
        cell(retr + ' / ' + (k.por_vencer || 0), 'Retrasadas / por vencer', (k.contratistas_participantes || 0) + ' contratistas', retr > 0 ? '#e2685f' : '#64748b')
      ].join('');
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.warn('[lic-kpi]', e);
      wrap.innerHTML = '<div style="grid-column:1/-1;color:#94a3b8;font-size:12px;font-weight:600;padding:10px">No se pudieron cargar los KPIs de licitación.</div>';
    }
  }

  window.loadLicKpis = loadLicKpis;
  loadLicKpis();
})();
