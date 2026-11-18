/* SIMS screens - stage 5: Docket History, Home daily summary (admin), Admin tabs for Alerts and Telegram, Part Watch List, Backups and storage. */
(function () {
  'use strict';
  var App = window.App, C = SIMS_CORE, $ = App.$, $$ = App.$$, esc = App.esc, api = App.api, toast = App.toast;
  function stamp(ms) { return C.fmtStamp(ms); }
  function busy(btn, on, txt) { if (!btn) return; if (on) { btn._t = btn.textContent; btn.disabled = true; btn.textContent = txt || 'Please wait…'; } else { btn.disabled = false; btn.textContent = btn._t || btn.textContent; } }
  function errBox(t, e) { if (e && e.code === 'adminlock') { App.lockCard(t); return; } t.innerHTML = '<div class="card bad err">' + esc(e && e.message || 'Something went wrong.') + '</div>'; }
  var chip = function (s) { var c = s === 'GRN Done' ? 'ok' : s === "Partly GRN'd" || s === 'Combined' ? 'acc' : s === 'Arrived' ? 'warn' : ''; return '<span class="chip ' + c + '">' + esc(s) + '</span>'; };

  // =====================================================================
  // Docket History
  // =====================================================================
  App.pages['docket-history'] = {
    perm: 'docketHistory',
    render: function (view, r) {
      view.innerHTML = '<div class="card"><label class="f">Docket, POMS LR, invoice or case number</label><div class="row"><input type="search" id="dhQ" class="grow" autocomplete="off" inputmode="numeric"><button class="btn pri" id="dhGo">Search</button></div></div><div id="dhRes" style="margin-top:12px"></div>';
      var q = $('#dhQ', view), res = $('#dhRes', view);
      function go(v, lr) {
        v = (v || '').replace(/\s+/g, ''); if (!v) return;
        res.innerHTML = '<span class="spinner"></span>';
        api('docketHistory', { q: v, lr: lr || '' }).then(function (d) {
          if (!d.found) { res.innerHTML = '<div class="card">Nothing found for “' + esc(v) + '”.</div>'; App.feedback(false); return; }
          if (d.choose) {
            res.innerHTML = '<h3>More than one match</h3><div class="list">' + d.choose.map(function (m) { return '<div class="item click" data-lr="' + esc(m.lr) + '">' + esc(m.label) + '</div>'; }).join('') + '</div>';
            $$('[data-lr]', res).forEach(function (el) { el.onclick = function () { go(v, el.dataset.lr); }; });
            return;
          }
          paint(d);
        }).catch(function (e) { res.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      }
      function paint(d) {
        var k = d.docket, u = App.me.user;
        var html = '<div class="card"><div class="row between"><div class="mono bold" style="font-size:24px">' + esc(k.lr) + '</div>' + chip(k.status) + '</div>' + (d.archived ? '<div class="small" style="color:var(--warn)">From the archive (older than 90 days)</div>' : '') + (k.pomsLr ? '<div class="small muted">POMS LR ' + esc(k.pomsLr) + '</div>' : '') +
          '<div style="margin:8px 0">' + (k.flags || []).map(function (f) { return '<span class="chip bad">' + esc(f) + '</span>'; }).join(' ') + (k.claim && k.claim.state === 'open' ? '<span class="chip warn">Claim open</span>' : '') + '</div>' +
          '<div class="kv"><div>Boxes</div><div>' + (k.printed ? esc(k.boxes) : '—') + '</div><div>Remark</div><div>' + (k.printed ? esc(k.remarkLine) : '—') + '</div><div>GRN</div><div>' + k.progress.done + ' of ' + k.progress.total + ' lines</div>' +
          (k.printed ? '<div>Arrived</div><div>' + esc(stamp(k.arrivedAt)) + ' · ' + esc((k.arrivedBy || '') + (k.arrivedLabel ? ' (' + k.arrivedLabel + ')' : '')) + '</div>' : '') + '<div>Documents</div><div>' + (k.docs || []).length + '</div>' + (k.totalValue !== undefined ? '<div>Total value</div><div class="bold">₹ ' + C.fmtINR(k.totalValue) + '</div>' : '') + '</div>' +
          '<div class="row" style="margin-top:10px">' + (d.archived ? '' : '<button class="btn" id="dhOpen">Open docket</button>') + '<button class="btn" id="dhXl">Download Excel</button></div></div>';
        html += '<h3>Timeline</h3><div class="card">' + (d.timeline.length ? '<div class="list">' + d.timeline.map(function (e) { return '<div class="item"><div class="grow"><div class="bold">' + esc(e.text) + '</div><div class="small muted">' + esc(stamp(e.ts)) + (e.by ? ' · ' + esc(e.by + (e.label ? ' (' + e.label + ')' : '')) : ' · system') + (e.detail ? ' · ' + esc(e.detail) : '') + '</div></div></div>'; }).join('') + '</div>' : '<span class="muted">No events recorded.</span>') + '</div>';
        html += '<h3>Lines (' + k.lines.length + ')</h3><div class="card tscroll"><table class="dt"><thead><tr><th>Part</th><th>Description</th><th>Qty</th><th>Invoice</th><th>Mark</th><th></th></tr></thead><tbody>' + k.lines.map(function (l) { return '<tr><td class="mono">' + esc(l.part) + '</td><td>' + esc(l.desc) + '</td><td>' + esc(l.qty) + '</td><td class="mono">' + esc(l.invoice) + '</td><td>' + (l.mark ? '<span class="chip acc">' + esc(l.mark) + '</span>' : '') + '</td><td>' + (l.grnDate ? '<span class="chip ok">GRN\'d ' + esc(C.fmtDay(l.grnDate)) + '</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
        res.innerHTML = html;
        var op = $('#dhOpen', res); if (op) op.onclick = function () { App.go('#/docket/' + encodeURIComponent(k.lr)); };
        $('#dhXl', res).onclick = function () {
          function mk() { var rows = [['Invoice No', 'Part No', 'Description', 'Qty', 'Mark', 'GRN Date']].concat(k.lines.map(function (l) { return [l.invoice, l.part, l.desc, l.qty, l.mark, l.grnDate ? C.fmtDay(l.grnDate) : '']; })); var ws = XLSX.utils.aoa_to_sheet(rows), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Docket'); XLSX.writeFile(wb, 'Docket-' + k.lr + '.xlsx'); }
          if (window.XLSX) mk(); else { var s = document.createElement('script'); s.src = 'lib/xlsx.mini.min.js'; s.onload = mk; document.head.appendChild(s); }
        };
        App.feedback(true);
      }
      $('#dhGo', view).onclick = function () { go(q.value); };
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(q.value); });
      if (r.q && r.q.q) { q.value = r.q.q; go(r.q.q); } else q.focus();
    }
  };

  // =====================================================================
  // Home: daily summary (admin only, not clickable)
  // =====================================================================
  var homeStat = App.pages.home.stat;
  App.pages.home.stat = function (s) {
    homeStat(s);
    var u = App.me.user; if (!u.admin || u.adminLocked) return;
    var host = $('#hSum'); if (!host) { var h = $('#hStat'); if (!h) return; host = document.createElement('div'); host.id = 'hSum'; h.parentNode.insertBefore(host, h.nextSibling); }
    App.swr('adminSummary', function () { return api('adminSummary'); }, function (d) {
      var el = $('#hSum'); if (!el) return;
      var names = ['Today', 'Yesterday', 'Day before'];
      el.innerHTML = '<h3>Daily summary</h3><div class="card">' + d.days.map(function (x, i) {
        return '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="bold">' + names[i] + ' <span class="muted small">' + esc(C.fmtDay(x.day)) + '</span></div><div class="small">Arrived: ' + x.dockets + ' docket' + (x.dockets === 1 ? '' : 's') + ', ' + x.boxes + ' boxes · ₹ ' + C.fmtINR(x.arrivedValue) + '</div><div class="small">GRN\'d: ' + x.docketsGrn + ' docket' + (x.docketsGrn === 1 ? '' : 's') + ', ' + x.linesGrn + ' lines · ₹ ' + C.fmtINR(x.grnValue) + '</div></div>';
      }).join('') + '</div>';
    }, { silent: true }).catch(function () { });
  };

  App.pages['part-watch'] = { perm: 'partWatch', render: function (view) { return App.adminTabs.watch(view); } };

  // =====================================================================
  // Admin tabs
  // =====================================================================
  App.adminTabs = {
    // ---------- Alerts and Telegram ----------
    alerts: function (t) {
      t.innerHTML = '<span class="spinner"></span>';
      function load() { return App.swr('adminTelegram', function () { return api('adminTelegram'); }, function (d) { App.keepState(t, function () { paint(d); }); }, { silent: true, onError: function (e, have) { if (!have) errBox(t, e); } }); }
      function paint(d) {
        var connectedGroups = d.groups.filter(function (g) { return g.status === 'connected'; }), waiting = d.groups.filter(function (g) { return g.status === 'waiting'; });
        var h = '<div class="card"><div class="bold">Telegram</div>';
        h += d.tokenSet ? '<div class="small muted" style="margin:4px 0">Bot ' + (d.bot ? '@' + esc(d.bot) : '(not answering)') + ' · admin chat ' + (d.adminConnected ? '<span style="color:var(--ok)">connected</span>' : '<span style="color:var(--warn)">not connected</span>') + '</div>' : '<div class="small muted" style="margin:4px 0">Not connected. Alerts and login approvals come by email until it is.</div>';
        h += '<label class="f">Bot token' + (d.tokenSet ? ' (set; paste a new one to replace)' : '') + '</label><div class="row"><input type="password" id="tgTok" class="grow" autocomplete="off" placeholder="123456:ABC…"><button class="btn" id="tgSave">Save token</button></div><div id="tgMsg" class="small" style="margin-top:8px"></div>';
        if (d.tokenSet) h += '<div class="row" style="margin-top:10px"><button class="btn" id="tgCode">Connect my admin chat</button>' + (d.adminConnected ? '<button class="btn" id="tgTest">Send test message</button>' : '') + '</div>';
        h += '</div>';
        h += '<h3>Groups</h3><div class="card">' + (waiting.length ? '<div class="small muted">Groups waiting</div><div class="list">' + waiting.map(function (g) { return '<div class="item"><div class="grow bold">' + esc(g.title) + '</div><button class="btn pri" data-ga="approve" data-g="' + esc(g.id) + '">Approve</button><button class="btn" data-ga="reject" data-g="' + esc(g.id) + '">Reject</button></div>'; }).join('') + '</div>' : '') +
          (connectedGroups.length ? '<div class="small muted" style="margin-top:8px">Connected</div><div class="list">' + connectedGroups.map(function (g) { return '<div class="item"><div class="grow"><div class="bold">' + esc(g.name || g.title) + '</div><div class="small muted">' + esc(g.title) + '</div></div><button class="btn" data-ga="rename" data-g="' + esc(g.id) + '">Rename</button><button class="btn" data-ga="disconnect" data-g="' + esc(g.id) + '">Disconnect</button></div>'; }).join('') + '</div>' : '') +
          (!waiting.length && !connectedGroups.length ? '<span class="muted">No groups yet. Add the bot to a group and type /connect there.</span>' : '') + '</div>';
        var WHEN = { missed: 'A part on your Missed Claims list arrives on a docket.', client: 'A part for a party order whose mark has “Alert on GRN” switched on arrives on a docket.', watch: 'A part on the Part Watch List arrives for the first time (it then leaves the list).', afterhours: 'Someone tries to use SIMS outside office hours.' };
        var cell = 'padding:10px 8px;border-top:1px solid var(--line);vertical-align:top';
        h += '<h3>Alerts</h3><div class="card"><label class="item"><input type="checkbox" id="alMaster"' + (d.alertsOn ? ' checked' : '') + '><span><span class="bold">Alerts are ' + (d.alertsOn ? 'ON' : 'OFF') + '</span><span class="small muted" style="display:block">Untick to stop all four alerts below for everyone, Admin and groups.</span></span></label></div>' +
          '<div style="' + (d.alertsOn ? '' : 'opacity:.45;') + '"><div class="small muted" style="margin:6px 0 8px">Tick who receives each alert. <b>Admin</b> means your own Telegram chat. If Admin and every group are unticked, nobody receives that alert.</div><div class="card" style="padding:4px 8px;overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">Alert</th><th style="padding:8px;text-align:center">Admin</th><th style="padding:8px;text-align:left">Groups</th></tr></thead><tbody>' +
          Object.keys(d.alerts).map(function (k) {
            var a = d.alerts[k];
            return '<tr><td style="' + cell + '"><div class="bold">' + esc(a.label) + '</div><div class="small muted">' + esc(WHEN[k] || '') + '</div></td>' +
              '<td style="' + cell + ';text-align:center"><label class="item" style="justify-content:center;padding:4px 0"><input type="checkbox" data-to="' + k + '" value="me" aria-label="' + esc(a.label) + ' to Admin"' + (a.to.indexOf('me') >= 0 ? ' checked' : '') + '></label></td>' +
              '<td style="' + cell + '">' + (connectedGroups.length ? connectedGroups.map(function (g) { return '<label class="item" style="padding:4px 0"><input type="checkbox" data-to="' + k + '" value="' + esc(g.id) + '"' + (a.to.indexOf(g.id) >= 0 ? ' checked' : '') + '><span>' + esc(g.name || g.title) + '</span></label>'; }).join('') : '<span class="small muted">No group connected</span>') + '</td></tr>';
          }).join('') +
          '</tbody></table></div></div><div class="small muted" style="margin-top:10px">Always sent to Admin only, never to groups and not affected by the switch above: data feed problems, POD helper, missing files and POD storage warnings. Login requests and Admin unlock requests are not alerts: choose Telegram and/or email for them in Settings, General.</div>';
        t.innerHTML = h;
        $('#tgSave') && ($('#tgSave').onclick = function () { var b = this; busy(b, true, 'Checking…'); api('adminTgToken', { token: $('#tgTok').value }).then(function (r) { toast('Connected to @' + r.bot + (r.webhook ? '.' : ' (webhook not set).')); load(); }).catch(function (e) { busy(b, false); $('#tgMsg').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }); });
        var tc = $('#tgCode'); if (tc) tc.onclick = function () { api('adminTgCode').then(function (r) { $('#tgMsg').innerHTML = 'Open Telegram, find <b>@' + esc(r.bot) + '</b>: <a href="https://t.me/' + esc(r.bot) + '?start=' + esc(r.code) + '" target="_blank" rel="noopener"><b>tap here to open it</b></a>, then press <b>Start</b> (valid ' + r.minutes + ' minutes).<br>If the link does not work, send this message to the bot: <span class="mono bold">/start ' + esc(r.code) + '</span>'; }).catch(function (e) { toast(e.message); }); };
        var tt = $('#tgTest'); if (tt) tt.onclick = function () { api('adminTgTest').then(function () { toast('Test message sent.'); }).catch(function (e) { toast(e.message); }); };
        $$('[data-ga]', t).forEach(function (b) {
          b.onclick = function () {
            function run(name) { api('adminTgGroup', { id: b.dataset.g, action: b.dataset.ga, name: name }).then(paint).catch(function (e) { toast(e.message); }); }
            if (b.dataset.ga === 'rename') { var n = window.prompt('Group name in SIMS'); if (n) run(n); } else run();
          };
        });
        function save(k) {
          var to = $$('[data-to="' + k + '"]', t).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
          api('adminAlertSet', { kind: k, to: to }).then(function (r) { paint(r); toast(to.length ? 'Saved.' : 'Saved. Nobody receives this alert now.'); }).catch(function (e) { toast(e.message); });
        }
        $$('[data-to]', t).forEach(function (c) { c.onchange = function () { save(c.dataset.to); }; });
        var am = $('#alMaster', t); if (am) am.onchange = function () { var on = am.checked; api('adminAlertsMaster', { on: on }).then(function (r) { paint(r); toast(on ? 'Alerts are on.' : 'Alerts are off. Nobody receives them.'); }).catch(function (e) { am.checked = !on; toast(e.message); }); };
      }
      return load();
    },

    // ---------- Part Watch List ----------
    watch: function (t) { /* used by the Part Watch List page */
      t.innerHTML = '<span class="spinner"></span>';
      function paint(d) {
        t.innerHTML = '<div class="card"><div class="small muted" style="margin-bottom:8px">The first time a watched part arrives (its Docket GRN sheet is printed) a Part Watch List Alert is sent and the part leaves this list.</div><div class="row"><input type="text" id="wP" class="grow" placeholder="Part number" autocapitalize="characters" autocomplete="off"><button class="btn pri" id="wAdd">Add</button></div><div class="small" id="wInfo" style="margin-top:8px"></div><input type="text" id="wN" placeholder="Note (optional)" maxlength="200" style="margin-top:8px"><div id="wMsg" class="small" style="margin-top:8px"></div></div>' +
          '<div class="card">' + (d.items.length ? '<div class="list">' + d.items.map(function (w) { var mine = d.canRemoveAll || w.by === d.me; return '<div class="item"><div class="grow"><div class="bold mono">' + esc(w.part) + '</div>' + (App.lists.price.get(w.part) ? '<div class="small">' + esc(App.lists.price.get(w.part).desc) + '</div>' : '') + '<div class="small muted">' + esc(stamp(w.addedAt)) + ' · ' + esc(w.by) + (w.note ? ' · ' + esc(w.note) : '') + '</div></div>' + (mine ? '<button class="btn" data-rm="' + esc(w.part) + '">Remove</button>' : '') + '</div>'; }).join('') + '</div>' : '<span class="muted">No watched parts.</span>') + '</div>';
        function info(picked) {
          var q = $('#wP').value.replace(/\s+/g, '').toUpperCase(), el = $('#wInfo');
          if (!q) { el.innerHTML = ''; return; }
          var exact = App.lists.price.get(q);
          if (picked && exact) {
            var rk = App.lists.rack.get(exact.part), loc = rk ? C.location(rk[0], rk[1]) : null;
            el.innerHTML = '<span class="bold">' + esc(exact.desc) + '</span><br><span class="muted">MRP ' + App.money2(exact.mrp) + (loc && !loc.none && App.can('partLocation') ? ' · Location ' + esc(loc.text) : '') + '</span>'; return;
          }
          var list = App.partSuggestions(q);
          if (!list.length) { el.innerHTML = q.length > 1 ? '<span class="muted">Not in the price list</span>' : ''; return; }
          el.innerHTML = '<div class="list" style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px">' + list.map(function (p) { return '<div class="item click" data-sp="' + esc(p.part) + '"><div class="grow"><div class="bold mono">' + esc(p.part) + '</div><div class="small muted">' + esc(p.desc) + '</div></div><span class="small muted">' + App.money2(p.mrp) + '</span></div>'; }).join('') + '</div>';
          $$('[data-sp]', el).forEach(function (d) { d.onclick = function () { $('#wP').value = d.dataset.sp; info(true); }; });
        }
        $('#wP').oninput = function () { info(); }; info();
        $('#wAdd').onclick = function () { var b = this, args = { part: $('#wP').value.replace(/\s+/g, '').toUpperCase(), note: $('#wN').value }; busy(b, true, 'Adding…'); App.swr('watchList', function () { return api('watchAdd', args); }, paint, { fresh: true, silent: true, onError: function (e) { busy(b, false); $('#wMsg').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; } }); };
        $$('[data-rm]', t).forEach(function (b) { b.onclick = function () { b.classList.add('waiting'); App.swr('watchList', function () { return api('watchRemove', { part: b.dataset.rm }); }, paint, { fresh: true, silent: true, onError: function (e) { b.classList.remove('waiting'); toast(e.message); } }); }; });
      }
      // shows the saved copy at once, then refreshes quietly (same as the other pages)
      return App.swr('watchList', function () { return api('watchList'); }, paint, { silent: true, onError: function (e, haveCopy) { if (!haveCopy) errBox(t, e); } });
    },

    // ---------- Backups ----------
    backups: function (t) {
      t.innerHTML = '<span class="spinner"></span>';
      var nm = { transit: 'Transit', price: 'Price list', rack: 'Rack bin list' };
      function paint(d, st) {
        var h = '<h3 style="margin-top:0">Feed backups</h3>';
        h += '<div class="small muted" style="margin-bottom:8px">The last 3 good copies of each feed are kept. Roll back to put an older copy in front of the devices. Rolling back the transit list changes what devices see; GRN history is not rewritten.</div>';
        h += ['transit', 'price', 'rack'].map(function (k) {
          var rows = d.backups.filter(function (b) { return b.kind === k; });
          return '<div class="card"><div class="bold">' + nm[k] + '</div>' + (rows.length ? '<div class="list">' + rows.map(function (b) { return '<div class="item"><div class="grow"><div>Version ' + b.version + (b.current ? ' <span class="chip ok">current</span>' : '') + '</div><div class="small muted">' + esc(stamp(b.at)) + ' · ' + b.rows + ' rows</div></div>' + (b.current ? '' : '<button class="btn" data-rb="' + k + ':' + b.slot + '">Roll back</button>') + '</div>'; }).join('') + '</div>' : '<span class="muted">No backups yet.</span>') + '</div>';
        }).join('');
        t.innerHTML = h;
        $$('[data-rb]', t).forEach(function (b) {
          b.onclick = function () {
            var p = b.dataset.rb.split(':');
            App.confirm('Roll back the ' + nm[p[0]] + ' to this copy? Devices will use it until the next feed update.', 'Roll back').then(function (y) { if (!y) return; api('adminRollback', { kind: p[0], slot: +p[1] }).then(function (r) { toast('Rolled back.'); App.refreshLists(); paint(r, st); }).catch(function (e) { toast(e.message); }); });
          };
        });
      }
      return App.swr('adminBackups', function () { return api('adminBackups'); }, function (d) { App.keepState(t, function () { paint(d); }); }, { silent: true, onError: function (e, have) { if (!have) errBox(t, e); } });
    }
  };
})();
