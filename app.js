/* Pontaj TC — pontaj + timpi de picking. Un singur fișier de logică; fără build. */
(function () {
'use strict';

/* ───────────── utilitare ───────────── */
var TZ = 'Europe/Bucharest';
var MAX_SHIFT_MS = 16 * 3600e3;          // o tură deschisă mai veche de 16h = "plecare lipsă"
var APP_VERSION = '1.0.2';
var $ = function (s, r) { return (r || document).querySelector(s); };
var mem = {};
var LS = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : d; } },
  set: function (k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del: function (k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }
};
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function rid(n) { var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
function E(msg, code) { var e = new Error(msg); e.friendly = true; e.code = code || 'app'; return e; }
function emsg(e) { return e && e.friendly ? e.message : (e && e.message ? e.message : String(e)); }

var dfParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(ms) { var p = {}; dfParts.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; }); if (p.hour === '24') p.hour = '00'; return p; }
function dateKey(ms) { var p = parts(ms); return p.year + '-' + p.month + '-' + p.day; }
function fmtTime(ms) { if (ms == null) return '–'; var p = parts(ms); return p.hour + ':' + p.minute + ':' + p.second; }
function fmtTimeM(ms) { if (ms == null) return '–'; var p = parts(ms); return p.hour + ':' + p.minute; }
function addDays(dk, n) { var a = dk.split('-').map(Number); var d = new Date(Date.UTC(a[0], a[1] - 1, a[2] + n, 12)); return d.toISOString().slice(0, 10); }
function zonedToMs(dk, hhmm) {
  var a = dk.split('-').map(Number), b = hhmm.split(':').map(Number);
  var want = Date.UTC(a[0], a[1] - 1, a[2], b[0], b[1] || 0, b[2] || 0), guess = want;
  for (var i = 0; i < 3; i++) { var p = parts(guess); var got = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); guess -= (got - want); }
  return guess;
}
var WD = ['dum', 'lun', 'mar', 'mie', 'joi', 'vin', 'sâm'];
function fmtDate(dk, withWd) { var a = dk.split('-'); var s = a[2] + '.' + a[1] + '.' + a[0]; if (withWd) { s = WD[new Date(Date.UTC(+a[0], +a[1] - 1, +a[2], 12)).getUTCDay()] + ' ' + s; } return s; }
function fmtDur(ms) { if (ms == null) return '–'; var s = Math.floor(Math.max(0, ms) / 1000); return Math.floor(s / 3600) + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
// durată care curge: se actualizează pe loc în fiecare secundă (fără să redesenez butoanele)
function live(base, since, norm) {
  var v = base + (since ? now() - since : 0); if (norm != null) v = Math.max(0, v - norm);
  return '<span data-lb="' + base + '" data-ls="' + (since || '') + '"' + (norm != null ? ' data-ln="' + norm + '"' : '') + '>' + fmtDur(v) + '</span>';
}
function liveParts(c, what) {   // [bază, de când curge] pentru totalul de prezență ('all') sau de picking ('pick')
  var g = c.segs[c.segs.length - 1], tot = what === 'all' ? c.presence : c.pick;
  return g && g.live && (what === 'all' || g.cat === what) ? [tot - g.dur, g.start] : [tot, 0];
}
function fmtClock(ms) { var s = Math.floor(Math.max(0, ms) / 1000); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase(); }

var clockOffset = Number(LS.get('ptc_offset', 0)) || 0;   // ora serverului − ora telefonului
function now() { return Date.now() + clockOffset; }

/* ───────────── configurare implicită ───────────── */
function defaultConfig() {
  return {
    normMin: 510,   // 08:30 prezență; ce trece = ore suplimentare
    reasons: [
      { id: 'r_pauza', name: 'Pauză oficială', kind: 'break', comment: 'none', active: true },
      { id: 'r_problema', name: 'Problemă comandă', kind: 'work', comment: 'req', active: true },
      { id: 'r_lipsa', name: 'Lipsă raft', kind: 'work', comment: 'opt', active: true },
      { id: 'r_batoane', name: 'Desfăcut batoane', kind: 'work', comment: 'none', active: true }
    ]
  };
}
var KIND_LBL = { break: 'Pauză (nu se lucrează)', work: 'Activitate (timp de lucru)' };
var CMT_LBL = { none: 'fără comentariu', opt: 'comentariu opțional', req: 'comentariu obligatoriu' };

/* ───────────── calculul unei zile ─────────────
   Eveniment: {id, t (ora oficială, ms), d (ora telefonului), s: in|pick|r|idle|out, rid, rn, rk, c, fp, by}
   Un eveniment deschide un segment care ține până la următorul eveniment. */
function computeDay(doc, nowMs) {
  var evs = ((doc && doc.events) || []).slice().sort(function (a, b) { return a.t - b.t; });
  var segs = [], cur = null, arrival = null, departure = null, firstPick = null, intervalStart = null, edited = false;
  evs.forEach(function (e) {
    if (e.by) edited = true;
    if (cur) { cur.end = e.t; segs.push(cur); cur = null; }
    if (e.s === 'out') { departure = e.t; intervalStart = null; return; }
    if (arrival == null) arrival = e.t;
    if (intervalStart == null) intervalStart = e.t;
    if (e.s === 'pick' && firstPick == null) firstPick = e.t;
    departure = null;
    cur = { start: e.t, s: e.s, rid: e.rid, rn: e.rn, rk: e.rk, c: e.c || '', by: e.by || '' };
  });
  var open = false, missingOut = false;
  if (cur) {
    if (nowMs - intervalStart < MAX_SHIFT_MS) { cur.end = Math.max(nowMs, cur.start); cur.live = true; open = true; }
    else { cur.end = cur.start; missingOut = true; }
    segs.push(cur);
  }
  var r = { evs: evs, segs: segs, arrival: arrival, departure: departure, firstPick: firstPick, open: open, missingOut: missingOut, edited: edited,
            presence: 0, pick: 0, brk: 0, other: 0, idle: 0, byReason: {}, last: evs[evs.length - 1] || null };
  segs.forEach(function (g) {
    var d = g.end - g.start; g.dur = d; r.presence += d;
    if (g.s === 'pick') { g.cat = 'pick'; r.pick += d; }
    else if (g.s === 'r') {
      g.cat = g.rk === 'break' ? 'break' : 'work';
      if (g.cat === 'break') r.brk += d; else r.other += d;
      var k = g.rid || g.rn; if (!r.byReason[k]) r.byReason[k] = { rid: k, name: g.rn, kind: g.cat, ms: 0, n: 0 };
      r.byReason[k].ms += d; r.byReason[k].n++;
    } else { g.cat = 'idle'; r.idle += d; }
  });
  return r;
}
function overtime(c, cfg) { return Math.max(0, c.presence - (cfg.normMin || 510) * 60000); }
function segLabel(g) { return g.cat === 'pick' ? 'Picking' : g.cat === 'idle' ? 'Fără activitate' : (g.rn || 'Activitate'); }
function reasonName(cfg, rid, fallback) { var x = (cfg.reasons || []).filter(function (r) { return r.id === rid; })[0]; return x ? x.name : (fallback || rid); }

/* ───────────── stocare: mod DEMO (doar pe acest dispozitiv) ───────────── */
function seedDemo() {
  var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  var cfg = defaultConfig();
  var people = [['admin', 'Admin Demo', 'admin', '', '1234'], ['u1', 'Ionescu Maria', 'operator', 'R1010AAA', '1111'], ['u2', 'Popa Elena', 'operator', 'R1010BBB', '2222'], ['u3', 'Stan Cristina', 'operator', 'R1010CCC', '3333'], ['u4', 'Dobre Andrei', 'operator', 'R1010DDD', '4444']];
  var S = { roster: {}, pins: {}, config: cfg, days: {} };
  people.forEach(function (p) { S.roster[p[0]] = { name: p[1], role: p[2], wmsId: p[3], active: true }; S.pins[p[0]] = p[4]; });
  var R = {}; cfg.reasons.forEach(function (r) { R[r.id] = r; });
  function ev(t, s, rid_, c, fp) { var e = { id: rid(8), t: t, d: t, s: s }; if (s === 'r') { e.rid = rid_; e.rn = R[rid_].name; e.rk = R[rid_].kind; if (fp) e.fp = true; } if (c) e.c = c; return e; }
  var M = 60000, today = dateKey(Date.now());
  var cmts = ['Comandă Kaufland – lipsă 2 baxuri la lot', 'Etichetă greșită pe palet', 'Cantitate diferită față de comandă', 'Lot amestecat pe locație'];
  for (var back = 12; back >= 1; back--) {
    var dk = addDays(today, -back); var wd = new Date(dk + 'T12:00:00Z').getUTCDay(); if (wd === 0 || wd === 6) continue;
    ['u1', 'u2', 'u3', 'u4'].forEach(function (u) {
      if (rnd() < 0.08) return;
      var t = zonedToMs(dk, '07:00') + ri(-6, 5) * M, evs = [];
      evs.push(ev(t, 'in')); t += ri(6, 14) * M; evs.push(ev(t, 'pick'));
      t += ri(95, 130) * M; if (rnd() < 0.6) { evs.push(ev(t, 'r', 'r_problema', cmts[ri(0, 3)], true)); t += ri(6, 18) * M; evs.push(ev(t, 'pick')); }
      t += ri(70, 100) * M; evs.push(ev(t, 'r', 'r_pauza', '', true)); t += ri(28, 36) * M; evs.push(ev(t, 'pick'));
      t += ri(60, 90) * M; if (rnd() < 0.5) { evs.push(ev(t, 'r', 'r_lipsa', rnd() < 0.5 ? 'T01 – aștept stivuitorul' : '', true)); t += ri(5, 15) * M; evs.push(ev(t, 'pick')); }
      t += ri(40, 70) * M; if (rnd() < 0.35) { evs.push(ev(t, 'r', 'r_batoane', '', true)); t += ri(15, 40) * M; evs.push(ev(t, 'pick')); }
      t += ri(50, 110) * M; evs.push(ev(t, 'idle'));
      var out = zonedToMs(dk, '15:30') + ri(-3, 6) * M + (rnd() < 0.3 ? ri(20, 75) * M : 0); if (out < t + 4 * M) out = t + ri(5, 12) * M;
      evs.push(ev(out, 'out'));
      S.days[u + '_' + dk] = { userId: u, date: dk, events: evs };
    });
  }
  var n = Date.now();
  S.days['u1_' + today] = { userId: 'u1', date: today, events: [ev(n - 172 * M, 'in'), ev(n - 160 * M, 'pick'), ev(n - 75 * M, 'r', 'r_problema', cmts[0], true), ev(n - 63 * M, 'pick')] };
  S.days['u2_' + today] = { userId: 'u2', date: today, events: [ev(n - 168 * M, 'in'), ev(n - 158 * M, 'pick'), ev(n - 9 * M, 'r', 'r_pauza', '', true)] };
  S.days['u3_' + today] = { userId: 'u3', date: today, events: [ev(n - 14 * M, 'in')] };
  return S;
}
function DemoStore() {
  var KEY = 'ptc_demo_v1', S = LS.get(KEY, null), subs = [];
  if (!S || !S.roster) { S = seedDemo(); LS.set(KEY, S); }
  function save() { LS.set(KEY, S); subs.slice().forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function sub(f) { subs.push(f); f(); return function () { subs = subs.filter(function (x) { return x !== f; }); }; }
  function range(from, to) { return Object.keys(S.days).map(function (k) { return S.days[k]; }).filter(function (d) { return d.date >= from && d.date <= to; }).map(clone); }
  return {
    mode: 'demo',
    boot: function () { return Promise.resolve({ setupDone: true }); },
    roster: function () { return Promise.resolve(clone(S.roster)); },
    login: function (userId, pin) {
      var u = S.roster[userId];
      if (!u || S.pins[userId] !== pin) return Promise.reject(E('PIN greșit', 'pin'));
      if (!u.active) return Promise.reject(E('Cont dezactivat. Vorbește cu adminul.'));
      LS.set('ptc_demo_me', userId);
      return Promise.resolve({ userId: userId, role: u.role, name: u.name });
    },
    resume: function () { var id = LS.get('ptc_demo_me', null), u = id && S.roster[id]; return Promise.resolve(u && u.active !== false ? { userId: id, role: u.role, name: u.name } : null); },
    logout: function () { LS.del('ptc_demo_me'); return Promise.resolve(); },
    changePin: function (userId, oldPin, newPin) { if (S.pins[userId] !== oldPin) return Promise.reject(E('PIN-ul vechi e greșit')); S.pins[userId] = newPin; save(); return Promise.resolve(); },
    config: function () { return Promise.resolve(clone(S.config)); },
    saveConfig: function (c) { S.config = clone(c); save(); return Promise.resolve(); },
    watchDays: function (ids, cb) { return sub(function () { var m = {}; ids.forEach(function (id) { m[id] = clone(S.days[id]) || null; }); cb(m, false); }); },
    getDays: function (ids) { var m = {}; ids.forEach(function (id) { m[id] = clone(S.days[id]) || null; }); return Promise.resolve(m); },
    appendEvent: function (userId, date, ev) { var id = userId + '_' + date; if (!S.days[id]) S.days[id] = { userId: userId, date: date, events: [] }; S.days[id].events.push(ev); save(); return Promise.resolve(); },
    watchRange: function (from, to, cb) { return sub(function () { cb(range(from, to)); }); },
    getRange: function (from, to) { return Promise.resolve(range(from, to)); },
    saveDay: function (id, doc) { S.days[id] = { userId: doc.userId, date: doc.date, events: clone(doc.events) }; save(); return Promise.resolve(); },
    addUser: function (u) { var id = 'u' + rid(6); S.roster[id] = { name: u.name, role: u.role, wmsId: u.wmsId || '', active: true }; S.pins[id] = u.pin; save(); return Promise.resolve(id); },
    updateUser: function (id, patch) { Object.assign(S.roster[id], patch); save(); return Promise.resolve(); },
    resetPin: function (id, pin) { S.pins[id] = pin; save(); return Promise.resolve(); },
    setTeamCode: function () { return Promise.resolve(); },
    syncClock: function () { return Promise.resolve(0); },
    resetDemo: function () { S = seedDemo(); save(); }
  };
}

/* ───────────── stocare: Firebase (Auth + Firestore, plan gratuit Spark) ───────────── */
function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(E('Nu s-a putut încărca ' + src)); }; document.head.appendChild(s); }); }
function hashPin(userId, pin) {
  var txt = 'ptc:' + userId + ':' + pin;
  if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); });
  var h = 5381; for (var i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0; return Promise.resolve('x' + h);
}
function FirebaseStore(fbCfg) {
  var auth, db, FV, pub = null, loggedIn = false, rosterCache = LS.get('ptc_roster', null), DOMAIN = '@pontaj-tc.app';
  var RESET_HINT = 'PIN greșit. Dacă PIN-ul ți-a fost schimbat de admin, apasă „Înapoi” și alege-ți din nou numele.';
  function pinPass(p) { return 'PTC#' + p; }
  function teamPass(c) { return 'TC#' + c; }
  function isNet(e) { return e && (e.code === 'auth/network-request-failed' || e.code === 'unavailable'); }
  function isCred(e) { return e && /auth\/(invalid-credential|wrong-password|user-not-found|invalid-login-credentials|user-disabled|invalid-email)/.test(e.code || ''); }
  function readRoster() { return db.doc('meta/roster').get().then(function (s) { var d = s.data() || {}; rosterCache = d.users || {}; LS.set('ptc_roster', rosterCache); return rosterCache; }); }
  function teamSignIn(code) { return auth.signInWithEmailAndPassword(pub.teamEmail, teamPass(code)).then(function () { LS.set('ptc_team', code); }); }
  // cont nou creat dintr-o instanță secundară, ca adminul să rămână logat
  function mkAccount(email, pass) {
    var sec = firebase.initializeApp(fbCfg, 'sec' + Date.now()), uid;
    return sec.auth().setPersistence(firebase.auth.Auth.Persistence.NONE)
      .then(function () { return sec.auth().createUserWithEmailAndPassword(email, pass); })
      .then(function (c) { uid = c.user.uid; return sec.auth().signOut(); })
      .then(function () { return sec.delete().catch(function () {}); })
      .then(function () { return uid; }, function (e) { try { sec.delete(); } catch (_) {} throw e; });
  }
  function newEmail(prefix) { return prefix + '-' + rid(10) + DOMAIN; }
  function finishLogin(userId, pin, fallback) {
    var uid = auth.currentUser.uid, email = auth.currentUser.email;
    return db.doc('accounts/' + uid).get().then(function (a) {
      if (!a.exists || a.data().userId !== userId) throw E(RESET_HINT, 'pin');   // cont vechi, înlocuit la resetarea PIN-ului
      if (!a.data().active) throw E('Cont dezactivat. Vorbește cu adminul.');
      var acc = a.data();
      return readRoster().catch(function () { return rosterCache || {}; }).then(function (r) {
        var name = (r[userId] || {}).name || (fallback && fallback.name) || 'Utilizator';
        return hashPin(userId, pin).then(function (h) {
          LS.set('ptc_me', { userId: userId, name: name, email: email, role: acc.role, h: h }); loggedIn = true;
          return { userId: userId, role: acc.role, name: name };
        });
      });
    });
  }
  var api = {
    mode: 'firebase',
    boot: function () {
      return loadScript('vendor/firebase-app-compat.js').then(function () { return loadScript('vendor/firebase-auth-compat.js'); }).then(function () { return loadScript('vendor/firebase-firestore-compat.js'); }).then(function () {
        firebase.initializeApp(fbCfg); auth = firebase.auth(); db = firebase.firestore(); FV = firebase.firestore.FieldValue;
        return db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
      }).then(function () {
        return new Promise(function (res) { var un = auth.onAuthStateChanged(function () { un(); res(); }); });
      }).then(function () {
        return db.doc('meta/public').get().then(function (s) { pub = s.exists ? s.data() : null; if (pub) LS.set('ptc_pub', pub); return { setupDone: !!pub }; },
          function (e) { pub = LS.get('ptc_pub', null); if (pub) return { setupDone: true }; throw E('Nu pot ajunge la server. Verifică internetul și încearcă din nou.', 'net'); });
      });
    },
    setup: function (o) {
      var userId = 'u' + rid(8), email = newEmail(userId), uid, teamEmail = newEmail('echipa');
      return auth.createUserWithEmailAndPassword(email, pinPass(o.pin)).then(function (c) {
        uid = c.user.uid; return db.doc('accounts/' + uid).set({ userId: userId, role: 'admin', active: true });
      }).then(function () { return mkAccount(teamEmail, teamPass(o.teamCode)); }).then(function (teamUid) {
        var b = db.batch(), users = {}; users[userId] = { name: o.name, role: 'admin', wmsId: '', active: true, email: email, authUid: uid };
        b.set(db.doc('accounts/' + teamUid), { userId: '', role: 'team', active: true });
        b.set(db.doc('meta/roster'), { users: users, teamUid: teamUid });
        b.set(db.doc('meta/config'), defaultConfig());
        b.set(db.doc('meta/public'), { setupDone: true, teamEmail: teamEmail, createdAt: FV.serverTimestamp() });
        return b.commit().then(function () { pub = { setupDone: true, teamEmail: teamEmail }; LS.set('ptc_pub', pub); LS.set('ptc_team', o.teamCode); });
      }).then(function () { return finishLogin(userId, o.pin, { name: o.name }); });
    },
    // lista de nume: are nevoie de codul echipei (o singură dată pe telefon)
    roster: function (teamCode) {
      if (loggedIn) return readRoster().catch(function () { return rosterCache || {}; });
      var code = teamCode || LS.get('ptc_team', null);
      if (!code) return Promise.reject(E('Introdu codul echipei', 'need-team'));
      return teamSignIn(code).then(readRoster).catch(function (e) {
        if (isNet(e)) { if (rosterCache) return rosterCache; throw E('Fără conexiune la internet.', 'net'); }
        if (e.code === 'auth/too-many-requests') throw E('Prea multe încercări. Așteaptă câteva minute.');
        // cod greșit sau cod vechi (schimbat între timp de admin)
        LS.del('ptc_team'); throw E(teamCode ? 'Cod greșit' : 'Introdu codul echipei', 'need-team');
      });
    },
    login: function (userId, pin) {
      var me = LS.get('ptc_me', null), u = (rosterCache || {})[userId] || (me && me.userId === userId ? me : null);
      if (!u || !u.email) return Promise.reject(E('Utilizator necunoscut. Alege din listă.'));
      return auth.signInWithEmailAndPassword(u.email, pinPass(pin)).catch(function (e) {
        if (isNet(e)) {   // fără semnal: accept PIN-ul verificat local, dacă telefonul e deja al acestui utilizator
          return hashPin(userId, pin).then(function (h) {
            if (auth.currentUser && me && me.userId === userId && auth.currentUser.email === me.email && me.h === h) return 'offline';
            throw E('Fără conexiune. Încearcă din nou.', 'net');
          });
        }
        if (e.code === 'auth/too-many-requests') throw E('Prea multe încercări. Așteaptă câteva minute.');
        if (!isCred(e)) throw e;
        // poate adminul a resetat PIN-ul (cont nou) → reîmprospătez lista și mai încerc o dată
        var code = LS.get('ptc_team', null); if (!code) throw E(RESET_HINT, 'pin');
        return teamSignIn(code).then(readRoster).catch(function () { throw E(RESET_HINT, 'pin'); }).then(function (r) {
          var f = r[userId]; if (!f || f.email === u.email) throw E('PIN greșit', 'pin');
          return auth.signInWithEmailAndPassword(f.email, pinPass(pin)).catch(function () { throw E('PIN greșit', 'pin'); });
        });
      }).then(function (r) {
        if (r === 'offline') { loggedIn = true; return { userId: me.userId, role: me.role, name: me.name }; }
        return finishLogin(userId, pin, u);
      });
    },
    // după refresh / redeschidere pe același dispozitiv: rămâne logat, fără PIN, cât timp contul e activ
    resume: function () {
      var me = LS.get('ptc_me', null), u = auth.currentUser;
      if (!me || !u || u.email !== me.email) return Promise.resolve(null);
      var ok = function () { loggedIn = true; return { userId: me.userId, role: me.role, name: me.name }; };
      return db.doc('accounts/' + u.uid).get().then(function (a) {
        if (!a.exists || !a.data().active || a.data().userId !== me.userId) return null;   // cont dezactivat sau PIN resetat → cere PIN
        if (a.data().role !== me.role) { me.role = a.data().role; LS.set('ptc_me', me); }
        return ok();
      }, function (e) { return e && e.code === 'permission-denied' ? null : ok(); });   // fără semnal: merg pe ce e salvat pe telefon
    },
    logout: function () { loggedIn = false; LS.del('ptc_me'); return auth.signOut().catch(function () {}); },
    changePin: function (userId, oldPin, newPin) {
      var u = auth.currentUser, cred = firebase.auth.EmailAuthProvider.credential(u.email, pinPass(oldPin));
      return u.reauthenticateWithCredential(cred).catch(function (e) { throw isCred(e) ? E('PIN-ul vechi e greșit') : e; })
        .then(function () { return u.updatePassword(pinPass(newPin)); })
        .then(function () { return hashPin(userId, newPin); }).then(function (h) { var me = LS.get('ptc_me', null); if (me) { me.h = h; LS.set('ptc_me', me); } });
    },
    config: function () { return db.doc('meta/config').get().then(function (s) { return s.exists ? s.data() : defaultConfig(); }); },
    saveConfig: function (c) { return db.doc('meta/config').set(clone(c)); },
    watchDays: function (ids, cb) {
      var m = {}, pend = {}, got = 0, uns = ids.map(function (id) {
        var first = true;
        return db.doc('days/' + id).onSnapshot({ includeMetadataChanges: true }, function (s) {
          m[id] = s.exists ? s.data() : null; pend[id] = s.metadata.hasPendingWrites; if (first) { first = false; got++; }
          if (got === ids.length) cb(clone(stripTs(m)), ids.some(function (i) { return pend[i]; }));
        }, function (e) { console.error(e); toast('Eroare la citire: ' + emsg(e)); });
      });
      return function () { uns.forEach(function (u) { u(); }); };
    },
    getDays: function (ids) { return Promise.all(ids.map(function (id) { return db.doc('days/' + id).get(); })).then(function (ss) { var m = {}; ss.forEach(function (s, i) { m[ids[i]] = s.exists ? s.data() : null; }); return clone(stripTs(m)); }); },
    appendEvent: function (userId, date, ev) {
      var data = { userId: userId, date: date, events: FV.arrayUnion(ev), updatedAt: FV.serverTimestamp(), recv: {} };
      data.recv[ev.id] = FV.serverTimestamp();   // ora la care a ajuns la server (audit)
      return db.doc('days/' + userId + '_' + date).set(data, { merge: true });
    },
    watchRange: function (from, to, cb) {
      return db.collection('days').where('date', '>=', from).where('date', '<=', to).onSnapshot(function (q) { cb(q.docs.map(function (d) { return clone(stripTs(d.data())); })); }, function (e) { console.error(e); toast('Eroare la citire: ' + emsg(e)); });
    },
    getRange: function (from, to) { return db.collection('days').where('date', '>=', from).where('date', '<=', to).get().then(function (q) { return q.docs.map(function (d) { return clone(stripTs(d.data())); }); }); },
    saveDay: function (id, doc, who) { return db.doc('days/' + id).set({ userId: doc.userId, date: doc.date, events: clone(doc.events), updatedAt: FV.serverTimestamp(), editedBy: who || '' }, { merge: true }); },
    addUser: function (o) {
      var userId = 'u' + rid(8), email = newEmail(userId);
      return mkAccount(email, pinPass(o.pin)).then(function (uid) {
        var b = db.batch(), up = {}; up['users.' + userId] = { name: o.name, role: o.role, wmsId: o.wmsId || '', active: true, email: email, authUid: uid };
        b.set(db.doc('accounts/' + uid), { userId: userId, role: o.role, active: true });
        b.update(db.doc('meta/roster'), up);
        return b.commit();
      }).then(readRoster).then(function () { return userId; });
    },
    updateUser: function (id, patch) {
      var u = (rosterCache || {})[id], b = db.batch(), up = {}, acc = {};
      Object.keys(patch).forEach(function (k) { up['users.' + id + '.' + k] = patch[k]; if (k === 'role' || k === 'active') acc[k] = patch[k]; });
      b.update(db.doc('meta/roster'), up);
      if (Object.keys(acc).length && u && u.authUid) b.update(db.doc('accounts/' + u.authUid), acc);
      return b.commit().then(readRoster);
    },
    resetPin: function (id, pin) {   // fără server propriu nu pot schimba parola altcuiva → cont nou legat de același utilizator
      var u = rosterCache[id], email = newEmail(id);
      return mkAccount(email, pinPass(pin)).then(function (uid) {
        var b = db.batch(), up = {}; up['users.' + id + '.email'] = email; up['users.' + id + '.authUid'] = uid;
        b.set(db.doc('accounts/' + uid), { userId: id, role: u.role, active: u.active !== false });
        if (u.authUid) b.delete(db.doc('accounts/' + u.authUid));
        b.update(db.doc('meta/roster'), up);
        return b.commit();
      }).then(readRoster);
    },
    setTeamCode: function (code) {
      var email = newEmail('echipa');
      return db.doc('meta/roster').get().then(function (s) {
        var old = (s.data() || {}).teamUid;
        return mkAccount(email, teamPass(code)).then(function (uid) {
          var b = db.batch();
          b.set(db.doc('accounts/' + uid), { userId: '', role: 'team', active: true });
          if (old) b.delete(db.doc('accounts/' + old));
          b.update(db.doc('meta/roster'), { teamUid: uid });
          b.set(db.doc('meta/public'), { teamEmail: email }, { merge: true });
          return b.commit();
        });
      }).then(function () { pub.teamEmail = email; LS.set('ptc_pub', pub); LS.set('ptc_team', code); });
    },
    syncClock: function () {   // ora oficială = ora serverului Google, nu ceasul telefonului
      var ref = db.doc('clock/' + auth.currentUser.uid), t0 = Date.now(), t1;
      return ref.set({ t: FV.serverTimestamp() }).then(function () { t1 = Date.now(); return ref.get({ source: 'server' }); }).then(function (s) {
        var srv = s.data().t.toMillis(); return Math.round(srv - (t0 + t1) / 2);
      });
    }
  };
  function stripTs(o) { // scot câmpurile Timestamp (recv/updatedAt) în milisecunde, ca să pot clona simplu
    if (o && typeof o.toMillis === 'function') return o.toMillis();
    if (Array.isArray(o)) return o.map(stripTs);
    if (o && typeof o === 'object') { var r = {}; Object.keys(o).forEach(function (k) { r[k] = stripTs(o[k]); }); return r; }
    return o;
  }
  return api;
}

/* ───────────── stare aplicație ───────────── */
var store, session = null, cfg = defaultConfig(), roster = {};
var ui = { screen: 'boot', tab: 'pontaj', pin: '', pinUser: null, err: '', rep: null, repUser: '', repFrom: '', repTo: '', repDay: '' };
var my = { docs: {}, keys: [], pending: false, unsub: null };
var adm = { live: [], unsub: null };
var busy = false, actBusy = false, tickTimer = null;

function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.add('hidden'); }, 3200); }
function sheet(html) { var s = $('#sheet'); if (html == null) { s.classList.add('hidden'); s.innerHTML = ''; ui.edit = null; return; } s.innerHTML = '<div class="box">' + html + '</div>'; s.classList.remove('hidden'); }
function isAdmin() { return session && session.role === 'admin'; }
function activeReasons() { return (cfg.reasons || []).filter(function (r) { return r.active !== false; }); }
function people(includeInactive) {
  return Object.keys(roster).map(function (id) { return Object.assign({ id: id }, roster[id]); })
    .filter(function (u) { return u.role !== 'team' && (includeInactive || u.active !== false); })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'ro'); });
}

/* ───────────── pornire / autentificare ───────────── */
function start() {
  store = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey ? FirebaseStore(window.FIREBASE_CONFIG) : DemoStore();
  store.boot().then(function (b) {
    if (!b.setupDone) { ui.screen = 'setup'; return render(); }
    return store.resume().catch(function () { return null; }).then(function (s) {
      if (s) return enterSession(s);
      var me = LS.get('ptc_me', null);
      if (me && store.mode === 'firebase') { ui.pinUser = { id: me.userId, name: me.name }; ui.screen = 'pin'; return render(); }
      return showRoster();
    });
  }).catch(function (e) { console.error(e); ui.screen = 'fatal'; ui.err = emsg(e); render(); });
}
function showRoster(code) {
  return store.roster(code).then(function (r) { roster = r; ui.screen = 'roster'; ui.err = ''; render(); })
    .catch(function (e) { if (e.code === 'need-team') { ui.screen = 'team'; ui.err = code ? emsg(e) : ''; } else { ui.screen = 'fatal'; ui.err = emsg(e); } render(); });
}
function doLogin(pin) {
  var u = ui.pinUser; ui.err = ''; ui.pin = pin; busy = true; renderPinDots('Se verifică…');
  store.login(u.id, pin).then(enterSession).catch(function (e) { busy = false; ui.pin = ''; ui.err = emsg(e); if (!e.friendly) console.error(e); render(); });
}
function enterSession(s) {
  session = s; ui.pin = '';
  return Promise.all([store.config().catch(function () { return defaultConfig(); }), store.roster().catch(function () { return roster; })]).then(function (a) {
    cfg = a[0] || defaultConfig(); if (!cfg.reasons) cfg.reasons = defaultConfig().reasons; if (!cfg.normMin) cfg.normMin = 510;
    roster = a[1] || roster;
    if (roster[s.userId] && roster[s.userId].name) session.name = roster[s.userId].name;
    ui.screen = 'main'; ui.tab = isAdmin() ? 'azi' : 'pontaj'; busy = false;
    store.syncClock().then(function (o) { clockOffset = o; LS.set('ptc_offset', o); }).catch(function () {});
    enterTab(); render();
  });
}
function logout() {
  stopWatch(); session = null; sheet(null);
  store.logout().then(function () { ui.pinUser = null; ui.pin = ''; showRoster(); });
}
function stopWatch() { if (my.unsub) { my.unsub(); my.unsub = null; } if (adm.unsub) { adm.unsub(); adm.unsub = null; } my.docs = {}; my.keys = []; }

/* ───────────── pontajul meu ───────────── */
function watchMine() {
  var t = dateKey(now()), y = addDays(t, -1), ids = [session.userId + '_' + y, session.userId + '_' + t];
  if (my.unsub && my.keys.join() === ids.join()) return;
  if (my.unsub) my.unsub();
  my.keys = ids; my.day = [y, t];
  my.unsub = store.watchDays(ids, function (m, pending) { my.docs = m; my.pending = pending; my.loaded = true; if (ui.screen === 'main' && ui.tab === 'pontaj') render(); });
}
// ziua "activă": azi; sau ieri, dacă tura de ieri e încă deschisă (lucru peste miezul nopții)
function activeDay() {
  var n = now(), y = my.day[0], t = my.day[1], dy = my.docs[my.keys[0]], dt = my.docs[my.keys[1]];
  if (!(dt && dt.events && dt.events.length) && dy && dy.events && dy.events.length) { var cy = computeDay(dy, n); if (cy.open) return { date: y, c: cy }; }
  return { date: t, c: computeDay(dt || { events: [] }, n) };
}
function myState(c) {
  var l = c.last;
  if (!l || l.s === 'out' || !c.open) return { k: 'off', ev: l };
  if (l.s === 'pick') return { k: 'pick', ev: l };
  if (l.s === 'r') return { k: 'r', ev: l };
  return { k: 'idle', ev: l };
}
function act(s, extra) {
  if (actBusy || !my.loaded) return; actBusy = true; setTimeout(function () { actBusy = false; }, 600);   // apăsări duble
  if (dateKey(now()) !== my.day[1]) watchMine();
  var A = activeDay(), t = now(); if (A.c.last && t <= A.c.last.t) t = A.c.last.t + 1;
  var ev = Object.assign({ id: rid(10), t: t, d: Date.now(), s: s }, extra || {});
  var date = A.date; if (s === 'in' && !A.c.open) date = my.day[1];
  store.appendEvent(session.userId, date, ev).catch(function (e) { console.error(e); toast('Nu s-a putut salva: ' + emsg(e)); });
  sheet(null);
}
function startReason(ridv, comment) {
  var r = activeReasons().filter(function (x) { return x.id === ridv; })[0]; if (!r) return;
  var A = activeDay(), st = myState(A.c), x = { rid: r.id, rn: r.name, rk: r.kind };
  if (st.k === 'pick' || (st.k === 'r' && st.ev.fp)) x.fp = true;
  if (comment) x.c = comment;
  act('r', x);
}
function summaryHtml(c) {
  var items = [['Sosire', fmtTime(c.arrival)], ['Început picking', fmtTime(c.firstPick)], ['Prezență', fmtDur(c.presence)], ['Picking', fmtDur(c.pick)], ['Pauză oficială', fmtDur(c.brk)], ['Alte activități', fmtDur(c.other)], ['Fără activitate', fmtDur(c.idle)], ['Ore suplimentare', fmtDur(overtime(c, cfg))]];
  if (c.departure) items.splice(1, 0, ['Plecare', fmtTime(c.departure)]);
  return items.map(function (i) { return '<div><b>' + i[1] + '</b><span>' + i[0] + '</span></div>'; }).join('');
}
function timelineHtml(c, withBy) {
  if (!c.segs.length) return '<div class="mut small">Nicio activitate.</div>';
  return '<ul class="tl">' + c.segs.map(function (g) {
    return '<li><span class="dot ' + g.cat + '"></span><span class="tm" style="min-width:132px;font-size:13px">' + fmtTime(g.start) + ' – ' + (g.live ? 'acum' : fmtTime(g.end)) + '</span><span><b>' + esc(segLabel(g)) + '</b>' +
      (g.c ? '<br><span class="small mut">' + esc(g.c) + '</span>' : '') + (withBy && g.by ? '<br><span class="small mut">corectat de ' + esc(g.by) + '</span>' : '') + '</span><span class="du">' + (g.live ? live(0, g.start) : fmtDur(g.dur)) + '</span></li>';
  }).join('') + (c.departure ? '<li><span class="dot"></span><span class="tm" style="min-width:132px;font-size:13px">' + fmtTime(c.departure) + '</span><span><b>Plecare</b></span></li>' : '') +
    (c.missingOut ? '<li><span class="chip warn">Plecare nebifată</span></li>' : '') + '</ul>';
}
function viewPontaj() {
  if (!my.loaded) return '<div class="center mut" style="padding:40px">Se încarcă…</div>';
  var A = activeDay(), c = A.c, st = myState(c), n = now(), h = '';
  var since = st.ev ? st.ev.t : n;
  if (st.k === 'off') {
    if (c.departure && c.last && c.last.s === 'out') {
      h += '<div class="status off"><div class="lbl">Zi încheiată</div><div class="timer" style="font-size:40px">' + fmtDur(c.presence) + '</div><div class="since">Plecare la ' + fmtTime(c.departure) + ' · ore suplimentare ' + fmtDur(overtime(c, cfg)) + '</div></div>';
      h += '<div class="stack"><button class="btn ghost" data-a="confirm" data-do="in">M-am întors la muncă</button></div>';
    } else {
      h += '<div class="status off"><div class="lbl">Nepontat</div><div class="timer" id="clock" style="font-size:46px">' + fmtTime(n) + '</div><div class="since">' + fmtDate(dateKey(n), true) + '</div></div>';
      h += '<div class="stack"><button class="btn xl green" data-a="act" data-s="in">Am venit la muncă</button></div>';
    }
  } else {
    var cls = st.k === 'pick' ? 'pick' : st.k === 'r' ? (st.ev.rk === 'break' ? 'break' : 'work') : '';
    var lbl = st.k === 'pick' ? 'Picking' : st.k === 'r' ? st.ev.rn : 'La muncă · fără activitate';
    h += '<div class="status ' + cls + '"><div class="lbl">' + esc(lbl) + '</div><div class="timer" id="timer" data-since="' + since + '">' + fmtClock(n - since) + '</div><div class="since">de la ' + fmtTime(since) + (st.k === 'r' && st.ev.fp ? ' · picking pe pauză' : '') + '</div>' + (st.ev.c ? '<div class="cmt">' + esc(st.ev.c) + '</div>' : '') + '</div>';
    h += '<div class="stack">';
    var rs = activeReasons().map(function (r) { return '<button class="btn ' + (r.kind === 'break' ? 'amber' : 'blue') + '" data-a="reason" data-rid="' + r.id + '">' + esc(r.name) + '</button>'; }).join('');
    if (st.k === 'idle') {
      h += '<button class="btn xl green" data-a="act" data-s="pick">▶ Începe picking</button>';
      if (rs) h += '<div class="small mut" style="margin-top:14px">Altă activitate:</div><div class="grid2">' + rs + '</div>';
    } else if (st.k === 'pick') {
      if (rs) h += '<div class="small mut">Pune picking-ul pe pauză pentru:</div><div class="grid2">' + rs + '</div>';
      h += '<button class="btn navy" data-a="act" data-s="idle">■ Termină picking</button>';
    } else {
      h += '<button class="btn xl green" data-a="act" data-s="pick">▶ ' + (st.ev.fp ? 'Reia picking' : 'Începe picking') + '</button>';
      h += '<button class="btn ghost" data-a="act" data-s="idle">Am terminat „' + esc(st.ev.rn) + '”' + (st.ev.fp ? ' · fără picking' : '') + '</button>';
    }
    h += '<button class="btn out" style="margin-top:18px" data-a="confirm" data-do="out">Plec acasă (bifează plecarea)</button></div>';
  }
  if (my.pending) h += '<div class="center small mut" style="margin-top:10px">⏳ Se sincronizează când revine semnalul…</div>';
  var dy = my.docs[my.keys[0]];
  if (A.date === my.day[1] && dy && dy.events && dy.events.length && dy.events.slice().sort(function (a, b) { return a.t - b.t; }).pop().s !== 'out')
    h += '<div class="card" style="margin-top:12px;background:var(--red-bg);color:var(--red)"><b>Ieri nu ai bifat plecarea.</b> Anunță adminul ca să corecteze ora de plecare.</div>';
  if (c.evs.length) {
    h += '<div class="card" style="margin-top:14px"><h3>' + (A.date === my.day[1] ? 'Azi' : 'Tura din ' + fmtDate(A.date)) + '</h3><div class="kv" id="sum">' + summaryHtml(c) + '</div></div>';
    h += '<div class="card"><h3>Activități</h3>' + timelineHtml(c) + '</div>';
  }
  return h;
}
function viewZile() {
  if (!ui.zile) {
    var t = dateKey(now()), ids = []; for (var i = 0; i < 14; i++) ids.push(session.userId + '_' + addDays(t, -i));
    store.getDays(ids).then(function (m) { ui.zile = ids.map(function (id) { return m[id]; }).filter(Boolean); if (ui.tab === 'zile') render(); }).catch(function (e) { toast(emsg(e)); });
    return '<div class="center mut" style="padding:40px">Se încarcă…</div>';
  }
  if (!ui.zile.length) return '<div class="card mut">Nu ai nicio zi pontată în ultimele 14 zile.</div>';
  var n = now(), tot = { p: 0, k: 0, o: 0 };
  var rows = ui.zile.map(function (d) {
    var c = computeDay(d, n), ot = overtime(c, cfg); tot.p += c.presence; tot.k += c.pick; tot.o += ot;
    return '<tr><td>' + fmtDate(d.date, true).slice(0, 9) + '</td><td>' + fmtTime(c.arrival) + '</td><td>' + (c.departure ? fmtTime(c.departure) : c.open ? '…' : '<span class="chip warn">lipsă</span>') + '</td><td>' + fmtDur(c.presence) + '</td><td>' + fmtDur(c.pick) + '</td><td class="' + (ot ? 'ot' : '') + '">' + fmtDur(ot) + '</td></tr>';
  }).join('');
  return '<div class="card"><h3>Ultimele 14 zile</h3><div class="tblw"><table class="t"><tr><th>Ziua</th><th>Sosire</th><th>Plecare</th><th>Prezență</th><th>Picking</th><th>Supl.</th></tr>' + rows +
    '<tr class="tot"><td>Total</td><td></td><td></td><td>' + fmtDur(tot.p) + '</td><td>' + fmtDur(tot.k) + '</td><td>' + fmtDur(tot.o) + '</td></tr></table></div></div>';
}

/* ───────────── admin: azi (live) ───────────── */
function watchLive() {
  var t = dateKey(now()), y = addDays(t, -1);
  if (adm.unsub && adm.key === t) return;
  if (adm.unsub) adm.unsub();
  adm.key = t;
  adm.unsub = store.watchRange(y, t, function (docs) { adm.live = docs; adm.loaded = true; if (ui.screen === 'main' && ui.tab === 'azi') render(); });
}
function liveFor(userId) {
  var t = adm.key, y = addDays(t, -1), n = now(), dt = null, dy = null;
  adm.live.forEach(function (d) { if (d.userId === userId) { if (d.date === t) dt = d; else if (d.date === y) dy = d; } });
  var stale = null;
  if (dy) { var cy = computeDay(dy, n); if (cy.open && !(dt && dt.events.length)) return { date: y, c: cy }; if (cy.missingOut || (cy.open && dt)) stale = y; }
  return { date: t, c: computeDay(dt || { events: [] }, n), stale: stale, none: !dt };
}
function viewAzi() {
  if (!adm.loaded) return '<div class="center mut" style="padding:40px">Se încarcă…</div>';
  var n = now(), cnt = { pick: 0, brk: 0, other: 0, off: 0 }, order = { pick: 0, work: 1, break: 2, idle: 3, done: 4, none: 5 };
  var cards = people().filter(function (u) { return u.role !== 'admin' || adm.live.some(function (d) { return d.userId === u.id; }); }).map(function (u) {
    var L = liveFor(u.id), c = L.c, st = myState(c), key, chip;
    if (st.k === 'pick') { key = 'pick'; chip = '<span class="chip pick">Picking ' + live(0, st.ev.t) + '</span>'; cnt.pick++; }
    else if (st.k === 'r') { key = st.ev.rk === 'break' ? 'break' : 'work'; chip = '<span class="chip ' + key + '">' + esc(st.ev.rn) + ' ' + live(0, st.ev.t) + '</span>'; if (key === 'break') cnt.brk++; else cnt.other++; }
    else if (st.k === 'idle') { key = 'idle'; chip = '<span class="chip">Fără activitate ' + live(0, st.ev.t) + '</span>'; cnt.other++; }
    else if (c.departure) { key = 'done'; chip = '<span class="chip off">Plecat ' + fmtTime(c.departure) + '</span>'; cnt.off++; }
    else { key = 'none'; chip = '<span class="chip off">Nepontat</span>'; cnt.off++; }
    var html = '<button class="ucard" data-a="openDay" data-u="' + u.id + '" data-d="' + L.date + '"><span class="ava">' + esc(initials(u.name)) + '</span><span><span class="nm">' + esc(u.name) + '</span><br>' + chip +
      (L.stale ? ' <span class="chip warn">plecare lipsă ' + fmtDate(L.stale).slice(0, 5) + '</span>' : '') + (st.k === 'r' && st.ev.c ? '<br><span class="small mut">' + esc(st.ev.c) + '</span>' : '') + '</span>' +
      '<span class="rt small">' + (c.arrival ? 'sosire <b>' + fmtTime(c.arrival) + '</b><br>picking <b>' + live(liveParts(c, 'pick')[0], liveParts(c, 'pick')[1]) + '</b>' + (overtime(c, cfg) ? '<br><span class="ot">supl. ' + live(liveParts(c, 'all')[0], liveParts(c, 'all')[1], (cfg.normMin || 510) * 60000) + '</span>' : '') : '') + '</span></button>';
    return { o: order[key], html: html, name: u.name };
  }).sort(function (a, b) { return a.o - b.o || a.name.localeCompare(b.name, 'ro'); });
  return '<div class="card"><h3>Acum · ' + fmtDate(adm.key, true) + ' ' + fmtTimeM(n) + '</h3><div class="kv" style="grid-template-columns:repeat(4,1fr)"><div><b>' + cnt.pick + '</b><span>la picking</span></div><div><b>' + cnt.brk + '</b><span>în pauză</span></div><div><b>' + cnt.other + '</b><span>alte activități</span></div><div><b>' + cnt.off + '</b><span>plecați / nepontați</span></div></div></div>' +
    '<div class="livegrid">' + cards.map(function (c) { return c.html; }).join('') + '</div><div class="small mut center" style="margin-top:10px">Apasă pe un om ca să vezi ziua lui sau să corectezi pontajul.</div>';
}

/* ───────────── admin: editor de zi (corecții) ───────────── */
function typeOptions(sel) {
  var o = [['in', 'Sosire'], ['pick', 'Picking'], ['idle', 'Fără activitate'], ['out', 'Plecare']], seen = {};
  (cfg.reasons || []).forEach(function (r) { o.splice(o.length - 2, 0, ['r:' + r.id, r.name]); seen['r:' + r.id] = 1; });
  if (sel && !seen[sel] && sel.indexOf('r:') === 0) o.push([sel, ui.edit.names[sel] || sel]);
  return o.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === sel ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('');
}
function openDay(userId, date) {
  var id = userId + '_' + date;
  store.getDays([id]).then(function (m) {
    var d = m[id] || { userId: userId, date: date, events: [] }, names = {};
    var rows = d.events.slice().sort(function (a, b) { return a.t - b.t; }).map(function (e) {
      var ty = e.s === 'r' ? 'r:' + e.rid : e.s; if (e.s === 'r') names[ty] = e.rn;
      return { ev: e, time: fmtTime(e.t), time0: fmtTime(e.t), type: ty, type0: ty, c: e.c || '', c0: e.c || '', next: dateKey(e.t) !== date };
    });
    ui.edit = { id: id, userId: userId, date: date, rows: rows, names: names, recv: d.recv || {}, mode: 'view' };
    renderEdit();
  }).catch(function (e) { toast(emsg(e)); });
}
function editDoc() {   // construiesc documentul din rândurile editorului
  var ed = ui.edit, evs = ed.rows.map(function (r) {
    var e = clone(r.ev) || { id: rid(10) }, changed = !r.ev;
    var dk = r.next ? addDays(ed.date, 1) : ed.date;
    if (!r.ev || r.time !== r.time0 || r.next !== (dateKey(r.ev.t) !== ed.date)) { e.t = zonedToMs(dk, r.time); changed = true; }
    if (r.type !== r.type0 || !r.ev) {
      changed = true; delete e.rid; delete e.rn; delete e.rk; delete e.fp;
      if (r.type.indexOf('r:') === 0) { var rr = r.type.slice(2), x = (cfg.reasons || []).filter(function (q) { return q.id === rr; })[0]; e.s = 'r'; e.rid = rr; e.rn = x ? x.name : (ed.names[r.type] || rr); e.rk = x ? x.kind : 'work'; }
      else e.s = r.type;
    }
    if (r.c !== r.c0) { changed = true; if (r.c) e.c = r.c; else delete e.c; }
    if (changed) e.by = session.name;
    return e;
  }).sort(function (a, b) { return a.t - b.t; });
  // "picking pe pauză": o activitate care urmează direct după picking
  evs.forEach(function (e, i) { if (e.s === 'r' && e.by) { if (i > 0 && (evs[i - 1].s === 'pick' || (evs[i - 1].s === 'r' && evs[i - 1].fp))) e.fp = true; else delete e.fp; } });
  return { userId: ed.userId, date: ed.date, events: evs };
}
function renderEdit() {
  var ed = ui.edit, u = roster[ed.userId] || { name: ed.userId }, h = '<h2>' + esc(u.name) + ' · ' + fmtDate(ed.date, true) + '</h2>';
  if (ed.mode === 'view') {
    var c = computeDay({ events: ed.rows.map(function (r) { return r.ev; }) }, now());
    var late = c.evs.filter(function (e) { var rv = ed.recv[e.id]; return rv && Math.abs(rv - e.t) > 5 * 60000 && !e.by; }).length;
    h += c.evs.length ? '<div class="kv">' + summaryHtml(c) + '</div><div style="margin:12px 0">' + timelineHtml(c, true) + '</div>' : '<div class="mut" style="margin:10px 0">Nicio pontare în această zi.</div>';
    if (late) h += '<div class="small mut" style="margin-bottom:10px">ⓘ ' + late + ' apăsări au ajuns la server cu peste 5 minute întârziere (telefon fără semnal).</div>';
    h += '<div class="row"><button class="btn navy grow" data-a="editMode">Corectează pontajul</button><button class="btn ghost sm" style="min-height:56px" data-a="sheetClose">Închide</button></div>';
  } else {
    h += '<div class="small mut" style="margin-bottom:8px">Fiecare rând pornește o stare care ține până la rândul următor. Rândurile modificate rămân marcate „corectat de ' + esc(session.name) + '”.</div>';
    h += ed.rows.map(function (r, i) {
      return '<div class="evbox"><div class="evrow"><input class="in" type="time" step="1" value="' + r.time + '" data-ei="' + i + '" data-ef="time"><select class="in" data-ei="' + i + '" data-ef="type">' + typeOptions(r.type) + '</select><button data-a="evDel" data-i="' + i + '" aria-label="Șterge">🗑</button>' +
        '<input class="in c2" placeholder="Comentariu" value="' + esc(r.c) + '" data-ei="' + i + '" data-ef="c"><label><input type="checkbox" data-ei="' + i + '" data-ef="next"' + (r.next ? ' checked' : '') + '>+1 zi</label></div></div>';
    }).join('') || '<div class="mut" style="margin:10px 0">Niciun rând.</div>';
    h += '<button class="btn ghost" data-a="evAdd">+ Adaugă rând</button><div class="err" id="ederr"></div><div class="row"><button class="btn green grow" data-a="evSave">Salvează</button><button class="btn ghost sm" style="min-height:56px" data-a="sheetClose">Renunță</button></div>';
  }
  var s = $('#sheet'); s.innerHTML = '<div class="box">' + h + '</div>'; s.classList.remove('hidden');
}

/* ───────────── admin: rapoarte ───────────── */
function monthStart(dk) { return dk.slice(0, 8) + '01'; }
function runReport() {
  var from = ui.repFrom, to = ui.repTo; if (!from || !to || from > to) { toast('Alege o perioadă validă'); return; }
  ui.rep = null; ui.repLoading = true; render();
  store.getRange(from, to).then(function (docs) { ui.repLoading = false; ui.rep = buildReport(docs); render(); }).catch(function (e) { ui.repLoading = false; toast(emsg(e)); render(); });
}
function buildReport(docs) {
  var n = now(), reasons = {}, days = [], users = {};
  docs.forEach(function (d) {
    if (!d.events || !d.events.length) return;
    var c = computeDay(d, n), u = roster[d.userId] || { name: '(șters) ' + d.userId, wmsId: '' };
    Object.keys(c.byReason).forEach(function (k) { var r = c.byReason[k]; if (!reasons[k]) reasons[k] = { rid: k, name: reasonName(cfg, k, r.name), kind: r.kind }; });
    var row = { userId: d.userId, name: u.name, wmsId: u.wmsId || '', date: d.date, c: c, ot: overtime(c, cfg) };
    days.push(row);
    var a = users[d.userId] || (users[d.userId] = { userId: d.userId, name: u.name, wmsId: u.wmsId || '', days: 0, presence: 0, pick: 0, brk: 0, other: 0, idle: 0, ot: 0, byReason: {}, warn: 0 });
    a.days++; a.presence += c.presence; a.pick += c.pick; a.brk += c.brk; a.other += c.other; a.idle += c.idle; a.ot += row.ot; if (c.missingOut) a.warn++;
    Object.keys(c.byReason).forEach(function (k) { a.byReason[k] = (a.byReason[k] || 0) + c.byReason[k].ms; });
  });
  days.sort(function (a, b) { return a.name.localeCompare(b.name, 'ro') || a.date.localeCompare(b.date); });
  var rl = Object.keys(reasons).map(function (k) { return reasons[k]; }).sort(function (a, b) { return (a.kind === 'break' ? 0 : 1) - (b.kind === 'break' ? 0 : 1) || a.name.localeCompare(b.name, 'ro'); });
  return { from: ui.repFrom, to: ui.repTo, days: days, users: Object.keys(users).map(function (k) { return users[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ro'); }), reasons: rl };
}
function dayNote(c) { return c.missingOut ? 'plecare nebifată' : c.open ? 'în curs' : c.edited ? 'corectat de admin' : ''; }
function viewRapoarte() {
  var t = dateKey(now()); if (!ui.repFrom) { ui.repFrom = monthStart(t); ui.repTo = t; }
  var h = '<div class="card"><h3>Raport</h3><div class="filters"><div><label class="f">De la</label><input class="in" type="date" id="rf" value="' + ui.repFrom + '"></div><div><label class="f">Până la</label><input class="in" type="date" id="rt" value="' + ui.repTo + '"></div>' +
    '<div><label class="f">Utilizator</label><select class="in" id="ru"><option value="">Toți</option>' + people(true).map(function (u) { return '<option value="' + u.id + '"' + (ui.repUser === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></div>' +
    '<div style="display:flex;align-items:flex-end"><button class="btn navy" style="min-height:48px" data-a="repRun">Afișează</button></div></div></div>';
  if (ui.repLoading) return h + '<div class="center mut" style="padding:30px">Se calculează…</div>';
  var R = ui.rep; if (!R) return h + '<div class="card mut">Alege perioada și apasă „Afișează”. Pentru un singur om, alege-l din listă – vezi fiecare zi și fiecare activitate.</div>';
  var rc = R.reasons;
  if (!ui.repUser) {
    var tot = { days: 0, presence: 0, pick: 0, idle: 0, ot: 0, r: {} };
    var rows = R.users.map(function (u) {
      tot.days += u.days; tot.presence += u.presence; tot.pick += u.pick; tot.idle += u.idle; tot.ot += u.ot;
      return '<tr class="click" data-a="repPick" data-u="' + u.userId + '"><td><b>' + esc(u.name) + '</b>' + (u.warn ? ' <span class="chip warn">' + u.warn + ' fără plecare</span>' : '') + '</td><td>' + u.days + '</td><td>' + fmtDur(u.presence) + '</td><td>' + fmtDur(u.pick) + '</td>' +
        rc.map(function (r) { tot.r[r.rid] = (tot.r[r.rid] || 0) + (u.byReason[r.rid] || 0); return '<td>' + fmtDur(u.byReason[r.rid] || 0) + '</td>'; }).join('') + '<td>' + fmtDur(u.idle) + '</td><td class="' + (u.ot ? 'ot' : '') + '">' + fmtDur(u.ot) + '</td></tr>';
    }).join('');
    h += '<div class="card"><h3>Sumar pe utilizatori · ' + fmtDate(R.from) + ' – ' + fmtDate(R.to) + '</h3>' + (R.users.length ? '<div class="tblw"><table class="t"><tr><th>Utilizator</th><th>Zile</th><th>Prezență</th><th>Picking</th>' + rc.map(function (r) { return '<th>' + esc(r.name) + '</th>'; }).join('') + '<th>Fără activ.</th><th>Ore supl.</th></tr>' + rows +
      '<tr class="tot"><td>Total</td><td>' + tot.days + '</td><td>' + fmtDur(tot.presence) + '</td><td>' + fmtDur(tot.pick) + '</td>' + rc.map(function (r) { return '<td>' + fmtDur(tot.r[r.rid] || 0) + '</td>'; }).join('') + '<td>' + fmtDur(tot.idle) + '</td><td>' + fmtDur(tot.ot) + '</td></tr></table></div><div class="small mut" style="margin-top:8px">Apasă pe un nume pentru detaliul pe zile.</div>' : '<div class="mut">Nicio pontare în perioadă.</div>') + '</div>';
  } else {
    var u = R.users.filter(function (x) { return x.userId === ui.repUser; })[0], ds = R.days.filter(function (d) { return d.userId === ui.repUser; });
    var nm = (roster[ui.repUser] || {}).name || ui.repUser;
    h += '<button class="btn ghost sm" style="margin-bottom:10px" data-a="repAll">‹ Toți utilizatorii</button><div class="card"><h3>' + esc(nm) + ' · ' + fmtDate(R.from) + ' – ' + fmtDate(R.to) + '</h3>';
    if (!u) h += '<div class="mut">Nicio pontare în perioadă.</div>';
    else {
      h += '<div class="kv" style="margin-bottom:12px"><div><b>' + u.days + '</b><span>Zile pontate</span></div><div><b>' + fmtDur(u.presence) + '</b><span>Prezență</span></div><div><b>' + fmtDur(u.pick) + '</b><span>Picking propriu-zis</span></div>' +
        rc.filter(function (r) { return u.byReason[r.rid]; }).map(function (r) { return '<div><b>' + fmtDur(u.byReason[r.rid]) + '</b><span>' + esc(r.name) + '</span></div>'; }).join('') + '<div><b>' + fmtDur(u.idle) + '</b><span>Fără activitate</span></div><div><b class="' + (u.ot ? 'ot' : '') + '">' + fmtDur(u.ot) + '</b><span>Ore suplimentare</span></div></div>';
      h += '<div class="tblw"><table class="t"><tr><th>Ziua</th><th>Sosire</th><th>Plecare</th><th>Prezență</th><th>Început picking</th><th>Picking</th>' + rc.map(function (r) { return '<th>' + esc(r.name) + '</th>'; }).join('') + '<th>Fără activ.</th><th>Ore supl.</th></tr>' +
        ds.map(function (d) {
          var c = d.c; return '<tr class="click" data-a="openDay" data-u="' + d.userId + '" data-d="' + d.date + '"><td>' + fmtDate(d.date, true) + '</td><td>' + fmtTime(c.arrival) + '</td><td>' + (c.departure ? fmtTime(c.departure) : c.open ? '…' : '<span class="chip warn">lipsă</span>') + '</td><td>' + fmtDur(c.presence) + '</td><td>' + fmtTime(c.firstPick) + '</td><td>' + fmtDur(c.pick) + '</td>' +
            rc.map(function (r) { return '<td>' + fmtDur((c.byReason[r.rid] || {}).ms || 0) + '</td>'; }).join('') + '<td>' + fmtDur(c.idle) + '</td><td class="' + (d.ot ? 'ot' : '') + '">' + fmtDur(d.ot) + '</td></tr>';
        }).join('') + '</table></div><div class="small mut" style="margin-top:8px">Apasă pe o zi pentru lista de activități și corecții.</div>';
    }
    h += '<div class="row" style="margin-top:12px"><input class="in grow" type="date" id="rnew" value="' + R.to + '"><button class="btn ghost sm" data-a="repNewDay">Deschide / adaugă zi</button></div></div>';
  }
  h += '<button class="btn green" data-a="repXlsx">⬇ Export Excel (' + (ui.repUser ? 'utilizatorul ales' : 'toți utilizatorii') + ')</button>';
  return h;
}
function xlsDate(dk) { var a = dk.split('-').map(Number); return (Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(1899, 11, 30)) / 86400000; }
function xlsTime(ms) { if (ms == null) return ''; var p = parts(ms); return (+p.hour * 3600 + +p.minute * 60 + +p.second) / 86400; }
function xlsDur(ms) { return Math.round(ms / 1000) / 86400; }
function exportXlsx() {
  var R = ui.rep; if (!R) return;
  var go = function () {
    var X = window.XLSX, f = ui.repUser, rc = R.reasons;
    var users = R.users.filter(function (u) { return !f || u.userId === f; }), days = R.days.filter(function (d) { return !f || d.userId === f; });
    function mk(aoa, fmt, widths) {   // fmt: {colIndex: 'format'}
      var ws = X.utils.aoa_to_sheet(aoa);
      for (var r = 1; r < aoa.length; r++) Object.keys(fmt).forEach(function (c) { var cell = ws[X.utils.encode_cell({ r: r, c: +c })]; if (cell && typeof cell.v === 'number') cell.z = fmt[c]; });
      ws['!cols'] = aoa[0].map(function (hd, i) { return { wch: (widths && widths[i]) || Math.max(12, String(hd).length + 2) }; });
      return ws;
    }
    var D = '[h]:mm:ss', T = 'hh:mm:ss', DT = 'dd.mm.yyyy';
    var s1 = [['Utilizator', 'ID WMS', 'Zile pontate', 'Prezență', 'Picking', 'Total pauze', 'Total alte activități'].concat(rc.map(function (r) { return r.name; })).concat(['Fără activitate', 'Ore suplimentare', 'Zile fără plecare bifată'])];
    users.forEach(function (u) { s1.push([u.name, u.wmsId, u.days, xlsDur(u.presence), xlsDur(u.pick), xlsDur(u.brk), xlsDur(u.other)].concat(rc.map(function (r) { return xlsDur(u.byReason[r.rid] || 0); })).concat([xlsDur(u.idle), xlsDur(u.ot), u.warn])); });
    var f1 = {}; for (var i = 3; i < s1[0].length - 1; i++) f1[i] = D;
    var s2 = [['Utilizator', 'ID WMS', 'Data', 'Sosire', 'Plecare', 'Prezență', 'Început picking', 'Picking'].concat(rc.map(function (r) { return r.name; })).concat(['Fără activitate', 'Ore suplimentare', 'Observații'])];
    days.forEach(function (d) { var c = d.c; s2.push([d.name, d.wmsId, xlsDate(d.date), xlsTime(c.arrival), xlsTime(c.departure), xlsDur(c.presence), xlsTime(c.firstPick), xlsDur(c.pick)].concat(rc.map(function (r) { return xlsDur((c.byReason[r.rid] || {}).ms || 0); })).concat([xlsDur(c.idle), xlsDur(d.ot), dayNote(c)])); });
    var f2 = { 2: DT, 3: T, 4: T, 5: D, 6: T }; for (i = 7; i < s2[0].length - 1; i++) f2[i] = D;
    var s3 = [['Utilizator', 'ID WMS', 'Data', 'Început', 'Sfârșit', 'Durată', 'Secunde', 'Activitate', 'Tip', 'Comentariu', 'Observații']];
    days.forEach(function (d) { d.c.segs.forEach(function (g) { s3.push([d.name, d.wmsId, xlsDate(d.date), xlsTime(g.start), xlsTime(g.end), xlsDur(g.dur), Math.round(g.dur / 1000), segLabel(g), g.cat === 'pick' ? 'Picking' : g.cat === 'break' ? 'Pauză' : g.cat === 'work' ? 'Activitate' : 'Fără activitate', g.c || '', (g.live ? 'în curs' : '') + (g.by ? 'corectat de ' + g.by : '')]); }); });
    var s4 = [['ID WMS', 'Utilizator', 'Data', 'Ore picking (zecimal)', 'Ore prezență (zecimal)', 'Început picking']];
    days.forEach(function (d) { s4.push([d.wmsId, d.name, xlsDate(d.date), Math.round(d.c.pick / 360) / 10000, Math.round(d.c.presence / 360) / 10000, xlsTime(d.c.firstPick)]); });
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, mk(s1, f1, [26, 12]), 'Sumar');
    X.utils.book_append_sheet(wb, mk(s2, f2, [26, 12, 12]), 'Zilnic');
    X.utils.book_append_sheet(wb, mk(s3, { 2: DT, 3: 'hh:mm:ss', 4: 'hh:mm:ss', 5: D }, [26, 12, 12, 10, 10, 10, 9, 22, 16, 40, 24]), 'Activitati');
    X.utils.book_append_sheet(wb, mk(s4, { 2: DT, 5: T }, [12, 26, 12, 20, 22, 16]), 'Ore picking');
    var name = 'Pontaj_TC_' + R.from + '_' + R.to + (f ? '_' + ((roster[f] || {}).name || f).replace(/[^\w]+/g, '_') : '') + '.xlsx';
    var buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
    saveFile(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  };
  if (window.XLSX) go(); else loadScript('vendor/xlsx.mini.min.js').then(go).catch(function (e) { toast(emsg(e)); });
}
function saveFile(blob, name) {
  var plain = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); toast('Fișier descărcat: ' + name); };
  if (window.claude && typeof window.claude.use === 'function') {   // când rulează ca demo în Claude
    window.claude.use('downloads').then(function (d) { if (!d) return plain(); return d.save({ filename: name, data: blob }).then(function () { toast('Fișier salvat: ' + name); }); })
      .catch(function (e) { if (e && e.code === 'declined') return; toast('Descărcarea nu a mers aici' + (e && e.code ? ' (' + e.code + ')' : '')); });
  } else plain();
}

/* ───────────── admin: echipă ───────────── */
function viewEchipa() {
  var h = '<button class="btn green" data-a="userNew">+ Utilizator nou</button><div style="height:12px"></div>';
  h += people(true).map(function (u) {
    return '<button class="ucard" data-a="userEdit" data-u="' + u.id + '"' + (u.active === false ? ' style="opacity:.55"' : '') + '><span class="ava">' + esc(initials(u.name)) + '</span><span><span class="nm">' + esc(u.name) + '</span><br><span class="small mut">' + (u.role === 'admin' ? 'Admin' : 'Operator') + (u.wmsId ? ' · WMS ' + esc(u.wmsId) : '') + (u.active === false ? ' · dezactivat' : '') + '</span></span><span class="rt mut">›</span></button>';
  }).join('');
  return h;
}
function userSheet(id) {
  var u = id ? roster[id] : { name: '', role: 'operator', wmsId: '', active: true }, self = id && id === session.userId;
  ui.userEdit = id || '';
  var h = '<h2>' + (id ? 'Modifică utilizator' : 'Utilizator nou') + '</h2><label class="f">Nume și prenume</label><input class="in" id="un" value="' + esc(u.name) + '" autocomplete="off">' +
    '<label class="f">Rol</label><select class="in" id="ur"' + (self ? ' disabled' : '') + '><option value="operator"' + (u.role === 'operator' ? ' selected' : '') + '>Operator</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option></select>' +
    '<label class="f">ID user WMS (opțional – pentru legătura cu raportul de productivitate)</label><input class="in" id="uw" value="' + esc(u.wmsId || '') + '" autocomplete="off">';
  if (!id) h += '<label class="f">PIN (4 cifre)</label><input class="in" id="up" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="ex. 4821">';
  h += '<div class="err" id="uerr"></div><div class="stack"><button class="btn green" data-a="userSave">Salvează</button>';
  if (id && !self) h += '<div class="row"><input class="in grow" id="unp" inputmode="numeric" maxlength="4" placeholder="PIN nou (4 cifre)" autocomplete="off"><button class="btn ghost sm" data-a="userPin">Resetează PIN</button></div>' +
    '<button class="btn ' + (u.active === false ? 'ghost' : 'out') + '" data-a="confirm" data-do="userToggle">' + (u.active === false ? 'Reactivează contul' : 'Dezactivează contul') + '</button>';
  if (self) h += '<div class="small mut">PIN-ul tău îl schimbi din meniul ☰ → „Schimbă PIN”.</div>';
  h += '<button class="btn ghost" data-a="sheetClose">Închide</button></div>';
  sheet(h);
}

/* ───────────── admin: setări ───────────── */
function viewSetari() {
  var nm = cfg.normMin || 510;
  var h = '<div class="card"><h3>Ore suplimentare</h3><label class="f">Durata normală a unei zile (timpul contorizat de la sosire la plecare). Tot ce depășește această durată se calculează ca ore suplimentare.</label>' +
    '<div class="row"><input class="in" type="number" inputmode="numeric" id="snh" min="0" max="16" value="' + Math.floor(nm / 60) + '" style="width:76px"><span>ore</span><input class="in" type="number" inputmode="numeric" id="snm" min="0" max="59" value="' + (nm % 60) + '" style="width:76px"><span class="grow">minute</span><button class="btn navy sm" data-a="normSave">Salvează</button></div>' +
    '<div class="small mut" style="margin-top:6px">Exemplu: la ' + Math.floor(nm / 60) + ' ore ' + (nm % 60) + ' min, cine stă ' + fmtDur((nm + 45) * 60000) + ' are 0:45:00 ore suplimentare.</div></div>';
  h += '<div class="card"><h3>Activități / motive de pauză la picking</h3>' + (cfg.reasons || []).map(function (r, i) {
    return '<button class="ucard" style="box-shadow:none;border:1px solid var(--line)' + (r.active === false ? ';opacity:.55' : '') + '" data-a="reasonEdit" data-i="' + i + '"><span class="dot ' + r.kind + '" style="margin:0"></span><span><span class="nm">' + esc(r.name) + '</span><br><span class="small mut">' + KIND_LBL[r.kind] + ' · ' + CMT_LBL[r.comment || 'none'] + (r.active === false ? ' · ascuns' : '') + '</span></span><span class="rt mut">›</span></button>';
  }).join('') + '<button class="btn ghost" data-a="reasonEdit" data-i="-1">+ Activitate nouă</button></div>';
  if (store.mode === 'firebase') h += '<div class="card"><h3>Codul echipei</h3><div class="small mut">Se cere o singură dată pe fiecare telefon nou, ca lista de nume să nu fie vizibilă oricui are linkul. Dacă îl schimbi, telefoanele deja folosite merg în continuare.</div><div class="row" style="margin-top:8px"><input class="in grow" id="steam" placeholder="Cod nou (minim 4 caractere)" autocomplete="off"><button class="btn navy sm" data-a="teamSave">Schimbă</button></div></div>';
  else h += '<div class="card"><h3>Mod demo</h3><div class="small mut">Datele sunt de probă și rămân doar pe acest dispozitiv.</div><button class="btn ghost" style="margin-top:8px" data-a="confirm" data-do="demoReset">Reface datele demo</button></div>';
  h += '<div class="small mut center">Pontaj TC v' + APP_VERSION + '</div>';
  return h;
}
function reasonSheet(i) {
  var r = i >= 0 ? cfg.reasons[i] : { name: '', kind: 'work', comment: 'none', active: true }; ui.reasonEdit = i;
  function opt(v, l, s) { return '<option value="' + v + '"' + (v === s ? ' selected' : '') + '>' + l + '</option>'; }
  sheet('<h2>' + (i >= 0 ? 'Modifică activitatea' : 'Activitate nouă') + '</h2><label class="f">Denumire (textul de pe buton)</label><input class="in" id="qn" value="' + esc(r.name) + '" autocomplete="off">' +
    '<label class="f">Tip</label><select class="in" id="qk">' + opt('break', 'Pauză – nu se lucrează (ex. pauza oficială)', r.kind) + opt('work', 'Activitate – timp de lucru, dar nu picking', r.kind) + '</select>' +
    '<label class="f">Comentariu la pornire</label><select class="in" id="qc">' + opt('none', 'Fără comentariu (pornește dintr-o apăsare)', r.comment) + opt('opt', 'Opțional', r.comment) + opt('req', 'Obligatoriu', r.comment) + '</select>' +
    '<label class="f">Stare</label><select class="in" id="qa">' + opt('1', 'Activ – apare ca buton', r.active === false ? '0' : '1') + opt('0', 'Ascuns – nu mai apare (istoricul rămâne)', r.active === false ? '0' : '1') + '</select>' +
    '<div class="err" id="qerr"></div><div class="stack"><button class="btn green" data-a="reasonSave">Salvează</button><button class="btn ghost" data-a="sheetClose">Renunță</button></div>');
}

/* ───────────── randare ───────────── */
function pinPadHtml() {
  var k = ''; for (var i = 1; i <= 9; i++) k += '<button data-a="pinKey" data-k="' + i + '">' + i + '</button>';
  return '<div class="dots" id="dots">' + [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < ui.pin.length ? 'f' : '') + '"></i>'; }).join('') + '</div><div class="pad">' + k + '<button class="x" data-a="pinBack">Înapoi</button><button data-a="pinKey" data-k="0">0</button><button class="x" data-a="pinDel">⌫ Șterge</button></div><div class="err" id="pinerr">' + esc(ui.err) + '</div>';
}
function renderPinDots(msg) { var d = $('#dots'); if (d) d.innerHTML = [0, 1, 2, 3].map(function (i) { return '<i class="' + (i < ui.pin.length ? 'f' : '') + '"></i>'; }).join(''); var e = $('#pinerr'); if (e && msg != null) { e.textContent = msg; e.style.color = 'var(--mut)'; } }
function demoBar() { return store && store.mode === 'demo' ? '<div class="demo"><b>MOD DEMO</b> – date de probă, salvate doar pe acest dispozitiv. PIN admin: 1234 · operatori: 1111, 2222, 3333, 4444.</div>' : ''; }
function render() {
  var a = $('#app'), h = '';
  if (ui.screen === 'fatal') h = '<div class="top"><div class="ttl">Pontaj TC</div></div><div class="wrap center" style="padding-top:60px"><p>' + esc(ui.err) + '</p><button class="btn navy" data-a="reload">Încearcă din nou</button></div>';
  else if (ui.screen === 'setup') h = '<div class="top"><div class="ttl">Pontaj TC · configurare inițială</div></div><div class="wrap"><div class="card"><p style="margin-top:0">Aplicația e nouă. Creează contul de <b>admin</b>; restul utilizatorilor îi adaugi apoi din „Echipă”.</p>' +
    '<label class="f">Numele tău</label><input class="in" id="sn" autocomplete="off"><label class="f">PIN admin (4 cifre)</label><input class="in" id="sp" inputmode="numeric" maxlength="4" autocomplete="off">' +
    '<label class="f">Codul echipei (minim 4 caractere) – îl dai oamenilor o singură dată, la prima deschidere pe telefon</label><input class="in" id="st" autocomplete="off"><div class="err" id="serr"></div><button class="btn green" data-a="setupGo">Creează</button></div></div>';
  else if (ui.screen === 'team') h = '<div class="top"><div class="ttl">Pontaj TC</div></div><div class="wrap"><div class="card"><p style="margin-top:0">Introdu <b>codul echipei</b> (îl primești de la șeful de tură). Se cere o singură dată pe acest telefon.</p><input class="in" id="tc" autocomplete="off" autocapitalize="none"><div class="err">' + esc(ui.err) + '</div><button class="btn navy" data-a="teamGo">Continuă</button></div></div>';
  else if (ui.screen === 'roster') h = '<div class="top"><div class="grow"><div class="ttl">Pontaj TC</div><div class="sub">Apasă pe numele tău</div></div></div>' + demoBar() + '<div class="wrap"><div class="names">' +
    people().map(function (u) { return '<button data-a="pickUser" data-u="' + u.id + '"><span class="ava">' + esc(initials(u.name)) + '</span><span>' + esc(u.name) + (u.role === 'admin' ? ' <span class="chip">admin</span>' : '') + '</span></button>'; }).join('') + '</div></div>';
  else if (ui.screen === 'pin') h = '<div class="top"><div class="ttl">Pontaj TC</div></div>' + demoBar() + '<div class="wrap"><div class="pinbox"><div class="ava" style="margin:14px auto 8px;width:64px;height:64px;font-size:22px">' + esc(initials(ui.pinUser.name)) + '</div><h2>' + esc(ui.pinUser.name) + '</h2><div class="mut">Introdu PIN-ul</div>' + pinPadHtml() + '</div></div>';
  else if (ui.screen === 'main') {
    var tabs = isAdmin() ? [['azi', '👥', 'Azi'], ['rap', '📊', 'Rapoarte'], ['echipa', '🪪', 'Echipă'], ['setari', '⚙️', 'Setări'], ['pontaj', '⏱', 'Pontajul meu']] : [['pontaj', '⏱', 'Pontaj'], ['zile', '📅', 'Zilele mele']];
    var body = ui.tab === 'pontaj' ? viewPontaj() : ui.tab === 'zile' ? viewZile() : ui.tab === 'azi' ? viewAzi() : ui.tab === 'rap' ? viewRapoarte() : ui.tab === 'echipa' ? viewEchipa() : viewSetari();
    h = '<div class="top"><div class="grow"><div class="ttl">' + esc(session.name) + '</div><div class="sub">Pontaj TC' + (isAdmin() ? ' · admin' : '') + '</div></div><button data-a="menu" aria-label="Meniu">☰</button></div>' + demoBar() +
      '<div class="wrap' + (ui.tab === 'azi' || ui.tab === 'rap' ? ' wide' : '') + '">' + body + '</div><div class="tabbar">' + tabs.map(function (t) { return '<button class="' + (ui.tab === t[0] ? 'on' : '') + '" data-a="tab" data-t="' + t[0] + '"><span class="ic">' + t[1] + '</span>' + t[2] + '</button>'; }).join('') + '</div>';
  }
  a.innerHTML = h;
}
function enterTab() {
  if (ui.tab === 'pontaj') watchMine();
  if (ui.tab === 'azi') watchLive();
  if (ui.tab === 'zile') ui.zile = null;
}
function tick() {
  if (ui.screen !== 'main') { var ck = $('#clock'); if (ck) ck.textContent = fmtTime(now()); return; }
  var nn = now();
  Array.prototype.forEach.call(document.querySelectorAll('[data-lb]'), function (el) {
    var ls = Number(el.dataset.ls), v = Number(el.dataset.lb) + (ls ? nn - ls : 0); if (el.dataset.ln) v = Math.max(0, v - Number(el.dataset.ln)); el.textContent = fmtDur(v);
  });
  if (ui.tab === 'pontaj' && my.loaded) {
    if (dateKey(now()) !== my.day[1]) { watchMine(); return; }
    var tm = $('#timer'); if (tm) tm.textContent = fmtClock(now() - Number(tm.dataset.since));
    var ck2 = $('#clock'); if (ck2) ck2.textContent = fmtTime(now());
    var sm = $('#sum'); if (sm) { var A = activeDay(); if (A.c.open) sm.innerHTML = summaryHtml(A.c); }
  } else if (ui.tab === 'azi' && adm.loaded) {
    if (dateKey(now()) !== adm.key) { watchLive(); return; }
    if (++tick.n % 15 === 0) render();
  }
}
tick.n = 0;

/* ───────────── acțiuni (click) ───────────── */
function validPin(p) { return /^\d{4}$/.test(p || ''); }
var actions = {
  reload: function () { location.reload(); },
  pickUser: function (d) { ui.pinUser = { id: d.u, name: roster[d.u].name }; ui.pin = ''; ui.err = ''; ui.screen = 'pin'; render(); },
  pinKey: function (d) { if (busy || ui.pin.length >= 4) return; ui.pin += d.k; renderPinDots(''); if (ui.pin.length === 4) doLogin(ui.pin); },
  pinDel: function () { if (busy) return; ui.pin = ui.pin.slice(0, -1); renderPinDots(''); },
  pinBack: function () { if (busy) return; ui.pin = ''; ui.err = ''; LS.del('ptc_me'); showRoster(); },
  teamGo: function () { var c = $('#tc').value.trim(); if (c.length < 4) { ui.err = 'Codul are minim 4 caractere'; return render(); } showRoster(c); },
  setupGo: function (d, el) {
    var n = $('#sn').value.trim(), p = $('#sp').value.trim(), t = $('#st').value.trim(), er = $('#serr');
    if (n.length < 3) { er.textContent = 'Scrie numele'; return; } if (!validPin(p)) { er.textContent = 'PIN-ul trebuie să aibă exact 4 cifre'; return; } if (t.length < 4) { er.textContent = 'Codul echipei: minim 4 caractere'; return; }
    el.disabled = true; er.textContent = 'Se creează…';
    store.setup({ name: n, pin: p, teamCode: t }).then(function (s) { session = s; return Promise.all([store.config(), store.roster()]); }).then(function (a) { cfg = a[0]; roster = a[1]; ui.screen = 'main'; ui.tab = 'echipa'; enterTab(); render(); toast('Gata. Adaugă acum utilizatorii.'); })
      .catch(function (e) { console.error(e); el.disabled = false; er.textContent = 'Nu a mers: ' + emsg(e); });
  },
  tab: function (d) { ui.tab = d.t; enterTab(); render(); window.scrollTo(0, 0); },
  menu: function () {
    sheet('<h2>' + esc(session.name) + '</h2><div class="stack"><button class="btn ghost" data-a="pinChange">Schimbă PIN</button><button class="btn out" data-a="logout">Ieșire / alt utilizator</button><button class="btn ghost" data-a="sheetClose">Închide</button></div>');
  },
  logout: function () { logout(); },
  pinChange: function () { sheet('<h2>Schimbă PIN</h2><label class="f">PIN vechi</label><input class="in" id="po" type="password" inputmode="numeric" maxlength="4" autocomplete="off"><label class="f">PIN nou (4 cifre)</label><input class="in" id="pn" type="password" inputmode="numeric" maxlength="4" autocomplete="off"><div class="err" id="perr"></div><div class="stack"><button class="btn green" data-a="pinSave">Salvează</button><button class="btn ghost" data-a="sheetClose">Renunță</button></div>'); },
  pinSave: function (d, el) {
    var o = $('#po').value, n = $('#pn').value, er = $('#perr'); if (!validPin(n)) { er.textContent = 'PIN-ul nou trebuie să aibă exact 4 cifre'; return; }
    el.disabled = true; store.changePin(session.userId, o, n).then(function () { sheet(null); toast('PIN schimbat'); }).catch(function (e) { el.disabled = false; er.textContent = emsg(e); });
  },
  sheetClose: function () { sheet(null); },
  act: function (d) { act(d.s); },
  reason: function (d) {
    var r = activeReasons().filter(function (x) { return x.id === d.rid; })[0]; if (!r) return;
    if (!r.comment || r.comment === 'none') return startReason(r.id, '');
    sheet('<h2>' + esc(r.name) + '</h2><label class="f">Comentariu' + (r.comment === 'req' ? ' (obligatoriu)' : ' (opțional)') + '</label><textarea class="in" id="rc" placeholder="ex. nr. comandă, ce lipsește…"></textarea><div class="err" id="rerr"></div><div class="stack"><button class="btn ' + (r.kind === 'break' ? 'amber' : 'blue') + '" data-a="reasonGo" data-rid="' + r.id + '" data-req="' + (r.comment === 'req' ? 1 : 0) + '">Pornește „' + esc(r.name) + '”</button><button class="btn ghost" data-a="sheetClose">Renunță</button></div>');
    setTimeout(function () { var t = $('#rc'); if (t) t.focus(); }, 50);
  },
  reasonGo: function (d) { var c = $('#rc').value.trim(); if (d.req === '1' && c.length < 3) { $('#rerr').textContent = 'Scrie un comentariu'; return; } startReason(d.rid, c); },
  confirm: function (d, el) {   // a doua apăsare confirmă (fără ferestre de confirmare ale browserului)
    if (el.dataset.armed) { delete el.dataset.armed; return doConfirmed(d.do); }
    el.dataset.armed = '1'; el.dataset.txt = el.textContent; el.classList.add('armed'); el.textContent = 'Apasă încă o dată pentru confirmare';
    setTimeout(function () { if (el.isConnected && el.dataset.armed) { delete el.dataset.armed; el.classList.remove('armed'); el.textContent = el.dataset.txt; } }, 4000);
  },
  openDay: function (d) { openDay(d.u, d.d); },
  editMode: function () { ui.edit.mode = 'edit'; renderEdit(); },
  evAdd: function () { var ed = ui.edit, last = ed.rows[ed.rows.length - 1]; ed.rows.push({ ev: null, time: last ? last.time : '07:00:00', time0: '', type: ed.rows.length ? 'out' : 'in', type0: '', c: '', c0: '', next: last ? last.next : false }); renderEdit(); },
  evDel: function (d) { ui.edit.rows.splice(+d.i, 1); renderEdit(); },
  evSave: function (d, el) {
    var ed = ui.edit, er = $('#ederr'); if (ed.rows.some(function (r) { return !/^\d\d:\d\d/.test(r.time); })) { er.textContent = 'Completează ora pe fiecare rând'; return; }
    var doc = editDoc(); el.disabled = true;
    store.saveDay(ed.id, doc, session.name).then(function () { sheet(null); toast('Pontaj corectat'); if (ui.tab === 'rap' && ui.rep) runReport(); }).catch(function (e) { el.disabled = false; er.textContent = emsg(e); });
  },
  repRun: function () { ui.repFrom = $('#rf').value; ui.repTo = $('#rt').value; ui.repUser = $('#ru').value; runReport(); },
  repAll: function () { ui.repUser = ''; render(); window.scrollTo(0, 0); },
  repPick: function (d) { ui.repUser = d.u; render(); window.scrollTo(0, 0); },
  repNewDay: function () { var v = $('#rnew').value; if (v) openDay(ui.repUser, v); },
  repXlsx: function () { exportXlsx(); },
  userNew: function () { userSheet(''); },
  userEdit: function (d) { userSheet(d.u); },
  userSave: function (d, el) {
    var id = ui.userEdit, n = $('#un').value.trim(), r = $('#ur').value, w = $('#uw').value.trim(), er = $('#uerr'), p;
    if (n.length < 3) { er.textContent = 'Scrie numele'; return; }
    if (!id) { p = $('#up').value.trim(); if (!validPin(p)) { er.textContent = 'PIN-ul trebuie să aibă exact 4 cifre'; return; } }
    el.disabled = true; er.textContent = 'Se salvează…';
    (id ? store.updateUser(id, { name: n, role: r, wmsId: w }) : store.addUser({ name: n, role: r, wmsId: w, pin: p })).then(function () { return store.roster(); }).then(function (ro) { roster = ro; if (id === session.userId) session.name = n; sheet(null); render(); toast(id ? 'Salvat' : 'Utilizator creat'); })
      .catch(function (e) { console.error(e); el.disabled = false; er.textContent = 'Nu a mers: ' + emsg(e); });
  },
  userPin: function (d, el) {
    var p = $('#unp').value.trim(), er = $('#uerr'); if (!validPin(p)) { er.textContent = 'PIN-ul trebuie să aibă exact 4 cifre'; return; }
    el.disabled = true; store.resetPin(ui.userEdit, p).then(function () { return store.roster(); }).then(function (ro) { roster = ro; sheet(null); toast('PIN resetat'); }).catch(function (e) { console.error(e); el.disabled = false; er.textContent = 'Nu a mers: ' + emsg(e); });
  },
  normSave: function () {
    var hh = parseInt($('#snh').value, 10), mm = parseInt($('#snm').value, 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 16 || mm < 0 || mm > 59 || hh * 60 + mm < 1) return toast('Durată invalidă');
    cfg.normMin = hh * 60 + mm; store.saveConfig(cfg).then(function () { toast('Durată salvată: ' + hh + ' ore ' + mm + ' min'); ui.rep = null; render(); }).catch(function (e) { toast(emsg(e)); });
  },
  reasonEdit: function (d) { reasonSheet(+d.i); },
  reasonSave: function () {
    var i = ui.reasonEdit, n = $('#qn').value.trim(); if (n.length < 2) { $('#qerr').textContent = 'Scrie denumirea'; return; }
    var r = i >= 0 ? cfg.reasons[i] : { id: 'r_' + rid(6) }; r.name = n; r.kind = $('#qk').value; r.comment = $('#qc').value; r.active = $('#qa').value === '1';
    if (i < 0) cfg.reasons.push(r);
    store.saveConfig(cfg).then(function () { sheet(null); render(); toast('Salvat'); }).catch(function (e) { $('#qerr').textContent = emsg(e); });
  },
  teamSave: function (d, el) { var c = $('#steam').value.trim(); if (c.length < 4) return toast('Minim 4 caractere'); el.disabled = true; store.setTeamCode(c).then(function () { toast('Cod schimbat'); render(); }).catch(function (e) { console.error(e); el.disabled = false; toast('Nu a mers: ' + emsg(e)); }); }
};
function doConfirmed(what) {
  if (what === 'out') return act('out');
  if (what === 'in') return act('in');
  if (what === 'demoReset') { store.resetDemo(); ui.rep = null; toast('Date demo refăcute'); return render(); }
  if (what === 'userToggle') { var id = ui.userEdit, on = roster[id].active === false; return store.updateUser(id, { active: on }).then(function () { return store.roster(); }).then(function (ro) { roster = ro; sheet(null); render(); toast(on ? 'Cont reactivat' : 'Cont dezactivat'); }).catch(function (e) { toast(emsg(e)); }); }
}
document.addEventListener('click', function (ev) {
  var el = ev.target.closest('[data-a]'); if (!el || el.disabled) return;
  var f = actions[el.dataset.a]; if (f) { try { f(el.dataset, el); } catch (e) { console.error(e); toast('Eroare: ' + emsg(e)); } }
});
document.addEventListener('input', function (ev) {   // câmpurile editorului de zi
  var el = ev.target; if (!el.dataset || el.dataset.ei == null || !ui.edit) return;
  var r = ui.edit.rows[+el.dataset.ei]; if (!r) return;
  r[el.dataset.ef] = el.type === 'checkbox' ? el.checked : el.value;
});
document.addEventListener('change', function (ev) { var el = ev.target; if (el.dataset && el.dataset.ei != null && ui.edit) { var r = ui.edit.rows[+el.dataset.ei]; if (r) r[el.dataset.ef] = el.type === 'checkbox' ? el.checked : el.value; } });
document.addEventListener('visibilitychange', function () {
  if (document.hidden || !session) return;
  if (ui.screen === 'main') { render(); store.syncClock().then(function (o) { clockOffset = o; LS.set('ptc_offset', o); }).catch(function () {}); }
});

window.__ptc = { computeDay: computeDay, zonedToMs: zonedToMs, dateKey: dateKey, fmtDur: fmtDur, addDays: addDays, overtime: overtime };
tickTimer = setInterval(tick, 1000);
if ('serviceWorker' in navigator && location.protocol === 'https:') { try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) {} }
start();
})();
