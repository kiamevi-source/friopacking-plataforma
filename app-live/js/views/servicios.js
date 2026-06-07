/* ════════════════════════════════════════════════════════════════════
   views/servicios.js — Portafolio de Servicios (portado del
   "Dashboard de Servicios v9"). Vista nativa de app-live alimentada en
   vivo por la tabla `portafolio_servicios` de Supabase (PMO).

   Sub-vistas:
     1. Vista Ejecutiva       — KPIs del portafolio
     2. Próximos sin Contratar — servicios Pendiente/Licitación por urgencia
     3. Matriz Operativa      — Cliente × Especialidad → Contratista

   Dependencias: core.js (window.sb, escapeHtml), lucide (opcional)
   Expone: window.loadServicios
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Reglas de negocio (idénticas al dashboard original) ──
  var ACTIVE = ['Proceso', 'Cierre'];
  var FUTURE = ['Por Iniciar'];
  var CONTRACTED_SIT = ['Contratado'];
  var PENDING_SIT = ['Pendiente', 'Licitación'];
  var DONE = ['Concluído', 'Concluido', 'Terminado'];
  // Año de temporada: las fechas vienen como "30-Abr" (sin año) → se asume 2026.
  var SEASON_YEAR = 2026;

  var esc = window.escapeHtml || function (s) { return String(s == null ? '' : s); };

  // ── Estado del módulo ──
  var DATA = null;          // filas crudas mapeadas
  var built = false;        // shell construido
  var sub = 'ejecutiva';    // sub-vista activa
  var matState = { q: '', est: '' };
  var urgState = { sit: '', cli: '', esp: '', sup: '', view: 'inicio' };

  // ── Helpers de fecha ──
  var MES = {
    ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
    jul: 6, ago: 7, set: 8, sep: 8, oct: 9, nov: 10, dic: 11
  };
  function parseFecha(s) {
    if (!s || s === '—') return null;
    s = String(s).trim();
    // ISO yyyy-mm-dd
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) { var d0 = new Date(+iso[1], +iso[2] - 1, +iso[3], 12); return isNaN(d0) ? null : d0; }
    // "DD-Mon" / "DD Mon" / "DD/Mon" (mes en español abreviado)
    var m = s.match(/^(\d{1,2})[\s\-\/]+([a-záéíóú]{3,})/i);
    if (m) {
      var dd = +m[1];
      var mon = m[2].toLowerCase().slice(0, 3).replace('á', 'a').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('ú', 'u');
      if (mon in MES) { var d1 = new Date(SEASON_YEAR, MES[mon], dd, 12); return isNaN(d1) ? null : d1; }
    }
    var dg = new Date(s);
    return isNaN(dg) ? null : dg;
  }
  function today() { var t = new Date(); t.setHours(12, 0, 0, 0); return t; }
  function daysDiff(d) { if (!d) return null; return Math.round((d - today()) / 86400000); }
  function fm(d) {
    if (!d) return '—';
    try { return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }); }
    catch (e) { return '—'; }
  }
  function uniq(arr) { return arr.filter(function (v, i) { return v && arr.indexOf(v) === i; }); }

  // ════════════════════════════════════════════════════════════════
  //  CSS (scoped a #view-servicios)
  // ════════════════════════════════════════════════════════════════
  function injectCss() {
    if (document.getElementById('fp-serv-css')) return;
    var s = document.createElement('style');
    s.id = 'fp-serv-css';
    s.textContent = [
      '#view-servicios{--brand:#0ea5a4;--navy:#0f1e35;--t2:#475569;--t3:#94a3b8;--bd:rgba(15,23,42,.08);--surf:#fff;font-family:Manrope,system-ui,sans-serif;color:var(--navy)}',
      '.sv-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}',
      '.sv-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0ea5a4}',
      '.sv-eyebrow .dot{width:7px;height:7px;border-radius:50%;background:#3ECBB0;box-shadow:0 0 0 3px rgba(62,203,176,.18)}',
      '.sv-h1{font-size:24px;font-weight:800;letter-spacing:-.5px;margin:6px 0 2px}',
      '.sv-sub{font-size:13px;color:var(--t2);font-weight:500}',
      '.sv-tabs{display:inline-flex;gap:4px;background:#f1f5f9;border:1px solid var(--bd);border-radius:12px;padding:4px}',
      '.sv-tab{appearance:none;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:var(--t2);padding:8px 14px;border-radius:9px;display:inline-flex;align-items:center;gap:7px;transition:.15s}',
      '.sv-tab:hover{color:var(--navy)}',
      '.sv-tab.active{background:#fff;color:#0f1e35;box-shadow:0 1px 2px rgba(15,23,42,.10),0 2px 8px -4px rgba(15,23,42,.18)}',
      '.sv-tab .cnt{font-size:11px;font-weight:800;background:rgba(14,165,164,.12);color:#0a8f8e;padding:1px 7px;border-radius:20px}',
      '.sv-pane{display:none;animation:svfade .25s ease both}',
      '.sv-pane.on{display:block}',
      '@keyframes svfade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      // KPI cards
      '.sv-kgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}',
      '@media(max-width:1200px){.sv-kgrid{grid-template-columns:repeat(3,1fr)}}',
      '@media(max-width:680px){.sv-kgrid{grid-template-columns:repeat(2,1fr)}}',
      '.sv-kc{position:relative;overflow:hidden;background:linear-gradient(180deg,#fff,#fcfdfe);border:1px solid var(--bd);border-radius:14px;padding:15px 16px;box-shadow:0 1px 2px rgba(15,23,42,.05);transition:.18s}',
      '.sv-kc:hover{transform:translateY(-2px);box-shadow:0 12px 28px -14px rgba(15,23,42,.22)}',
      '.sv-kc .tl{position:absolute;top:0;left:0;right:0;height:3px}',
      '.sv-kc .ico{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:10px}',
      '.sv-kc .ico i{width:18px;height:18px}',
      '.sv-kc .num{font-size:30px;font-weight:800;line-height:1;letter-spacing:-1px}',
      '.sv-kc .lbl{font-size:10.5px;font-weight:800;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-top:8px}',
      '.sv-kc .sub{font-size:11.5px;color:var(--t2);margin-top:5px;font-weight:600}',
      '.sv-secttl{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);margin:18px 0 10px}',
      // controls
      '.sv-ctrls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}',
      '.sv-ctrls input,.sv-ctrls select{font-family:inherit;font-size:13px;height:36px;padding:0 12px;border:1px solid var(--bd);border-radius:10px;background:#fff;color:var(--navy);font-weight:600}',
      '.sv-ctrls input{min-width:200px}',
      '.sv-ctrls input:focus,.sv-ctrls select:focus{outline:none;border-color:#3ECBB0;box-shadow:0 0 0 3px rgba(62,203,176,.15)}',
      // urgentes
      '.sv-ulist{display:flex;flex-direction:column;gap:10px}',
      '.sv-uc{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--bd);border-left-width:4px;border-radius:13px;padding:13px 16px;box-shadow:0 1px 2px rgba(15,23,42,.05);transition:.15s}',
      '.sv-uc:hover{transform:translateY(-1px);box-shadow:0 10px 24px -14px rgba(15,23,42,.25)}',
      '.sv-uc.crit{border-left-color:#ef4444}.sv-uc.high{border-left-color:#f97316}.sv-uc.med{border-left-color:#f59e0b}.sv-uc.low{border-left-color:#cbd5e1}',
      '.sv-ud{flex-shrink:0;width:62px;text-align:center}',
      '.sv-ud .n{font-size:21px;font-weight:800;line-height:1;letter-spacing:-.5px}',
      '.sv-ud .l{font-size:10px;color:var(--t3);font-weight:700;margin-top:3px;text-transform:uppercase;letter-spacing:.03em}',
      '.sv-uc.crit .sv-ud .n{color:#dc2626}.sv-uc.high .sv-ud .n{color:#ea580c}.sv-uc.med .sv-ud .n{color:#d97706}',
      '.sv-ui{flex:1;min-width:0}',
      '.sv-ui .cli{font-size:14.5px;font-weight:800}',
      '.sv-ui .meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:5px;font-size:12px;color:var(--t2);font-weight:600}',
      '.sv-ui .meta i{width:13px;height:13px;vertical-align:-2px;margin-right:3px}',
      '.sv-ur{flex-shrink:0;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:5px}',
      '.sv-badge{font-size:11px;font-weight:800;padding:4px 11px;border-radius:20px;letter-spacing:.02em}',
      '.s-pend{background:#fef3c7;color:#b45309}.s-licit{background:#ede9fe;color:#7c3aed}.s-venc{background:#fee2e2;color:#dc2626}',
      // matriz
      '.sv-mwrap{overflow:auto;border:1px solid var(--bd);border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.05)}',
      '.sv-mt{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}',
      '.sv-mt th,.sv-mt td{padding:9px 11px;border-bottom:1px solid var(--bd);white-space:nowrap;text-align:center}',
      '.sv-mt thead th{position:sticky;top:0;background:#f8fafc;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--t2);z-index:2}',
      '.sv-mt th.rh,.sv-mt td.rh{position:sticky;left:0;background:#fff;text-align:left;font-weight:800;z-index:1;box-shadow:1px 0 0 var(--bd)}',
      '.sv-mt thead th.rh{z-index:3;background:#f8fafc}',
      '.sv-mt tbody tr:hover td{background:#f8fafc}.sv-mt tbody tr:hover td.rh{background:#f1f5f9}',
      '.sv-cell{display:inline-block;padding:3px 9px;border-radius:9px;font-size:10.5px;font-weight:700;max-width:120px;overflow:hidden;text-overflow:ellipsis}',
      '.sv-empty{padding:40px;text-align:center;color:var(--t3);font-weight:600;background:#fff;border:1px solid var(--bd);border-radius:14px}',
      '.sv-empty i{width:34px;height:34px;display:block;margin:0 auto 10px;color:#cbd5e1}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── KPI card builder ──
  var CM = {
    brand: ['#0ea5a4', '#ccfbf1'], blue: ['#3b82f6', '#dbeafe'], amber: ['#f59e0b', '#fef3c7'],
    green: ['#10b981', '#d1fae5'], red: ['#ef4444', '#fee2e2'], purple: ['#8b5cf6', '#ede9fe'],
    orange: ['#f97316', '#fed7aa'], gray: ['#64748b', '#f1f5f9'], navy: ['#0f1e35', '#e2e8f0']
  };
  function kc(o) {
    var c = (CM[o.color] || CM.brand);
    return '<div class="sv-kc">' +
      '<div class="tl" style="background:' + c[0] + '"></div>' +
      '<div class="ico" style="background:' + c[1] + ';color:' + c[0] + '"><i data-lucide="' + o.icon + '"></i></div>' +
      '<div class="num" style="color:' + c[0] + '">' + o.value + '</div>' +
      '<div class="lbl">' + esc(o.label) + '</div>' +
      (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : '') +
      '</div>';
  }

  // ════════════════════════════════════════════════════════════════
  //  Shell
  // ════════════════════════════════════════════════════════════════
  function buildShell() {
    var root = document.getElementById('view-servicios');
    if (!root) return;
    var pend = DATA.filter(function (p) { return PENDING_SIT.indexOf(p.sit) >= 0; }).length;
    root.innerHTML =
      '<div class="header-deco"></div>' +
      '<div class="sv-head">' +
        '<div>' +
          '<span class="sv-eyebrow"><span class="dot"></span>Portafolio · Contratas & Servicios</span>' +
          '<h1 class="sv-h1">Servicios</h1>' +
          '<div class="sv-sub">' + DATA.length + ' servicios · ' + uniq(DATA.map(function (p) { return p.cli; })).length + ' clientes · datos en vivo de Supabase</div>' +
        '</div>' +
        '<div class="sv-tabs">' +
          '<button class="sv-tab" data-sub="ejecutiva"><i data-lucide="layout-dashboard"></i>Vista Ejecutiva</button>' +
          '<button class="sv-tab" data-sub="urgentes"><i data-lucide="clock-alert"></i>Próximos sin Contratar <span class="cnt">' + pend + '</span></button>' +
          '<button class="sv-tab" data-sub="matriz"><i data-lucide="layout-grid"></i>Matriz Operativa</button>' +
        '</div>' +
      '</div>' +
      '<div class="sv-pane" id="sv-pane-ejecutiva"></div>' +
      '<div class="sv-pane" id="sv-pane-urgentes"></div>' +
      '<div class="sv-pane" id="sv-pane-matriz"></div>';

    root.querySelectorAll('.sv-tab').forEach(function (b) {
      b.addEventListener('click', function () { setSub(b.getAttribute('data-sub')); });
    });
    built = true;
  }

  function setSub(name) {
    sub = name;
    document.querySelectorAll('#view-servicios .sv-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-sub') === name);
    });
    document.querySelectorAll('#view-servicios .sv-pane').forEach(function (p) {
      p.classList.toggle('on', p.id === 'sv-pane-' + name);
    });
    if (name === 'ejecutiva') renderEjecutiva();
    else if (name === 'urgentes') renderUrgentes();
    else if (name === 'matriz') renderMatriz();
    if (window.lucide) lucide.createIcons();
  }

  // ════════════════════════════════════════════════════════════════
  //  1 · Vista Ejecutiva
  // ════════════════════════════════════════════════════════════════
  function renderEjecutiva() {
    var P = DATA;
    var total = P.length;
    var clis = uniq(P.map(function (p) { return p.cli; })).length;
    var conts = uniq(P.map(function (p) { return p.con; })).length;
    var esps = uniq(P.map(function (p) { return p.esp; })).length;
    var sups = uniq(P.map(function (p) { return p.sup; })).length;

    var contratado = P.filter(function (p) { return CONTRACTED_SIT.indexOf(p.sit) >= 0; }).length;
    var pendiente = P.filter(function (p) { return p.sit === 'Pendiente'; }).length;
    var licit = P.filter(function (p) { return p.sit === 'Licitación'; }).length;
    var sinContratar = pendiente + licit;
    var enProceso = P.filter(function (p) { return p.est === 'Proceso'; }).length;
    var porIniciar = P.filter(function (p) { return FUTURE.indexOf(p.est) >= 0; }).length;
    var concl = P.filter(function (p) { return DONE.indexOf(p.est) >= 0; }).length;
    var obs = P.filter(function (p) { return p.est === 'Obs'; }).length;

    // Riesgo por fecha (servicios contratados/activos cuyo fin está cerca)
    var venc7 = P.filter(function (p) {
      var d = daysDiff(p.finD); return d !== null && d >= 0 && d <= 7 && ACTIVE.indexOf(p.est) >= 0;
    }).length;
    var sinFecha = P.filter(function (p) { return !p.finD && !p.iniD; }).length;
    var pctContrat = total ? Math.round(contratado / total * 100) : 0;

    var html =
      '<div class="sv-secttl">Resumen del portafolio</div>' +
      '<div class="sv-kgrid">' +
        kc({ label: 'Servicios totales', value: total, icon: 'layers', color: 'navy' }) +
        kc({ label: 'Clientes', value: clis, icon: 'building-2', color: 'blue' }) +
        kc({ label: 'Contratistas', value: conts, icon: 'hard-hat', color: 'purple' }) +
        kc({ label: 'Especialidades', value: esps, icon: 'wrench', color: 'brand' }) +
        kc({ label: 'Supervisores', value: sups, icon: 'user-check', color: 'gray' }) +
      '</div>' +
      '<div class="sv-secttl">Situación de contratación</div>' +
      '<div class="sv-kgrid">' +
        kc({ label: 'Contratados', value: contratado, icon: 'file-check-2', color: 'green', sub: pctContrat + '% del portafolio' }) +
        kc({ label: 'Sin contratar', value: sinContratar, icon: 'clock-alert', color: 'amber', sub: pendiente + ' pend · ' + licit + ' licit' }) +
        kc({ label: 'En proceso', value: enProceso, icon: 'activity', color: 'blue' }) +
        kc({ label: 'Por iniciar', value: porIniciar, icon: 'play', color: 'orange' }) +
        kc({ label: 'Concluidos', value: concl, icon: 'circle-check', color: 'gray', sub: obs ? obs + ' con observaciones' : '' }) +
      '</div>' +
      '<div class="sv-secttl">Señales de riesgo</div>' +
      '<div class="sv-kgrid">' +
        kc({ label: 'Vencen ≤ 7 días', value: venc7, icon: 'calendar-clock', color: venc7 ? 'red' : 'green', sub: 'Servicios activos' }) +
        kc({ label: 'Licitación abierta', value: licit, icon: 'gavel', color: 'purple' }) +
        kc({ label: 'Con observaciones', value: obs, icon: 'alert-triangle', color: obs ? 'amber' : 'gray' }) +
        kc({ label: 'Sin fechas', value: sinFecha, icon: 'calendar-off', color: 'gray', sub: 'Requieren completar' }) +
        kc({ label: 'Cobertura datos', value: (total ? Math.round((total - sinFecha) / total * 100) : 0) + '%', icon: 'database', color: 'brand', sub: 'con al menos una fecha' }) +
      '</div>';

    document.getElementById('sv-pane-ejecutiva').innerHTML = html;
  }

  // ════════════════════════════════════════════════════════════════
  //  2 · Próximos sin Contratar
  // ════════════════════════════════════════════════════════════════
  function fillSelect(sel, opts, cur) {
    sel.innerHTML = '<option value="">' + sel.getAttribute('data-ph') + '</option>' +
      opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }

  function renderUrgentes() {
    var pane = document.getElementById('sv-pane-urgentes');
    var base = DATA.filter(function (p) { return PENDING_SIT.indexOf(p.sit) >= 0; });

    var totalPend = base.filter(function (p) { return p.sit === 'Pendiente'; }).length;
    var totalLicit = base.filter(function (p) { return p.sit === 'Licitación'; }).length;
    var vencidos = base.filter(function (p) { return p.iniD && daysDiff(p.iniD) < 0; }).length;
    var ini7 = base.filter(function (p) { var d = p.iniD && daysDiff(p.iniD); return d !== null && d >= 0 && d <= 7; }).length;
    var ini30 = base.filter(function (p) { var d = p.iniD && daysDiff(p.iniD); return d !== null && d >= 0 && d <= 30; }).length;
    var sinFecha = base.filter(function (p) { return !p.iniD; }).length;

    if (!pane.__init) {
      pane.innerHTML =
        '<div class="sv-kgrid">' +
          '<div id="svu-k-pend"></div><div id="svu-k-licit"></div><div id="svu-k-venc"></div>' +
          '<div id="svu-k-7"></div><div id="svu-k-30"></div>' +
        '</div>' +
        '<div class="sv-ctrls">' +
          '<select id="svu-sit" data-ph="Toda situación"></select>' +
          '<select id="svu-cli" data-ph="Todos los clientes"></select>' +
          '<select id="svu-esp" data-ph="Toda especialidad"></select>' +
          '<select id="svu-sup" data-ph="Todos los supervisores"></select>' +
        '</div>' +
        '<div class="sv-ulist" id="svu-list"></div>';
      ['sit', 'cli', 'esp', 'sup'].forEach(function (k) {
        var el = pane.querySelector('#svu-' + k);
        el.addEventListener('change', function () { urgState[k] = el.value; renderUrgentesList(); });
      });
      pane.__init = true;
    }

    document.getElementById('svu-k-pend').outerHTML = '<div id="svu-k-pend">' + kc({ label: 'Pendientes', value: totalPend, icon: 'clock', color: 'amber' }) + '</div>';
    document.getElementById('svu-k-licit').outerHTML = '<div id="svu-k-licit">' + kc({ label: 'En licitación', value: totalLicit, icon: 'gavel', color: 'purple' }) + '</div>';
    document.getElementById('svu-k-venc').outerHTML = '<div id="svu-k-venc">' + kc({ label: 'Ya iniciados', value: vencidos, icon: 'flag', color: vencidos ? 'red' : 'gray', sub: 'sin contratista' }) + '</div>';
    document.getElementById('svu-k-7').outerHTML = '<div id="svu-k-7">' + kc({ label: 'Inician ≤ 7 días', value: ini7, icon: 'alarm-clock', color: ini7 ? 'orange' : 'gray' }) + '</div>';
    document.getElementById('svu-k-30').outerHTML = '<div id="svu-k-30">' + kc({ label: 'Inician ≤ 30 días', value: ini30, icon: 'calendar-days', color: 'blue', sub: sinFecha + ' sin fecha' }) + '</div>';

    fillSelect(pane.querySelector('#svu-sit'), ['Pendiente', 'Licitación'], urgState.sit);
    fillSelect(pane.querySelector('#svu-cli'), uniq(base.map(function (p) { return p.cli; })).sort(), urgState.cli);
    fillSelect(pane.querySelector('#svu-esp'), uniq(base.map(function (p) { return p.esp; })).sort(), urgState.esp);
    fillSelect(pane.querySelector('#svu-sup'), uniq(base.map(function (p) { return p.sup; })).sort(), urgState.sup);

    renderUrgentesList();
  }

  function renderUrgentesList() {
    var list = DATA.filter(function (p) { return PENDING_SIT.indexOf(p.sit) >= 0; });
    if (urgState.sit) list = list.filter(function (p) { return p.sit === urgState.sit; });
    if (urgState.cli) list = list.filter(function (p) { return p.cli === urgState.cli; });
    if (urgState.esp) list = list.filter(function (p) { return p.esp === urgState.esp; });
    if (urgState.sup) list = list.filter(function (p) { return p.sup === urgState.sup; });

    list.sort(function (a, b) {
      var da = a.iniD, db = b.iniD;
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return da - db;
    });

    var el = document.getElementById('svu-list');
    if (!list.length) {
      el.innerHTML = '<div class="sv-empty"><i data-lucide="circle-check"></i>Sin servicios pendientes con los filtros seleccionados</div>';
      if (window.lucide) lucide.createIcons();
      return;
    }

    el.innerHTML = list.map(function (p) {
      var d = p.iniD ? daysDiff(p.iniD) : null;
      var cls = 'low', disp = '—', lbl = 'sin fecha';
      if (d !== null) {
        if (d < 0) { cls = 'crit'; disp = Math.abs(d) + 'd'; lbl = 'iniciado'; }
        else if (d <= 7) { cls = 'crit'; disp = d + 'd'; lbl = 'al inicio'; }
        else if (d <= 14) { cls = 'high'; disp = d + 'd'; lbl = 'al inicio'; }
        else if (d <= 30) { cls = 'med'; disp = d + 'd'; lbl = 'al inicio'; }
        else { cls = 'low'; disp = d + 'd'; lbl = 'al inicio'; }
      }
      var sCls = p.sit === 'Licitación' ? 's-licit' : 's-pend';
      var vencBadge = (d !== null && d < 0) ? '<span class="sv-badge s-venc">YA INICIADO</span>' : '';
      return '<div class="sv-uc ' + cls + '">' +
        '<div class="sv-ud"><div class="n">' + disp + '</div><div class="l">' + lbl + '</div></div>' +
        '<div class="sv-ui">' +
          '<div class="cli">' + esc(p.cli) + ' · <span style="color:var(--t2);font-weight:700">' + esc(p.esp) + '</span></div>' +
          '<div class="meta">' +
            '<span><i data-lucide="calendar-plus"></i>Inicio: ' + fm(p.iniD) + '</span>' +
            '<span><i data-lucide="calendar-check"></i>Fin: ' + fm(p.finD) + '</span>' +
            '<span><i data-lucide="user-shield"></i>' + esc(p.sup || '—') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sv-ur"><span class="sv-badge ' + sCls + '">' + esc(p.sit) + '</span>' + vencBadge + '</div>' +
      '</div>';
    }).join('');
    if (window.lucide) lucide.createIcons();
  }

  // ════════════════════════════════════════════════════════════════
  //  3 · Matriz Operativa
  // ════════════════════════════════════════════════════════════════
  function renderMatriz() {
    var pane = document.getElementById('sv-pane-matriz');
    if (!pane.__init) {
      pane.innerHTML =
        '<div class="sv-ctrls">' +
          '<input type="text" id="svm-q" placeholder="Buscar cliente…">' +
          '<select id="svm-est" data-ph="Todos los estados">' +
            '<option value="">Todos los estados</option>' +
            '<option value="activo">Solo activos</option>' +
            '<option value="futuro">Solo futuros</option>' +
          '</select>' +
        '</div>' +
        '<div id="svm-wrap"></div>';
      pane.querySelector('#svm-q').addEventListener('input', function (e) { matState.q = e.target.value; drawMatriz(); });
      pane.querySelector('#svm-est').addEventListener('change', function (e) { matState.est = e.target.value; drawMatriz(); });
      pane.__init = true;
    }
    drawMatriz();
  }

  function drawMatriz() {
    var fq = (matState.q || '').toLowerCase();
    var fest = matState.est;
    function estFilter(p) {
      if (fest === 'activo') return ACTIVE.indexOf(p.est) >= 0;
      if (fest === 'futuro') return FUTURE.indexOf(p.est) >= 0;
      return true;
    }
    var clis = uniq(DATA.map(function (p) { return p.cli; })).sort()
      .filter(function (c) { return !fq || c.toLowerCase().indexOf(fq) >= 0; });
    var esps = uniq(DATA.filter(estFilter).map(function (p) { return p.esp; })).sort();

    var bc = function (est) {
      return ({ Proceso: '#3b82f6', Cierre: '#f59e0b', 'Concluído': '#0f172a', 'Concluido': '#0f172a', Terminado: '#0f172a', 'Por Iniciar': '#f97316', Obs: '#dc2626' })[est] || '#94a3b8';
    };

    var rows = '';
    var shown = 0;
    clis.forEach(function (cli) {
      var cp = DATA.filter(function (p) { return p.cli === cli && estFilter(p); });
      if (!cp.length) return;
      shown++;
      var cells = esps.map(function (esp) {
        var m = cp.filter(function (p) { return p.esp === esp; });
        if (!m.length) return '<td><span style="color:#cbd5e1">—</span></td>';
        var f = m[0];
        var col = bc(f.est);
        var pending = PENDING_SIT.indexOf(f.sit) >= 0;
        var style = pending
          ? 'background:repeating-linear-gradient(135deg,' + col + '11,' + col + '11 3px,' + col + '33 3px,' + col + '33 6px);color:' + col + ';border:1px dashed ' + col + '88'
          : 'background:' + col + '22;color:' + col + ';border:1px solid ' + col + '55';
        var multi = m.length > 1 ? ' +' + (m.length - 1) : '';
        return '<td><span class="sv-cell" style="' + style + '" title="' + esc(f.con || '—') + ' · ' + esc(f.est) + ' · ' + esc(f.sit) + '">' + esc(f.con || '—') + multi + '</span></td>';
      }).join('');
      rows += '<tr><td class="rh">' + esc(cli) + '</td>' + cells + '<td style="font-weight:800;color:#0ea5a4">' + cp.length + '</td></tr>';
    });

    var wrap = document.getElementById('svm-wrap');
    if (!shown) { wrap.innerHTML = '<div class="sv-empty"><i data-lucide="search-x"></i>Sin resultados</div>'; if (window.lucide) lucide.createIcons(); return; }
    wrap.innerHTML =
      '<div class="sv-mwrap"><table class="sv-mt"><thead><tr><th class="rh">Cliente</th>' +
      esps.map(function (e) { return '<th>' + esc(e) + '</th>'; }).join('') +
      '<th>Total</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="margin-top:10px;font-size:11.5px;color:var(--t3);font-weight:600">Color = estado · borde punteado = sin contratar (Pendiente/Licitación) · "+n" = servicios adicionales del mismo tipo</div>';
    if (window.lucide) lucide.createIcons();
  }

  // ════════════════════════════════════════════════════════════════
  //  Carga
  // ════════════════════════════════════════════════════════════════
  window.loadServicios = async function () {
    injectCss();
    var root = document.getElementById('view-servicios');
    if (!root) return;

    if (DATA) { if (!built) buildShell(); setSub(sub); return; }

    root.innerHTML = '<div class="sv-empty" style="margin-top:40px"><i data-lucide="loader"></i>Cargando portafolio de servicios…</div>';
    if (window.lucide) lucide.createIcons();

    if (!window.sb) { root.innerHTML = '<div class="sv-empty">Supabase no disponible</div>'; return; }
    try {
      var res = await window.sb
        .from('portafolio_servicios')
        .select('cliente,especialidad,situacion,estado,supervisor,contratista,fecha_inicio,fecha_fin')
        .order('id', { ascending: true });
      if (res.error) throw res.error;
      DATA = (res.data || []).map(function (r) {
        return {
          cli: (r.cliente || '—').trim(),
          esp: (r.especialidad || '—').trim(),
          sit: (r.situacion || '').trim(),
          est: (r.estado || '').trim(),
          sup: (r.supervisor || '').trim(),
          con: (r.contratista || '').trim(),
          iniD: parseFecha(r.fecha_inicio),
          finD: parseFecha(r.fecha_fin)
        };
      });
      buildShell();
      setSub(sub);
    } catch (err) {
      console.error('[Servicios] load error', err);
      root.innerHTML = '<div class="sv-empty"><i data-lucide="alert-triangle"></i>No se pudo cargar el portafolio de servicios<br><span style="font-size:12px">' + esc(String(err.message || err)) + '</span></div>';
      if (window.lucide) lucide.createIcons();
    }
  };
})();
