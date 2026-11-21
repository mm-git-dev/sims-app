/* SIMS screens - stage 3: Party Orders (Order Numbers, Order Status, packing sheets) and the Transit List. */
(function () {
  'use strict';
  var App = window.App, C = SIMS_CORE, $ = App.$, $$ = App.$$, esc = App.esc, api = App.api, toast = App.toast;
  var DAY = 86400000;
  function stamp(ms) { return C.fmtStamp(ms); }
  function today() { var d = new Date(Date.now() + 19800000); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function busy(btn, on, txt) { if (!btn) return; if (on) { btn._t = btn.textContent; btn.disabled = true; btn.textContent = txt || 'Please wait…'; } else { btn.disabled = false; btn.textContent = btn._t || btn.textContent; } }
  function dateMs(v) { return v ? Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) : null; }
  function inr(n) { return C.fmtINR(n); }
  function lakh(n) { return '₹ ' + (n / 100000).toFixed(2) + ' L'; }
  function xlsx(rows, sheetName, file) {
    function mk() { var ws = XLSX.utils.aoa_to_sheet(rows), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName); XLSX.writeFile(wb, file); }
    if (window.XLSX) return mk();
    var s = document.createElement('script'); s.src = 'lib/xlsx.mini.min.js'; s.onload = mk; document.head.appendChild(s);
  }
  var STATE_CHIP = { 'Active': 'ok', 'Expires soon': 'warn', 'Expired': 'bad', 'Closed': '' };

  // =====================================================================
  // Party Orders
  // =====================================================================
  App.pages['party-orders'] = {
    perm: 'partyOrders',
    render: function (view, r) {
      var tab = r.arg === 'status' ? 'status' : 'numbers', data = null, mark = (r.q && r.q.mark) || '', filter = 'Active';
      view.innerHTML = '<div class="tabs"><button data-t="numbers"' + (tab === 'numbers' ? ' class="on"' : '') + '>Order Numbers</button><button data-t="status"' + (tab === 'status' ? ' class="on"' : '') + '>Order Status</button></div><div id="poBody"></div>';
      $$('.tabs button', view).forEach(function (b) { b.onclick = function () { App.go('#/party-orders/' + b.dataset.t + (mark && b.dataset.t === 'status' ? '?mark=' + encodeURIComponent(mark) : '')); }; });
      var body = $('#poBody', view);

      function take(x) { if (x && x.list) { data = x.list; try { localStorage.setItem('sims.c.' + App.me.user.id + '.orders', JSON.stringify({ d: data, t: Date.now() })); } catch (e) { } if (tab === 'numbers') { drawNumbers(); } else drawStatus(); } else loadOrders(true); }
      function loadOrders(fresh) { return App.swr('orders', function () { return api('orders'); }, function (d) { data = d; App.keepState(body, function () { if (tab === 'numbers') drawNumbers(); else drawStatus(); }); }, { fresh: fresh }).catch(function (e) { body.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; }); }

      // ---------- Order Numbers ----------
      function drawNumbers() {
        var yy = String(new Date(Date.now() + 19800000).getUTCFullYear()).slice(2);
        var states = ['All', 'Active', 'Expires soon', 'Expired', 'Closed'];
        var rows = data.orders.filter(function (o) { return filter === 'All' || o.state === filter; });
        var q = ($('#poQ') || {}).value || '';
        if (q) { var uq = q.toUpperCase().replace(/\s+/g, ''); rows = rows.filter(function (o) { return (o.pso + o.mark + (o.party || '').toUpperCase()).replace(/\s+/g, '').indexOf(uq) >= 0; }); }
        var html = '<div class="card"><h3 style="margin-top:0">Add order number</h3>' +
          '<label class="f">Order number (only the digits after PPO30256' + yy + ' — do not type the year ' + yy + ')</label><input type="text" id="aPso" inputmode="numeric" autocomplete="off" placeholder="135 for PPO30256' + yy + '135">' +
          '<div class="row"><div class="grow"><label class="f">Private mark</label><input type="text" id="aMark" autocapitalize="characters" autocomplete="off" maxlength="20" style="text-transform:uppercase"></div><div class="grow"><label class="f">Order date</label><input type="date" id="aDate" value="' + today() + '"></div></div>' +
          '<label class="f">Party name (optional)</label><input type="text" id="aParty" maxlength="60" autocomplete="off"><div style="margin-top:12px"><button class="btn pri" id="aAdd">Add order number</button></div><div id="aMsg" class="small" style="margin-top:8px"></div></div>' +
          '<div class="tabs" id="poChips" style="margin-top:14px">' + states.map(function (s) { return '<button data-s="' + esc(s) + '"' + (filter === s ? ' class="on"' : '') + '>' + esc(s) + '</button>'; }).join('') + '</div>' +
          '<input type="search" id="poQ" enterkeyhint="search" placeholder="Filter order numbers, marks or parties" value="' + esc(q) + '" style="margin:10px 0">' +
          '<div class="card">' + (rows.length ? '<div class="list">' + rows.map(function (o) {
            return '<div class="item"><div class="grow"><div class="bold mono">' + esc(o.pso) + '</div><div class="small muted">Ordered ' + esc(C.fmtDay(o.orderDate)) + ' · expires ' + esc(C.fmtDay(o.expiresAt)) + (o.party ? ' · ' + esc(o.party) : '') + (o.state === 'Closed' ? ' · ' + esc(o.closeReason || '') + (o.note ? ': ' + esc(o.note) : '') : '') + '</div></div>' +
              '<a class="chip acc" href="#/party-orders/status?mark=' + encodeURIComponent(o.mark) + '" style="text-decoration:none;margin-right:6px">' + esc(o.mark) + '</a><span class="chip ' + (STATE_CHIP[o.state] || '') + '">' + esc(o.state) + '</span>' +
              (data.canManage ? '<button class="btn" data-ed="' + esc(o.pso) + '" style="margin-left:8px">Edit</button>' + (o.state === 'Closed' ? '<button class="btn" data-ro="' + esc(o.pso) + '">Reopen</button>' : '<button class="btn" data-cl="' + esc(o.pso) + '">Close</button>') : '') + '</div>';
          }).join('') + '</div>' : '<span class="muted">No order numbers here.</span>') + '</div>';
        if (data.isAdmin && data.marks.length) {
          html += '<h3>Alert on GRN</h3><div class="card"><div class="small muted" style="margin-bottom:8px">When ticked, every part under that mark sends a Client Part Alert once it is GRN\'d (messages start when Telegram is connected).</div><div class="list">' + data.marks.map(function (m) {
            return '<label class="item"><input type="checkbox" data-al="' + esc(m.mark) + '"' + (m.alert ? ' checked' : '') + '><span class="bold">' + esc(m.mark) + '</span><span class="muted small">' + esc(m.party || '') + '</span></label>';
          }).join('') + '</div></div>';
        }
        body.innerHTML = html;
        $$('#poChips button', body).forEach(function (b) { b.onclick = function () { filter = b.dataset.s; drawNumbers(); }; });
        $('#poQ').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } };
        $('#poQ').oninput =function () { var pos = this.selectionStart; drawNumbers(); var el = $('#poQ'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } };
        var mk = $('#aMark'); mk.oninput = function () { var p = mk.selectionStart; mk.value = mk.value.toUpperCase(); try { mk.setSelectionRange(p, p); } catch (e) { } };
        $('#aAdd').onclick = function () {
          var b = this, args = { pso: $('#aPso').value, mark: mk.value, party: $('#aParty').value, orderDate: dateMs($('#aDate').value) };
          if (!args.pso.trim()) { toast('Enter the order number.'); $('#aPso').focus(); return; }
          if (!args.mark.trim()) { toast('Enter the private mark.'); mk.focus(); return; }
          var typed = args.pso.replace(/\s+/g, ''), oy = String(new Date(args.orderDate + 19800000).getUTCFullYear()).slice(2);
          var ask = Promise.resolve(true);
          if (/^\d+$/.test(typed) && typed.length >= 4 && typed.indexOf(oy) === 0) {
            var short = typed.slice(2);
            ask = App.confirm('You typed ' + typed + '. The year (' + oy + ') is added automatically, so this would become PPO30256' + oy + typed + '. Did you mean ' + short + ' (PPO30256' + oy + short + ')?', 'Use ' + short, 'Keep ' + typed).then(function (y) { if (y) { args.pso = short; $('#aPso').value = short; } return true; });
          }
          ask.then(function () {
            busy(b, true, 'Adding…');
            return api('orderAdd', args).then(function (x) { toast(x.pso + ' added under ' + x.mark + '.'); take(x); }).catch(function (e) { busy(b, false); $('#aMsg').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
          });
        };
        $$('[data-al]', body).forEach(function (c) { c.onchange = function () { api('markAlert', { mark: c.dataset.al, on: c.checked }).then(function () { toast('Alert on GRN ' + (c.checked ? 'on' : 'off') + ' for ' + c.dataset.al + '.'); }).catch(function (e) { c.checked = !c.checked; toast(e.message); }); }; });
        $$('[data-ed]', body).forEach(function (b) { b.onclick = function () { editOrder(data.orders.filter(function (o) { return o.pso === b.dataset.ed; })[0]); }; });
        $$('[data-cl]', body).forEach(function (b) { b.onclick = function () { closeOrder(b.dataset.cl); }; });
        $$('[data-ro]', body).forEach(function (b) { b.onclick = function () { api('orderReopen', { pso: b.dataset.ro }).then(function (x) { toast('Reopened.'); take(x); }).catch(function (e) { toast(e.message); }); }; });
      }
      function editOrder(o) {
        var dt = new Date(o.orderDate).toISOString().slice(0, 10);
        App.modal('<h2 style="margin-top:0">Edit ' + esc(o.pso) + '</h2><label class="f">Private mark</label><input type="text" id="eMark" value="' + esc(o.mark) + '" maxlength="20" style="text-transform:uppercase"><label class="f">Party name</label><input type="text" id="eParty" value="' + esc(o.party || '') + '" maxlength="60"><label class="f">Order date</label><input type="date" id="eDate" value="' + dt + '"><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Save</button></div>', function (m, close) {
          $('[data-n]', m).onclick = close;
          $('[data-y]', m).onclick = function () {
            busy($('[data-y]', m), true, 'Saving…');
            api('orderEdit', { pso: o.pso, mark: $('#eMark', m).value, party: $('#eParty', m).value, orderDate: dateMs($('#eDate', m).value) }).then(function (x) { close(); toast('Saved.'); take(x); }).catch(function (e) { busy($('[data-y]', m), false); toast(e.message, 4000); });
          };
        });
      }
      function closeOrder(pso) {
        App.modal('<h2 style="margin-top:0">Close ' + esc(pso) + '</h2><label class="f">Reason</label><select id="cR"><option>Cancelled by party</option><option>Other</option></select><label class="f">Note (optional)</label><input type="text" id="cN" maxlength="200"><div class="small muted" style="margin-top:8px">Parts already invoiced will still arrive and still show the mark.</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Close order</button></div>', function (m, close) {
          $('[data-n]', m).onclick = close;
          $('[data-y]', m).onclick = function () {
            busy($('[data-y]', m), true, 'Closing…');
            api('orderClose', { pso: pso, reason: $('#cR', m).value, note: $('#cN', m).value }).then(function (x) { close(); toast('Closed.'); take(x); }).catch(function (e) { busy($('[data-y]', m), false); toast(e.message, 4000); });
          };
        });
      }

      // ---------- Order Status ----------
      var st = null;
      function drawStatus() {
        var marks = data.marks;
        var sel = '<label class="f">Party mark</label><div class="row"><select id="sMark" class="grow"><option value="">Pick a mark…</option>' + marks.map(function (m) { return '<option value="' + esc(m.mark) + '"' + (m.mark === mark ? ' selected' : '') + '>' + esc(m.mark + (m.party ? ' — ' + m.party : '')) + '</option>'; }).join('') + '</select></div>';
        body.innerHTML = '<div class="card">' + sel + '</div><div id="sBody" style="margin-top:12px"></div>';
        $('#sMark').onchange = function () { mark = this.value; history.replaceState(null, '', '#/party-orders/status' + (mark ? '?mark=' + encodeURIComponent(mark) : '')); loadStatus(false); };
        if (mark) loadStatus(false);
      }
      function loadStatus(fresh) {
        var sb = $('#sBody'); if (!sb) return;
        if (!mark) { sb.innerHTML = ''; return; }
        var my = mark;
        return App.swr('orderStatus:' + my, function () { return api('orderStatus', { mark: my }); }, function (d) { if (my !== mark || !$('#sBody')) return; st = d; App.keepState($('#sBody'), function () { paintStatus(d); }); }, { fresh: fresh }).catch(function (e) { if ($('#sBody')) $('#sBody').innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      }
      function lineRow(l, sel, tr) {
        return '<div class="item">' + (sel ? '<input type="checkbox" data-k="' + esc(l.key) + '" checked>' : '') + '<div class="grow"><div><span class="bold mono">' + App.partLink(l.part) + '</span> <span class="muted">× ' + esc(l.qty) + '</span></div><div class="small muted">' + esc(l.desc) + '</div>' +
          ((tr && l.lrDate) ? '<div class="small muted">Expected ' + esc(C.fmtDay(C.expectedDate(l.lrDate, 12))) + '</div>' : (l.batch ? '<div class="small muted">' + esc(l.batch) + '</div>' : '')) +
          (l.early ? '<div class="small" style="color:var(--warn)">GRN\'d early on ' + esc(C.fmtDay(l.grnDate)) + ', may have been sold, pick from location or reorder.</div>' : '') + '</div></div>';
      }
      function section(title, arr, cls, sel) { return '<h3>' + esc(title) + ' <span class="chip ' + (cls || '') + '">' + arr.length + '</span></h3><div class="card">' + (arr.length ? '<div class="list">' + arr.map(function (l) { return lineRow(l, sel, title === 'In transit'); }).join('') + '</div>' : '<span class="muted">None.</span>') + '</div>'; }
      function paintStatus(d) {
        var canPrint = App.can('printPacking'), html = '<div class="card"><div class="row between"><div><div class="bold" style="font-size:20px">' + esc(d.mark) + '</div><div class="muted small">' + esc(d.party || '') + '</div></div><div class="right"><div class="small muted">Ready to pack</div><div class="bold" style="font-size:20px">₹ ' + inr(d.ready) + '</div></div></div>' +
          '<div class="row" style="margin-top:10px">' + (canPrint ? '<button class="btn pri" id="pPrint"' + (d.awaiting.length ? '' : ' disabled') + '>Print packing sheet</button>' : '') + '<button class="btn" id="pXl">Download Excel</button></div></div>';
        html += section('In transit', d.transit, '') + section('Arrived', d.arrived || [], (d.arrived || []).length ? 'warn' : '') + section('Awaiting packing', d.awaiting, d.awaiting.length ? 'warn' : '', canPrint) + section('Packed', d.packed, 'ok');
        if (d.batches.length) html += '<h3>Packing batches</h3><div class="card"><div class="list">' + d.batches.map(function (b) { return '<div class="item"><div class="grow"><div class="bold">' + esc(b.name) + '</div><div class="small muted">' + esc(stamp(b.at)) + ' · ' + esc(b.by + (b.label ? ' (' + b.label + ')' : '')) + ' · ' + b.count + ' parts</div></div>' + (canPrint ? '<button class="btn" data-rp="' + esc(b.id) + '">Reprint</button>' : '') + '</div>'; }).join('') + '</div></div>';
        $('#sBody').innerHTML = html;
        var pp = $('#pPrint'); if (pp) pp.onclick = function () {
          var keys = $$('#sBody [data-k]').filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.k; });
          if (!keys.length) { toast('Tick at least one part to pack.'); return; }
          busy(pp, true, 'Preparing…');
          api('packPrint', { mark: d.mark, keys: keys }).then(function (x) { return SIMSPrint.print(SIMSPrint.packingSheet(x.sheet)).then(function () { toast('Packing sheet ' + x.sheet.batch + ' printed. Parts marked Packed.'); busy(pp, false); loadStatus(true); }); }).catch(function (e) { busy(pp, false); toast(e.message, 5000); });
        };
        $('#pXl').onclick = function () {
          var rows = [['Section', 'Part No', 'Description', 'Qty', 'Invoice', 'LR', 'LR Date', 'Order', 'Location', 'Note']];
          [['In transit', d.transit], ['Arrived', d.arrived || []], ['Awaiting packing', d.awaiting], ['Packed', d.packed]].forEach(function (s) { s[1].forEach(function (l) { rows.push([s[0], l.part, l.desc, l.qty, l.invoice, l.lr, l.lrDate ? C.fmtDay(l.lrDate) : '', l.pso, l.loc, l.early ? 'GRN\'d early ' + C.fmtDay(l.grnDate) : (l.batch || '')]); }); });
          xlsx(rows, d.mark, 'Order-Status-' + d.mark + '.xlsx');
        };
        $$('[data-rp]', $('#sBody')).forEach(function (b) { b.onclick = function () { api('packReprint', { id: b.dataset.rp }).then(function (x) { return SIMSPrint.print(SIMSPrint.packingSheet(x.sheet)); }).catch(function (e) { toast(e.message); }); }; });
      }
      App.live(function () { loadOrders(false); if (tab === 'status' && mark) loadStatus(false); });
      return loadOrders(false);
    }
  };

  // =====================================================================
  // Transit List (works on the transit list saved on this device)
  // =====================================================================
  App.pages.transit = {
    perm: 'transitList',
    render: function (view) {
      var tab = 'list', F = {}, limit = 200, sortValue = false, open = {};
      var NOW = Date.now(), admin = App.me.user.admin;
      function rows() {
        var L = App.lists, tr = L.raw.transit || [], mk = L.marks || {}, price = L.price || new Map();
        return tr.map(function (r) {
          var p = price.get(r[1]), lrDate = r[5] || null, state = C.transitState(lrDate, NOW), mark = mk[r[9] || (/^PPO/.test(r[6]) ? r[6] : '')] || '';
          return { invoice: r[0], part: r[1], desc: r[2], qty: r[3], lr: r[4], lrDate: lrDate, po: r[6], mark: mark, state: state, expected: lrDate ? lrDate + 8 * DAY : null, value: p && p.ndp ? r[3] * p.ndp * (1 + (p.tax || 0) / 100) : 0 };
        });
      }
      var ALL = [];
      function stateChip(s) { return s === 'overdue' ? '<span class="chip bad">Overdue</span>' : s === 'notBooked' ? '<span class="chip">Not booked yet</span>' : ''; }
      function lineTable(arr) {
        return '<div class="tscroll"><table class="dt sticky1"><thead><tr><th>Part</th><th>Description</th><th>Qty</th><th>Invoice</th><th>LR</th><th>LR date</th><th>Expected</th><th>Mark</th></tr></thead><tbody>' + arr.map(function (x) {
          return '<tr><td class="mono">' + App.partLink(x.part) + '</td><td>' + esc(x.desc) + '</td><td>' + esc(x.qty) + '</td><td class="mono">' + App.invLink(x.invoice) + '</td><td class="mono">' + (x.lr ? App.lrLink(x.lr) : '') + '</td><td>' + (x.lrDate ? esc(C.fmtDay(x.lrDate)) : '—') + ' ' + stateChip(x.state) + '</td><td>' + (x.expected ? esc(C.fmtDay(x.expected)) : '') + '</td><td>' + (x.mark ? '<span class="chip acc">' + esc(x.mark) + '</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      }
      function listFiltered() {
        return ALL.filter(function (x) {
          return Object.keys(F).every(function (k) {
            var v = F[k]; if (!v || k === 'lrDateRaw') return true;
            var cell = k === 'lrDate' ? (x.lrDate ? C.fmtDay(x.lrDate) : '') : k === 'mark' ? x.mark + ' ' + x.po : String(x[k]);
            return k === 'lrDate' ? cell.toUpperCase() === v : cell.toUpperCase().indexOf(v) >= 0;
          });
        });
      }
      function drawList(host) {
        var phone = window.matchMedia('(max-width:800px)').matches;
        var cols = [['part', 'Part'], ['desc', 'Description'], ['invoice', 'Invoice'], ['lr', 'LR'], ['mark', 'Mark / PO']];
        if (!phone) { cols.splice(2, 0, ['qty', 'Qty']); cols.splice(5, 0, ['lrDate', 'LR date']); } else { delete F.qty; delete F.lrDate; }
        host.innerHTML = '<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:flex-end">' + cols.map(function (c) {
          return c[0] === 'lrDate' ? '<div style="flex:1 1 150px;min-width:140px"><label class="f" style="margin:0 0 2px;font-size:12px">LR date</label><input type="date" data-fd="1" title="LR date" value="' + esc(F.lrDateRaw || '') + '"></div>'
            : '<input type="search" enterkeyhint="search" data-f="' + c[0] + '" placeholder="' + esc(c[1]) + '" aria-label="Filter ' + esc(c[1]) + '" value="' + esc(F[c[0]] || '') + '" style="flex:1 1 130px;min-width:110px">';
        }).join('') + '</div><div id="tlRes"></div>';
        $$('[data-f]', host).forEach(function (i) {
          i.oninput = function () { F[i.dataset.f] = i.value.trim().toUpperCase(); limit = 200; paintList(); };
          i.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } };
        });
        var fd = $('[data-fd]', host); if (fd) fd.onchange = function () { F.lrDateRaw = fd.value; F.lrDate = fd.value ? C.fmtDay(dateMs(fd.value)).toUpperCase() : ''; limit = 200; paintList(); };
        paintList();
      }
      function paintList() {
        var res = $('#tlRes'); if (!res) return;
        var all = listFiltered(), shown = all.slice(0, limit);
        res.innerHTML = '<div class="small muted" style="margin-bottom:6px">' + all.length + ' of ' + ALL.length + ' lines</div><div class="card" style="padding:0">' + lineTable(shown) + '</div>' + (all.length > limit ? '<div style="margin:12px 0"><button class="btn" id="tlMore">Show 200 more</button></div>' : '');
        var m = $('#tlMore'); if (m) m.onclick = function () { limit += 200; paintList(); };
      }
      function groups(keyFn, extra) {
        var g = {}; ALL.forEach(function (x) { var k = keyFn(x); if (!k) return; var e = g[k] || (g[k] = { key: k, lines: [], party: 0, overdue: 0, value: 0, minDate: null }); e.lines.push(x); if (x.mark) e.party++; if (x.state === 'overdue') e.overdue++; e.value += x.value; if (x.lrDate && (e.minDate === null || x.lrDate < e.minDate)) e.minDate = x.lrDate; });
        return Object.keys(g).map(function (k) { return g[k]; });
      }
      function drawGroups(host, byParty) {
        var gs = groups(function (x) { return byParty ? x.mark : x.lr; });
        gs.sort(function (a, b) { if (!byParty && admin && sortValue) return b.value - a.value; return (b.overdue > 0) - (a.overdue > 0) || (a.minDate || 9e15) - (b.minDate || 9e15); });
        host.innerHTML = (admin && !byParty ? '<div class="row" style="margin-bottom:8px"><label class="item" style="flex:0 0 auto"><input type="checkbox" id="tgVal"' + (sortValue ? ' checked' : '') + '><span>Sort by value</span></label></div>' : '') +
          (gs.length ? gs.map(function (g, i) {
            var isOpen = open[g.key];
            return '<div class="card"><div class="item click" data-g="' + esc(g.key) + '"><div class="grow"><div class="bold mono">' + esc(byParty ? g.key : g.key) + '</div><div class="small muted">' + g.lines.length + ' lines' + (byParty ? '' : ' · ' + g.party + ' party parts') + (g.minDate ? ' · LR ' + esc(C.fmtDay(g.minDate)) : ' · not booked yet') + '</div></div>' + (g.overdue ? '<span class="chip bad">' + g.overdue + ' overdue</span>' : '') + (admin && !byParty ? '<span class="bold" style="margin-left:8px">' + esc(lakh(g.value)) + '</span>' : '') + (byParty ? '<a class="btn" href="#/party-orders/status?mark=' + encodeURIComponent(g.key) + '" style="margin-left:8px">Order Status</a>' : '') + '</div>' + (isOpen ? lineTable(g.lines) : '') + '</div>';
          }).join('') : '<div class="card muted">Nothing here.</div>');
        $$('[data-g]', host).forEach(function (el) { el.onclick = function (e) { if (e.target.closest('a')) return; open[el.dataset.g] = !open[el.dataset.g]; drawGroups(host, byParty); }; });
        var tv = $('#tgVal', host); if (tv) tv.onchange = function () { sortValue = tv.checked; drawGroups(host, byParty); };
      }
      function draw() {
        ALL = rows();
        view.innerHTML = '<div class="tabs"><button data-t="list"' + (tab === 'list' ? ' class="on"' : '') + '>List</button><button data-t="docket"' + (tab === 'docket' ? ' class="on"' : '') + '>By docket</button><button data-t="party"' + (tab === 'party' ? ' class="on"' : '') + '>By party</button></div>' +
          '<div class="row" style="margin:10px 0"><span class="small muted grow">' + ALL.length + ' lines · updated ' + esc(App.lists.meta && App.lists.meta.transit ? stamp(App.lists.meta.transit.updatedAt) : '') + '</span><button class="btn" id="tlPrint">Print</button><button class="btn" id="tlXl">Download Excel</button></div><div id="tlHost"></div>';
        $$('.tabs button', view).forEach(function (b) { b.onclick = function () { tab = b.dataset.t; draw(); }; });
        var host = $('#tlHost'); if (tab === 'list') drawList(host); else drawGroups(host, tab === 'party');
        $('#tlXl').onclick = function () {
          var data = tab === 'list' ? listFiltered() : ALL;
          xlsx([['Invoice No', 'Part No', 'Description', 'Qty', 'LR', 'LR Date', 'Expected', 'PO', 'Mark', 'State']].concat(data.map(function (x) { return [x.invoice, x.part, x.desc, x.qty, x.lr, x.lrDate ? C.fmtDay(x.lrDate) : '', x.expected ? C.fmtDay(x.expected) : '', x.po, x.mark, x.state === 'overdue' ? 'Overdue' : x.state === 'notBooked' ? 'Not booked yet' : '']; })), 'Transit', 'Transit-List.xlsx');
        };
        $('#tlPrint').onclick = function () {
          var data = tab === 'list' ? listFiltered() : ALL.slice().sort(function (a, b) { return (a.lr < b.lr ? -1 : a.lr > b.lr ? 1 : 0); });
          SIMSPrint.print(SIMSPrint.transitSheet({ title: tab === 'party' ? 'Transit List by party' : 'Transit List', rows: data, printedAt: Date.now(), printedBy: App.who() }));
        };
      }
      if (!App.lists.raw.transit) { view.innerHTML = '<div class="center muted" style="padding:40px"><span class="spinner"></span></div>'; return App.refreshLists().then(draw); }
      draw();
      App.live(function () { App.refreshLists().then(function () { if (App.page === 'transit' && !document.activeElement.matches('input')) App.keepState(view, draw); }); });
    }
  };
})();
