/* SIMS - Admin -> Remote Printing tab. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, $$ = App.$$, esc = App.esc, api = App.api, toast = App.toast, C = SIMS_CORE;
  App.adminTabs = App.adminTabs || {};
  App.adminTabs.print = function (t) {
    t.innerHTML = '<span class="spinner"></span>';
    function paint(d) {
      var ago = d.seen ? Math.max(0, Math.round((d.now - d.seen) / 1000)) : null;
      var status = !d.hasKey ? '<span class="muted">No key yet. Create a key to set up the office PC.</span>'
        : !d.seen ? '<span style="color:var(--warn)">Waiting for the office PC to connect for the first time.</span>'
        : d.online ? '<span style="color:var(--ok)">Connected</span> · ' + esc(d.pc) + ' · last check ' + ago + ' seconds ago'
        : '<span style="color:var(--bad)">Offline</span> since ' + esc(C.fmtStamp(d.seen)) + (d.pc ? ' · ' + esc(d.pc) : '');
      var h = '<div class="card"><label class="item"><input type="checkbox" id="rpOn"' + (d.on ? ' checked' : '') + (d.hasKey ? '' : ' disabled') + '><span class="bold">Remote printing</span></label><div class="small" style="margin-top:6px">' + status + '</div>' + (d.ip ? '<div class="small muted">Office address: ' + esc(d.ip) + '</div>' : '') + '</div>';
      h += '<div class="card"><div class="bold">Key</div><div class="small muted" style="margin:4px 0 8px">The key goes into config.json on the office PC. It is shown only once.</div><div class="row">' + (d.hasKey ? '<button class="btn" id="rpRep">Replace key</button><button class="btn" id="rpRem">Remove key</button>' : '<button class="btn pri" id="rpNew">Create key</button>') + '</div><div id="rpKey" style="margin-top:10px"></div></div>';
      h += '<div class="card"><div class="bold">Printer for remote prints</div>' + (d.printers.length
        ? '<select id="rpPr" style="margin-top:8px"><option value="">Pick a printer…</option>' + d.printers.map(function (p) { return '<option' + (p === d.printer ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select>'
        : '<div class="small muted" style="margin-top:6px">The office PC reports its printers here once it is connected.</div>') + '</div>';
      h += '<h3>Recent jobs</h3><div class="card">' + (d.jobs.length ? '<div class="list">' + d.jobs.map(function (j) {
        var c = j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : j.status === 'cancelled' ? '' : 'warn';
        return '<div class="item"><div class="grow"><div class="bold">' + esc(j.title) + '</div><div class="small muted">' + esc(C.fmtStamp(j.at)) + ' · ' + esc(j.by + (j.label ? ' (' + j.label + ')' : '')) + ' · ' + j.pages + ' pages' + (j.result && j.status !== 'done' ? ' · ' + esc(j.result) : '') + '</div></div><span class="chip ' + c + '">' + esc(j.status) + '</span>' +
          (j.status === 'queued' ? '<button class="btn" data-cx="' + esc(j.id) + '">Cancel</button>' : '') + (j.status === 'failed' || j.status === 'cancelled' ? '<button class="btn" data-rt="' + esc(j.id) + '">Retry</button>' : '') + '</div>';
      }).join('') + '</div>' : '<span class="muted">No remote prints yet.</span>') + '</div>';
      t.innerHTML = h;
      var on = $('#rpOn', t); if (on) on.onchange = function () { api('adminPrintSet', { on: on.checked }).then(paint).catch(function (e) { toast(e.message); on.checked = !on.checked; }); };
      var pr = $('#rpPr', t); if (pr) pr.onchange = function () { api('adminPrintSet', { printer: pr.value }).then(function (x) { toast('Printer saved.'); paint(x); }).catch(function (e) { toast(e.message); }); };
      function key(action) {
        api('adminPrintKey', { action: action }).then(function (x) {
          paint(x);
          if (x.newKey) $('#rpKey', t).innerHTML = '<div class="card ok"><div class="small">Copy this key now. It will not be shown again.</div><div class="mono bold" style="word-break:break-all;margin-top:6px">' + esc(x.newKey) + '</div></div>';
        }).catch(function (e) { toast(e.message); });
      }
      var n = $('#rpNew', t); if (n) n.onclick = function () { key('create'); };
      var rp = $('#rpRep', t); if (rp) rp.onclick = function () { App.confirm('Replace the key? The old key stops working immediately and config.json on the office PC must be updated.', 'Replace').then(function (y) { if (y) key('replace'); }); };
      var rm = $('#rpRem', t); if (rm) rm.onclick = function () { App.confirm('Remove the key? Remote printing stops and is switched off.', 'Remove').then(function (y) { if (y) key('remove'); }); };
      $$('[data-cx]', t).forEach(function (b) { b.onclick = function () { api('printCancel', { id: b.dataset.cx }).then(function () { return api('adminPrint'); }).then(paint).catch(function (e) { toast(e.message); }); }; });
      $$('[data-rt]', t).forEach(function (b) { b.onclick = function () { api('adminPrintRetry', { id: b.dataset.rt }).then(paint).catch(function (e) { toast(e.message); }); }; });
    }
    function load() {
      return App.swr('adminPrint', function () { return api('adminPrint', {}, { quiet: true }); }, function (d) {
        if (!document.body.contains(t) || $('#rpKey', t) && $('#rpKey', t).innerHTML || t.querySelector('select') === document.activeElement) return;
        App.keepState(t, function () { paint(d); });
      }, { silent: true, noStatus: true, onError: function (e, have) { if (e && e.code === 'adminlock') App.lockCard(t); else if (!have && !t.querySelector('.card')) t.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; } });
    }
    load();
    var iv = setInterval(function () { if (!document.body.contains(t)) { clearInterval(iv); return; } load(); }, 10000);
  };
})();
