/* SIMS screens - stage 2: Pending Items, Pending Claims, Missed Claims, documents, remark edit, add delivery. */
(function () {
  'use strict';
  var App = window.App, C = SIMS_CORE, $ = App.$, $$ = App.$$, esc = App.esc, api = App.api, toast = App.toast;
  function stamp(ms) { return C.fmtStamp(ms); }
  function today() { var d = new Date(Date.now() + 19800000); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function busy(btn, on, txt) { if (!btn) return; if (on) { btn._t = btn.textContent; btn.disabled = true; btn.textContent = txt || 'Please wait…'; } else { btn.disabled = false; btn.textContent = btn._t || btn.textContent; } }
  function upload(lr, type, doc, note, extra) { return api('uploadDoc', Object.assign({ lr: lr, type: type, note: note || '', mime: doc.mime, name: doc.name, data: doc.data }, extra || {})); }
  App.uploadDoc = upload;

  // ---------- remark editor ----------
  App.editRemark = function (lr, cur, done) {
    App.modal('<h2 style="margin-top:0">Remark for transporter</h2><div class="muted small">Docket ' + esc(lr) + '. Every change is logged.</div><div class="row" style="margin-top:8px"><div class="grow"><label class="f">Damaged</label><input type="number" id="rD" value="' + esc(cur ? cur.damaged : -1) + '"></div><div class="grow"><label class="f">Short</label><input type="number" id="rS" value="' + esc(cur ? cur.short : -1) + '"></div></div>' +
      '<div class="small muted" style="margin-top:6px">−1 means not entered. 0 and 0 = OK.</div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Save</button></div>', function (m, close) {
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () {
        var d = parseInt($('#rD', m).value, 10), s = parseInt($('#rS', m).value, 10);
        if (isNaN(d) || isNaN(s) || d < -1 || s < -1) { toast('Enter whole numbers (−1 = not entered).'); return; }
        if ((d < 0) !== (s < 0)) { toast('Enter both Damaged and Short, or leave both at -1 (not entered).', 5000); return; }
        busy($('[data-y]', m), true, 'Saving…');
        api('editRemark', { lr: lr, damaged: d, short: s }).then(function (r) { close(); toast('Remark: ' + r.remark); done && done(); }).catch(function (e) { busy($('[data-y]', m), false); toast(e.message, 4000); });
      };
    });
  };

  // ---------- add a document ----------
  App.addDocument = function (lr, types, done, deliveryId) {
    var opts = types.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
    App.modal('<h2 style="margin-top:0">Add document</h2><label class="f">Document</label><select id="dt">' + opts + '</select><label class="f">Note (optional)</label><input type="text" id="dn" maxlength="200"><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Choose photo</button></div>', function (m, close) {
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () {
        var type = $('#dt', m).value, note = $('#dn', m).value; close();
        App.pickDoc({ title: type }).then(function (doc) {
          if (!doc) return;
          toast('Saving…', 8000);
          upload(lr, type, doc, note, { deliveryId: deliveryId || '' }).then(function (r) { toast(r.status === 'queued' ? 'Saved temporarily; it will move to the POD account automatically.' : 'Saved.'); done && done(); }).catch(function (e) { toast(e.message, 5000); });
        });
      };
    });
  };
  App.docTypesAllowed = function () {
    var t = [];
    if (App.can('uploadPod')) t.push('POD', 'Later POD', 'Later receipt sheet');
    if (App.can('uploadClaim')) t.push('Claim sheet');
    return t;
  };
  App.viewDoc = function (id) {
    var o = App.overlay('Document', '<div class="center"><span class="spinner"></span></div>');
    api('docFile', { id: id }).then(function (r) {
      if (r.removed) { o.body.innerHTML = '<div class="card warn">POD removed from Drive (stored offline)</div>'; return; }
      o.body.innerHTML = r.mime === 'application/pdf' ? '<iframe style="width:100%;height:80vh;border:0;background:#fff" src="data:application/pdf;base64,' + r.data + '"></iframe>' : '<img style="max-width:100%;border-radius:8px" src="data:' + esc(r.mime) + ';base64,' + r.data + '">';
    }).catch(function (e) { o.body.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
  };

  /** Called by Docket Details after drawing. */
  App.docketExtras = function (view, k, reload) {
    var box = document.createElement('div');
    var docs = k.docs || [], dels = k.deliveries || [], html = '<h3>Documents (' + docs.length + ')</h3><div class="card">';
    if (!docs.length) html += '<span class="muted">No documents yet.</span>';
    else html += '<div class="list">' + docs.map(function (d) {
      var st = d.status === 'removed' ? '<span class="chip warn">POD removed from Drive (stored offline)</span>' : d.status === 'queued' ? '<span class="chip warn">Saved temporarily</span>' : '';
      return '<div class="item"><div class="grow"><div class="bold">' + esc(d.type) + '</div><div class="small muted">' + esc(stamp(d.at)) + ' · ' + esc(d.by + (d.label ? ' (' + d.label + ')' : '')) + (d.note ? ' · ' + esc(d.note) : '') + '</div>' + st + '</div>' + (d.status === 'removed' ? '' : '<button class="btn" data-vd="' + esc(d.id) + '">View</button>') + '</div>';
    }).join('') + '</div>';
    var types = App.docTypesAllowed();
    if (types.length) html += '<div style="margin-top:10px"><button class="btn" id="addDoc">Add document</button></div>';
    html += '</div>';
    if (k.short > 0) {
      var cl = k.claim; html += '<h3>Claim</h3><div class="card"><div class="row between"><div class="bold">Short ' + esc(k.short) + ' box' + (k.short === 1 ? '' : 'es') + '</div><span class="chip ' + (cl.state === 'open' ? 'warn' : 'ok') + '">' + esc(cl.state === 'open' ? 'Open' : cl.state === 'settled' ? 'Settled' : 'Closed') + '</span></div>' +
        (cl.state === 'open' ? '<div class="muted">Still short: ' + cl.stillShort + (cl.stillShort === 1 ? ' box' : ' boxes') + '</div>' : '') +
        (dels.length ? '<div class="list" style="margin-top:8px">' + dels.map(function (x) { return '<div class="item"><div class="grow">' + x.boxes + ' box' + (x.boxes === 1 ? '' : 'es') + ' received ' + esc(C.fmtDay(x.date)) + (x.note ? '<div class="small muted">' + esc(x.note) + '</div>' : '') + '</div><span class="chip ' + (x.poms ? 'ok' : 'warn') + '">' + (x.poms ? 'Added to POMS' : 'Not added to POMS') + '</span></div>'; }).join('') + '</div>' : '') +
        (cl.state === 'open' && cl.stillShort > 0 && App.can('addDelivery') ? '<div class="row" style="margin-top:10px"><button class="btn pri" id="dxAd">Add delivery</button></div>' : '') + '</div>';
    }
    if (App.can('editPodRemarks') && k.printed) html += '<div class="row" style="margin-top:10px"><button class="btn" id="editRem">Edit remark</button></div>';
    box.innerHTML = html; view.appendChild(box);
    $$('[data-vd]', box).forEach(function (b) { b.onclick = function () { App.viewDoc(b.dataset.vd); }; });
    var ad = $('#addDoc', box); if (ad) ad.onclick = function () { App.addDocument(k.lr, types, reload); };
    var da = $('#dxAd', box); if (da) da.onclick = function () { addDelivery({ lr: k.lr, stillShort: k.claim.stillShort }, reload); };
    var er = $('#editRem', box); if (er) er.onclick = function () { App.editRemark(k.lr, k, reload); };
  };

  // =====================================================================
  // Pending Items
  // =====================================================================
  var ISSUES = ['Remark missing', 'POD missing', 'Claim sheet missing', 'Later receipt sheet missing', 'Not added to POMS'];
  App.pages['pending-items'] = {
    perm: 'pendingItems',
    render: function (view) {
      var items = [], filter = '', q = '';
      view.innerHTML = '<div class="tabs" id="pChips"></div><input type="search" id="pQ" placeholder="Filter pending items" style="margin-bottom:12px"><div class="card" id="pList"><span class="spinner"></span></div>';
      function fixLabel(x) { return { remark: 'Enter remark', pod: 'Upload POD', claim: 'Upload claim sheet', later: 'Upload sheet', poms: 'Mark added to POMS' }[x.fix]; }
      function canFix(x) { return { remark: App.can('editPodRemarks'), pod: App.can('uploadPod'), claim: App.can('uploadClaim'), later: App.can('uploadPod'), poms: App.can('markPoms') }[x.fix]; }
      function draw() {
        var counts = {}; items.forEach(function (x) { counts[x.issue] = (counts[x.issue] || 0) + 1; });
        $('#pChips').innerHTML = '<button data-f=""' + (!filter ? ' class="on"' : '') + '>All (' + items.length + ')</button>' + ISSUES.map(function (i) { return '<button data-f="' + esc(i) + '"' + (filter === i ? ' class="on"' : '') + '>' + esc(i) + ' (' + (counts[i] || 0) + ')</button>'; }).join('');
        $$('#pChips button').forEach(function (b) { b.onclick = function () { filter = b.dataset.f; draw(); }; });
        var rows = items.filter(function (x) { return (!filter || x.issue === filter) && (!q || x.lr.indexOf(q) >= 0); });
        $('#pList').innerHTML = rows.length ? '<div class="list">' + rows.map(function (x, i) {
          return '<div class="item"><div class="grow click" data-o="' + esc(x.lr) + '"><div class="bold mono">' + esc(x.lr) + '</div><div class="small muted">Arrived ' + esc(stamp(x.arrivedAt)) + (x.extra ? ' · ' + esc(x.extra) : '') + '</div><div style="margin-top:4px"><span class="chip bad">' + esc(x.issue) + '</span></div></div>' + (canFix(x) ? '<button class="btn pri" data-fx="' + items.indexOf(x) + '">' + esc(fixLabel(x)) + '</button>' : '') + '</div>';
        }).join('') + '</div>' : '<span class="muted">Nothing pending here.</span>';
        $$('[data-o]', $('#pList')).forEach(function (d) { d.onclick = function () { App.go('#/docket/' + encodeURIComponent(d.dataset.o)); }; });
        $$('[data-fx]', $('#pList')).forEach(function (b) { b.onclick = function () { fix(items[+b.dataset.fx]); }; });
      }
      function fix(x) {
        if (x.fix === 'remark') return App.editRemark(x.lr, null, reload);
        if (x.fix === 'poms') return pomsModal(x.deliveryId, reload);
        var type = x.fix === 'pod' ? 'POD' : x.fix === 'claim' ? 'Claim sheet' : 'Later receipt sheet';
        App.pickDoc({ title: type + ' for ' + x.lr }).then(function (doc) {
          if (!doc) return; toast('Saving…', 8000);
          upload(x.lr, type, doc, '', { deliveryId: x.deliveryId || '' }).then(function (r) { toast(r.status === 'queued' ? 'Saved temporarily; it will move automatically.' : 'Saved.'); load(true); }).catch(function (e) { toast(e.message, 5000); });
        });
      }
      function load(fresh) { return App.swr('pendingItems', function () { return api('pendingItems'); }, function (d) { items = d.items; draw(); }, { fresh: fresh }).catch(function (e) { $('#pList').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }); }
      function reload() { return load(true); }
      $('#pQ').oninput = function () { q = this.value.replace(/\s+/g, ''); draw(); };
      App.live(function () { load(false); });
      return load();
    }
  };

  function pomsModal(deliveryId, done) {
    App.modal('<h2 style="margin-top:0">Added to POMS</h2><label class="f">Note (optional)</label><input type="text" id="pn" maxlength="200"><div class="row" style="margin-top:12px"><button class="btn" id="pa">Attach later receipt sheet (optional)</button><span class="small muted" id="paName"></span></div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Mark added to POMS</button></div>', function (m, close) {
      var doc = null;
      $('#pa', m).onclick = function () { m.style.display = 'none'; App.pickDoc({ title: 'Later receipt sheet' }).then(function (d) { m.style.display = ''; if (d) { doc = d; $('#paName', m).textContent = 'Attached ✓'; } }); };
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () {
        busy($('[data-y]', m), true, 'Saving…');
        var a = { id: deliveryId, note: $('#pn', m).value }; if (doc) { a.data = doc.data; a.mime = doc.mime; a.name = doc.name; }
        api('markPoms', a).then(function () { close(); toast('Marked added to POMS.'); done && done(); }).catch(function (e) { busy($('[data-y]', m), false); toast(e.message, 4000); });
      };
    });
  }

  function addDelivery(c, done) {
    var docs = {};
    App.modal('<h2 style="margin-top:0">Add delivery</h2><div class="muted small">Docket ' + esc(c.lr) + ' · still short ' + c.stillShort + '</div><label class="f">Boxes received now</label><input type="number" id="adB" min="1" max="' + c.stillShort + '" inputmode="numeric"><label class="f">Date</label><input type="date" id="adD" value="' + today() + '"><label class="f">Note (optional)</label><input type="text" id="adN" maxlength="200">' +
      '<div class="row" style="margin-top:12px">' + (App.can('uploadPod') ? '<button class="btn" id="adP">New POD (optional)</button>' : '') + (App.can('uploadClaim') ? '<button class="btn" id="adC">Claim sheet (optional)</button>' : '') + '</div><div class="small muted" id="adInfo" style="margin-top:6px"></div>' +
      '<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Save delivery</button></div>', function (m, close) {
      function pick(btnId, type) { var b = $(btnId, m); if (!b) return; b.onclick = function () { m.style.display = 'none'; App.pickDoc({ title: type }).then(function (d) { m.style.display = ''; if (d) { docs[type] = d; $('#adInfo', m).textContent = Object.keys(docs).join(' + ') + ' attached ✓'; } }); }; }
      pick('#adP', 'Later POD'); pick('#adC', 'Claim sheet');
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () {
        var n = parseInt($('#adB', m).value, 10); if (!(n >= 1) || n > c.stillShort) { toast('Enter 1 to ' + c.stillShort + ' boxes.'); return; }
        var dt = $('#adD', m).value, ms = dt ? Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10)) : null;
        busy($('[data-y]', m), true, 'Saving…');
        api('addDelivery', { lr: c.lr, boxes: n, date: ms, note: $('#adN', m).value, docs: Object.keys(docs).map(function (t) { return { type: t, mime: docs[t].mime, name: docs[t].name, data: docs[t].data }; }) })
          .then(function () { close(); toast('Delivery added.'); done && done(); }).catch(function (e) { busy($('[data-y]', m), false); toast(e.message, 5000); });
      };
    });
  }
  App.addDelivery = addDelivery;

  // =====================================================================
  // Pending Claims
  // =====================================================================
  App.pages['pending-claims'] = {
    perm: 'pendingClaims',
    render: function (view) {
      var all = false;
      function load(fresh) {
        return App.swr('pendingClaims:' + (all ? 'all' : 'open'), function () { return api('pendingClaims', { all: all }); }, function (d) { App.keepState(view, function () {
          view.innerHTML = '<label class="item"><input type="checkbox" id="pcAll"' + (all ? ' checked' : '') + '><span>Show closed and settled claims too</span></label>' +
            (d.claims.length ? d.claims.map(card).join('') : '<div class="card muted">No open claims.</div>');
          $('#pcAll').onchange = function () { all = this.checked; load(); };
          $$('[data-ad]', view).forEach(function (b) { b.onclick = function () { addDelivery(d.claims.filter(function (c) { return c.lr === b.dataset.ad; })[0], function () { load(true); }); }; });
          $$('[data-st]', view).forEach(function (b) { b.onclick = function () { App.confirm('Mark this claim as settled? It will leave the open list.', 'Mark settled').then(function (y) { if (!y) return; api('settleClaim', { lr: b.dataset.st }).then(function () { toast('Settled.'); load(true); }).catch(function (e) { toast(e.message); }); }); }; });
          $$('[data-pm]', view).forEach(function (b) { b.onclick = function () { pomsModal(b.dataset.pm, function () { load(true); }); }; });
          $$('[data-op]', view).forEach(function (b) { b.onclick = function () { App.go('#/docket/' + encodeURIComponent(b.dataset.op)); }; });
        }); }, { fresh: fresh }).catch(function (e) { view.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      }
      function card(c) {
        return '<div class="card"><div class="row between"><div class="bold mono" style="font-size:20px">' + esc(c.lr) + '</div><span class="chip ' + (c.state === 'open' ? 'warn' : 'ok') + '">' + (c.state === 'open' ? 'Open' : c.state === 'settled' ? 'Settled' : 'Closed') + '</span></div>' +
          '<div class="small muted">Arrived ' + esc(stamp(c.arrivedAt)) + ' · ' + c.boxes + ' boxes · short ' + c.short + '</div>' +
          (c.state === 'open' ? '<div class="bold" style="margin:6px 0">Still short: ' + c.stillShort + (c.stillShort === 1 ? ' box' : ' boxes') + '</div>' : '') +
          (c.deliveries.length ? '<div class="list">' + c.deliveries.map(function (x) { return '<div class="item"><div class="grow">' + x.boxes + ' box' + (x.boxes === 1 ? '' : 'es') + ' received ' + esc(C.fmtDay(x.date)) + (x.note ? '<div class="small muted">' + esc(x.note) + '</div>' : '') + (x.poms ? '<div class="small muted">Added to POMS ' + esc(stamp(x.pomsAt)) + ' · ' + esc(x.pomsBy) + '</div>' : '') + '</div>' + (x.poms ? '<span class="chip ok">Added to POMS</span>' : (App.can('markPoms') ? '<button class="btn" data-pm="' + esc(x.id) + '">Added to POMS</button>' : '<span class="chip warn">Not added</span>')) + '</div>'; }).join('') + '</div>' : '') +
          '<div class="row" style="margin-top:10px">' + (c.stillShort > 0 && App.can('addDelivery') ? '<button class="btn pri" data-ad="' + esc(c.lr) + '">Add delivery</button>' : '') + (c.state === 'open' && App.can('markSettled') ? '<button class="btn" data-st="' + esc(c.lr) + '">Mark settled</button>' : '') + '<button class="btn" data-op="' + esc(c.lr) + '">Open docket</button></div></div>';
      }
      App.live(function () { load(false); });
      return load();
    }
  };

  // =====================================================================
  // Missed Claims
  // =====================================================================
  App.pages['missed-claims'] = {
    perm: 'missedClaims',
    render: function (view) {
      var all = false;
      function load(fresh) {
        return App.swr('missedList:' + (all ? 'all' : 'open'), function () { return api('missedList', { all: all }); }, function (d) { App.keepState(view, function () {
          view.innerHTML = '<div class="card"><h2 style="margin-top:0">Add a missed claim</h2><div class="muted small">Short quantities only. It shows on every incoming lot of this part until cleared.</div>' +
            '<label class="f">Part number</label><input type="text" id="mPart" autocapitalize="characters" autocomplete="off"><div class="small muted" id="mDesc"></div><label class="f">Quantity short</label><input type="number" id="mQty" min="1" inputmode="numeric">' +
            '<label class="f">Original docket (optional)</label><input type="text" id="mLr" inputmode="numeric"><label class="f">Note (optional)</label><input type="text" id="mNote" maxlength="200"><button class="btn pri" id="mAdd" style="margin-top:12px">Add</button></div>' +
            '<label class="item"><input type="checkbox" id="mAll"' + (all ? ' checked' : '') + '><span>Show cleared too</span></label>' +
            (d.items.length ? d.items.map(function (x) {
              var left = x.qty - x.raised;
              return '<div class="card"><div class="row between"><div><div class="bold mono" style="font-size:19px">' + esc(x.part) + '</div><div class="muted">' + esc(x.desc) + '</div></div><span class="chip ' + (x.status === 'open' ? 'warn' : 'ok') + '">' + (x.status === 'open' ? 'Claim pending: ' + left : 'Cleared') + '</span></div>' +
                '<div class="small muted" style="margin:6px 0">Short ' + x.qty + (x.raised ? ' · raised ' + x.raised + ' of ' + x.qty : '') + (x.lr ? ' · docket ' + esc(x.lr) : '') + ' · added ' + esc(stamp(x.at)) + ' by ' + esc(x.by + (x.label ? ' (' + x.label + ')' : '')) + (x.note ? ' · ' + esc(x.note) : '') + '</div>' +
                (x.status === 'open' ? '<button class="btn pri" data-r="' + esc(x.id) + '" data-left="' + left + '">Claim raised</button>' : '') +
                '<details style="margin-top:8px"><summary class="small muted">History</summary>' + x.history.map(function (h) { return '<div class="small muted">' + esc(stamp(h.at)) + ' · ' + esc(h.by) + ' · ' + esc(h.what) + '</div>'; }).join('') + '</details></div>';
            }).join('') : '<div class="card muted">No missed claims.</div>');
          var pi = $('#mPart');
          pi.oninput = function () { var p = App.lists.price.get(pi.value.trim().toUpperCase()); $('#mDesc').textContent = p ? p.desc : (pi.value.trim() ? 'Not in the price list' : ''); };
          $('#mAll').onchange = function () { all = this.checked; load(); };
          $('#mAdd').onclick = function () {
            busy($('#mAdd'), true, 'Adding…');
            api('missedAdd', { part: pi.value, qty: $('#mQty').value, lr: $('#mLr').value, note: $('#mNote').value }).then(function () { toast('Added.'); load(true); }).catch(function (e) { busy($('#mAdd'), false); toast(e.message, 4000); });
          };
          $$('[data-r]', view).forEach(function (b) {
            b.onclick = function () {
              var left = +b.dataset.left;
              App.modal('<h2 style="margin-top:0">Claim raised</h2><label class="f">Quantity raised (up to ' + left + ')</label><input type="number" id="rq" min="1" max="' + left + '" value="' + left + '"><div class="small muted" style="margin-top:6px">A part raised for 2 of 4 leaves 2 pending.</div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Save</button></div>', function (m, close) {
                $('[data-n]', m).onclick = close;
                $('[data-y]', m).onclick = function () { api('missedRaise', { id: b.dataset.r, qty: $('#rq', m).value }).then(function () { close(); toast('Saved.'); load(true); }).catch(function (e) { toast(e.message, 4000); }); };
              });
            };
          });
        }); var q = $('#mPart'); if (q && q.oninput) q.oninput(); }, { fresh: fresh }).catch(function (e) { view.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      }
      App.live(function () { load(false); });
      return load();
    }
  };
})();
