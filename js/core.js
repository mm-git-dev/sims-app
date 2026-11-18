/**
 * SIMS core logic. Pure functions only (no Google or browser calls) so the same
 * file runs in Apps Script, in the screens, and in the Node tests.
 * Source of truth: apps-script/core.js. build.js copies it to web/core.js.
 */
var SIMS_CORE = (function () {
  'use strict';

  // ---------- basic helpers ----------
  function txt(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  /** Part numbers are text, used as-is (no zero changes). Numbers from a sheet become plain digits. */
  function partNo(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return txt(v);
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var IST_MS = 5.5 * 3600 * 1000;

  /** Parse a date given as Date, Excel serial number, or text like "05 Nov 2026" / "2026-11-05" / "05/11/2026". Returns ms (UTC midnight of that calendar day) or null. */
  function parseDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      // use the calendar day as seen in IST
      var t = v.getTime() + IST_MS;
      return Math.floor(t / 86400000) * 86400000;
    }
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 20000 || v > 80000) return null; // Excel serial sanity range
      return Math.round((v - 25569) * 86400000);
    }
    var s = txt(v);
    if (!s) return null;
    var m = s.match(/^(\d{1,2})[ \-\/]([A-Za-z]{3,9})[ \-\/,]*(\d{2,4})$/);
    if (m) {
      var mi = MON.findIndex(function (x) { return m[2].toLowerCase().slice(0, 3) === x.toLowerCase(); });
      if (mi < 0) return null;
      var y = +m[3]; if (y < 100) y += 2000;
      return Date.UTC(y, mi, +m[1]);
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { var yy = +m[3]; if (yy < 100) yy += 2000; return Date.UTC(yy, +m[2] - 1, +m[1]); }
    if (/^\d{5}$/.test(s)) return parseDate(+s);
    return null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** "05 Nov 26" from ms-at-UTC-midnight */
  function fmtDay(ms) {
    if (ms === null || ms === undefined) return '';
    var d = new Date(ms);
    return pad2(d.getUTCDate()) + ' ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2);
  }
  /** "07 Nov 26, 04:30 pm" from a real instant (ms), shown in IST */
  function fmtStamp(ms) {
    if (!ms) return '';
    var d = new Date(ms + IST_MS);
    var h = d.getUTCHours(), ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    return pad2(d.getUTCDate()) + ' ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2) +
      ', ' + pad2(h) + ':' + pad2(d.getUTCMinutes()) + ' ' + ap;
  }
  /** Batch name "07-Nov-26" */
  function fmtBatchDate(ms) {
    var d = new Date(ms + IST_MS);
    return pad2(d.getUTCDate()) + '-' + MON[d.getUTCMonth()] + '-' + String(d.getUTCFullYear()).slice(2);
  }

  /** Indian digit grouping: 329702 -> "3,29,702". Rounds to whole rupees. */
  function fmtINR(n) {
    n = Math.round(Number(n) || 0);
    var neg = n < 0; if (neg) n = -n;
    var s = String(n);
    if (s.length > 3) {
      var last3 = s.slice(-3), rest = s.slice(0, -3);
      rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
      s = rest + ',' + last3;
    }
    return (neg ? '-' : '') + s;
  }
  /** Lakhs, e.g. 1234567 -> "12.35 L" */
  function fmtLakh(n) { return (Number(n) / 100000).toFixed(2) + ' L'; }

  /** Value of a line = Qty x NDP x (1 + Tax/100). */
  function lineValue(qty, ndp, tax) { return Number(qty) * Number(ndp) * (1 + Number(tax) / 100); }
  /** Packing sheet estimate: total Qty x MRP less 25%, rounded to whole rupees. */
  function estimateAmount(lines) {
    var t = 0;
    lines.forEach(function (l) { t += Number(l.qty) * Number(l.mrp); });
    return Math.round(t * 0.75);
  }

  /** Alphabetical by part number (case-insensitive, plain character order). */
  function comparePart(a, b) {
    var x = txt(a).toUpperCase(), y = txt(b).toUpperCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function sortByPart(arr, key) {
    key = key || 'part';
    return arr.slice().sort(function (a, b) { return comparePart(a[key], b[key]); });
  }

  // ---------- locations ----------
  /** Returns {rack, bin, text, group} ; group is 'A','B','C','DE','OIL'. No location => text ''. */
  function location(rack, bin) {
    var r = txt(rack), b = txt(bin);
    if (!r || !/^[A-Za-z]/.test(r) || r.toUpperCase() === 'Z') return { rack: '', bin: '', text: '', group: 'OIL', none: true };
    var letter = r.charAt(0).toUpperCase();
    var text = b ? r + '-' + b : r;
    var group = letter === 'A' ? 'A' : letter === 'B' ? 'B' : letter === 'C' ? 'C' :
      (letter === 'D' || letter === 'E') ? 'DE' : 'OIL';
    return { rack: r, bin: b, text: text, group: group, none: false };
  }
  var GROUP_TITLES = { A: 'Rack A', B: 'Rack B', C: 'Rack C', DE: 'Rack D and E', OIL: 'Oil and other locations' };

  // ---------- scanning ----------
  /** Part-label QR (advantagetvs link) -> part number, or '' if it is not one. */
  function partFromQr(text) {
    var s = txt(text), i = s.toLowerCase().indexOf('ircode=');
    if (i < 0) return '';
    var rest = s.slice(i + 7);
    try { rest = decodeURIComponent(rest); } catch (e) { /* keep as is */ }
    var parts = rest.split(' - ');
    if (parts.length < 2) return '';
    var second = parts[1].trim();
    if (second.length <= 8) return '';
    return second.slice(8);
  }

  /**
   * Decide what a scanned/typed text is.
   * ctx.isPart(text) -> bool (is it in the price list). ctx.siteHost optional.
   * Returns {kind, value, hint?} ; kind in part|docket|case|delivery|docketLink|unknown
   */
  function classifyScan(raw, ctx) {
    ctx = ctx || {};
    var s = txt(raw);
    if (!s) return { kind: 'unknown', value: '' };
    var q = partFromQr(s);
    if (q) return { kind: 'part', value: q };
    var m = s.match(/[?&#\/]docket[=\/]([A-Za-z0-9]+)/i);
    if (m && /^https?:/i.test(s)) return { kind: 'docketLink', value: m[1] };
    var compact = s.replace(/\s+/g, '');
    if (/^\d+$/.test(compact)) {
      if (ctx.isPart && ctx.isPart(compact)) return { kind: 'part', value: compact };
      if (/^926\d{6}$/.test(compact)) return { kind: 'delivery', value: compact, hint: 'Scan the Case No barcode instead.' };
      if (/^\d{8}$/.test(compact)) return { kind: 'case', value: compact };
      if (/^(\d{9}|\d{11}|\d{12})$/.test(compact)) return { kind: 'docket', value: compact };
      return { kind: 'unknown', value: compact };
    }
    return { kind: 'part', value: s };
  }

  // ---------- feed checks ----------
  var HEAD_TRANSIT = ['Invoice No.', 'Part No.', 'Description', 'Qty', 'MRP', 'LR No.', 'LR Date', 'Rack', 'Bin', 'PO No'];
  var HEAD_PRICE = ['Part No', 'Part Description', 'HSN Code', 'Tax', 'NDP', 'MRP', 'MOQ', 'Category'];
  var HEAD_RACK = ['Part No', 'Rack', 'Bin'];
  var PO_RE = /^[A-Z]{2,4}30256\d{2}\d+$/; // PPO / MPO / PSO, plus other company prefixes seen in real data (e.g. MLPO)
  var TAXES = [5, 12, 18, 28];

  function headingsOk(row, expected, loose) {
    if (!row) return false;
    for (var i = 0; i < expected.length; i++) {
      var a = txt(row[i]).replace(/\.$/, '').toLowerCase(), b = expected[i].replace(/\.$/, '').toLowerCase();
      if (a !== b) return false;
    }
    return true;
  }
  function isNum(v) { return v !== '' && v !== null && v !== undefined && isFinite(Number(v)) && typeof v !== 'boolean'; }
  function isWhole(v) { return isNum(v) && Number(v) === Math.floor(Number(v)); }

  /**
   * Generic tab check. kind: 'transit' | 'price' | 'rack'.
   * rows = 2-D array incl. header row. prevCount = rows in last good version (0 if none).
   * Returns {status:'ok'|'rejected'|'held', reason, rows:[objects], bad:[{row,reason}], columnFail}
   */
  function checkTab(kind, rows, prevCount) {
    var head = kind === 'transit' ? HEAD_TRANSIT : kind === 'price' ? HEAD_PRICE : HEAD_RACK;
    var label = kind === 'transit' ? 'Transit' : kind === 'price' ? 'Price list' : 'Rack bin';
    if (!rows || !rows.length || !headingsOk(rows[0], head)) {
      return { status: 'rejected', reason: 'Headings missing or not in the expected order.', rows: [], bad: [] };
    }
    var body = rows.slice(1).filter(function (r) { return r.some(function (c) { return txt(c) !== ''; }); });
    if (prevCount >= 50 && body.length < prevCount * 0.2) {
      return { status: 'held', reason: 'The new copy has ' + Math.round((1 - body.length / prevCount) * 100) + '% fewer rows than the last one.', rows: [], bad: [] };
    }
    var good = [], bad = [], colFails = {};
    var curPart = '';
    function fail(i, col, why) { bad.push({ row: i + 2, reason: why, part: curPart }); colFails[col] = (colFails[col] || 0) + 1; }
    var seen = {};
    body.forEach(function (r, i) {
      var o, why; curPart = '';
      if (kind === 'transit') {
        o = { invoice: txt(r[0]), part: partNo(r[1]), desc: txt(r[2]), qty: r[3], feedPrice: r[4], lr: txt(r[5]), lrDateRaw: r[6], rack: txt(r[7]), bin: txt(r[8]), po: txt(r[9]) }; curPart = o.part;
        if (!o.part) return fail(i, 'Part No.', 'Part number empty');
        if (!o.invoice) return fail(i, 'Invoice No.', 'Invoice number empty');
        if (!isWhole(r[3]) || Number(r[3]) <= 0) return fail(i, 'Qty', 'Qty is not a whole number');
        if (!isNum(r[4]) || Number(r[4]) <= 0) return fail(i, 'MRP', 'MRP not a positive number');
        var d = parseDate(r[6]);
        if (o.lr && r[6] !== '' && r[6] !== null && d === null) return fail(i, 'LR Date', 'LR Date not valid');
        if (o.po && !PO_RE.test(o.po)) return fail(i, 'PO No', 'PO number format not valid');
        o.qty = Number(r[3]); o.feedPrice = Number(r[4]); o.lrDate = d;
        o.lr = o.lr.replace(/\s+/g, '');
      } else if (kind === 'price') {
        o = { part: partNo(r[0]), desc: txt(r[1]), tax: Number(r[3]), ndp: Number(r[4]), mrp: Number(r[5]) }; curPart = o.part;
        if (!o.part) return fail(i, 'Part No', 'Part number empty');
        if (!isNum(r[4]) || !isNum(r[5])) return fail(i, 'NDP', 'NDP or MRP not numeric');
        if (o.mrp < o.ndp) return fail(i, 'MRP', 'MRP lower than NDP');
        if (TAXES.indexOf(o.tax) < 0) return fail(i, 'Tax', 'Tax not 5/12/18/28');
      } else {
        o = { part: partNo(r[0]), rack: txt(r[1]), bin: txt(r[2]) }; curPart = o.part;
        if (!o.part) return fail(i, 'Part No', 'Part number empty');
        if (seen[o.part]) { bad.push({ row: i + 2, reason: 'Duplicate part (first row used)', part: o.part, info: true }); return; }
        seen[o.part] = 1;
      }
      good.push(o);
    });
    // whole column wrong: any single column failing in >50% of rows rejects the tab
    var colKeys = Object.keys(colFails);
    for (var k = 0; k < colKeys.length; k++) {
      var pct = colFails[colKeys[k]] / Math.max(1, body.length);
      if (pct > 0.5) {
        return { status: 'rejected', reason: colKeys[k] + ' column looks wrong in ' + Math.round(pct * 100) + '% of rows.', rows: [], bad: bad, columnFail: colKeys[k] };
      }
    }
    if (!good.length) return { status: 'rejected', reason: label + ' tab has no usable rows.', rows: [], bad: bad };
    return { status: 'ok', reason: '', rows: good, bad: bad };
  }

  // ---------- GRN detection ----------
  /** Key of a transit line. Repeats of the same invoice+part+lr+po get a #n suffix. */
  function lineKeys(rows) {
    var cnt = {};
    return rows.map(function (r) {
      var base = r.invoice + '|' + r.part + '|' + r.po;
      cnt[base] = (cnt[base] || 0) + 1;
      return base + '|' + cnt[base];
    });
  }

  /**
   * prev: array of tracked lines {key, ..., grnDate: ms|null, history:[]}
   * rows: current good transit rows. today: ms (UTC midnight day).
   * Returns {lines, newCount, grnd:[keys], reopened:[keys]}
   */
  function detectGrn(prev, rows, today) {
    var keys = lineKeys(rows), present = {}, out = [], byKey = {};
    prev.forEach(function (l) { byKey[l.key] = l; });
    var grnd = [], reopened = [], created = 0;
    rows.forEach(function (r, i) {
      var k = keys[i]; present[k] = 1;
      var old = byKey[k], l;
      if (old) {
        l = Object.assign({}, old, r, { key: k });
        if (old.grnDate) { l.grnDate = null; l.history = (old.history || []).concat([{ reopened: today, was: old.grnDate }]); reopened.push(k); }
      } else { l = Object.assign({}, r, { key: k, grnDate: null, history: [] }); created++; }
      out.push(l);
    });
    prev.forEach(function (l) {
      if (present[l.key]) return;
      if (!l.grnDate) { l = Object.assign({}, l, { grnDate: today }); grnd.push(l.key); }
      out.push(l);
    });
    return { lines: out, newCount: created, grnd: grnd, reopened: reopened };
  }

  /** 'none' | 'partly' | 'done' for a docket's lines. */
  function grnProgress(lines) {
    var n = lines.length, g = lines.filter(function (l) { return l.grnDate; }).length;
    return { done: g, total: n, state: n && g === n ? 'done' : g > 0 ? 'partly' : 'none' };
  }

  // ---------- docket status, remark, flags ----------
  function remarkText(d) {
    var dm = Number(d.damaged), sh = Number(d.short);
    if (!(dm >= 0) || !(sh >= 0) || d.damaged === '' || d.short === '' || d.damaged == null || d.short == null) return 'NOT ENTERED';
    if (dm === 0 && sh === 0) return 'OK';
    return dm + ' DAMAGED, ' + sh + ' SHORT';
  }
  /** Short boxes that count for a claim: only when BOTH damaged and short are entered (0 or more). Otherwise 0. */
  function shortBoxes(d) { return remarkText(d) === 'NOT ENTERED' ? 0 : Number(d.short); }
  function remarkLine(d) {
    var dm = Number(d.damaged), sh = Number(d.short);
    if (remarkText(d) === 'NOT ENTERED') return 'Not entered';
    return 'Out of ' + d.boxes + ': ' + dm + ' damaged, ' + sh + ' short';
  }
  /** Status from print state + GRN progress. d.arrivedAt, d.combined (bool). */
  function docketStatus(d, progress) {
    if (progress && progress.state === 'done') return 'GRN Done';
    if (progress && progress.state === 'partly') return "Partly GRN'd";
    if (d.combined) return 'Combined';
    if (d.arrivedAt) return 'Arrived';
    return 'Not arrived';
  }
  /** docs: {pod, claim, laterReceipts, deliveries} counts (documents of each kind; deliveries = late deliveries recorded). */
  function docketFlags(d, docs) {
    docs = docs || {};
    var f = [];
    if (remarkText(d) === 'NOT ENTERED') f.push('Remark not entered');
    if (!docs.pod) f.push('POD missing');
    if (shortBoxes(d) > 0 && !docs.claim) f.push('Claim sheet missing');
    if ((docs.deliveries || 0) > (docs.laterReceipts || 0)) f.push('Later receipt sheet missing');
    if (d.lrMismatch) f.push('LR not matching POMS');
    return f;
  }
  /** Claim state for a docket with short boxes. deliveries: [{boxes, poms}] */
  function claimState(d, deliveries) {
    var sh = shortBoxes(d);
    if (!(sh > 0)) return { state: 'none', stillShort: 0, late: 0 };
    var late = 0; (deliveries || []).forEach(function (x) { late += Number(x.boxes) || 0; });
    var still = Math.max(0, sh - late);
    if (d.claimSettled) return { state: 'settled', stillShort: still, late: late };
    var open = still > 0 || (deliveries || []).some(function (x) { return !x.poms; });
    return { state: open ? 'open' : 'closed', stillShort: still, late: late };
  }

  // ---------- party order status ----------
  /** Section of a party line: packed | awaiting (arrived) | early (GRN'd before the docket arrived; also awaiting) | overdue | transit. */
  function partySection(l, arrived, packed, now) {
    if (packed) return 'packed';
    if (arrived) return 'awaiting';
    if (l.grnDate) return 'early';
    if (l.lrDate && now - l.lrDate > 20 * 86400000) return 'overdue';
    return 'transit';
  }
  /** Expected arrival = LR date + 8 days; overdue after 20 days; no LR date = not yet booked. */
  function transitState(lrDate, now) {
    if (!lrDate) return 'notBooked';
    return now - lrDate > 20 * 86400000 ? 'overdue' : 'transit';
  }

  // ---------- permissions ----------
  var PERMS = {
    always: ['partBasic'],
    defaults: ['partLocation', 'docketGrn', 'searchParts'],
    extra: ['searchDockets', 'boxScan', 'combinedGrn', 'pendingItems', 'pendingClaims', 'addDelivery', 'uploadPod', 'uploadClaim',
      'editPodRemarks', 'markPoms', 'markSettled', 'missedClaims', 'partyOrders', 'manageOrders', 'printPacking', 'transitList',
      'boxFinder', 'docketHistory', 'uploadPacking', 'refreshTransit', 'partWatch']
  };
  var PERM_INFO = {
    partBasic: 'See a part\'s number, description and MRP. Always on.',
    partLocation: 'On part scan, also see its rack location and the transit lines coming for it.',
    docketGrn: 'Enter dockets, print and reprint Docket GRN sheets.',
    searchParts: 'Search by part number.',
    searchDockets: 'Search by docket (LR), invoice or case number.',
    boxScan: 'See what is inside a box (scan a case number).',
    combinedGrn: 'Print combined rack sheets, add dockets not yet printed, combine by scanning.',
    pendingItems: 'See the Pending Items list (missing remarks, PODs, sheets).',
    pendingClaims: 'See dockets with short boxes and open claims.',
    addDelivery: 'Record late boxes arriving against a claim.',
    uploadPod: 'Attach a POD photo or file to a docket.',
    uploadClaim: 'Attach claim sheets, with an optional note.',
    editPodRemarks: 'Change a docket\'s damaged/short remark after printing (every change is logged).',
    markPoms: 'Mark a late delivery as added to POMS.',
    markSettled: 'Mark a claim as settled.',
    missedClaims: 'Add, view and clear Missed Claims.',
    partyOrders: 'View Order Status and add order numbers.',
    manageOrders: 'Edit, close and reopen order numbers.',
    printPacking: 'Print packing sheets (marks parts as packed).',
    transitList: 'View and print the Transit List.',
    boxFinder: 'Find which case an invoice part was packed in.',
    docketHistory: 'On Docket Details, open the timeline of who did what, and find dockets older than 90 days in the archive.',
    uploadPacking: 'Upload the company packing list.',
    refreshTransit: 'Refresh transit now instead of waiting.',
    partWatch: 'Part Watch List: add parts to watch and get an alert when one first arrives. Remove only the ones they added.'
  };
  function allPerms() { return PERMS.always.concat(PERMS.defaults, PERMS.extra); }
  function can(user, perm) {
    if (!user) return false;
    if (user.admin) return !user.adminLocked || perm === 'partBasic' || perm === 'partLocation';
    if (PERMS.always.indexOf(perm) >= 0) return true;
    return (user.perms || []).indexOf(perm) >= 0;
  }

  // ---------- office hours ----------
  /** settings: {start:'10:00', end:'19:00', days:[1,2,3,4,5,6] (0=Sun)} ; nowMs real instant. */
  function officeOpen(settings, nowMs) {
    var d = new Date(nowMs + IST_MS);
    var mins = d.getUTCHours() * 60 + d.getUTCMinutes(), dow = d.getUTCDay();
    var s = (settings.start || '10:00').split(':'), e = (settings.end || '19:00').split(':');
    var a = +s[0] * 60 + +s[1], b = +e[0] * 60 + +e[1];
    return (settings.days || [1, 2, 3, 4, 5, 6]).indexOf(dow) >= 0 && mins >= a && mins < b;
  }
  /** What a user may do right now. Admin always; others only basic part scan outside hours. */
  function canNow(user, perm, settings, nowMs) {
    if (!user) return false;
    if (user.admin) return true;
    if (!can(user, perm)) return false;
    if (officeOpen(settings, nowMs)) return true;
    return perm === 'partBasic';
  }

  // ---------- transit dates ----------
  function expectedDate(lrDateMs) { return lrDateMs == null ? null : lrDateMs + 8 * 86400000; }
  function isOverdue(lrDateMs, todayMs) { return lrDateMs != null && (todayMs - lrDateMs) / 86400000 > 20; }

  // ---------- packing list ----------
  /** rows: 2-D array of the "Data" tab. Finds the real heading row (the one containing "Case Number"). */
  function parsePackingList(rows) {
    var h = -1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      if (rows[i].some(function (c) { return txt(c).toLowerCase() === 'case number'; })) { h = i; break; }
    }
    if (h < 0) return { ok: false, reason: 'Heading row with "Case Number" not found.', lines: [] };
    var idx = {};
    rows[h].forEach(function (c, j) { idx[txt(c).toLowerCase()] = j; });
    var need = ['invoice number', 'delivery number', 'case number', 'carton box', 'part no', 'part description', 'qty'];
    for (var n = 0; n < need.length; n++) if (idx[need[n]] === undefined) return { ok: false, reason: 'Missing column: ' + need[n], lines: [] };
    var lines = [], bad = 0;
    for (var r = h + 1; r < rows.length; r++) {
      var x = rows[r];
      if (!x || !txt(x[idx['case number']]) ) { if (x && x.some(function (c) { return txt(c) !== ''; })) bad++; continue; }
      var q = Number(x[idx['qty']]);
      if (!isFinite(q)) { bad++; continue; }
      lines.push({
        invoice: txt(x[idx['invoice number']]), delivery: txt(x[idx['delivery number']]), caseNo: txt(x[idx['case number']]),
        carton: txt(x[idx['carton box']]), part: partNo(x[idx['part no']]), desc: txt(x[idx['part description']]), qty: q
      });
    }
    return { ok: true, reason: '', lines: lines, bad: bad };
  }

  /** Last 4 digits of an invoice number, for the INV column. */
  function inv4(inv) { var s = txt(inv); return s.slice(-4); }

  return {
    txt: txt, partNo: partNo, parseDate: parseDate, fmtDay: fmtDay, fmtStamp: fmtStamp, fmtBatchDate: fmtBatchDate,
    fmtINR: fmtINR, fmtLakh: fmtLakh, lineValue: lineValue, estimateAmount: estimateAmount,
    comparePart: comparePart, sortByPart: sortByPart, location: location, GROUP_TITLES: GROUP_TITLES,
    partFromQr: partFromQr, classifyScan: classifyScan, checkTab: checkTab, lineKeys: lineKeys, detectGrn: detectGrn,
    grnProgress: grnProgress, partySection: partySection, transitState: transitState, remarkText: remarkText, shortBoxes: shortBoxes, remarkLine: remarkLine, docketStatus: docketStatus, docketFlags: docketFlags, claimState: claimState,
    PERMS: PERMS, PERM_INFO: PERM_INFO, allPerms: allPerms, can: can, officeOpen: officeOpen, canNow: canNow,
    expectedDate: expectedDate, isOverdue: isOverdue, parsePackingList: parsePackingList, inv4: inv4,
    HEAD_TRANSIT: HEAD_TRANSIT, HEAD_PRICE: HEAD_PRICE, HEAD_RACK: HEAD_RACK
  };
})();
if (typeof module !== 'undefined') module.exports = SIMS_CORE;
var C = SIMS_CORE; // short alias used by the back end files (Apps Script shares one global scope)
