/* SIMS screens - core: state, back-end calls, device cache, router, shell, login, home, search, scan, part details. */
(function () {
  'use strict';
  var C = SIMS_CORE, CFG = window.SIMS_CONFIG;
  var App = window.App = { me: null, token: '', lists: { price: new Map(), rack: new Map(), transit: [], marks: {}, meta: {}, ver: {} }, pages: {}, page: null };

  // ---------- tiny helpers ----------
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  App.$ = $; App.$$ = $$; App.esc = esc;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  App.ls = ls;
  function money2(n) { n = Number(n) || 0; var s = n.toFixed(2), p = s.split('.'); return '₹ ' + C.fmtINR(+p[0]) + '.' + p[1]; }
  App.money2 = money2;
  function ago(ms) {
    if (!ms) return 'never';
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60); if (h < 24) return h + ' h ago';
    return Math.floor(h / 24) + ' d ago';
  }
  App.ago = ago;
  function toast(msg, ms) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }
  App.toast = toast;
  // ---------- Back button / back swipe closes what is open on top (scanner, search, pop-ups, side menu) instead of leaving the page ----------
  var layers = [], layerSeq = 0, skipPop = 0;
  function openLayer(closeFn) {
    var L = { id: ++layerSeq, close: closeFn };
    layers.push(L);
    try { history.pushState({ simsLayer: L.id }, ''); } catch (e) { /* ignore */ }
    return L;
  }
  function layerDone(L) {                       // closed from the screen (X, Cancel, a scan result ...): take our history step away again
    var i = layers.indexOf(L); if (i < 0) return;
    layers.splice(i, 1);
    setTimeout(function () { if (history.state && history.state.simsLayer === L.id) { skipPop++; history.back(); } }, 30);
  }
  window.addEventListener('popstate', function () {
    if (skipPop > 0) { skipPop--; return; }
    var L = layers.pop(); if (L) { L.close(); return; }
    var st = history.state;                      // landed on a step left behind by a layer that was closed another way: step over it
    if (st && st.simsLayer) { skipPop++; history.back(); }
  });
  var drawerL = null;
  function hideDrawer() { var s = $('#side'), sc = $('#scrim'); if (s) s.classList.remove('open'); if (sc) sc.classList.add('hide'); }
  function openDrawer() { $('#side').classList.add('open'); $('#scrim').classList.remove('hide'); if (!drawerL) drawerL = openLayer(function () { drawerL = null; hideDrawer(); }); }
  function closeDrawer() { hideDrawer(); if (drawerL) { var L = drawerL; drawerL = null; layerDone(L); } }
  function modal(html, onMount) {
    var m = document.createElement('div'); m.className = 'modal'; m.innerHTML = '<div class="box">' + html + '</div>';
    document.body.appendChild(m);
    var L = openLayer(function () { close(); });
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    function close() { if (!m.parentNode) return; m.remove(); layerDone(L); }
    if (onMount) onMount(m, close);
    return { el: m, close: close };
  }
  App.modal = modal;
  function confirmBox(msg, yes, no) {
    return new Promise(function (res) {
      modal('<p style="font-size:18px;margin-top:0">' + msg + '</p><div class="row" style="justify-content:flex-end"><button class="btn" data-n>' + esc(no || 'Cancel') + '</button><button class="btn pri" data-y>' + esc(yes || 'OK') + '</button></div>', function (m, close) {
        $('[data-n]', m).onclick = function () { close(); res(false); };
        $('[data-y]', m).onclick = function () { close(); res(true); };
      });
    });
  }
  App.confirm = confirmBox;

  // ---------- device cache (IndexedDB) ----------
  var dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      try {
        var r = indexedDB.open('sims', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  function idbGet(k) { return idb().then(function (d) { return !d ? null : new Promise(function (res) { var q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }); }
  function idbSet(k, v) { return idb().then(function (d) { return !d ? null : new Promise(function (res) { var t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = function () { res(); }; t.onerror = function () { res(); }; }); }); }

  // ---------- back-end calls ----------
  function deviceId() { var d = ls('sims.device'); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); ls('sims.device', d); } return d; }
  function deviceInfo() {
    var u = navigator.userAgent, type = /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iPhone' : /Windows/.test(u) ? 'Windows PC' : /Mac/.test(u) ? 'Mac' : 'Device';
    var br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser';
    return { type: type, browser: br };
  }
  App.deviceInfo = deviceInfo;
  // Press feedback for every button in the app: the button you just pressed shows a spinner and ignores taps until its request finishes.
  var lastPress = { el: null, t: 0 };
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('button'); if (b) lastPress = { el: b, t: Date.now() }; }, true);
  function api(action, args, opts) {
    var btn = lastPress.el && Date.now() - lastPress.t < 700 && lastPress.el.isConnected && !lastPress.el.disabled && !lastPress.el.classList.contains('waiting') ? lastPress.el : null;
    if (btn) { btn.classList.add('waiting'); btn.setAttribute('aria-busy', 'true'); lastPress.el = null; }
    var done = function () { if (btn) { btn.classList.remove('waiting'); btn.removeAttribute('aria-busy'); } };
    return api1(action, args, opts).then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  }
  function api1(action, args, opts) {
    opts = opts || {};
    return fetch(CFG.API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: action, args: args || {}, token: App.token }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) return j.data;
        var e = new Error(j.error || 'Error'); e.code = j.code;
        if (!opts.quiet) {
          if (j.code === 'takeover' || j.code === 'auth' && App.token) { endSession(j.error, j.code === 'takeover'); }
        }
        throw e;
      }, function (err) { var e = new Error('No connection. Check your internet and try again.'); e.code = 'net'; throw e; });
  }
  App.api = api;

  function endSession(msg, takeover) {
    App.token = ''; ls('sims.token', null); App.me = null; clearCaches();
    showLogin(msg);
  }

  // ---------- lists / cache ----------
  function buildLists() {
    var L = App.lists, pr = L.raw.price, rk = L.raw.rack, tr = L.raw.transit;
    L.price = new Map(); (pr || []).forEach(function (r) { L.price.set(r[0], { part: r[0], desc: r[1], mrp: r[2], ndp: r[3], tax: r[4] }); });
    L.rack = new Map(); (rk || []).forEach(function (r) { L.rack.set(r[0], [r[1], r[2]]); });
    L.transitBy = new Map(); (tr || []).forEach(function (r) { var o = { invoice: r[0], part: r[1], desc: r[2], qty: r[3], lr: r[4], lrDate: r[5], po: r[6], rack: r[7], bin: r[8] }; if (!L.transitBy.has(o.part)) L.transitBy.set(o.part, []); L.transitBy.get(o.part).push(o); });
    // docket and invoice numbers for as-you-type search (open transit lines only)
    L.lrIdx = new Map(); L.invIdx = new Map();
    (tr || []).forEach(function (r) {
      var lr = r[4], inv = r[0];
      if (lr) { var e = L.lrIdx.get(lr); if (!e) { e = { lr: lr, lines: 0, lrDate: r[5] }; L.lrIdx.set(lr, e); } e.lines++; }
      if (inv) { var v = L.invIdx.get(inv); if (!v) { v = { invoice: inv, lr: lr, lines: 0 }; L.invIdx.set(inv, v); } v.lines++; }
    });
  }
  App.loadCachedLists = function () {
    return idbGet('lists').then(function (c) {
      var role = App.me && App.me.user.admin ? 1 : 0;
      App.lists.raw = { price: null, rack: null, transit: null }; App.lists.ver = {}; App.lists.marks = {}; App.lists.meta = {};
      if (c) {
        App.lists.raw = c.raw || App.lists.raw; App.lists.ver = c.ver || {}; App.lists.marks = c.marks || {}; App.lists.meta = c.meta || {};
        if (c.role !== role) { App.lists.raw.price = null; App.lists.ver.price = ''; }
      }
      buildLists();
    });
  };
  App.refreshLists = function () {
    if (!App.token) return Promise.resolve();
    return api('getLists', { have: App.lists.ver }, { quiet: true }).then(function (d) {
      var L = App.lists;
      if (d.meta) L.meta = d.meta;
      if (d.price) { L.raw.price = d.price.rows; L.ver.price = d.price.v; }
      if (d.rack) { L.raw.rack = d.rack.rows; L.ver.rack = d.rack.v; }
      if (d.transit) { L.raw.transit = d.transit.rows; L.ver.transit = d.transit.v; L.marks = d.transit.marks || {}; }
      if (d.price || d.rack || d.transit) buildLists();
      idbSet('lists', { raw: L.raw, ver: L.ver, marks: L.marks, meta: L.meta, role: App.me && App.me.user.admin ? 1 : 0 });
      if (App.page === 'home') App.pages.home.tick && App.pages.home.tick();
    }).catch(function () { /* offline: keep cache */ });
  };

  // ---------- instant pages: show the last copy at once, refresh quietly, keep the page up to date ----------
  function cacheKey(k) { return 'sims.c.' + (App.me ? App.me.user.id : '') + '.' + k; }
  function cacheRemember(k) {
    // keep at most 15 saved docket pages so the browser's storage never fills up
    if (k.indexOf('docket:') !== 0) return;
    var idx = []; try { idx = JSON.parse(ls('sims.cidx') || '[]'); } catch (e) { idx = []; }
    idx = idx.filter(function (x) { return x !== k; }); idx.push(k);
    while (idx.length > 15) { var old = idx.shift(); ls(cacheKey(old), null); }
    ls('sims.cidx', JSON.stringify(idx));
  }
  /** fetchFn() -> promise of data. paint(data) draws it.
      Shows the saved copy immediately, then the fresh one if it differs. Never paints into a page the user has left.
      opts: {fresh: skip the saved copy; onError(e): called if the refresh fails (even when a saved copy is on screen); silent: do not show errors} */
  // Small status next to the page title while a saved copy is on screen: "Refreshing…", then "Updated" (if something changed) or nothing.
  var sync = { n: 0, t: null, hide: null };
  function syncShow(kind, text) { var el = $('#sync'); if (!el) return; clearTimeout(sync.hide); el.className = 'on ' + kind; el.title = text; el.setAttribute('aria-label', text); el.innerHTML = kind === 'run' ? '<span class="sp"></span>' : kind === 'ok' ? '✓' : '⚠'; }
  function syncHide() { var el = $('#sync'); if (el) el.className = ''; }
  function syncStart() { sync.n++; clearTimeout(sync.t); clearTimeout(sync.hide); sync.t = setTimeout(function () { if (sync.n > 0) syncShow('run', 'Refreshing…'); }, 250); }
  function syncEnd(res) {
    sync.n = Math.max(0, sync.n - 1); if (sync.n > 0) return; clearTimeout(sync.t);
    if (res === 'changed') { syncShow('ok', 'Updated'); sync.hide = setTimeout(syncHide, 2500); }
    else if (res === 'error') { syncShow('bad', 'No connection, showing saved copy'); sync.hide = setTimeout(syncHide, 5000); }
    else syncHide();
  }
  App.swr = function (key, fetchFn, paint, opts) {
    opts = opts || {};
    var rid = App.routeSeq, ck = cacheKey(key), cached = null, shown = null;
    try { cached = JSON.parse(ls(ck) || 'null'); } catch (e) { cached = null; }
    function go(d) { if (App.routeSeq !== rid) return; paint(d); }
    if (cached && !opts.fresh) { shown = JSON.stringify(cached.d); try { go(cached.d); } catch (e) { shown = null; } }
    var track = !!(cached && !opts.fresh && !opts.noStatus && !App.inLive);   // the icon shows when a page opens, not on the quiet background refresh
    if (track) syncStart();
    return fetchFn().then(function (d) {
      var s = JSON.stringify(d); ls(ck, JSON.stringify({ d: d, t: Date.now() })); cacheRemember(key);
      var changed = s !== shown;
      if (changed) go(d);
      shown = s; if (track) syncEnd(changed ? 'changed' : 'same'); return d;
    }, function (e) {
      if (track) syncEnd('error');
      if (opts.onError && App.routeSeq === rid) opts.onError(e, shown !== null);
      if (shown === null && !opts.silent) throw e;
    });
  };
  /** Remember the user's place (scroll, open sections, typed text, focus) while a page is redrawn. */
  App.keepState = function (root, fn) {
    var page = $('#page'), st = { scroll: page ? page.scrollTop : 0, det: [], vals: {}, chk: {}, act: null, sel: null };
    $$('details', root).forEach(function (d) { st.det.push(d.open); });
    $$('input[id],select[id],textarea[id]', root).forEach(function (e) { if (e.type === 'checkbox' || e.type === 'radio') st.chk[e.id] = e.checked; else st.vals[e.id] = e.value; });
    var ae = document.activeElement; if (ae && ae.id && root.contains(ae)) { st.act = ae.id; try { st.sel = [ae.selectionStart, ae.selectionEnd]; } catch (e) { /* not a text field */ } }
    fn();
    $$('details', root).forEach(function (d, i) { if (st.det[i] !== undefined) d.open = st.det[i]; });
    Object.keys(st.vals).forEach(function (id) { var e = document.getElementById(id); if (e && e.value !== st.vals[id]) e.value = st.vals[id]; });
    Object.keys(st.chk).forEach(function (id) { var e = document.getElementById(id); if (e) e.checked = st.chk[id]; });
    if (st.act) { var f = document.getElementById(st.act); if (f) { f.focus(); try { if (st.sel) f.setSelectionRange(st.sel[0], st.sel[1]); } catch (e) { /* ignore */ } } }
    if (page) page.scrollTop = st.scroll;
  };
  /** A page registers how to refresh itself; the app calls it every 20 s while the page is on screen and idle. */
  App.live = function (fn) { App.liveFn = fn; };
  function liveTick() {
    if (document.hidden || !App.liveFn || !App.me) return;
    if (document.querySelector('.modal, .overlay')) return;
    var ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && $('#page') && $('#page').contains(ae)) return;
    App.inLive = true; try { App.liveFn(); } catch (e) { /* ignore */ }
    App.inLive = false;
  }
  setInterval(liveTick, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(liveTick, 300); });
  /** Fetch what the busiest pages need, in the background, so they open instantly. */
  App.prefetch = function () {
    if (!App.me || !App.open()) return;
    var jobs = [];
    if (App.can('docketGrn')) jobs.push(['openDockets', {}, 'openDockets']);
    if (App.can('combinedGrn')) jobs.push(['arrivedDockets', {}, 'arrivedDockets']);
    if (App.can('pendingItems')) jobs.push(['pendingItems', {}, 'pendingItems']);
    if (App.can('pendingClaims')) jobs.push(['pendingClaims', { all: false }, 'pendingClaims:open']);
    if (App.can('missedClaims')) jobs.push(['missedList', { all: false }, 'missedList:open']);
    if (App.can('partWatch')) jobs.push(['watchList', {}, 'watchList']);
    if (App.can('partyOrders')) jobs.push(['orders', {}, 'orders']);
    if (App.can('uploadPacking')) jobs.push(['packStatus', {}, 'packStatus']);
    jobs.push(['homeStatus', {}, 'homeStatus']);
    if (App.me.user.admin) { jobs.push(['adminUsers', {}, 'adminUsers']); jobs.push(['adminDevices', {}, 'adminDevices']); jobs.push(['adminSettings', {}, 'adminSettings']); jobs.push(['adminFiles', {}, 'adminFiles']); jobs.push([null, null, 'adminFeeds']); }
    var p = Promise.resolve();
    var lanes = [Promise.resolve(), Promise.resolve(), Promise.resolve()]; // three at a time, so everything is ready in a few seconds
    jobs.forEach(function (j, i) { lanes[i % 3] = lanes[i % 3].then(function () { var call = j[0] ? api(j[0], j[1], { quiet: true }) : Promise.all([api('adminFeedStatus', {}, { quiet: true }), api('adminFeedIssues', {}, { quiet: true })]); return call.then(function (d) { ls(cacheKey(j[2]), JSON.stringify({ d: d, t: Date.now() })); }).catch(function () {}); }); });
    p = Promise.all(lanes);
    // the first few open dockets, so tapping one opens at once
    p.then(function () { try { var c = JSON.parse(ls(cacheKey('openDockets')) || 'null'); return c ? c.d.dockets.slice(0, 5) : []; } catch (e) { return []; } }).then(function (list) {
      var q = Promise.resolve();
      list.forEach(function (x) { q = q.then(function () { return api('docketDetails', { q: x.lr }, { quiet: true }).then(function (d) { ls(cacheKey('docket:' + x.lr), JSON.stringify({ d: d, t: Date.now() })); cacheRemember('docket:' + x.lr); }).catch(function () {}); }); });
    });
  };
  function clearCaches() { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('sims.c.') === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ } }

  // ---------- permissions ----------
  /** Shown instead of "no permission" while an Admin session is still locked. */
  App.lockCard = function (view) {
    var tg = !App.me || App.me.adminVia !== 'email';
    view.innerHTML = '<div class="card warn"><h2 style="margin-top:0">Admin is locked</h2><p>This login can only scan parts until you unlock it. Tap the button and SIMS sends a request to your ' + (tg ? 'Telegram' : 'email') + '.</p><button class="btn pri" id="lkReq">Unlock Admin</button><div id="lkMsg" class="muted" style="margin-top:10px"></div></div>';
    $('#lkReq', view).onclick = function () { App.unlockAdmin($('#lkMsg', view), this); };
  };
  var unlockTimer = null;
  /** One tap: sends the unlock request, then waits (checking every 3 s) until the Admin taps Unlock in Telegram. */
  App.unlockAdmin = function (msgEl, btn) {
    btn.disabled = true; btn.textContent = 'Sending…';
    api('requestAdmin', { device: App.deviceInfo().type }).then(function (r) {
      btn.textContent = 'Request sent';
      if (r.via !== 'telegram') { msgEl.textContent = 'A link was sent to your email. Open it on this device.'; return; }
      msgEl.innerHTML = 'Sent to your Telegram. Tap <b>Unlock this device</b> there; this page opens by itself.';
      var tries = 0; clearTimeout(unlockTimer);
      (function poll() {
        unlockTimer = setTimeout(function () {
          if (++tries > 200) { btn.disabled = false; btn.textContent = 'Unlock Admin'; msgEl.textContent = 'No answer yet. Tap Unlock Admin to send it again.'; return; }
          api('adminUnlockStatus', {}, { quiet: true }).then(function (s) {
            if (!s.unlocked) return poll();
            return api('me').then(function (me) { applyMe(me); clearCaches(); refreshMenu(); toast('Admin unlocked.'); route(); App.prefetch(); });
          }).catch(function () { poll(); });
        }, 3000);
      })();
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Unlock Admin'; msgEl.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
  };
  App.can = function (p) { return !!App.me && C.can(App.me.user, p); };
  App.open = function () { return !!App.me && (App.me.open || App.me.user.admin); };
  App.canNow = function (p) { return App.can(p) && (App.open() || p === 'partBasic'); };
  App.who = function () { var u = App.me.user; return u.name + (u.label ? ' (' + u.label + ')' : ''); };

  // ---------- feedback ----------
  var actx = null;
  function beep(ok) {
    try {
      if (!App.me || App.me.settings.scanSounds !== 'on') return;
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
      o.frequency.value = ok ? 1500 : 320; g.gain.value = 0.15; o.start(); o.stop(actx.currentTime + (ok ? 0.09 : 0.22));
    } catch (e) { /* ignore */ }
  }
  function buzz(ok) { try { if (navigator.vibrate) navigator.vibrate(ok ? 70 : [60, 50, 60]); } catch (e) { /* ignore */ } }
  App.feedback = function (ok) { beep(ok); buzz(ok); };

  // ---------- router ----------
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, ''), q = {}, qi = h.indexOf('?');
    if (qi >= 0) { h.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, qi); }
    var seg = h.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: seg[0] || 'home', arg: seg[1] || '', arg2: seg[2] || '', q: q };
  }
  App.go = function (h) { if (location.hash === h) route(); else location.hash = h; };

  var TITLES = { home: 'Home', 'docket-grn': 'Docket GRN', combined: 'Combined GRN', 'pending-items': 'Pending Items', 'pending-claims': 'Pending Claims', 'missed-claims': 'Missed Claims', 'party-orders': 'Party Orders', transit: 'Transit List', box: 'Box Contents', 'box-finder': 'Box Finder', 'part-watch': 'Part Watch List', 'docket-history': 'Docket History', 'upload-packing': 'Upload Packing List', docket: 'Docket Details', part: 'Part Details', admin: 'Settings', 'combine-scan': 'Combine by Scanning', approve: 'Login Request', 'admin-open': 'Admin Access' };
  var PUBLIC = { approve: 1 };

  function route() {
    App.routeSeq = (App.routeSeq || 0) + 1; App.liveFn = null;
    var r = parseHash();
    if (!App.token && !PUBLIC[r.name]) { showLogin(); return; }
    if (!App.me && !PUBLIC[r.name]) return;
    var pg = App.pages[r.name] || App.pages.home;
    App.page = App.pages[r.name] ? r.name : 'home';
    if (PUBLIC[r.name] && !App.me) { renderBare(r); return; }
    renderShell();
    $('#pageTitle').textContent = TITLES[App.page] || 'SIMS';
    $$('#side a.nav').forEach(function (a) { a.classList.toggle('on', a.dataset.r === menuKey(App.page)); });
    var view = $('#page'); view.scrollTop = 0; view.innerHTML = '<div class="center muted" style="padding:40px"><span class="spinner"></span></div>';
    closeDrawer();
    var gate = pg.perm && !App.canNow(pg.perm) ? pg.perm : null;
    if (App.me.user.adminLocked && App.page !== 'admin' && App.page !== 'admin-open' && App.page !== 'home' && App.page !== 'part') { App.lockCard(view); return; }
    if (!App.open() && App.page !== 'home' && App.page !== 'part') { view.innerHTML = closedHtml(); return; }
    if (gate) { view.innerHTML = '<div class="card">You do not have permission to open this page.</div>'; return; }
    Promise.resolve(pg.render(view, r)).catch(function (e) {
      if (e && e.code === 'closed') view.innerHTML = '<div class="card warn">' + esc(e.message) + '</div>';
      else view.innerHTML = '<div class="card bad err">' + esc(e && e.message || 'Something went wrong.') + '</div>';
    });
  }
  function closedHtml() { var s = App.me.settings; return '<div class="card warn"><h2>SIMS is closed</h2><p>SIMS is closed. Office hours ' + fmtHM(s.officeStart) + ' to ' + fmtHM(s.officeEnd) + '.</p><p class="muted">Only basic part scan works now (part number, description, MRP).</p></div>'; }
  function fmtHM(t) { var p = t.split(':'), h = +p[0], ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + p[1] + ' ' + ap; }
  function menuKey(p) { return p === 'docket' || p === 'combine-scan' || p === 'box' ? '' : p; }
  window.addEventListener('hashchange', route);
  App.route = route;

  // ---------- shell ----------
  var camOK = false;
  function detectCamera() {
    try { if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return; navigator.mediaDevices.enumerateDevices().then(function (d) { camOK = d.some(function (x) { return x.kind === 'videoinput'; }); updateScanBtn(); }); } catch (e) { /* none */ }
  }
  function updateScanBtn() { var b = $('#scanBtn'); if (b) b.classList.toggle('hide', !(camOK && (window.matchMedia('(max-width:800px)').matches || window.matchMedia('(pointer:coarse)').matches))); }
  var ICON = {
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>'
  };
  App.ICON = ICON;
  function menuItems() {
    var m = [{ k: 'home', t: 'Home', h: '#/home' }], can = function (p) { return App.me.user.adminLocked || App.can(p); };
    if (can('docketGrn')) m.push({ k: 'docket-grn', t: 'Docket GRN', h: '#/docket-grn' });
    if (can('combinedGrn')) m.push({ k: 'combined', t: 'Combined GRN', h: '#/combined' });
    if (can('pendingItems')) m.push({ k: 'pending-items', t: 'Pending Items', h: '#/pending-items' });
    if (can('pendingClaims')) m.push({ k: 'pending-claims', t: 'Pending Claims', h: '#/pending-claims' });
    if (can('missedClaims')) m.push({ k: 'missed-claims', t: 'Missed Claims', h: '#/missed-claims' });
    if (can('transitList')) m.push({ k: 'transit', t: 'Transit List', h: '#/transit' });
    if (can('partyOrders')) m.push({ k: 'party-orders', t: 'Party Orders', h: '#/party-orders' });
    if (can('boxFinder')) m.push({ k: 'box-finder', t: 'Box Finder', h: '#/box-finder' });
    if (can('partWatch')) m.push({ k: 'part-watch', t: 'Part Watch List', h: '#/part-watch' });
    if (can('uploadPacking')) m.push({ k: 'upload-packing', t: 'Upload Packing List', h: '#/upload-packing' });
    if (App.me.user.admin) m.push({ k: 'admin', t: 'Settings', h: '#/admin' });
    return m;
  }
  function renderShell() {
    if ($('#app')) { refreshMenu(); return; }
    $('#boot') && $('#boot').remove();
    $('#root').innerHTML =
      '<div id="app"><aside id="side"><div class="brand">SIMS<small>Stock Inward Management</small></div><nav id="menu"></nav></aside><div id="scrim" class="hide"></div>' +
      '<div id="main"><header id="top"><button class="ib mobileOnly" id="menuBtn" aria-label="Menu">' + ICON.menu + '</button><h1 id="pageTitle">SIMS</h1><span id="sync" aria-live="polite"></span><span id="who"></span>' +
      '<button class="ib" id="searchBtn" aria-label="Search">' + ICON.search + '</button><button class="ib hide" id="scanBtn" aria-label="Scan">' + ICON.scan + '</button></header><main id="page"></main></div></div>';
    $('#menuBtn').onclick = function () {
      var s = $('#side');
      if (window.matchMedia('(max-width:800px)').matches) openDrawer(); else s.classList.toggle('collapsed');
    };
    $('#menuBtn').classList.remove('mobileOnly');
    $('#scrim').onclick = closeDrawer;
    $('#searchBtn').onclick = function () { openSearch(); };
    $('#scanBtn').onclick = function () { App.scan({ mode: 'route' }); };
    $('#who').onclick = labelModal;
    refreshMenu(); detectCamera(); updateScanBtn();
  }
  function refreshMenu() {
    var th = document.documentElement.dataset.theme;
    $('#menu').innerHTML = menuItems().map(function (i) { return '<a class="nav" data-r="' + i.k + '" href="' + i.h + '">' + esc(i.t) + '</a>'; }).join('') +
      '<div class="sep"></div><button class="nav" id="themeBtn">Theme: ' + (th === 'light' ? 'Light' : 'Pitch Black') + '</button>';
    $('#themeBtn').onclick = function () { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true); refreshMenu(); };
    $('#who').textContent = App.who();
    $$('#side a.nav').forEach(function (a) { a.classList.toggle('on', a.dataset.r === menuKey(App.page)); });
    $$('#side a.nav').forEach(function (a) { a.addEventListener('click', closeDrawer); });
  }
  function setTheme(t, save) {
    document.documentElement.dataset.theme = t; ls('sims.theme', t);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f4f5f7' : '#000000';
    if (save && App.token) api('setTheme', { theme: t }, { quiet: true }).catch(function () {});
  }
  function labelModal() {
    var u = App.me.user, di = deviceInfo();
    modal('<h2 style="margin-top:0">' + esc(u.name) + '</h2><p class="muted small">' + (u.label ? 'Device: ' + esc(u.label) + '<br>' : '') + esc(di.type + ' · ' + di.browser) + '<br>Only the Admin can name or rename a device.</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-n>Close</button><button class="btn bad" data-y>Log out</button></div>', function (m, close) {
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () { close(); api('logout', {}, { quiet: true }).catch(function () {}).then(function () { endSession(''); }); };
    });
  }

  // ---------- bare pages (not logged in) ----------
  function renderBare(r) {
    $('#boot') && $('#boot').remove();
    $('#root').innerHTML = '<div style="max-width:520px;margin:0 auto;padding:20px" id="bare"></div>';
    var pg = App.pages[r.name]; pg.render($('#bare'), r);
  }

  // ---------- login ----------
  var pollTimer = null;
  function showLogin(msg) {
    clearTimeout(pollTimer);
    $('#boot') && $('#boot').remove();
    $('#root').innerHTML = '<div style="max-width:520px;margin:0 auto;padding:20px"><div class="brand" style="padding-left:0">SIMS<small>Stock Inward Management System</small></div><h2>Who are you?</h2>' +
      (msg ? '<div class="card warn">' + esc(msg) + '</div>' : '') + '<div id="names" class="loginlist"><span class="spinner"></span></div><p class="muted">Name not listed? Ask the admin to add you.</p></div>';
    var cached = ls('sims.names'); if (cached) drawNames(JSON.parse(cached));
    api('listNames', {}, { quiet: true }).then(function (d) { ls('sims.names', JSON.stringify(d.names)); drawNames(d.names); }).catch(function (e) { if (!cached) $('#names').innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
  }
  function drawNames(names) {
    var el = $('#names'); if (!el) return;
    el.innerHTML = names.map(function (n) { return '<button data-n="' + esc(n) + '">' + esc(n) + '</button>'; }).join('');
    $$('button', el).forEach(function (b) { b.onclick = function () { login(b.dataset.n); }; });
  }
  function login(name) {
    $('#root').innerHTML = '<div style="max-width:520px;margin:0 auto;padding:20px" class="center"><h2>' + esc(name) + '</h2><p><span class="spinner"></span></p><p class="muted" id="lmsg">Logging in…</p></div>';
    api('requestLogin', { name: name, deviceId: deviceId(), deviceInfo: deviceInfo() }, { quiet: true }).then(function (r) {
      if (r.status === 'approved') return startSession(r.token);
      $('#lmsg').innerHTML = 'Waiting for the admin to approve this login…<br><button class="btn" id="cancelLogin" style="margin-top:16px">Cancel</button>';
      $('#cancelLogin').onclick = function () { clearTimeout(pollTimer); showLogin(); };
      (function poll() {
        pollTimer = setTimeout(function () {
          api('loginStatus', { reqId: r.reqId, secret: r.secret }, { quiet: true }).then(function (s) {
            if (s.status === 'approved') startSession(s.token);
            else if (s.status === 'rejected') showLogin('The admin did not approve this login.');
            else poll();
          }).catch(function () { poll(); });
        }, 3000);
      })();
    }).catch(function (e) { showLogin(e.message); });
  }
  function startSession(token) {
    App.token = token; ls('sims.token', token);
    api('me').then(function (me) { applyMe(me); if (!location.hash || /^#\/?$/.test(location.hash) || location.hash.indexOf('#/login') === 0) location.hash = '#/home'; return boot2(); }).catch(function (e) { endSession(e.message); });
  }
  function applyMe(me) { App.me = me; setTheme(me.theme || 'dark', false); ls('sims.me', JSON.stringify(me)); }
  function boot2() {
    return App.loadCachedLists().then(function () { route(); App.refreshLists(); setTimeout(App.prefetch, 1500); });
  }

  // ---------- Search ----------
  function recent() { try { return JSON.parse(ls('sims.recent') || '[]'); } catch (e) { return []; } }
  function addRecent(q) { var r = recent().filter(function (x) { return x !== q; }); r.unshift(q); ls('sims.recent', JSON.stringify(r.slice(0, 8))); }
  function overlay(title, bodyHtml, onClose) {
    var o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = '<div class="oh"><button class="ib" data-x aria-label="Close">' + ICON.back + '</button><h2>' + esc(title) + '</h2></div><div class="ob">' + bodyHtml + '</div>';
    document.body.appendChild(o);
    var h = { el: o, body: $('.ob', o) };
    var L = openLayer(function () { h.close(); });   // back button runs the (possibly wrapped) close, e.g. the scanner also stops the camera
    function close() { if (!o.parentNode) return; o.remove(); onClose && onClose(); layerDone(L); }
    h.close = close;
    $('[data-x]', o).onclick = function () { h.close(); };
    return h;
  }
  App.overlay = overlay;

  function partSuggestions(q) {
    q = q.toUpperCase(); var out = [];
    if (q.length < 2) return out;
    App.lists.price.forEach(function (v, k) { if (out.length < 25 && k.toUpperCase().indexOf(q) === 0) out.push(v); });
    return out;
  }
  /** Docket and invoice suggestions from the transit lines saved on this device (needs the Search: dockets permission). */
  function docketSuggestions(q, anyone) {
    var out = { dockets: [], invoices: [] };
    q = q.replace(/[ \t]+/g, '');
    if ((!anyone && !App.can('searchDockets')) || !App.open() || !/^[0-9]{3,}$/.test(q) || !App.lists.lrIdx) return out;
    var st = {}; try { var c = JSON.parse(ls(cacheKey('openDockets')) || 'null'); if (c) c.d.dockets.forEach(function (x) { st[x.lr] = x.status; }); } catch (e) { /* none */ }
    function scan(map, key, list, mk) {
      var starts = [], inside = [];
      map.forEach(function (v, k) { var i = k.indexOf(q); if (i === 0) starts.push(v); else if (i > 0 && q.length >= 4) inside.push(v); });
      starts.concat(inside).slice(0, 8).forEach(function (v) { list.push(mk(v)); });
    }
    scan(App.lists.lrIdx, 'lr', out.dockets, function (v) { return { lr: v.lr, lines: v.lines, status: st[v.lr] || 'In transit', lrDate: v.lrDate }; });
    scan(App.lists.invIdx, 'invoice', out.invoices, function (v) { return { invoice: v.invoice, lr: v.lr, lines: v.lines, status: st[v.lr] || 'In transit' }; });
    return out;
  }
  App.docketSuggestions = function (q) { return docketSuggestions(q, true); };
  function openSearch() {
    var o = overlay('Search SIMS', '<input type="search" id="sq" placeholder="Part, LR, invoice or case no." autocomplete="off" autocapitalize="characters"><div id="sres" style="margin-top:12px"></div>');
    var inp = $('#sq', o.el), res = $('#sres', o.el);
    function showRecent() {
      var r = recent();
      res.innerHTML = r.length ? '<h3>Recent searches</h3><div class="list">' + r.map(function (x) { return '<div class="item click" data-q="' + esc(x) + '">' + esc(x) + '</div>'; }).join('') + '</div>' : '';
      $$('[data-q]', res).forEach(function (d) { d.onclick = function () { inp.value = d.dataset.q; run(true); }; });
    }
    function run(go) {
      var q = inp.value.trim(); if (!q) { showRecent(); return; }
      var sug = partSuggestions(q), html = '';
      if (sug.length) html += '<h3>Parts</h3><div class="list">' + sug.map(function (p) { return '<div class="item click" data-part="' + esc(p.part) + '"><div class="grow"><div class="bold mono">' + esc(p.part) + '</div><div class="muted small">' + esc(p.desc) + '</div></div></div>'; }).join('') + '</div>';
      var ds = docketSuggestions(q), partsHtml = html, dkHtml = '';
      if (ds.dockets.length) dkHtml += '<h3>Dockets</h3><div class="list">' + ds.dockets.map(function (d) { return '<div class="item click" data-dk="' + esc(d.lr) + '"><div class="grow"><div class="bold mono">' + esc(d.lr) + '</div><div class="muted small">' + d.lines + (d.lines === 1 ? ' line' : ' lines') + (d.lrDate ? ' · LR date ' + esc(C.fmtDay(d.lrDate)) : '') + '</div></div><span class="chip">' + esc(d.status) + '</span></div>'; }).join('') + '</div>';
      if (ds.invoices.length) dkHtml += '<h3>Invoices</h3><div class="list">' + ds.invoices.map(function (d) { return '<div class="item click"' + (d.lr ? ' data-dk="' + esc(d.lr) + '"' : '') + '><div class="grow"><div class="bold mono">' + esc(d.invoice) + '</div><div class="muted small">' + (d.lr ? 'Docket ' + esc(d.lr) : 'Not booked yet') + ' · ' + d.lines + (d.lines === 1 ? ' line' : ' lines') + '</div></div>' + (d.lr ? '<span class="chip">' + esc(d.status) + '</span>' : '') + '</div>'; }).join('') + '</div>';
      if (App.can('searchDockets') && App.open() && /^[0-9 ]{4,}$/.test(q)) partsHtml += '<p class="muted small" style="margin-top:12px">Press Enter to search everything, including finished and archived dockets.</p>';
      html = dkHtml + partsHtml;
      res.innerHTML = html;
      bindRes();
      if (!go) return;
      addRecent(q);
      var exact = App.lists.price.has(q.toUpperCase()) ? q.toUpperCase() : (App.lists.price.has(q) ? q : '');
      var kinds = [];
      if (exact) kinds.push({ kind: 'part', part: exact, label: 'Part ' + exact });
      if ((App.can('searchDockets') || App.can('boxScan')) && App.open()) {
        res.innerHTML += '<p class="muted"><span class="spinner"></span> Searching…</p>';
        api('search', { q: q }).then(function (d) {
          kinds = kinds.concat(d.results);
          if (!kinds.length) { res.innerHTML = '<div class="card">Nothing found for “' + esc(q) + '”.</div>'; App.feedback(false); return; }
          if (kinds.length === 1) { open(kinds[0]); return; }
          res.innerHTML = '<h3>More than one match</h3><div class="list">' + kinds.map(function (k, i) { return '<div class="item click" data-k="' + i + '">' + esc(k.label) + '</div>'; }).join('') + '</div>';
          $$('[data-k]', res).forEach(function (d) { d.onclick = function () { open(kinds[+d.dataset.k]); }; });
        }).catch(function (e) { res.innerHTML = '<div class="card bad err">' + esc(e.message) + '</div>'; });
      } else if (kinds.length) open(kinds[0]);
      else { res.innerHTML = '<div class="card">Part number not found.</div>'; App.feedback(false); }
    }
    function open(k) { o.close(); if (k.kind === 'part') App.go('#/part/' + encodeURIComponent(k.part)); else if (k.kind === 'case') App.go('#/box/' + encodeURIComponent(k.caseNo)); else App.go('#/docket/' + encodeURIComponent(k.lr)); }
    function bindRes() { $$('[data-dk]', res).forEach(function (d) { d.onclick = function () { o.close(); App.go('#/docket/' + encodeURIComponent(d.dataset.dk)); }; }); $$('[data-part]', res).forEach(function (d) { d.onclick = function () { o.close(); App.go('#/part/' + encodeURIComponent(d.dataset.part)); }; }); }
    inp.addEventListener('input', function () { run(false); });
    inp.setAttribute('enterkeyhint', 'search');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { run(true); inp.blur(); } });
    showRecent(); setTimeout(function () { inp.focus(); }, 50);
  }
  App.openSearch = openSearch;

  // ---------- Scan ----------
  var zxingLoading = null;
  function loadZxing() {
    if (window.ZXing) return Promise.resolve();
    if (zxingLoading) return zxingLoading;
    zxingLoading = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'lib/zxing.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return zxingLoading;
  }
  /** opts: {mode:'route'|'batch'|'part', title, onText(text)->true to close|false to keep scanning, footer html} */
  App.scan = function (opts) {
    opts = opts || {};
    var o = overlay(opts.title || 'Scan', '');
    var ob = $('.ob', o.el); ob.style.cssText = 'padding:0;max-width:none;display:flex;flex-direction:column';
    ob.innerHTML = '<div class="scanwrap"><video playsinline muted></video><div class="scanframe"></div><div class="scanmsg" id="smsg">Point the camera at a barcode or QR code</div></div>' +
      (opts.footer ? '<div style="padding:10px 14px" id="sfoot">' + opts.footer + '</div>' : '') +
      '<div style="padding:12px 14px;border-top:1px solid var(--line)"><div class="row"><input type="text" id="smanual" placeholder="Or type a number" style="flex:1" autocapitalize="characters"><button class="btn pri" id="sgo">Go</button></div></div>';
    var video = $('video', ob), stream = null, stopped = false, last = '', lastAt = 0, detector = null, reader = null, timer = null;
    function stop() { stopped = true; clearInterval(timer); try { if (reader) reader.reset(); } catch (e) {} if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }
    var origClose = o.close; o.close = function () { stop(); origClose(); };
    $('[data-x]', o.el).onclick = o.close;
    function got(text) {
      var now = Date.now(); if (text === last && now - lastAt < 1800) return; last = text; lastAt = now;
      var r = (opts.onText || App.handleScan)(text, o);
      Promise.resolve(r).then(function (closeIt) { if (closeIt !== false && !stopped) o.close(); });
    }
    function manual() { var v = $('#smanual', ob).value.trim(); if (v) got(v); }
    $('#sgo', ob).onclick = manual; $('#smanual', ob).addEventListener('keydown', function (e) { if (e.key === 'Enter') manual(); });
    App.scanMsg = function (m) { var e = $('#smsg', ob); if (e) e.textContent = m; };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { App.scanMsg('Camera not available here. Type the number below.'); return o; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; video.play();
      if ('BarcodeDetector' in window) {
        return BarcodeDetector.getSupportedFormats().then(function (f) {
          var want = ['code_128', 'qr_code', 'code_39', 'ean_13'].filter(function (x) { return f.indexOf(x) >= 0; });
          detector = new BarcodeDetector({ formats: want });
          timer = setInterval(function () { if (video.readyState < 2) return; detector.detect(video).then(function (b) { if (b.length) got(b[0].rawValue); }).catch(function () {}); }, 160);
        });
      }
      return loadZxing().then(function () {
        var Z = window.ZXing, hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13]);
        reader = new Z.BrowserMultiFormatReader(hints);
        reader.decodeFromStream(stream, video, function (r) { if (r) got(r.getText()); });
      });
    }).catch(function () { App.scanMsg('Could not open the camera. Allow camera access, or type the number below.'); });
    return o;
  };

  /** Route a scanned or typed text. Returns true to close the scanner. */
  App.handleScan = function (text) {
    var k = C.classifyScan(text, { isPart: function (p) { return App.lists.price.has(p); } });
    if (k.kind === 'part') {
      var p = App.lists.price.has(k.value) ? k.value : (App.lists.price.has(k.value.toUpperCase()) ? k.value.toUpperCase() : '');
      if (!p) { App.feedback(false); toast('Part not found: ' + k.value); return false; }
      App.feedback(true); App.go('#/part/' + encodeURIComponent(p)); return true;
    }
    if (k.kind === 'delivery') { App.feedback(false); toast(k.hint); return false; }
    if (k.kind === 'case') { if (!App.can('boxScan')) { App.feedback(false); toast('You do not have permission to see box contents.'); return false; } App.feedback(true); App.go('#/box/' + encodeURIComponent(k.value)); return true; }
    if (k.kind === 'docketLink') { App.feedback(true); App.go('#/docket/' + encodeURIComponent(k.value)); return true; }
    if (k.kind === 'docket' || k.kind === 'unknown') {
      var no = k.value;
      if (!App.can('docketGrn') && !App.can('searchDockets')) { App.feedback(false); toast('You do not have permission to open dockets.'); return false; }
      return resolveDocketScan(no);
    }
    App.feedback(false); return false;
  };
  function resolveDocketScan(no) {
    return api('docketLookup', { q: no }).then(function (d) {
      if (d.found) { App.feedback(true); App.go(d.docket.printed ? '#/docket/' + encodeURIComponent(d.docket.lr) : '#/docket-grn?lr=' + encodeURIComponent(no)); return true; }
      // DTDC / Safexpress box labels carry the docket number plus a box number (pattern to be confirmed with real scans)
      if (/^\d{13,16}$/.test(no)) {
        return api('docketLookup', { q: no.slice(0, 12) }).then(function (d2) {
          if (d2.found) { App.feedback(true); App.go('#/docket/' + encodeURIComponent(d2.docket.lr)); return true; }
          App.feedback(false); toast('Docket not found. Type the LR number printed on the label.'); return false;
        });
      }
      if (App.can('docketGrn')) { App.feedback(false); App.go('#/docket-grn?lr=' + encodeURIComponent(no)); return true; }
      App.feedback(false); toast('Docket not found.'); return false;
    }).catch(function (e) { toast(e.message); return false; });
  }

  // ---------- Home ----------
  App.pages.home = {
    render: function (view) {
      var u = App.me.user, h = new Date().getHours(), g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      view.innerHTML = '<h2>' + esc(g + ', ' + App.who()) + '</h2>' + (u.adminLocked ? '<div class="card warn"><b>Admin is locked.</b> This login can only scan parts until you unlock it.<div style="margin-top:10px"><button class="btn pri" id="hUnlock">Unlock Admin</button></div><div id="hUnlockMsg" class="small muted" style="margin-top:8px"></div></div>' : '') + '<button class="btn pri big hide" id="hScan">' + ICON.scan.replace('<svg', '<svg style="width:22px;height:22px;vertical-align:-4px;stroke:currentColor;fill:none;stroke-width:2;margin-right:8px"') + 'Scan</button>' +
        '<div style="margin:14px 0"><input type="search" id="hSearch" placeholder="Search part, LR, invoice, case" readonly></div>' +
        '<div class="card" id="hFresh"></div><div id="hStat"></div>';
      var hu = $('#hUnlock'); if (hu) hu.onclick = function () { App.unlockAdmin($('#hUnlockMsg'), hu); };
      var sb = $('#hScan'); if (camOK && (window.matchMedia('(max-width:800px)').matches || window.matchMedia('(pointer:coarse)').matches)) sb.classList.remove('hide');
      sb.onclick = function () { App.scan({ mode: 'route' }); };
      $('#hSearch').onclick = openSearch; $('#hSearch').onfocus = openSearch;
      this.tick();
      if (App.open()) { var hs = function () { return App.swr('homeStatus', function () { return api('homeStatus'); }, function (s) { App.pages.home.stat(s); }, { silent: true, noStatus: true }); }; hs(); var lastHome = Date.now(); App.live(function () { if (Date.now() - lastHome < 55000) return; lastHome = Date.now(); hs(); App.refreshLists(); }); }
    },
    tick: function () {
      var el = $('#hFresh'); if (!el) return;
      var m = (App.lists.meta || {}).transit || {}, can = App.can('refreshTransit') && App.open();
      var bad = m.status && m.status !== 'ok' && m.status !== 'new';
      el.innerHTML = '<div class="row between"><div><div class="bold">' + (m.updatedAt ? 'Transit updated ' + esc(ago(m.updatedAt)) : (App.can('partLocation') ? 'Transit not loaded yet' : 'Part list ready')) + '</div>' +
        (bad ? '<div class="small" style="color:var(--warn)">The latest transit file had a problem; SIMS is using the last good copy.</div>' : '') + '<div class="small muted">Price list ' + esc(ago(((App.lists.meta || {}).price || {}).updatedAt)) + '</div></div>' +
        (can ? '<button class="btn" id="hRefresh">Refresh now</button>' : '') + '</div>';
      var b = $('#hRefresh'); if (b) b.onclick = function () {
        b.disabled = true; b.textContent = 'Refreshing…';
        api('refreshTransit').then(function () { return App.refreshLists(); }).then(function () { b.textContent = 'Updated just now'; setTimeout(function () { App.pages.home.tick(); }, 2500); }).catch(function (e) { b.disabled = false; b.textContent = 'Refresh now'; toast(e.message); });
      };
    },
    stat: function (s) {
      var el = $('#hStat'); if (!el) return;
      var out = [];
      if (s.arrivedNotCombined !== undefined) out.push(s.arrivedNotCombined + (s.arrivedNotCombined === 1 ? ' docket' : ' dockets') + ' arrived, not combined');
      el.innerHTML = out.map(function (t) { return '<div class="stat">' + esc(t) + '</div>'; }).join('') + (s.packRemind ? '<div class="stat">' + esc(s.packRemind) + ' <a href="#/upload-packing">Upload now</a></div>' : '');
    }
  };

  // ---------- Part details ----------
  App.pages.part = {
    render: function (view, r) {
      var no = r.arg, p = App.lists.price.get(no);
      if (!p) { App.feedback(false); view.innerHTML = '<div class="card bad"><h2>Part not found</h2><p>' + esc(no) + ' is not in the price list.</p></div>'; return; }
      var html = '<div class="card"><div class="mono" style="font-size:28px;font-weight:700">' + esc(p.part) + '</div><div style="font-size:19px;margin:4px 0 10px">' + esc(p.desc) + '</div>' +
        '<div class="kv"><div>MRP</div><div class="bold" style="font-size:22px">' + money2(p.mrp) + '</div></div></div>';
      if (App.can('partLocation') && App.open()) {
        var rk = App.lists.rack.get(p.part), loc = rk ? C.location(rk[0], rk[1]) : null, fb = (App.lists.transitBy.get(p.part) || [])[0];
        if ((!loc || loc.none) && fb) loc = C.location(fb.rack, fb.bin);
        html += '<div class="card"><div class="kv"><div>Location</div><div class="bold" style="font-size:22px">' + (loc && !loc.none ? esc(loc.text) : '<span class="muted">No location</span>') + '</div></div></div>';
        var tr = App.lists.transitBy.get(p.part) || [];
        html += '<h3>In transit</h3>';
        if (!tr.length) html += '<div class="card muted">Nothing in transit for this part.</div>';
        else html += '<div class="card"><div class="list">' + tr.map(function (t) {
          var mark = /^PSO/.test(t.po) ? (App.lists.marks[t.po] || '') : '', exp = C.expectedDate(t.lrDate);
          return '<div class="item"><div class="grow"><div class="bold mono">' + (t.lr ? 'LR ' + esc(t.lr) : 'Not booked yet') + '</div><div class="small muted">Expected ' + (exp ? esc(C.fmtDay(exp)) : '—') + '</div></div>' +
            (mark ? '<span class="chip acc">' + esc(mark) + '</span>' : '') + '<div class="bold" style="font-size:20px">× ' + esc(t.qty) + '</div></div>';
        }).join('') + '</div></div>';
      }
      html += '<div class="row" style="margin-top:14px"><button class="btn pri hide" id="pNext">Scan next part</button></div>';
      view.innerHTML = html; App.feedback(true);
      var nb = $('#pNext'); if (camOK) nb.classList.remove('hide');
      nb.onclick = function () { App.scan({ mode: 'route' }); };
    }
  };

  // ---------- start ----------
  function start() {
    setTheme(ls('sims.theme') || 'dark', false);
    var t = ls('sims.token'), me = null; try { me = JSON.parse(ls('sims.me') || 'null'); } catch (e) {}
    var r = parseHash();
    if (PUBLIC[r.name]) { route(); return; }
    if (!t) { showLogin(); return; }
    App.token = t;
    if (me) { App.me = me; boot2(); }  // instant start from the last known state; refreshed below
    api('me', {}, { quiet: false }).then(function (m) { var first = !App.me; applyMe(m); if (first) return boot2(); renderShell(); refreshMenu(); }).catch(function (e) {
      if (e.code === 'net') { if (!App.me) { $('#boot') && ($('#boot').innerHTML = '<div class="card">' + esc(e.message) + '</div>'); } }
    });
    setInterval(function () { App.refreshLists(); App.prefetch(); }, 5 * 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) App.refreshLists(); });
  }
  App.start = start;
  App.startWhenReady = start;
})();
