/* Print engine: builds A4 pages for Docket GRN sheets, Combined Rack Sheets and Packing sheets (brief section 6). */
var SIMSPrint = (function () {
  'use strict';
  var C = SIMS_CORE, ROW = 6, BOTTOM = 279, LATER_TOP = 22;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function qrSvg(text) {
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    var n = q.getModuleCount(), s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2) + ' ' + (n + 2) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) s += '<rect x="' + (c + 1) + '" y="' + (r + 1) + '" width="1" height="1" fill="#000"/>';
    return s + '</svg>';
  }

  /** Split items (each {h}) into pages. firstCap/laterCap in mm available for rows; trailerH in mm for the last page. Returns [{items, used}] */
  function paginate(items, firstCap, laterCap, trailerH) {
    var pages = [{ items: [], used: 0 }], cap = firstCap;
    items.forEach(function (it) {
      var p = pages[pages.length - 1];
      if (p.used + it.h > cap + 0.001) { pages.push({ items: [], used: 0 }); cap = laterCap; p = pages[pages.length - 1]; }
      p.items.push(it); p.used += it.h;
    });
    var last = pages[pages.length - 1], lastCap = pages.length === 1 ? firstCap : laterCap;
    if (trailerH) {
      if (last.used + trailerH > lastCap + 0.001) { pages.push({ items: [], used: 0, trailerOnly: true }); last = pages[pages.length - 1]; }
      last.trailer = true;
    }
    return pages;
  }

  function colgroup(widths) { return '<colgroup>' + widths.map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup>'; }
  function locHtml(l) {
    if (l.party) return esc(l.mark) + (l.loc ? ' <s>' + esc(l.loc) + '</s>' : '');
    return esc(l.loc);
  }
  function foot(left, p, total) { return '<div class="sp-foot"><span>' + esc(left) + '</span><span>Page ' + p + ' of ' + total + '</span></div>'; }

  /** Generic sheet assembly. cfg: {head1H, headHtml(), widths, headings, rowHtml(item), items, trailerH, trailerHtml(top), footerLeft} */
  function build(cfg) {
    var first = BOTTOM - (10 + cfg.head1H) - ROW, later = BOTTOM - LATER_TOP - ROW;
    var pages = paginate(cfg.items, first, later, cfg.trailerH), total = pages.length, html = [];
    pages.forEach(function (pg, i) {
      var top = i === 0 ? 10 + cfg.head1H : LATER_TOP, h = '<div class="sheet-page">';
      if (i === 0) h += '<div class="sp-head" style="height:' + cfg.head1H + 'mm">' + cfg.headHtml() + '</div>';
      if (!pg.trailerOnly) {
        h += '<div class="sp-table-wrap" style="top:' + top + 'mm"><table class="sp-t">' + colgroup(cfg.widths) + '<thead><tr>' +
          cfg.headings.map(function (t) { return '<th>' + t + '</th>'; }).join('') + '</tr></thead><tbody>' +
          pg.items.map(cfg.rowHtml).join('') + '</tbody></table></div>';
      }
      if (pg.trailer) {
        var ttop = pg.trailerOnly ? LATER_TOP : top + ROW + pg.used + 6;
        h += '<div class="sp-trailer" style="top:' + ttop + 'mm">' + cfg.trailerHtml() + '</div>';
      }
      h += foot(cfg.footerLeft, i + 1, total) + '</div>';
      html.push(h);
    });
    return html;
  }

  // ---------- Docket GRN sheet ----------
  function docketSheet(d, siteUrl) {
    var items = C.sortByPart(d.lines).map(function (l) { return { l: l, h: ROW }; });
    var inv = d.invoices || [];
    return build({
      head1H: 35, widths: [14, 41, 7, 11, 6, 21], headings: ['Part No', 'Description', 'Qty', 'Location', 'Inv', 'Check'],
      items: items, footerLeft: 'SIMS · Docket ' + d.lr + ' (' + d.boxes + ' boxes)',
      headHtml: function () {
        return '<div style="padding-left:10.6mm"><div class="sp-tag">Docket GRN Sheet' + (d.reprint ? '<span class="sp-reprint">REPRINT</span>' : '') + '</div>' +
          '<div class="sp-lr">' + esc(d.lr) + '</div>' +
          '<div class="sp-sub">LR date ' + esc(d.lrDate ? C.fmtDay(d.lrDate) : '—') + ' · Arrived ' + esc(C.fmtStamp(d.arrivedAt)) + ' · Printed by ' + esc(d.printedBy) + '</div>' +
          '<div class="sp-remark"><span class="tag">REMARK</span>' + esc(d.remark) + '</div>' +
          '<div class="sp-check">Checked by:<span class="line"></span></div></div>' +
          '<div class="sp-right"><div class="sp-qr">' + qrSvg(siteUrl + '#/docket/' + d.lr) + '</div>' +
          '<div class="sp-boxes"><span class="n">' + esc(d.boxes) + '</span><span class="l">Boxes</span></div></div>';
      },
      rowHtml: function (it) {
        var l = it.l;
        return '<tr' + (l.party ? ' class="party"' : '') + '><td class="fit pn">' + (l.claim ? '<span class="claimdot">' + esc(l.claim) + '</span>' : '') + (l.party ? '<span class="tri"></span>' : '') + esc(l.part) + '</td>' +
          '<td class="desc fit">' + esc(l.desc) + '</td><td class="c fit">' + esc(l.qty) + '</td><td class="c fit">' + locHtml(l) + '</td>' +
          '<td class="inv fit">' + esc(l.inv) + '</td><td class="c">' + (l.grn ? '<span class="grnnote">' + esc(l.grn) + '</span>' : '') + '</td></tr>';
      },
      trailerH: 6 + 6 + 2 + 5.5 * (inv.length + 1) + 1,
      trailerHtml: function () {
        return '<div class="sp-grnremark">POD REMARK: ' + esc(d.remark) + '</div><table class="sp-inv"><colgroup><col style="width:62%"><col style="width:38%"></colgroup>' +
          '<thead><tr><th>Invoice No</th><th>GRN No</th></tr></thead><tbody>' + inv.map(function (i) { return '<tr><td>' + esc(i) + '</td><td></td></tr>'; }).join('') + '</tbody></table>';
      }
    });
  }

  // ---------- Combined Rack Sheet ----------
  function rackTitle(title) {
    return title.toUpperCase().split(' ').map(function (w) { return '<span class="big">' + esc(w.charAt(0)) + '</span><span class="small">' + esc(w.slice(1)) + '</span>'; }).join(' ');
  }
  function rackSheet(s) {
    var items = s.lines.map(function (l) { return { l: l, h: ROW }; });
    return build({
      head1H: 29, widths: [14, 47, 7, 11, 21], headings: ['Part No', 'Description', 'Qty', 'Location', 'Check'],
      items: items, footerLeft: 'SIMS · Batch ' + s.batch + ' · ' + s.title,
      headHtml: function () {
        return '<div class="sp-tag">Combined Rack Sheet' + (s.reprint ? '<span class="sp-reprint">REPRINT</span>' : '') + '</div>' +
          '<div class="sp-rack-title">' + rackTitle(s.title) + '</div>' +
          '<div class="sp-sub" style="margin-top:1.4mm">Printed ' + esc(C.fmtStamp(s.printedAt)) + ' by ' + esc(s.printedBy) + '</div>' +
          '<div class="sp-batchbox"><div class="k">Batch</div><div class="v">' + esc(s.batch) + '</div></div>';
      },
      rowHtml: function (it) {
        var l = it.l;
        return '<tr><td class="fit pn">' + esc(l.part) + '</td>' +
          '<td class="desc fit">' + esc(l.desc) + '</td><td class="c fit">' + esc(l.qty) + '</td>' +
          '<td class="c fit">' + (l.party ? '<s>' + esc(l.loc) + '</s>' : esc(l.loc)) + '</td><td class="c">' + (l.party ? esc(l.mark) : '') + (l.party && l.grn ? ' ' : '') + (l.grn ? '<span class="grnnote">' + esc(l.grn) + '</span>' : '') + '</td></tr>';
      }
    });
  }

  // ---------- Packing sheet (stage 3 uses this) ----------
  function packingSheet(s) {
    var items = s.lines.map(function (l) { return { l: l, h: l.early ? ROW * 2 : ROW }; });
    return build({
      head1H: 41, widths: [14, 39, 7, 8, 11, 21], headings: ['Part No', 'Description', 'Qty', 'MRP', 'Location', 'Check'],
      items: items, footerLeft: 'SIMS · ' + s.batch,
      headHtml: function () {
        return '<div class="sp-tag">Packing Sheet' + (s.reprint ? '<span class="sp-reprint">REPRINT</span>' : '') + '</div><div class="sp-party">' + esc(s.mark) + '</div>' +
          '<div class="sp-sub" style="margin-top:1.4mm">Prepared ' + esc(C.fmtStamp(s.printedAt)) + ' by ' + esc(s.printedBy) + '</div>' +
          '<div class="sp-sub">' + s.lines.length + ' parts · Estimate amount ₹ ' + C.fmtINR(s.estimate) + '</div>' +
          '<div class="sp-batchbox"><div class="k">Packing Batch</div><div class="v">' + esc(s.batch) + '</div></div>';
      },
      rowHtml: function (it) {
        var l = it.l;
        return '<tr' + (l.early ? ' class="dbl"' : '') + '><td class="fit pn">' + esc(l.part) + '</td><td class="desc fit">' + esc(l.desc) +
          (l.early ? '<span class="early">! GRN\'d early ' + esc(l.earlyDate) + ' · pick from location or reorder</span>' : '') + '</td>' +
          '<td class="c fit">' + esc(l.qty) + '</td><td class="c fit">' + C.fmtINR(l.mrp) + '</td><td class="c fit">' + esc(l.loc) + '</td><td></td></tr>';
      },
      trailerH: 6 + 6,
      trailerHtml: function () { return '<div class="sp-packed"><span>Packed by: ________________</span><span>Boxes packed: ______</span></div>'; }
    });
  }

  // ---------- fit rule + output ----------
  function applyFit(root) {
    var cells = root.querySelectorAll('td.fit');
    cells.forEach(function (td) {
      var base = parseFloat(getComputedStyle(td).fontSize) * 0.75; // px -> pt
      var isDesc = td.classList.contains('desc'), size = base, min = 8;
      var guard = 0;
      while (td.scrollWidth > td.clientWidth + 0.5 && guard++ < 12) {
        if (size > min) { size = Math.max(min, size - 1); }
        else if (!isDesc && size > 5) { size -= 0.5; }
        else break;
        td.style.fontSize = size + 'pt';
      }
    });
  }

  function mount(pagesHtml) {
    var root = document.getElementById('printRoot');
    root.innerHTML = pagesHtml.join('');
    return root;
  }
  /** Render pages into #printRoot, wait for fonts, apply the fit rule. For on-screen preview/PDF tests `root` must be visible. */
  function render(pagesHtml) {
    var root = mount(pagesHtml);
    return (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
      root.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;'; applyFit(root); root.style.cssText = '';
      return root;
    });
  }
  /** Print pages with the browser's print dialog. */
  function print(pagesHtml) {
    return render(pagesHtml).then(function () { return new Promise(function (res) { setTimeout(function () { window.print(); res(); }, 60); }); });
  }

  // ---------- Transit List (plain list; the brief gives no fixed layout) ----------
  function transitSheet(s) {
    var items = s.rows.map(function (l) { return { l: l, h: ROW }; });
    return build({
      head1H: 28, widths: [14, 30, 6, 13, 13, 12, 12], headings: ['Part No', 'Description', 'Qty', 'Invoice', 'LR', 'LR date', 'Mark'],
      items: items, footerLeft: 'SIMS · ' + s.title,
      headHtml: function () {
        return '<div class="sp-tag">' + esc(s.title) + '</div><div class="sp-sub" style="margin-top:1.4mm">Printed ' + esc(C.fmtStamp(s.printedAt)) + ' by ' + esc(s.printedBy) + ' · ' + s.rows.length + ' lines · ! = overdue</div>';
      },
      rowHtml: function (it) {
        var l = it.l;
        return '<tr><td class="fit pn">' + esc(l.part) + '</td><td class="desc fit">' + esc(l.desc) + '</td><td class="c fit">' + esc(l.qty) + '</td><td class="fit">' + esc(l.invoice) + '</td><td class="fit">' + esc(l.lr) + '</td><td class="fit">' + (l.lrDate ? esc(C.fmtDay(l.lrDate)) : '—') + (l.state === 'overdue' ? ' !' : '') + '</td><td class="fit">' + esc(l.mark || '') + '</td></tr>';
      },
      trailerH: 0, trailerHtml: function () { return ''; }
    });
  }
  return { docketSheet: docketSheet, transitSheet: transitSheet, rackSheet: rackSheet, packingSheet: packingSheet, render: render, print: print, applyFit: applyFit, esc: esc };
})();
