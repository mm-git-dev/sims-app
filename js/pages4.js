/* SIMS screens - stage 4: Box contents, Box Finder, Upload Packing List. */
(function () {
  'use strict';
  var App = window.App, C = SIMS_CORE, $ = App.$, $$ = App.$$, esc = App.esc, api = App.api, toast = App.toast;
  function stamp(ms) { return C.fmtStamp(ms); }
  function busy(btn, on, txt) { if (!btn) return; if (on) { btn._t = btn.textContent; btn.disabled = true; btn.textContent = txt || 'Please wait…'; } else { btn.disabled = false; btn.textContent = btn._t || btn.textContent; } }
  function noList(st) { return '<div class="card warn">This case number is not in the packing list' + (st && st.lastUpload ? ' uploaded ' + esc(stamp(st.lastUpload)) : '') + '. ' + (st && !st.lastUpload ? 'No packing list has been uploaded yet. ' : 'Newer boxes may need a newer upload. ') + 'Ask someone with the Upload Packing List permission.</div>'; }

  // ---------- Box contents ----------
  function boxHtml(d) {
    if (!d.found) return noList(d.status);
    return '<div class="card"><div class="row between"><div><div class="muted small">Case No</div><div class="mono bold" style="font-size:30px;color:var(--accent)">' + esc(d.caseNo) + '</div></div></div>' +
      '<div id="bxShip" style="margin-top:10px"></div></div>' +
      '<div class="card tscroll"><table class="dt"><thead><tr><th>Part</th><th>Description</th><th>Qty</th></tr></thead><tbody>' + d.lines.map(function (l) { return '<tr><td class="mono">' + esc(l.part) + '</td><td>' + esc(l.desc) + '</td><td>' + esc(l.qty) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  // which invoice this box belongs to, and the docket(s) it travelled in: status, expected or arrival date (links to both pages)
  function shipInfo(view, d) {
    var inv = d.invoices && d.invoices[0], box = $('#bxShip', view);
    if (!inv || !box || !(App.can('searchDockets') || App.can('transitList') || App.can('combinedGrn'))) return;
    function fill(v) {
      box = $('#bxShip', view); if (!box || !v || !v.found) return;
      var NOW = Date.now();
      box.innerHTML = '<div class="small muted">Invoice</div><div class="bold mono" style="font-size:18px;margin-bottom:6px">' + App.invLink(inv) + '</div>' +
        v.dockets.map(function (g) {
          if (g.notBooked) return '<div class="item"><div class="grow"><div class="bold">Not booked yet</div></div></div>';
          var sub = g.arrivedAt ? 'Arrived ' + esc(stamp(g.arrivedAt)) : 'LR date ' + (g.lrDate ? esc(C.fmtDay(g.lrDate)) : '—') + ' · Expected ' + (g.expected ? esc(C.fmtDay(g.expected)) + (g.expected < NOW ? ' (late)' : '') : '—');
          return '<div class="item"><div class="grow"><div class="small muted">Docket (LR)</div><div class="bold mono" style="font-size:18px">' + App.lrLink(g.lr) + '</div><div class="small muted">' + sub + '</div></div>' + App.statusChip(g.status) + '</div>';
        }).join('');
    }
    App.swr('invoice:' + inv, function () { return api('invoiceDetails', { q: inv }); }, fill, { silent: true, noStatus: true });
  }
  App.pages.box = {
    render: function (view, r) {
      if (!App.can('boxScan') && !App.can('boxFinder')) { view.innerHTML = '<div class="card">You do not have permission to see box contents.</div>'; return; }
      var c = String(r.arg || '').replace(/\D/g, '');
      function paint(d) {
        App.keepState(view, function () {
          // same small button as on the part page, under the contents
          view.innerHTML = boxHtml(d) + '<div class="row" style="margin-top:14px"><button class="btn pri' + (App.canScan() ? '' : ' hide') + '" id="bxScan">Scan next box</button></div>';
          $('#bxScan', view).onclick = function () { App.scan({ mode: 'route' }); };
          if (d.found) shipInfo(view, d);
          App.feedback(!!d.found);
        });
      }
      function load(fresh) { return App.swr('box:' + c, function () { return api('boxInfo', { caseNo: c }); }, paint, { fresh: fresh }); }
      // The packing list is kept on the device, so a box found there opens at once with no server call.
      var rows = App.lists.packByCase && App.lists.packByCase.get(c);
      if (rows && rows.length) {
        var inv = {}; rows.forEach(function (x) { inv[x.invoice] = 1; });
        paint({ found: true, caseNo: c, delivery: rows[0].delivery, carton: rows[0].carton, uploadedAt: rows[0].at, invoices: Object.keys(inv),
          lines: rows.map(function (x) { return { part: x.part, desc: x.desc, qty: x.qty, invoice: x.invoice }; }), total: rows.reduce(function (t, x) { return t + x.qty; }, 0) });
        return;
      }
      // not on the device (a newer upload, or the list has not arrived yet): ask the server as before
      App.live(function () { load(false); });
      return load(false);
    }
  };

  // ---------- Box Finder ----------
  App.pages['box-finder'] = {
    perm: 'boxFinder',
    render: function (view, r) {
      view.innerHTML = '<div class="card"><label class="f">Invoice number</label><input type="text" id="bfI" inputmode="numeric" autocomplete="off"><div id="bfIS"></div><label class="f">Part number</label><input type="text" id="bfP" autocapitalize="characters" autocomplete="off"><div id="bfPS"></div><div style="margin-top:12px"><button class="btn pri" id="bfGo">Find box</button></div></div><div id="bfRes" style="margin-top:12px"></div>';
      var res = $('#bfRes', view), inv = $('#bfI', view), prt = $('#bfP', view);
      function go() {
        var i = inv.value.replace(/\s+/g, ''), p = prt.value.replace(/\s+/g, '').toUpperCase();
        if (!i || !p) { toast('Enter the invoice number and the part number.'); return; }
        function digits(x) { return String(x || '').replace(/\D/g, ''); }
        function same(typed, listed) { var t = digits(typed), l = digits(listed); if (!t || !l) return false; if (t === l) return true; return t.length >= 5 && l.length >= 5 && (t.slice(-l.length) === l || l.slice(-t.length) === t); }
        var local = null, pool = App.lists.packByPart && App.lists.packByPart.get(p);
        if (pool) { var by = {}; pool.filter(function (x) { return same(i, x.invoice); }).forEach(function (x) { var e = by[x.caseNo] || (by[x.caseNo] = { caseNo: x.caseNo, carton: x.carton, qty: 0, invoice: x.invoice }); e.qty += x.qty; }); var ks = Object.keys(by); if (ks.length) local = { found: true, cases: ks.map(function (k) { return by[k]; }) }; }
        res.innerHTML = local ? '' : '<span class="spinner"></span>';
        (local ? Promise.resolve(local) : api('boxFind', { invoice: i, part: p })).then(function (d) {
          if (!d.found) { res.innerHTML = '<div class="card bad">Not found in the packing list' + (d.status && d.status.lastUpload ? ' uploaded ' + esc(stamp(d.status.lastUpload)) : '') + '. Check the invoice and part number.</div>'; App.feedback(false); return; }
          App.feedback(true);
          // every case that holds this part, fully open: all its contents on this one page, the searched part on a grey band
          var cases = d.cases.slice().sort(function (a, b) { return String(a.caseNo) < String(b.caseNo) ? -1 : 1; }), total = 0; cases.forEach(function (x) { total += Number(x.qty) || 0; });
          res.innerHTML = '<div class="small muted" style="margin-bottom:6px">Packed in ' + cases.length + (cases.length === 1 ? ' case' : ' cases') + ' · ' + total + (total === 1 ? ' piece' : ' pieces') + '</div><div id="bfCases"><span class="spinner"></span></div>';
          return Promise.all(cases.map(function (x) {
            var rows = App.lists.packByCase && App.lists.packByCase.get(x.caseNo);
            return rows ? { caseNo: x.caseNo, lines: rows } : api('boxInfo', { caseNo: x.caseNo }).then(function (b) { return { caseNo: x.caseNo, lines: (b.lines || []) }; });
          })).then(function (boxes) {
            // same table as the packing list on the invoice page: case number once per case in the accent colour, a heavier line between cases, the searched part on a grey band
            $('#bfCases', res).innerHTML = '<div class="card tscroll"><table class="dt"><thead><tr><th>Case</th><th>Part</th><th>Description</th><th>Qty</th></tr></thead><tbody>' + boxes.map(function (b) {
              var ls = b.lines.slice().sort(function (a, c) { return String(a.part) < String(c.part) ? -1 : 1; });
              return ls.map(function (l, n) {
                var hit = String(l.part).toUpperCase() === p && same(i, l.invoice), st = hit ? ' style="background:var(--bfhit);font-weight:600"' : '';
                return '<tr' + (n === 0 ? ' style="border-top:3px solid var(--line)"' : '') + '>' + (n === 0 ? '<td class="mono bold" rowspan="' + ls.length + '" style="color:var(--accent);vertical-align:top;font-size:17px">' + esc(b.caseNo) + '</td>' : '') + '<td class="mono"' + st + '>' + esc(l.part) + '</td><td' + st + '>' + esc(l.desc) + '</td><td' + st + '>' + esc(l.qty) + '</td></tr>';
              }).join('');
            }).join('') + '</tbody></table></div>';
          });
        }).catch(function (e) { res.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      }
      $('#bfGo', view).onclick = go;
      [inv, prt].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); }); });
      // as-you-type lists from the packing list on this device: invoices first, then only the parts of the chosen invoice
      function digits2(x) { return String(x || '').replace(/\D/g, ''); }
      function invoicesFor(txt) {
        var q = digits2(txt), idx = App.lists.packByInv; if (!idx || q.length < 3) return [];
        var starts = [], inside = [];
        idx.forEach(function (rows, k) { var n = k.indexOf(q); if (n === 0) starts.push(k); else if (n > 0 && q.length >= 4) inside.push(k); });
        return starts.concat(inside).slice(0, 8).map(function (k) { var rows = idx.get(k), cs = {}; rows.forEach(function (x) { cs[x.caseNo] = 1; }); return { v: k, t: k, s: rows.length + (rows.length === 1 ? ' part line' : ' part lines') + ' · ' + Object.keys(cs).length + (Object.keys(cs).length === 1 ? ' case' : ' cases') }; });
      }
      function partsOfInvoice(txt) {
        var idx = App.lists.packByInv, q = digits2(inv.value), pq = txt.replace(/\s+/g, '').toUpperCase(); if (!idx || !q) return [];
        var rows = idx.get(q) || [];   // the invoice must be chosen (or typed in full): only its own parts are offered
        var by = {}; rows.forEach(function (x) { var e = by[x.part] || (by[x.part] = { part: x.part, desc: x.desc, qty: 0, cases: {} }); e.qty += x.qty; e.cases[x.caseNo] = 1; });
        var out = Object.keys(by).filter(function (k) { return !pq || k.toUpperCase().indexOf(pq) === 0 || (pq.length >= 3 && k.toUpperCase().indexOf(pq) > 0); }).sort().slice(0, 40);
        return out.map(function (k) { var e = by[k]; return { v: e.part, t: e.part, s: e.desc, r: 'Qty ' + e.qty }; });
      }
      var pl = App.pickList(prt, $('#bfPS', view), partsOfInvoice, function () { go(); }, { onFocus: true });
      App.pickList(inv, $('#bfIS', view), invoicesFor, function () { prt.value = ''; prt.focus(); pl.refresh(); });
      inv.addEventListener('input', function () { pl.refresh(); });
      // opened from a part on the invoice page: fill both boxes and show where that part is packed
      if (r && r.q && r.q.i && r.q.p) { inv.value = r.q.i; prt.value = r.q.p; go(); } else inv.focus();
    }
  };

  // ---------- Upload Packing List ----------
  var CHUNK = 1200;
  App.pages['upload-packing'] = {
    perm: 'uploadPacking',
    render: function (view) {
      view.innerHTML = '<div class="card" id="upStat"><span class="spinner"></span></div><div class="card"><h3 style="margin-top:0">Upload the company packing list</h3><div class="muted small">The Excel file exported from the company portal (the Data sheet). Boxes are kept for 30 days. Uploading again replaces the boxes that appear in the new file.</div>' +
        '<div style="margin:12px 0"><button class="btn pri" id="upPick">Choose Excel file</button><input type="file" id="upFile" accept=".xlsx,.xls,.csv" class="hide"></div><div id="upMsg"></div></div>';
      function stat(fresh) {
        return App.swr('packStatus', function () { return api('packStatus'); }, function (s) {
          var el = $('#upStat'); if (!el) return;
          el.innerHTML = s.lastUpload ? '<div class="bold">Last upload: ' + esc(stamp(s.lastUpload)) + '</div><div class="small muted">' + s.rows + ' lines · ' + s.ageDays + ' day' + (s.ageDays === 1 ? '' : 's') + ' ago' + (s.remind ? ' · <span style="color:var(--warn)">time for a new upload</span>' : '') + '</div>' : '<div class="bold" style="color:var(--warn)">No packing list uploaded yet.</div>';
        }, { fresh: fresh });
      }
      stat();
      var file = $('#upFile', view), msg = $('#upMsg', view);
      $('#upPick', view).onclick = function () { file.click(); };
      function loadXlsx() { return new Promise(function (res, rej) { if (window.XLSX) return res(); var s = document.createElement('script'); s.src = 'lib/xlsx.mini.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
      file.onchange = function () {
        var f = file.files && file.files[0]; if (!f) return;
        msg.innerHTML = '<span class="spinner"></span> Reading ' + esc(f.name) + '…';
        Promise.all([loadXlsx(), f.arrayBuffer()]).then(function (a) {
          var wb = XLSX.read(a[1], { type: 'array' }), name = wb.SheetNames.indexOf('Data') >= 0 ? 'Data' : wb.SheetNames[0];
          var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }), p = C.parsePackingList(rows);
          if (!p.ok) { msg.innerHTML = '<div class="card bad err">This does not look like the packing list: ' + esc(p.reason) + '</div>'; return; }
          var cases = {}; p.lines.forEach(function (l) { cases[l.caseNo] = 1; });
          var caseList = Object.keys(cases), arr = p.lines.map(function (l) { return [l.caseNo, l.invoice, l.delivery, l.carton, l.part, l.desc, l.qty]; });
          msg.innerHTML = '<div class="card"><b>' + arr.length + '</b> lines in <b>' + caseList.length + '</b> cases' + (p.bad ? ' · ' + p.bad + ' unreadable rows will be skipped' : '') + '.<div style="margin-top:10px"><button class="btn pri" id="upGo">Upload</button></div></div>';
          $('#upGo').onclick = function () { send(caseList, arr, p.bad || 0); };
        }).catch(function (e) { msg.innerHTML = '<div class="card bad err">Could not read that file: ' + esc(e && e.message || e) + '</div>'; });
      };
      function send(cases, arr, bad) {
        var b = $('#upGo'); busy(b, true, 'Uploading…');
        var sent = 0;
        function prog() { msg.querySelector('.card').insertAdjacentHTML('beforeend', ''); b.textContent = 'Uploading… ' + Math.round(sent / arr.length * 100) + '%'; }
        api('packUpload', { begin: true, cases: cases }).then(function () {
          var chain = Promise.resolve();
          for (var i = 0; i < arr.length; i += CHUNK) (function (part) { chain = chain.then(function () { return api('packUpload', { lines: part }).then(function () { sent += part.length; prog(); }); }); })(arr.slice(i, i + CHUNK));
          return chain;
        }).then(function () { return api('packUpload', { end: true, total: arr.length, cases: cases.length, bad: bad }).then(function (r) { App.refreshLists(); return r; }); })
          .then(function () { msg.innerHTML = '<div class="card ok"><b>Done.</b> ' + arr.length + ' lines in ' + cases.length + ' cases are ready for Box Finder and box scanning.</div>'; file.value = ''; stat(true); })
          .catch(function (e) { busy(b, false); msg.insertAdjacentHTML('beforeend', '<div class="card bad err">' + esc(e.message) + ' Upload again to retry.</div>'); });
      }
    }
  };
})();
