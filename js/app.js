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
  function modal(html, onMount) {
    var m = document.createElement('div'); m.className = 'modal'; m.innerHTML = '<div class="box">' + html + '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    function close() { m.remove(); }
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
  function api(action, args, opts) {
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
    App.token = ''; ls('sims.token', null); App.me = null;
    showLogin(msg);
  }

  // ---------- lists / cache ----------
  function buildLists() {
    var L = App.lists, pr = L.raw.price, rk = L.raw.rack, tr = L.raw.transit;
    L.price = new Map(); (pr || []).forEach(function (r) { L.price.set(r[0], { part: r[0], desc: r[1], mrp: r[2], ndp: r[3], tax: r[4] }); });
    L.rack = new Map(); (rk || []).forEach(function (r) { L.rack.set(r[0], [r[1], r[2]]); });
    L.transitBy = new Map(); (tr || []).forEach(function (r) { var o = { invoice: r[0], part: r[1], desc: r[2], qty: r[3], lr: r[4], lrDate: r[5], po: r[6], rack: r[7], bin: r[8] }; if (!L.transitBy.has(o.part)) L.transitBy.set(o.part, []); L.transitBy.get(o.part).push(o); });
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

  // ---------- permissions ----------
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

  var TITLES = { home: 'Home', 'docket-grn': 'Docket GRN', combined: 'Combined GRN', docket: 'Docket Details', part: 'Part Details', admin: 'Admin', 'combine-scan': 'Combine by Scanning', approve: 'Login Request', 'admin-open': 'Admin Access' };
  var PUBLIC = { approve: 1 };

  function route() {
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
    $('#side').classList.remove('open'); var sc = $('#scrim'); if (sc) sc.classList.add('hide');
    var gate = pg.perm && !App.canNow(pg.perm) ? pg.perm : null;
    if (!App.open() && App.page !== 'home' && App.page !== 'part') { view.innerHTML = closedHtml(); return; }
    if (gate) { view.innerHTML = '<div class="card">You do not have permission to open this page.</div>'; return; }
    Promise.resolve(pg.render(view, r)).catch(function (e) {
      if (e && e.code === 'closed') view.innerHTML = '<div class="card warn">' + esc(e.message) + '</div>';
      else view.innerHTML = '<div class="card bad err">' + esc(e && e.message || 'Something went wrong.') + '</div>';
    });
  }
  function closedHtml() { var s = App.me.settings; return '<div class="card warn"><h2>SIMS is closed</h2><p>SIMS is closed. Office hours ' + fmtHM(s.officeStart) + ' to ' + fmtHM(s.officeEnd) + '.</p><p class="muted">Only basic part scan works now (part number, description, MRP).</p></div>'; }
  function fmtHM(t) { var p = t.split(':'), h = +p[0], ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + p[1] + ' ' + ap; }
  function menuKey(p) { return p === 'docket' || p === 'combine-scan' ? '' : p; }
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
    var m = [{ k: 'home', t: 'Home', h: '#/home' }];
    if (App.can('docketGrn')) m.push({ k: 'docket-grn', t: 'Docket GRN', h: '#/docket-grn' });
    if (App.can('combinedGrn')) m.push({ k: 'combined', t: 'Combined GRN', h: '#/combined' });
    if (App.me.user.admin) m.push({ k: 'admin', t: 'Admin', h: '#/admin' });
    return m;
  }
  function renderShell() {
    if ($('#app')) { refreshMenu(); return; }
    $('#boot') && $('#boot').remove();
    $('#root').innerHTML =
      '<div id="app"><aside id="side"><div class="brand">SIMS<small>Stock Inward Management</small></div><nav id="menu"></nav></aside><div id="scrim" class="hide"></div>' +
      '<div id="main"><header id="top"><button class="ib mobileOnly" id="menuBtn" aria-label="Menu">' + ICON.menu + '</button><h1 id="pageTitle">SIMS</h1><span id="who"></span>' +
      '<button class="ib" id="searchBtn" aria-label="Search">' + ICON.search + '</button><button class="ib hide" id="scanBtn" aria-label="Scan">' + ICON.scan + '</button></header><main id="page"></main></div></div>';
    $('#menuBtn').onclick = function () {
      var s = $('#side');
      if (window.matchMedia('(max-width:800px)').matches) { s.classList.add('open'); $('#scrim').classList.remove('hide'); } else s.classList.toggle('collapsed');
    };
    $('#menuBtn').classList.remove('mobileOnly');
    $('#scrim').onclick = function () { $('#side').classList.remove('open'); $('#scrim').classList.add('hide'); };
    $('#searchBtn').onclick = function () { openSearch(); };
    $('#scanBtn').onclick = function () { App.scan({ mode: 'route' }); };
    $('#who').onclick = labelModal;
    refreshMenu(); detectCamera(); updateScanBtn();
  }
  function refreshMenu() {
    var th = document.documentElement.dataset.theme;
    $('#menu').innerHTML = menuItems().map(function (i) { return '<a class="nav" data-r="' + i.k + '" href="' + i.h + '">' + esc(i.t) + '</a>'; }).join('') +
      '<div class="sep"></div><button class="nav" id="themeBtn">Theme: ' + (th === 'light' ? 'Light' : 'Pitch Black') + '</button><button class="nav" id="logoutBtn">Log out</button>';
    $('#themeBtn').onclick = function () { setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true); refreshMenu(); };
    $('#logoutBtn').onclick = function () { api('logout', {}, { quiet: true }).catch(function () {}).then(function () { endSession(''); }); };
    $('#who').textContent = App.who();
    $$('#side a.nav').forEach(function (a) { a.addEventListener('click', function () { $('#side').classList.remove('open'); $('#scrim').classList.add('hide'); }); });
  }
  function setTheme(t, save) {
    document.documentElement.dataset.theme = t; ls('sims.theme', t);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f4f5f7' : '#000000';
    if (save && App.token) api('setTheme', { theme: t }, { quiet: true }).catch(function () {});
  }
  function labelModal() {
    modal('<h2 style="margin-top:0">Device label</h2><p class="muted small">Shown next to your name, e.g. Office PC.</p><input type="text" id="lbl" maxlength="30" value="' + esc(App.me.user.label) + '"><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-n>Cancel</button><button class="btn pri" data-y>Save</button></div>', function (m, close) {
      $('[data-n]', m).onclick = close;
      $('[data-y]', m).onclick = function () { api('setLabel', { label: $('#lbl', m).value }).then(function (r) { App.me.user.label = r.label; $('#who').textContent = App.who(); close(); route(); }).catch(function (e) { toast(e.message); }); };
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
    return App.loadCachedLists().then(function () { route(); App.refreshLists(); });
  }

  // ---------- Search ----------
  function recent() { try { return JSON.parse(ls('sims.recent') || '[]'); } catch (e) { return []; } }
  function addRecent(q) { var r = recent().filter(function (x) { return x !== q; }); r.unshift(q); ls('sims.recent', JSON.stringify(r.slice(0, 8))); }
  function overlay(title, bodyHtml, onClose) {
    var o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = '<div class="oh"><button class="ib" data-x aria-label="Close">' + ICON.back + '</button><h2>' + esc(title) + '</h2></div><div class="ob">' + bodyHtml + '</div>';
    document.body.appendChild(o);
    function close() { o.remove(); onClose && onClose(); }
    $('[data-x]', o).onclick = close;
    return { el: o, close: close, body: $('.ob', o) };
  }
  App.overlay = overlay;

  function partSuggestions(q) {
    q = q.toUpperCase(); var out = [];
    if (q.length < 2) return out;
    App.lists.price.forEach(function (v, k) { if (out.length < 25 && k.toUpperCase().indexOf(q) === 0) out.push(v); });
    return out;
  }
  function openSearch() {
    var o = overlay('Search SIMS', '<input type="search" id="sq" placeholder="Part number, LR, invoice or case number" autocomplete="off" autocapitalize="characters"><div id="sres" style="margin-top:12px"></div>');
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
      res.innerHTML = html;
      bindRes();
      if (!go) return;
      addRecent(q);
      var exact = App.lists.price.has(q.toUpperCase()) ? q.toUpperCase() : (App.lists.price.has(q) ? q : '');
      var kinds = [];
      if (exact) kinds.push({ kind: 'part', part: exact, label: 'Part ' + exact });
      if (App.can('searchDockets') && App.open()) {
        res.innerHTML += '<p class="muted"><span class="spinner"></span> Searching dockets…</p>';
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
    function open(k) { o.close(); if (k.kind === 'part') App.go('#/part/' + encodeURIComponent(k.part)); else App.go('#/docket/' + encodeURIComponent(k.lr)); }
    function bindRes() { $$('[data-part]', res).forEach(function (d) { d.onclick = function () { o.close(); App.go('#/part/' + encodeURIComponent(d.dataset.part)); }; }); }
    inp.addEventListener('input', function () { run(false); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(true); });
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
    if (k.kind === 'case') { App.feedback(true); toast('Box scan arrives in a later update.'); return false; }
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
      view.innerHTML = '<h2>' + esc(g + ', ' + App.who()) + '</h2><button class="btn pri big hide" id="hScan">' + ICON.scan.replace('<svg', '<svg style="width:22px;height:22px;vertical-align:-4px;stroke:currentColor;fill:none;stroke-width:2;margin-right:8px"') + 'Scan</button>' +
        '<div style="margin:14px 0"><input type="search" id="hSearch" placeholder="Search SIMS — part number, LR, invoice or case number" readonly></div>' +
        '<div class="card" id="hFresh"></div><div id="hStat"></div>';
      var sb = $('#hScan'); if (camOK && (window.matchMedia('(max-width:800px)').matches || window.matchMedia('(pointer:coarse)').matches)) sb.classList.remove('hide');
      sb.onclick = function () { App.scan({ mode: 'route' }); };
      $('#hSearch').onclick = openSearch; $('#hSearch').onfocus = openSearch;
      this.tick(); if (App.open()) api('homeStatus').then(function (s) { App.pages.home.stat(s); }).catch(function () {});
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
      el.innerHTML = out.map(function (t) { return '<div class="stat">' + esc(t) + '</div>'; }).join('');
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
    setInterval(function () { App.refreshLists(); }, 5 * 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) App.refreshLists(); });
  }
  App.start = start;
  App.startWhenReady = start;
})();
