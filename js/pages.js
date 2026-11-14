/* SIMS screens - Docket GRN, Docket Details, Combined GRN, Combine by Scanning, Admin, approval pages. */
(function () {
  'use strict';
  var App = window.App, C = SIMS_CORE, $ = App.$, $$ = App.$$, esc = App.esc, api = App.api, toast = App.toast;
  function siteBase() { return (window.SIMS_CONFIG && SIMS_CONFIG.SITE) || location.href.split('#')[0]; } // the QR on printed sheets always points to the real site, never localhost
  function stamp(ms) { return C.fmtStamp(ms); }
  function chipFor(status) { var c = status === 'GRN Done' ? 'ok' : status === "Partly GRN'd" ? 'acc' : status === 'Combined' ? 'acc' : status === 'Arrived' ? 'warn' : ''; return '<span class="chip ' + c + '">' + esc(status) + '</span>'; }
  function flagChips(fl) { return (fl || []).map(function (f) { return '<span class="chip bad">' + esc(f) + '</span>'; }).join(' '); }
  function busy(btn, on, txt) { if (!btn) return; if (on) { btn._t = btn.textContent; btn.disabled = true; btn.textContent = txt || 'Please wait…'; } else { btn.disabled = false; btn.textContent = btn._t || btn.textContent; } }
  function printPages(pages) { return SIMSPrint.print(pages); }
  var GROUPS = [['A', 'Rack A'], ['B', 'Rack B'], ['C', 'Rack C'], ['DE', 'Rack D and E'], ['OIL', 'Oil and other locations']];

  function sheetsToPages(sheets) {
    var all = [], empty = [];
    sheets.forEach(function (s) { if (!s.lines.length) { empty.push(s.title); return; } all = all.concat(SIMSPrint.rackSheet(s)); });
    return { pages: all, empty: empty };
  }
  /** Print rack sheets returned by the back end. */
  function printRackSheets(sheets) {
    var r = sheetsToPages(sheets);
    if (!r.pages.length) { toast('Nothing to print for the chosen pages.'); return Promise.resolve(false); }
    if (r.empty.length) toast('No lines for: ' + r.empty.join(', '));
    return printPages(r.pages).then(function () { return true; });
  }
  App.printRackSheets = printRackSheets;

  function pickGroups(title, go) {
    App.modal('<h2 style="margin-top:0">' + esc(title) + '</h2><div class="permgrid">' + GROUPS.map(function (g, i) {
      return '<label><input type="checkbox" value="' + g[0] + '"' + (i < 3 ? ' checked' : '') + '><span>' + esc(g[1]) + '</span></label>';
    }).join('') + '</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Print</button></div>', function (m, close) {
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () { var g = $$('input:checked', m).map(function (i) { return i.value; }); if (!g.length) { toast('Tick at least one page.'); return; } close(); go(g); };
    });
  }
  App.pickGroups = pickGroups;

  // =====================================================================
  // Docket GRN
  // =====================================================================
  function remarkPreview(dm, sh, boxes) {
    return C.remarkText({ damaged: dm === '' ? -1 : Number(dm), short: sh === '' ? -1 : Number(sh) });
  }
  App.pages['docket-grn'] = {
    perm: 'docketGrn',
    render: function (view, r) {
      view.innerHTML = '<div class="card"><label class="f" style="margin-top:0">Docket number</label><div class="row"><input type="text" id="dlr" class="grow" inputmode="numeric" placeholder="Docket number" autocomplete="off">' +
        '<button class="btn hide" id="dScan">Scan</button><button class="btn pri" id="dGo">Go</button></div><div id="dsug"></div></div><div id="dstep"></div><h3>Open dockets</h3><div class="card" id="dopen"><span class="spinner"></span></div>';
      var inp = $('#dlr'), step = $('#dstep'), podDoc = null, sug = $('#dsug');
      inp.setAttribute('enterkeyhint', 'go');
      function go() { var v = inp.value.replace(/\s+/g, ''); sug.innerHTML = ''; if (v) lookup(v); }
      function suggest() {
        var q = inp.value.replace(/\s+/g, ''), s = App.docketSuggestions ? App.docketSuggestions(q) : { dockets: [], invoices: [] };
        if (!s.dockets.length && !s.invoices.length) { sug.innerHTML = ''; return; }
        sug.innerHTML = '<div class="list" style="margin-top:8px">' + s.dockets.map(function (d) { return '<div class="item click" data-sl="' + esc(d.lr) + '"><div class="grow"><div class="bold mono">' + esc(d.lr) + '</div><div class="muted small">' + d.lines + (d.lines === 1 ? ' line' : ' lines') + '</div></div><span class="chip">' + esc(d.status) + '</span></div>'; }).join('') +
          s.invoices.map(function (d) { return '<div class="item click"' + (d.lr ? ' data-sl="' + esc(d.lr) + '"' : '') + '><div class="grow"><div class="bold mono">' + esc(d.invoice) + '</div><div class="muted small">' + (d.lr ? 'Docket ' + esc(d.lr) : 'Not booked yet') + '</div></div></div>'; }).join('') + '</div>';
        $$('[data-sl]', sug).forEach(function (el) { el.onclick = function () { sug.innerHTML = ''; lookup(el.dataset.sl); }; });
      }
      inp.addEventListener('input', suggest);
      $('#dGo').onclick = go; inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { go(); inp.blur(); } });
      var sb = $('#dScan'); if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.matchMedia('(pointer:coarse)').matches) sb.classList.remove('hide');
      sb.onclick = function () { App.scan({ mode: 'route', title: 'Scan Docket', onText: function (t) { var k = C.classifyScan(t, {}); var v = k.value; inp.value = v; App.feedback(true); lookup(v); return true; } }); };

      function lookup(lr) {
        inp.value = lr; step.innerHTML = '<div class="card"><span class="spinner"></span></div>';
        api('docketLookup', { q: lr }).then(function (d) {
          if (!d.found) return showNotFound(lr);
          if (d.docket.printed) return showPrinted(d.docket);
          showNew(d.docket.lr === lr ? lr : lr, d.docket.pomsLr || '');
        }).catch(function (e) { step.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      }
      function showNotFound(lr) {
        step.innerHTML = '<div class="card bad"><h2 style="margin-top:0">Docket number not found</h2><p class="muted">' + esc(lr) + ' is not in the transit data.</p><div class="row"><button class="btn" id="reenter">Re-enter</button><button class="btn pri" id="byInv">Find by invoice</button></div></div>';
        $('#reenter').onclick = function () { step.innerHTML = ''; inp.value = ''; inp.focus(); };
        $('#byInv').onclick = function () { showInvoice(lr); };
        App.feedback(false);
      }
      function showInvoice(lr) {
        step.innerHTML = '<div class="card"><h2 style="margin-top:0">Find by invoice</h2><label class="f">Enter one invoice number</label><div class="row"><input type="text" id="finv" class="grow" inputmode="numeric" autocomplete="off"><button class="btn pri" id="fgo">Find</button></div><div id="fres" style="margin-top:12px"></div></div>';
        var fi = $('#finv'); fi.focus();
        function find() {
          var v = fi.value.replace(/\s+/g, ''); if (!v) return;
          $('#fres').innerHTML = '<span class="spinner"></span>';
          api('findInvoice', { invoice: v }).then(function (d) {
            if (!d.found) { $('#fres').innerHTML = '<div class="err">Invoice not found.</div>'; return; }
            $('#fres').innerHTML = '<div class="card ok"><div>POMS LR for this invoice: <span class="bold mono">' + esc(d.pomsLr) + '</span></div><div class="small muted" style="margin:6px 0">All invoices under this LR — confirm they match your docket:</div>' +
              d.invoices.map(function (i) { return '<label class="item"><input type="checkbox" checked disabled><span class="mono">' + esc(i.invoice) + '</span><span class="muted small">' + i.lines + ' lines</span></label>'; }).join('') +
              '<div class="small" style="color:var(--warn);margin:8px 0">If the LR you typed (' + esc(lr) + ') is different from the POMS LR, the docket is flagged “LR not matching POMS”. Both numbers will find it.</div>' +
              '<button class="btn pri" id="useLr">Open docket under ' + esc(lr) + '</button></div>';
            $('#useLr').onclick = function () { showNew(lr, d.pomsLr); };
          }).catch(function (e) { $('#fres').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
        }
        $('#fgo').onclick = find; fi.addEventListener('keydown', function (e) { if (e.key === 'Enter') find(); });
      }
      function showPrinted(d) {
        step.innerHTML = '<div class="card warn"><h2 style="margin-top:0">Already printed</h2><p>Docket <span class="mono bold">' + esc(d.lr) + '</span> was printed by <b>' + esc(d.arrivedBy + (d.arrivedLabel ? ' (' + d.arrivedLabel + ')' : '')) + '</b> on ' + esc(stamp(d.arrivedAt)) + '.</p>' +
          '<p class="muted">' + esc(d.remarkLine) + ' · ' + chipFor(d.status) + '</p><div class="row"><button class="btn pri" id="reprint">Reprint</button><button class="btn" id="open">Open details</button></div></div>';
        $('#reprint').onclick = function () { doPrint({ lr: d.lr, reprint: true }, $('#reprint')); };
        $('#open').onclick = function () { App.go('#/docket/' + encodeURIComponent(d.lr)); };
        App.feedback(false);
      }
      function showNew(lr, poms) {
        step.innerHTML = '<div class="card"><h2 style="margin-top:0">New docket <span class="mono">' + esc(lr) + '</span></h2>' + (poms && poms !== lr ? '<div class="small" style="color:var(--warn)">POMS LR: ' + esc(poms) + ' (will be flagged “LR not matching POMS”)</div>' : '') +
          '<label class="f">Total boxes as per docket</label><input type="number" id="nBoxes" inputmode="numeric" min="1" placeholder="Total number of boxes in the docket">' +
          '<div class="row" style="margin-top:6px"><div class="grow"><label class="f">Damaged</label><input type="number" id="nDam" inputmode="numeric" min="-1" value="-1"></div><div class="grow"><label class="f">Short</label><input type="number" id="nShort" inputmode="numeric" min="-1" value="-1"></div></div>' +
          '<div class="small muted" style="margin-top:6px">−1 means not entered. Enter damaged and short separately; 0 and 0 = OK.</div>' +
          '<div style="margin:10px 0">Remark for transporter: <span class="bold" id="nRem">NOT ENTERED</span></div>' + (App.can('uploadPod') ? '<div class="row" style="margin-bottom:6px"><button class="btn" id="nPod">Add POD photo (optional)</button><span class="small muted" id="nPodInfo"></span></div><input type="text" id="nPodNote" class="hide" placeholder="POD note (optional)" maxlength="200" style="margin-bottom:10px">' : '') + '<button class="btn pri big" id="nPrint">Print Docket GRN Sheet</button></div>';
        var b = $('#nBoxes'), dm = $('#nDam'), sh = $('#nShort');
        function upd() { $('#nRem').textContent = remarkPreview(dm.value, sh.value); }
        dm.oninput = sh.oninput = upd; b.focus(); podDoc = null;
        var pb = $('#nPod'); if (pb) pb.onclick = function () { App.pickDoc({ title: 'POD photo' }).then(function (d) { if (d) { podDoc = d; $('#nPodInfo').textContent = 'Photo ready ✓'; $('#nPodNote').classList.remove('hide'); } }); };
        $('#nPrint').onclick = function () {
          var boxes = parseInt(b.value, 10), d = parseInt(dm.value, 10), s = parseInt(sh.value, 10);
          if (!(boxes >= 1)) { toast('Enter the total boxes as per docket.'); b.focus(); return; }
          if (isNaN(d) || isNaN(s) || d < -1 || s < -1) { toast('Damaged and short must be whole numbers (−1 = not entered).'); return; }
          if ((d < 0) !== (s < 0)) { toast('Enter both Damaged and Short, or leave both at -1 (not entered).', 5000); return; }
          if (d > boxes || s > boxes) { toast('Damaged or short cannot be more than total boxes.'); return; }
          doPrint({ lr: lr, pomsLr: poms && poms !== lr ? poms : '', boxes: boxes, damaged: d, short: s }, $('#nPrint'));
        };
      }
      function doPrint(args, btn) {
        busy(btn, true, 'Preparing…');
        api('docketPrint', args).then(function (d) {
          if (podDoc && !args.reprint) { var pd = podDoc, pn = ($('#nPodNote') || {}).value || ''; podDoc = null; App.uploadDoc(d.sheet.lr, 'POD', pd, pn).then(function (r) { toast(r.status === 'queued' ? 'POD saved temporarily; it will move automatically.' : 'POD saved.'); }).catch(function (e) { toast('POD not saved: ' + e.message, 6000); }); }
          var pages = SIMSPrint.docketSheet(d.sheet, siteBase());
          return printPages(pages).then(function () {
            step.innerHTML = '<div class="card ok"><h2 style="margin-top:0">Done</h2><p>Docket <span class="mono bold">' + esc(d.sheet.lr) + '</span> ' + (args.reprint ? 'reprinted.' : 'marked <b>Arrived</b>.') + '</p><div class="row"><button class="btn pri" id="nextD">Next docket</button><button class="btn" id="againD">Print again</button></div></div>';
            $('#nextD').onclick = function () { step.innerHTML = ''; inp.value = ''; inp.focus(); };
            $('#againD').onclick = function () { printPages(pages); };
            loadOpen(true);
          });
        }).catch(function (e) { busy(btn, false); if (e.code === 'printed') { lookup(args.lr); } else toast(e.message, 4000); });
      }
      var openSeq = 0;
      function loadOpen(fresh) {
        var my = ++openSeq;
        App.swr('openDockets', function () { return api('openDockets'); }, function (d) {
          var el = $('#dopen'); if (!el || my !== openSeq) return;
          if (!d.dockets.length) { el.innerHTML = '<span class="muted">No open dockets.</span>'; return; }
          el.innerHTML = '<div class="list">' + d.dockets.map(function (x) {
            return '<div class="item click" data-lr="' + esc(x.lr) + '"><div class="grow"><div class="bold mono">' + esc(x.lr) + '</div><div class="small muted">' + esc(stamp(x.arrivedAt)) + ' · ' + x.done + ' of ' + x.total + ' lines GRN\'d</div><div style="margin-top:4px">' + flagChips(x.flags) + '</div></div>' + chipFor(x.status) + '</div>';
          }).join('') + '</div>';
          $$('[data-lr]', el).forEach(function (d) { d.onclick = function () { App.go('#/docket/' + encodeURIComponent(d.dataset.lr)); }; });
        }, { fresh: fresh }).catch(function (e) { var el = $('#dopen'); if (el) el.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
      }
      loadOpen();
      App.live(function () { loadOpen(false); });
      if (r.q.lr) lookup(r.q.lr); else inp.focus();
    }
  };

  // =====================================================================
  // Docket Details
  // =====================================================================
  App.pages.docket = {
    render: function (view, r) {
      function paint(d) {
        if (!d.found) { view.innerHTML = '<div class="card bad"><h2>Docket not found</h2><p>' + esc(r.arg) + '</p></div>'; App.feedback(false); return; }
        var k = d.docket, u = App.me.user;
        var html = '<div class="card"><div class="row between"><div class="mono bold" style="font-size:26px">' + esc(k.lr) + '</div>' + chipFor(k.status) + '</div>' +
          (k.pomsLr ? '<div class="small muted">POMS LR ' + esc(k.pomsLr) + '</div>' : '') + '<div style="margin:8px 0">' + flagChips(k.flags) + '</div>' +
          '<div class="kv"><div>Boxes</div><div>' + (k.printed ? esc(k.boxes) : '<span class="muted">Not printed yet</span>') + '</div><div>Remark</div><div>' + (k.printed ? esc(k.remarkLine) : '—') + '</div>' +
          '<div>GRN</div><div>' + esc(k.progress.state === 'done' ? 'GRN Done' : k.progress.state === 'partly' ? "Partly GRN'd" : 'Not GRN\'d') + ' · ' + k.progress.done + ' of ' + k.progress.total + ' lines</div>' +
          (k.printed ? '<div>Arrived</div><div>' + esc(stamp(k.arrivedAt)) + ' · ' + esc(k.arrivedBy + (k.arrivedLabel ? ' (' + k.arrivedLabel + ')' : '')) + '</div>' : '') +
          '<div>Documents</div><div>' + (k.docs || []).length + '</div>' + (k.totalValue !== undefined ? '<div>Total value</div><div class="bold">₹ ' + C.fmtINR(k.totalValue) + '</div>' : '') + '</div></div>';
        if (k.batchInfo && k.batchInfo.length) {
          html += '<h3>Combined batches</h3><div class="card"><div class="list">' + k.batchInfo.map(function (b) {
            return '<div class="item"><div class="grow">Combined in batch <b>' + esc(b.name) + '</b><div class="small muted">' + esc(stamp(b.at)) + ' · ' + esc(b.by + (b.label ? ' (' + b.label + ')' : '')) + '</div></div>' + (App.can('combinedGrn') ? '<button class="btn" data-rb="' + esc(b.id) + '">Reprint batch</button>' : '') + '</div>';
          }).join('') + '</div></div>';
        }
        var acts = [];
        if (k.printed && App.can('docketGrn')) acts.push('<button class="btn pri" id="rpGrn">Reprint Docket GRN sheet</button>');
        if (k.printed && !k.combined && k.progress.state !== 'done' && App.can('combinedGrn')) acts.push('<button class="btn pri" id="startBatch">Start combined batch</button>');
        if (!k.printed && App.can('docketGrn')) acts.push('<button class="btn pri" id="toGrn">Open in Docket GRN</button>');
        acts.push('<button class="btn" id="xl">Download Excel</button>');
        if (d.archived) { acts.length = 0; acts.push('<button class="btn" id="xl">Download Excel</button>'); html = '<div class="card warn small">From the archive (older than 90 days). Read only.</div>' + html; }
        html += '<div class="row" style="margin:12px 0">' + acts.join('') + '</div>';
        if (App.can('docketHistory')) html += '<details class="card" id="dxTl"><summary>Timeline</summary><div id="dxTlBody" style="margin-top:8px"></div></details>';
        html += '<div id="dxExtras"></div><h3>Lines (' + k.lines.length + ')</h3><div class="card tscroll"><table class="dt"><thead><tr><th>Part</th><th>Description</th><th>Qty</th><th>Invoice</th><th>Mark</th><th></th></tr></thead><tbody>' +
          k.lines.map(function (l) { return '<tr><td class="mono">' + esc(l.part) + '</td><td>' + esc(l.desc) + (l.claimPending ? '<div><span class="chip warn">Claim pending: ' + esc(l.claimPending) + '</span></div>' : '') + '</td><td>' + esc(l.qty) + '</td><td class="mono">' + esc(l.invoice) + '</td><td>' + (l.mark ? '<span class="chip acc">' + esc(l.mark) + '</span>' : '') + '</td><td>' + (l.grnDate ? '<span class="chip ok">GRN\'d ' + esc(C.fmtDay(l.grnDate)) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
        view.innerHTML = html;
        var tl = $('#dxTl', view);
        if (tl) {
          var drawTl = function (t) { $('#dxTlBody', view).innerHTML = t.length ? '<div class="list">' + t.map(function (e) { return '<div class="item"><div class="grow"><div class="bold">' + esc(e.text) + '</div><div class="small muted">' + esc(stamp(e.ts)) + (e.by ? ' · ' + esc(e.by + (e.label ? ' (' + e.label + ')' : '')) : ' · system') + (e.detail ? ' · ' + esc(e.detail) : '') + '</div></div></div>'; }).join('') + '</div>' : '<span class="muted">No events recorded.</span>'; };
          var tlDone = false;
          tl.addEventListener('toggle', function () {
            if (!tl.open || tlDone) return; tlDone = true;
            if (d.timeline) { drawTl(d.timeline); return; }
            $('#dxTlBody', view).innerHTML = '<span class="spinner"></span>';
            api('docketHistory', { q: k.lr, lr: k.lr }).then(function (h) { drawTl(h.timeline || []); }).catch(function (e) { tlDone = false; $('#dxTlBody', view).innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
          });
        }
        if (App.docketExtras && !d.archived) App.docketExtras($('#dxExtras', view), k, function () { load(true); });
        $$('[data-rb]', view).forEach(function (b) { b.onclick = function () { App.pickGroups('Reprint batch', function (g) { api('batchReprint', { id: b.dataset.rb, groups: g }).then(function (x) { return printRackSheets(x.sheets); }).catch(function (e) { toast(e.message); }); }); }; });
        var rpg = $('#rpGrn'); if (rpg) rpg.onclick = function () {
          busy(rpg, true, 'Preparing…');
          api('docketPrint', { lr: k.lr, reprint: true }).then(function (x) { return printPages(SIMSPrint.docketSheet(x.sheet, siteBase())); })
            .then(function () { busy(rpg, false); }).catch(function (e) { busy(rpg, false); toast(e.message, 4000); });
        };
        var sbt = $('#startBatch'); if (sbt) sbt.onclick = function () { App.go('#/combine-scan?first=' + encodeURIComponent(k.lr)); };
        var tg = $('#toGrn'); if (tg) tg.onclick = function () { App.go('#/docket-grn?lr=' + encodeURIComponent(k.lr)); };
        $('#xl').onclick = function () {
          var s = document.createElement('script'); s.src = 'lib/xlsx.mini.min.js';
          function mk() {
            var rows = [['Invoice No', 'Part No', 'Description', 'Qty', 'Mark', 'GRN Date']].concat(k.lines.map(function (l) { return [l.invoice, l.part, l.desc, l.qty, l.mark, l.grnDate ? C.fmtDay(l.grnDate) : '']; }));
            var ws = XLSX.utils.aoa_to_sheet(rows), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Docket'); XLSX.writeFile(wb, 'Docket-' + k.lr + '.xlsx');
          }
          if (window.XLSX) mk(); else { s.onload = mk; document.head.appendChild(s); }
        };
      }
      function load(fresh) { return App.swr('docket:' + r.arg, function () {
        return api('docketDetails', { q: r.arg }).then(function (d) {
          if (d.found || !App.can('docketHistory')) return d;
          return api('docketHistory', { q: r.arg, lr: r.arg }).then(function (h) { return h.found && h.docket ? { found: true, docket: h.docket, archived: !!h.archived, timeline: h.archived ? h.timeline : undefined } : d; }).catch(function () { return d; });
        });
      }, function (d) { App.keepState(view, function () { paint(d); }); }, { fresh: fresh }); }
      App.live(function () { load(false); });
      return load(false);
    }
  };

  // =====================================================================
  // Combined GRN
  // =====================================================================
  var sel = {};      // ticked dockets, kept while the page is open
  App.pages.combined = {
    perm: 'combinedGrn',
    render: function (view) {
      view.innerHTML = '<div id="cbody"><div class="center muted" style="padding:30px"><span class="spinner"></span></div></div>';
      var addDraft = { lr: '', boxes: '', dm: '-1', sh: '-1', also: false };
      function load(fresh) {
        return App.swr('arrivedDockets', function () { return api('arrivedDockets'); }, function (d) { App.keepState($('#cbody'), function () { draw(d); }); }, { fresh: fresh });
      }
      function selCount() { return Object.keys(sel).filter(function (k) { return sel[k]; }).length; }
      function row(x, comb) {
        return '<label class="item"><input type="checkbox" data-lr="' + esc(x.lr) + '" data-c="' + (comb ? 1 : 0) + '"' + (sel[x.lr] ? ' checked' : '') + '><div class="grow"><div class="bold mono">' + esc(x.lr) + '</div><div class="small muted">Arrived ' + esc(stamp(x.arrivedAt)) + ' · ' + esc(x.boxes) + ' boxes' + (x.done ? ' · ' + x.done + ' of ' + x.total + ' lines GRN\'d' : '') + '</div></div>' + chipFor(x.status) + '</label>';
      }
      function draw(d) {
        var el = $('#cbody'); if (!el) return;
        Object.keys(sel).forEach(function (k) { var ok = d.pending.concat(d.combined).some(function (x) { return x.lr === k; }); if (!ok) delete sel[k]; });
        el.innerHTML =
          '<h3>Arrived dockets (oldest first)</h3><div class="card">' + (d.pending.length ? '<div class="list">' + d.pending.map(function (x) { return row(x, false); }).join('') + '</div>' : '<span class="muted">No arrived dockets waiting.</span>') + '</div>' +
          '<details class="card"><summary>Already combined, GRN pending (' + d.combined.length + ')</summary>' + (d.combined.length ? '<div class="list" style="margin-top:8px">' + d.combined.map(function (x) { return row(x, true); }).join('') + '</div>' : '<p class="muted">None.</p>') + '</details>' +
          '<h3>Recent batches</h3><div class="card">' + (d.recent.length ? '<div class="list">' + d.recent.map(function (b) { return '<div class="item"><div class="grow"><div class="bold">' + esc(b.name) + '</div><div class="small muted">' + esc(stamp(b.at)) + ' · ' + esc(b.by + (b.label ? ' (' + b.label + ')' : '')) + ' · ' + b.count + ' dockets</div></div><button class="btn" data-rb="' + esc(b.id) + '">Reprint</button></div>'; }).join('') + '</div>' : '<span class="muted">No batches yet.</span>') + '</div>' +
          '<details class="card" id="addBox"' + (addDraft.lr ? ' open' : '') + '><summary>Add a docket not yet printed</summary><label class="f">Docket number</label><input type="text" id="aLr" inputmode="numeric" value="' + esc(addDraft.lr) + '">' +
          '<label class="f">Total boxes as per docket</label><input type="number" id="aBoxes" inputmode="numeric" min="1" value="' + esc(addDraft.boxes) + '"><div class="row"><div class="grow"><label class="f">Damaged (−1 = not entered)</label><input type="number" id="aDm" inputmode="numeric" value="' + esc(addDraft.dm) + '"></div><div class="grow"><label class="f">Short (−1 = not entered)</label><input type="number" id="aSh" inputmode="numeric" value="' + esc(addDraft.sh) + '"></div></div>' +
          '<label class="item"><input type="checkbox" id="aAlso"' + (addDraft.also ? ' checked' : '') + '><span>Also print the Docket GRN sheet</span></label><button class="btn pri" id="aGo">Add to batch</button></details>' +
          '<div class="sticky-bar"><span class="bold" id="cCount">' + selCount() + ' selected</span><span class="grow"></span><button class="btn" id="cMore">More options</button><button class="btn pri" id="cPrint">Print A, B, C</button></div>';
        $$('input[data-lr]', el).forEach(function (cb) {
          cb.onchange = function () {
            if (cb.checked && cb.dataset.c === '1') {
              cb.checked = false;
              App.confirm('This docket was already combined. Combine it again? Its lines will be marked “Re-combined”.', 'Combine again', 'Skip').then(function (y) { if (y) { cb.checked = true; sel[cb.dataset.lr] = true; $('#cCount').textContent = selCount() + ' selected'; } });
              return;
            }
            sel[cb.dataset.lr] = cb.checked; $('#cCount').textContent = selCount() + ' selected';
          };
        });
        $$('[data-rb]', el).forEach(function (b) { b.onclick = function () { App.pickGroups('Reprint batch', function (g) { api('batchReprint', { id: b.dataset.rb, groups: g }).then(function (x) { return printRackSheets(x.sheets); }).catch(function (e) { toast(e.message); }); }); }; });
        function doCombine(groups) {
          var lrs = Object.keys(sel).filter(function (k) { return sel[k]; });
          if (!lrs.length) { toast('Tick at least one docket.'); return; }
          var btn = $('#cPrint'); busy(btn, true, 'Preparing…');
          api('combinedPrint', { lrs: lrs, groups: groups }).then(function (r) {
            return printRackSheets(r.sheets).then(function () { sel = {}; toast('Batch ' + r.batch.name + ' printed.'); return load(true); });
          }).catch(function (e) { busy(btn, false); toast(e.message, 4500); });
        }
        $('#cPrint').onclick = function () { doCombine(['A', 'B', 'C']); };
        $('#cMore').onclick = function () { if (!selCount()) { toast('Tick at least one docket.'); return; } App.pickGroups('Print pages', doCombine); };
        var ids = ['aLr', 'aBoxes', 'aDm', 'aSh'], keys = ['lr', 'boxes', 'dm', 'sh'];
        ids.forEach(function (id, i) { $('#' + id).oninput = function () { addDraft[keys[i]] = this.value; }; });
        $('#aAlso').onchange = function () { addDraft.also = this.checked; };
        $('#aGo').onclick = function () {
          var lr = addDraft.lr.replace(/\s+/g, ''), boxes = parseInt(addDraft.boxes, 10), dm = parseInt(addDraft.dm, 10), sh = parseInt(addDraft.sh, 10);
          if (!lr) { toast('Enter the docket number.'); return; }
          if (!(boxes >= 1)) { toast('Enter the total boxes as per docket.'); return; }
          if (isNaN(dm) || isNaN(sh) || dm < -1 || sh < -1 || dm > boxes || sh > boxes) { toast('Check damaged and short.'); return; }
          if ((dm < 0) !== (sh < 0)) { toast('Enter both Damaged and Short, or leave both at -1 (not entered).', 5000); return; }
          var btn = $('#aGo'); busy(btn, true, 'Adding…');
          // the typed number may be a POMS LR different from the docket number; the back end resolves both
          api('addToBatch', { lr: lr, boxes: boxes, damaged: dm, short: sh, alsoPrint: addDraft.also }).then(function (r) {
            sel[r.lr] = true; var also = r.sheet; addDraft = { lr: '', boxes: '', dm: '-1', sh: '-1', also: false };
            toast(r.already ? 'Docket ' + r.lr + ' was already printed; ticked.' : 'Docket ' + r.lr + ' added and ticked.');
            return load(true).then(function () { if (also) return printPages(SIMSPrint.docketSheet(also, siteBase())); });
          }).catch(function (e) { busy(btn, false); toast(e.message, 4500); });
        };
      }
      App.live(function () { load(false); });
      return load();
    }
  };

  // =====================================================================
  // Combine by scanning
  // =====================================================================
  App.pages['combine-scan'] = {
    perm: 'combinedGrn',
    render: function (view, r) {
      var list = []; // {lr, status}
      function has(lr) { return list.some(function (x) { return x.lr === lr; }); }
      function add(lr) {
        return api('docketLookup', { q: lr }).then(function (d) {
          if (!d.found || !d.docket.printed) { App.feedback(false); toast('Docket ' + lr + ' has not arrived. Print its Docket GRN sheet first.', 3500); return false; }
          var k = d.docket;
          if (has(k.lr)) { toast('Already in this batch.'); return false; }
          if (k.progress.state === 'done') { toast('Docket ' + k.lr + ' is already GRN\'d.'); return false; }
          function push() { list.push({ lr: k.lr, boxes: k.boxes, recomb: k.combined }); App.feedback(true); draw(); }
          if (k.combined) {
            var b = k.batches.length ? '' : '';
            return App.confirm('Already combined. Combine again?', 'Yes', 'Skip').then(function (y) { if (y) push(); return false; });
          }
          push(); return false;
        }).catch(function (e) { toast(e.message); return false; });
      }
      function fromText(t) {
        var k = C.classifyScan(t, {});
        if (k.kind === 'docketLink' || k.kind === 'docket' || k.kind === 'unknown') return add(k.value);
        App.feedback(false); toast('That is not a docket. Scan a Docket GRN sheet QR code.'); return false;
      }
      function draw() {
        view.innerHTML = '<div class="card"><div class="row between"><div><div class="bold" style="font-size:22px">Batch: ' + list.length + (list.length === 1 ? ' docket' : ' dockets') + '</div><div class="small muted">Scan each Docket GRN sheet QR code to add it.</div></div><button class="btn pri" id="sc">Scan</button></div></div>' +
          '<h3>Review and print</h3><div class="card">' + (list.length ? '<div class="list">' + list.map(function (x, i) { return '<div class="item"><input type="checkbox" checked disabled><div class="grow"><div class="bold mono">' + esc(x.lr) + '</div><div class="small muted">' + esc(x.boxes) + ' boxes' + (x.recomb ? ' · re-combine' : '') + '</div></div><button class="btn" data-rm="' + i + '">Remove</button></div>'; }).join('') + '</div>' : '<span class="muted">Nothing scanned yet.</span>') + '</div>' +
          '<div class="row"><button class="btn pri" id="cp"' + (list.length ? '' : ' disabled') + '>Print A, B, C</button><button class="btn" id="cm"' + (list.length ? '' : ' disabled') + '>More options</button><button class="btn" id="cb">Back to Combined GRN</button></div>';
        $$('[data-rm]', view).forEach(function (b) { b.onclick = function () { list.splice(+b.dataset.rm, 1); draw(); }; });
        $('#sc').onclick = openScan;
        function go(g) { var btn = $('#cp'); busy(btn, true, 'Preparing…'); api('combinedPrint', { lrs: list.map(function (x) { return x.lr; }), groups: g }).then(function (res) { return printRackSheets(res.sheets).then(function () { toast('Batch ' + res.batch.name + ' printed.'); App.go('#/combined'); }); }).catch(function (e) { busy(btn, false); toast(e.message, 4500); }); }
        $('#cp').onclick = function () { go(['A', 'B', 'C']); };
        $('#cm').onclick = function () { App.pickGroups('Print pages', go); };
        $('#cb').onclick = function () { App.go('#/combined'); };
      }
      function openScan() {
        App.scan({ mode: 'batch', title: 'Combine by Scanning', footer: '<div class="bold" id="bcount">Batch: ' + list.length + ' dockets</div>', onText: function (t, ov) { return Promise.resolve(fromText(t)).then(function () { var e = ov.el.querySelector('#bcount'); if (e) e.textContent = 'Batch: ' + list.length + (list.length === 1 ? ' docket' : ' dockets'); return false; }); } });
      }
      draw();
      if (r.q.first) add(r.q.first).then(function () { /* stay on the page */ });
    }
  };

  // =====================================================================
  // Approval page (opened from the admin's email) and admin unlock page
  // =====================================================================
  App.pages.approve = {
    render: function (view, r) {
      view.innerHTML = '<div class="brand" style="padding-left:0">SIMS</div><h2>Login request</h2><div id="ap"><span class="spinner"></span></div>';
      var args = { id: r.q.id, sig: r.q.sig };
      api('approveInfo', args, { quiet: true }).then(function (d) {
        if (d.status !== 'pending') { $('#ap').innerHTML = '<div class="card">This request was already ' + esc(d.status) + '.</div>'; return; }
        $('#ap').innerHTML = '<div class="card"><div class="bold" style="font-size:20px">🔐 ' + esc(d.name) + ' wants to log in</div><div class="muted">' + esc(d.device) + ' · ' + esc(stamp(d.at)) + '</div>' +
          '<label class="f">Device label (optional), e.g. Office PC</label><input type="text" id="apl" maxlength="30" value="' + esc(d.lastLabel || '') + '"><div class="row" style="margin-top:14px"><button class="btn pri" id="apY">Approve</button><button class="btn bad" id="apN">Reject</button></div></div>';
        function decide(x) { api('approveDecide', { id: r.q.id, sig: r.q.sig, decision: x, label: $('#apl').value }, { quiet: true }).then(function (res) { $('#ap').innerHTML = '<div class="card ok">' + (res.status === 'approved' ? 'Approved. ' + esc(d.name) + ' can now use SIMS.' : 'Rejected.') + '</div>'; }).catch(function (e) { toast(e.message); }); }
        $('#apY').onclick = function () { decide('approve'); }; $('#apN').onclick = function () { decide('reject'); };
        if (r.q.d === 'reject') $('#apN').focus();
      }).catch(function (e) { $('#ap').innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
    }
  };
  App.pages['admin-open'] = {
    render: function (view, r) {
      return api('openAdmin', { t: r.q.t }).then(function () { toast('Admin unlocked.'); App.me.adminUnlocked = true; location.hash = '#/admin'; location.reload(); }).catch(function (e) { view.innerHTML = '<div class="card bad"><h2>Admin link</h2><p class="err">' + esc(e.message) + '</p><button class="btn pri" onclick="location.hash=\'#/admin\'">Back to Admin</button></div>'; });
    }
  };

  // =====================================================================
  // Admin
  // =====================================================================
  var ADMIN_TABS = [['users', 'Users'], ['devices', 'Connected Devices'], ['settings', 'Settings'], ['feeds', 'Data Feeds'], ['files', 'Files'], ['alerts', 'Alerts'], ['watch', 'Part Watch List'], ['backups', 'Backups'], ['print', 'Remote Printing']];
  App.pages.admin = {
    render: function (view, r) {
      if (!App.me.user.admin) { view.innerHTML = '<div class="card">Admin only.</div>'; return; }
      var tab = r.arg || 'users';
      view.innerHTML = tabs() + '<div id="atab"></div>';
      $$('[data-t]', view).forEach(function (b) { b.onclick = function () { App.go('#/admin/' + b.dataset.t); }; });
      var t = $('#atab');
      function lockUi() {
        view.innerHTML = '<div class="card warn"><h2 style="margin-top:0">Admin is locked</h2><p>Tap the button and SIMS will send a one-time link (valid for 10 minutes) to the admin email. Open that link on this device.</p><button class="btn pri" id="reqA">Send me the admin link</button><div id="reqMsg" class="muted" style="margin-top:10px"></div></div>';
        $('#reqA').onclick = function () {
          busy($('#reqA'), true, 'Sending…');
          api('requestAdmin', { device: App.deviceInfo().type }).then(function () { $('#reqMsg').innerHTML = 'Link sent to the admin email. After you open it, you will come back here.'; busy($('#reqA'), false); }).catch(function (e2) { $('#reqMsg').innerHTML = '<span class="err">' + esc(e2.message) + '</span>'; busy($('#reqA'), false); });
        };
      }
      function fail(e, had) { if (e.code === 'adminlock') { lockUi(); return; } if (!had) t.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; }
      function tabSwr(key, fetchFn, paint, fresh) { return App.swr(key, fetchFn, function (d) { App.keepState(t, function () { paint(d); }); }, { fresh: fresh, onError: fail, silent: true }); }
      function anyPanelOpen() { return $$('[id^="pm-"]', t).some(function (b) { return b.innerHTML; }); }
      if (tab === 'users') usersTab(t, false); else if (tab === 'devices') devicesTab(t, false); else if (tab === 'settings') settingsTab(t, false); else if (tab === 'feeds') feedsTab(t, false); else if (App.adminTabs && App.adminTabs[tab]) App.adminTabs[tab](t); else filesTab(t, false);
      if (tab !== 'settings' && !(App.adminTabs && App.adminTabs[tab])) App.live(function () { if (tab === 'users') usersTab(t, false); else if (tab === 'devices') devicesTab(t, false); else if (tab === 'feeds') feedsTab(t, false); else filesTab(t, false); });
      function tabs() { return '<div class="tabs">' + ADMIN_TABS.map(function (t) { return '<button data-t="' + t[0] + '"' + (t[0] === tab ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>'; }
      function usersTab(t, fresh) {
        t.innerHTML = '<span class="spinner"></span>';
        tabSwr('adminUsers', function () { return api('adminUsers', {}, { quiet: true }); }, function (u) { if (anyPanelOpen()) return; paintUsers(t, u); }, fresh);
      }
      function paintUsers(t, u) {
        var h = '';
        if (u.pending.length) h += '<h3>Pending login approvals</h3>' + u.pending.map(function (p) { return '<div class="card"><div class="bold">' + esc(p.name) + ' · ' + esc(p.device) + '</div><div class="small muted">' + esc(stamp(p.at)) + '</div><label class="f">Device label (optional)</label><input type="text" data-pl="' + esc(p.id) + '" maxlength="30" value="' + esc(p.lastLabel || '') + '"><div class="row" style="margin-top:10px"><button class="btn pri" data-ap="' + esc(p.id) + '">Approve</button><button class="btn bad" data-rj="' + esc(p.id) + '">Reject</button></div></div>'; }).join('');
        h += '<h3>Names</h3>' + u.users.map(function (x) {
          return '<div class="card"><div class="row between"><div><span class="bold" style="font-size:19px">' + esc(x.name) + '</span> ' + (x.admin ? '<span class="chip acc">Admin</span>' : '<span class="chip ' + (x.status === 'active' ? 'ok' : 'warn') + '">' + esc(x.status) + '</span>') + '</div>' +
            (x.admin ? '' : '<div class="row"><button class="btn" data-pm="' + esc(x.id) + '">Permissions</button>' + (x.status === 'active' ? '<button class="btn" data-st="paused" data-id="' + esc(x.id) + '">Pause</button>' : '<button class="btn" data-st="active" data-id="' + esc(x.id) + '">Resume</button>') + '<button class="btn bad" data-st="removed" data-id="' + esc(x.id) + '">Remove</button></div>') + '</div><div id="pm-' + esc(x.id) + '"></div></div>';
        }).join('') + '<h3>Add a name</h3><div class="card"><div class="row"><input type="text" id="newName" class="grow" maxlength="30" placeholder="Name"><button class="btn pri" id="addName">Add</button></div><div class="small muted" style="margin-top:6px">New names get the default permissions.</div></div>';
        t.innerHTML = h;
        $$('[data-ap]', t).forEach(function (b) { b.onclick = function () { api('adminDecide', { id: b.dataset.ap, decision: 'approve', label: $('[data-pl="' + b.dataset.ap + '"]', t).value }).then(function () { toast('Approved.'); usersTab(t, true); }).catch(function (e) { toast(e.message); }); }; });
        $$('[data-rj]', t).forEach(function (b) { b.onclick = function () { api('adminDecide', { id: b.dataset.rj, decision: 'reject' }).then(function () { usersTab(t, true); }).catch(function (e) { toast(e.message); }); }; });
        $$('[data-st]', t).forEach(function (b) { b.onclick = function () { var go = function () { api('adminSetStatus', { id: b.dataset.id, status: b.dataset.st }).then(function () { usersTab(t, true); }).catch(function (e) { toast(e.message); }); }; if (b.dataset.st === 'removed') App.confirm('Remove this name? It disappears from the login list; past records keep the name.', 'Remove').then(function (y) { if (y) go(); }); else go(); }; });
        $('#addName').onclick = function () { api('adminAddUser', { name: $('#newName').value }).then(function () { usersTab(t, true); }).catch(function (e) { toast(e.message); }); };
        $$('[data-pm]', t).forEach(function (b) {
          b.onclick = function () {
            var usr = u.users.filter(function (x) { return x.id === b.dataset.pm; })[0], box = $('#pm-' + usr.id, t);
            if (box.innerHTML) { box.innerHTML = ''; return; }
            function grp(title, list) { return '<h3>' + title + '</h3><div class="permgrid">' + list.map(function (p) { return '<label><input type="checkbox" value="' + p + '"' + (usr.perms.indexOf(p) >= 0 ? ' checked' : '') + '><span class="grow">' + esc(permName(p)) + '<span class="info" data-i="' + p + '">i</span><div class="small muted hide" id="i-' + usr.id + p + '">' + esc(u.info[p]) + '</div></span></label>'; }).join('') + '</div>'; }
            box.innerHTML = '<div style="margin-top:10px"><div class="small muted">Always on: basic part scan (part number, description, MRP).</div>' + grp('Default set', u.defaults) + grp('Extra', u.extra) + '<button class="btn pri" id="sp-' + usr.id + '" style="margin-top:12px">Save permissions</button></div>';
            $$('[data-i]', box).forEach(function (i) { i.onclick = function (e) { e.preventDefault(); $('#i-' + usr.id + i.dataset.i).classList.toggle('hide'); }; });
            $('#sp-' + usr.id).onclick = function () { api('adminSetPerms', { id: usr.id, perms: $$('input:checked', box).map(function (c) { return c.value; }) }).then(function () { toast('Saved.'); }).catch(function (e) { toast(e.message); }); };
          };
        });
      }
      function permName(p) { return { partLocation: 'Part scan: location and transit details', docketGrn: 'Docket GRN', searchParts: 'Search: part numbers only', searchDockets: 'Search: dockets, invoices, case numbers', boxScan: 'Box scan (box contents)', combinedGrn: 'Combined GRN', pendingItems: 'Pending Items', pendingClaims: 'Pending Claims', addDelivery: 'Add delivery', uploadPod: 'Upload POD', uploadClaim: 'Upload claim sheets', editPodRemarks: 'Edit POD remarks', markPoms: 'Mark added to POMS', markSettled: 'Mark claim settled', missedClaims: 'Missed Claims', partyOrders: 'Party Orders: view and add', manageOrders: 'Manage order numbers', printPacking: 'Print packing sheets', transitList: 'Transit List', boxFinder: 'Box Finder', docketHistory: 'Docket timeline and archive search', uploadPacking: 'Upload Packing List', refreshTransit: 'Refresh transit' }[p] || p; }
      function devicesTab(t, fresh) {
        t.innerHTML = '<span class="spinner"></span>';
        tabSwr('adminDevices', function () { return api('adminDevices'); }, function (d) {
          t.innerHTML = d.devices.length ? d.devices.map(function (x) { return '<div class="card"><div class="row between"><div><div class="bold">' + esc(x.name + (x.label ? ' (' + x.label + ')' : '')) + '</div><div class="small muted">' + esc(x.device) + '</div><div class="small">Logged in since ' + esc(C.fmtDay(Math.floor((x.since + 19800000) / 86400000) * 86400000)) + ' (' + x.days + ' days) · last active ' + esc(App.ago(x.lastActive)) + '</div></div><button class="btn bad" data-lo="' + esc(x.userId) + '">Log out</button></div></div>'; }).join('') : '<div class="card muted">Nobody is logged in.</div>';
          $$('[data-lo]', t).forEach(function (b) { b.onclick = function () { api('adminLogoutUser', { userId: b.dataset.lo }).then(function () { toast('Logged out.'); devicesTab(t, true); }); }; });
        }, fresh);
      }
      function settingsTab(t, fresh) {
        t.innerHTML = '<span class="spinner"></span>';
        tabSwr('adminSettings', function () { return api('adminSettings'); }, function (d) {
          if (t.dataset.dirty) return;
          var s = d.settings, days = s.officeDays.split(',').map(Number), dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          t.innerHTML = '<div class="card"><h3 style="margin-top:0">Office hours</h3><div class="row"><div class="grow"><label class="f">Opens</label><input type="text" id="sS" value="' + esc(s.officeStart) + '" placeholder="10:00"></div><div class="grow"><label class="f">Closes</label><input type="text" id="sE" value="' + esc(s.officeEnd) + '" placeholder="19:00"></div></div>' +
            '<label class="f">Working days</label><div class="row">' + [1, 2, 3, 4, 5, 6, 0].map(function (d2) { return '<label class="chip"><input type="checkbox" data-d="' + d2 + '"' + (days.indexOf(d2) >= 0 ? ' checked' : '') + '> ' + dn[d2] + '</label>'; }).join('') + '</div>' +
            '<h3>Orders</h3><label class="f">Order expiry (days)</label><input type="number" id="sX" value="' + esc(s.orderExpiryDays) + '"><h3>Scanning</h3><label class="f">Scan sounds</label><select id="sSnd"><option value="off">Off</option><option value="on">On</option></select>' +
            '<h3>Logins</h3><label class="item"><input type="checkbox" id="sAuto"' + (s.autoAccept === 'on' ? ' checked' : '') + '><span>Auto-accept logins (turn OFF at go-live)</span></label><div class="small muted">Admin email: ' + esc(s.adminEmail) + '</div><button class="btn pri" id="sSave" style="margin-top:14px">Save settings</button></div>';
          $('#sSnd').value = s.scanSounds;
          t.oninput = t.onchange = function () { t.dataset.dirty = '1'; };
          $('#sSave').onclick = function () {
            var dd = $$('[data-d]', t).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.d; }).sort().join(',');
            api('adminSaveSettings', { settings: { officeStart: $('#sS').value.trim(), officeEnd: $('#sE').value.trim(), officeDays: dd, orderExpiryDays: $('#sX').value, scanSounds: $('#sSnd').value, autoAccept: $('#sAuto').checked ? 'on' : 'off' } }).then(function () { toast('Saved.'); }).catch(function (e) { toast(e.message); });
          };
        }, fresh);
      }
      function feedsTab(t, fresh) {
        t.innerHTML = '<span class="spinner"></span>';
        tabSwr('adminFeeds', function () { return Promise.all([api('adminFeedStatus'), api('adminFeedIssues')]); }, function (a) {
          var nm = { transit: 'Transit', price: 'Price list', rack: 'Rack bin list', relay: 'Relay file' };
          t.innerHTML = '<div class="row" style="margin-bottom:10px"><button class="btn pri" id="fr">Refresh now</button><span class="muted small" id="frm"></span></div>' + a[0].meta.map(function (m) { return '<div class="card"><div class="row between"><div class="bold">' + nm[m.source] + '</div><span class="chip ' + (m.status === 'ok' ? 'ok' : 'warn') + '">' + esc(m.status) + '</span></div><div class="small muted">Last update ' + esc(m.updatedAt ? stamp(Number(m.updatedAt)) : 'never') + (m.rows ? ' · ' + m.rows + ' rows' : '') + (m.message ? ' · ' + esc(m.message) : '') + '</div></div>'; }).join('') +
            '<h3>Feed issues (' + a[1].issues.length + ')</h3><div class="card tscroll">' + (a[1].issues.length ? '<table class="dt"><thead><tr><th>Source</th><th>Row</th><th>Problem</th></tr></thead><tbody>' + a[1].issues.map(function (i) { return '<tr><td>' + esc(i.source) + '</td><td>' + esc(i.row) + '</td><td>' + esc(i.reason) + '</td></tr>'; }).join('') + '</tbody></table>' : '<span class="muted">No issues.</span>') + '</div>';
          $('#fr').onclick = function () { busy($('#fr'), true, 'Refreshing…'); api('refreshTransit').then(function () { return App.refreshLists(); }).then(function () { feedsTab(t, true); }).catch(function (e) { toast(e.message); busy($('#fr'), false); }); };
        }, fresh);
      }
      function filesTab(t, fresh) {
        t.innerHTML = '<span class="spinner"></span>';
        tabSwr('adminFiles', function () { return api('adminFiles'); }, function (d) { t.innerHTML = '<div class="card"><div class="row between"><div class="bold">POD helper</div><button class="btn" id="tpod">Test</button></div><div class="small muted" id="tpodr"></div></div><div class="card"><div class="list">' + d.files.map(function (f) { return '<div class="item"><div class="grow"><div class="bold">' + esc(f.name) + '</div><div class="small muted">' + esc(f.type) + '</div></div><span class="chip ' + (f.status === 'ok' ? 'ok' : 'bad') + '">' + (f.status === 'ok' ? 'OK' : 'MISSING') + '</span></div>'; }).join('') + '</div></div>'; $('#tpod').onclick = function () { $('#tpodr').textContent = 'Testing…'; api('adminTestPod').then(function (r) { $('#tpodr').textContent = r.ok ? 'Working · ' + r.account + ' · ' + (r.used / 1073741824).toFixed(2) + ' GB used of ' + (r.limit / 1073741824).toFixed(0) + ' GB' : 'Not working: ' + (r.error || 'no reply'); }).catch(function (e) { $('#tpodr').textContent = e.message; }); }; }, fresh);
      }
    }
  };

})();
