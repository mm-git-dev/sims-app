/* Document picker and photo editor: Crop, Rotate 90, Retake, Save. Resizes to 2000 px longest side (never enlarges), JPEG quality 80.
   Everything is bundled; nothing is loaded from another site. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, esc = App.esc;
  var MAX_SIDE = 2000, QUALITY = 0.8, PDF_WARN = 3 * 1024 * 1024;

  function readB64(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); });
  }

  /** Ask for a file. Resolves {mime, data (base64), name, size} or null if cancelled. opts: {title, allowPdf} */
  App.pickDoc = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; m.close(); resolve(v); }
      var m = App.modal('<h2 style="margin-top:0">' + esc(opts.title || 'Add photo') + '</h2><div class="row" style="flex-direction:column;align-items:stretch;gap:10px">' +
        '<button class="btn pri big" data-cam>Take photo</button><button class="btn big" data-file>Choose photo' + (opts.allowPdf === false ? '' : ' or PDF') + '</button><button class="btn" data-x>Cancel</button></div>' +
        '<input type="file" accept="image/*" capture="environment" id="pcam" class="hide"><input type="file" accept="' + (opts.allowPdf === false ? 'image/*' : 'image/*,application/pdf') + '" id="pfile" class="hide">', function (mm) {
        $('[data-x]', mm).onclick = function () { finish(null); };
        $('[data-cam]', mm).onclick = function () { $('#pcam', mm).click(); };
        $('[data-file]', mm).onclick = function () { $('#pfile', mm).click(); };
        function got(e) {
          var f = e.target.files && e.target.files[0]; if (!f) return;
          mm.style.display = 'none';
          handle(f).then(function (r) {
            if (r === 'retake') { mm.style.display = ''; e.target.value = ''; return; }
            finish(r);
          });
        }
        $('#pcam', mm).onchange = got; $('#pfile', mm).onchange = got;
      });
    });
  };

  function handle(file) {
    if (file.type === 'application/pdf') {
      if (file.size > PDF_WARN) {
        return App.confirm('This PDF is ' + (file.size / 1048576).toFixed(1) + ' MB, which uses a lot of Drive space. A photo is usually much smaller. Use the PDF anyway?', 'Use PDF', 'Choose again').then(function (y) { return y ? pdf(file) : 'retake'; });
      }
      return pdf(file);
    }
    return edit(file);
  }
  function pdf(file) { return readB64(file).then(function (d) { return { mime: 'application/pdf', data: d, name: file.name || 'document.pdf', size: file.size }; }); }

  function edit(file) {
    return new Promise(function (resolve) {
      var load = window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }) : Promise.reject();
      load.then(function (bmp) { build(bmp, file, resolve); }, function () { App.toast('Could not open that image.'); resolve('retake'); });
    });
  }

  function build(bmp, file, resolve) {
    var src = document.createElement('canvas'); src.width = bmp.width; src.height = bmp.height; src.getContext('2d').drawImage(bmp, 0, 0);
    var crop = { x: 0, y: 0, w: src.width, h: src.height };
    var o = document.createElement('div'); o.className = 'overlay'; o.style.zIndex = 70;
    o.innerHTML = '<div class="oh"><h2>Edit photo</h2><span class="muted small" id="pinfo"></span></div><div class="scanwrap" id="pwrap" style="background:#111"><canvas id="pcv" style="touch-action:none"></canvas></div>' +
      '<div style="padding:12px 14px;border-top:1px solid var(--line)" class="row"><button class="btn" id="pRot">Rotate</button><button class="btn" id="pRe">Retake</button><span class="grow"></span><button class="btn pri" id="pSave">Save</button></div>';
    document.body.appendChild(o);
    var cv = $('#pcv', o), wrap = $('#pwrap', o), ctx = cv.getContext('2d'), scale = 1, HIT = 26;
    function layout() {
      var W = wrap.clientWidth - 24, H = wrap.clientHeight - 24; scale = Math.min(W / src.width, H / src.height);
      cv.width = Math.round(src.width * scale); cv.height = Math.round(src.height * scale); draw();
    }
    function info() { var s = Math.min(1, MAX_SIDE / Math.max(crop.w, crop.h)); $('#pinfo', o).textContent = Math.round(crop.w * s) + ' × ' + Math.round(crop.h * s) + ' px'; }
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(src, 0, 0, cv.width, cv.height);
      var x = crop.x * scale, y = crop.y * scale, w = crop.w * scale, h = crop.h * scale;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, cv.width, y); ctx.fillRect(0, y + h, cv.width, cv.height - y - h); ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, cv.width - x - w, h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      var cs = getComputedStyle(document.documentElement); ctx.fillStyle = cs.getPropertyValue('--accent').trim() || '#FFC400'; ctx.strokeStyle = cs.getPropertyValue('--accent-text').trim() || '#000'; ctx.lineWidth = 2;
      [[x, y], [x + w / 2, y], [x + w, y], [x, y + h / 2], [x + w, y + h / 2], [x, y + h], [x + w / 2, y + h], [x + w, y + h]].forEach(function (p) { ctx.beginPath(); ctx.rect(p[0] - 11, p[1] - 11, 22, 22); ctx.fill(); ctx.stroke(); });
      info();
    }
    var drag = null;
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; }
    function hit(p) {
      var x = crop.x * scale, y = crop.y * scale, w = crop.w * scale, h = crop.h * scale, l = Math.abs(p.x - x) < HIT, r = Math.abs(p.x - (x + w)) < HIT, t = Math.abs(p.y - y) < HIT, b = Math.abs(p.y - (y + h)) < HIT;
      var inX = p.x > x - HIT && p.x < x + w + HIT, inY = p.y > y - HIT && p.y < y + h + HIT;
      if (l && t) return 'nw'; if (r && t) return 'ne'; if (l && b) return 'sw'; if (r && b) return 'se';
      if (t && inX) return 'n'; if (b && inX) return 's'; if (l && inY) return 'w'; if (r && inY) return 'e';
      if (p.x > x && p.x < x + w && p.y > y && p.y < y + h) return 'move';
      return null;
    }
    cv.addEventListener('pointerdown', function (e) { var p = pos(e), k = hit(p); if (!k) return; drag = { k: k, p: p, c: { x: crop.x, y: crop.y, w: crop.w, h: crop.h } }; try { cv.setPointerCapture(e.pointerId); } catch (x) { } e.preventDefault(); });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = pos(e), dx = (p.x - drag.p.x) / scale, dy = (p.y - drag.p.y) / scale, c = drag.c, k = drag.k, MIN = 60;
      var x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
      if (k === 'move') { var nx = Math.max(0, Math.min(src.width - c.w, c.x + dx)), ny = Math.max(0, Math.min(src.height - c.h, c.y + dy)); crop.x = nx; crop.y = ny; draw(); return; }
      if (k.indexOf('w') >= 0) x1 = Math.max(0, Math.min(x2 - MIN, c.x + dx));
      if (k.indexOf('e') >= 0) x2 = Math.min(src.width, Math.max(x1 + MIN, x2 + dx));
      if (k.indexOf('n') >= 0) y1 = Math.max(0, Math.min(y2 - MIN, c.y + dy));
      if (k.indexOf('s') >= 0) y2 = Math.min(src.height, Math.max(y1 + MIN, y2 + dy));
      crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }; draw();
    });
    function up() { drag = null; } cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    function close() { o.remove(); window.removeEventListener('resize', layout); }
    $('#pRot', o).onclick = function () {
      var n = document.createElement('canvas'); n.width = src.height; n.height = src.width; var c = n.getContext('2d');
      c.translate(n.width, 0); c.rotate(Math.PI / 2); c.drawImage(src, 0, 0); src = n; crop = { x: 0, y: 0, w: src.width, h: src.height }; layout();
    };
    $('#pRe', o).onclick = function () { close(); resolve('retake'); };
    $('#pSave', o).onclick = function () {
      // crop first, then size rules, so a crop keeps full sharpness
      var s = Math.min(1, MAX_SIDE / Math.max(crop.w, crop.h)), out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(crop.w * s)); out.height = Math.max(1, Math.round(crop.h * s));
      var c = out.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
      out.toBlob(function (b) { readB64(b).then(function (d) { close(); resolve({ mime: 'image/jpeg', data: d, name: (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', size: b.size }); }); }, 'image/jpeg', QUALITY);
    };
    window.addEventListener('resize', layout); setTimeout(layout, 30);
  }
})();
