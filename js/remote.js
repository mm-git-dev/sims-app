/* SIMS - remote printing on the screens. Wraps SIMSPrint.print so every sheet follows the routing rules in the brief (7.4):
   in the office -> normal print dialog; away -> send to the office PC (or ask the admin / block). */
(function () {
  'use strict';
  var App = window.App, $ = App.$, esc = App.esc, api = App.api, toast = App.toast;
  var local = SIMSPrint.print, ip = { at: 0, v: '' };

  function publicIp() {
    if (Date.now() - ip.at < 300000) return Promise.resolve(ip.v);
    var done = false;
    return new Promise(function (res) {
      var t = setTimeout(function () { if (!done) { done = true; res(ip.v); } }, 3000);
      fetch('https://api.ipify.org').then(function (r) { return r.text(); }).then(function (v) { if (done) return; done = true; clearTimeout(t); ip = { at: Date.now(), v: v.trim() }; res(ip.v); }).catch(function () { if (!done) { done = true; clearTimeout(t); res(ip.v); } });
    });
  }
  function titleOf(pages) {
    var m = String(pages[0] || '').match(/class="sp-foot"><span>([^<]*)</);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'") : 'Print job';
  }
  function send(pages, addr) {
    return api('printSubmit', { pages: pages, title: titleOf(pages), ip: addr });
  }

  SIMSPrint.print = function (pages) {
    if (!App.me) return local(pages);
    return publicIp().then(function (addr) {
      if (!addr) return local(pages);                       // cannot tell where we are: behave as in the office
      return api('printRoute', { ip: addr }).then(function (m) {
        if (m.mode === 'local') return local(pages);
        if (m.mode === 'blocked') { App.modal('<h2 style="margin-top:0">Remote printing is off</h2><p>Connect to the office network to print.</p><div class="row" style="justify-content:flex-end"><button class="btn pri" data-x>OK</button></div>', function (mm, close) { $('[data-x]', mm).onclick = close; }); return; }
        if (m.mode === 'remote') return send(pages, addr).then(function () { toast('Print sent to the office PC ✓', 3500); });
        if (m.mode === 'offline') {
          return send(pages, addr).then(function (r) {
            App.modal('<h2 style="margin-top:0">Office PC is offline</h2><p>Your print will come out when it\'s back on.</p><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn" data-c>Cancel the print</button><button class="btn pri" data-x>OK</button></div>', function (mm, close) {
              $('[data-x]', mm).onclick = close;
              $('[data-c]', mm).onclick = function () { api('printCancel', { id: r.id }).then(function () { toast('Print cancelled.'); close(); }).catch(function (e) { toast(e.message); }); };
            });
          });
        }
        // admin, away: choose each time
        return new Promise(function (resolve) {
          App.modal('<h2 style="margin-top:0">You are away from the office</h2><div class="row" style="flex-direction:column;align-items:stretch;gap:10px">' +
            (m.remote ? '<button class="btn pri big" data-s>Send to office printer' + (m.online ? '' : ' (office PC offline)') + '</button>' : '') +
            '<button class="btn big" data-h>Print here</button><button class="btn big" data-p>Save as PDF</button><button class="btn" data-x>Cancel</button></div>', function (mm, close) {
            var s = $('[data-s]', mm); if (s) s.onclick = function () { close(); send(pages, addr).then(function () { toast(m.online ? 'Print sent to the office PC ✓' : 'Print queued. It will come out when the office PC is back on.', 4500); resolve(); }).catch(function (e) { toast(e.message, 5000); resolve(); }); };
            $('[data-h]', mm).onclick = function () { close(); local(pages).then(resolve); };
            $('[data-p]', mm).onclick = function () { close(); toast('In the print window choose "Save as PDF" as the printer.', 4500); local(pages).then(resolve); };
            $('[data-x]', mm).onclick = function () { close(); resolve(); };
          });
        });
      }).catch(function () { return local(pages); });         // routing unavailable: print here rather than lose the sheet
    });
  };
})();
