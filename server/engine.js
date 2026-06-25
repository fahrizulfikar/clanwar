/* =======================================================================
   ENGINE OTORITATIF v3 — EKONOMI PER-DESA + PETA HEXAGON + SPAWN + JARAH.
   Tiap desa milik pemain punya bangunan/sumber daya/antrean sendiri.
   Hanya server, tanpa DOM, bisa diuji headless.
   ======================================================================= */
const SHARED = require('../public/shared.js');
const { CONFIG, HEX, KAUM, BUILDINGS, RES, UNITS, UNIT_KEYS, HOME_NAMES } = SHARED;

const teamOf = f => Math.floor(f / 2);
const rand = (a, b) => a + Math.random() * (b - a);
const isCav = u => !!UNITS[u].cav;
const totalUnits = t => { let n = 0; for (const u in t) n += t[u] || 0; return n; };
const mergeTroops = (dst, src) => { for (const u in src) dst[u] = (dst[u] || 0) + src[u]; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ===================== LOBBY ===================== */
function createGame() {
  const slots = [];
  for (let f = 0; f < 8; f++) slots.push({ faction: f, team: teamOf(f), type: 'open', name: null, kaum: null, socketId: null, token: null });
  return { started: false, ended: false, time: 0, duration: CONFIG.MATCH_MINUTES * 60, winner: null, reason: null, scores: [0, 0, 0, 0], slots, villages: [], armies: [], offers: [], teamOff: [false, false, false, false], hostId: null };
}
// Host (pembuat room) keluarkan pemain lain dari lobi. Kembalikan socketId yang dikeluarkan.
function kickSlot(G, hostId, targetFaction) {
  if (G.started) return null;
  if (G.hostId !== hostId) return null;
  const s = G.slots[targetFaction];
  if (!s || s.type !== 'human' || s.socketId === hostId) return null;
  const sid = s.socketId;
  s.type = 'open'; s.name = null; s.kaum = null; s.socketId = null; s.token = null;
  return sid;
}
// Host nonaktifkan/aktifkan satu tim. off=true mematikan. Kembalikan {ok, kicked:[socketId]}.
function setTeamActive(G, hostId, team, off) {
  if (G.started || G.hostId !== hostId || team < 0 || team > 3) return { ok: false, kicked: [] };
  if (off) {
    if (G.slots.some(s => s.team === team && s.socketId === hostId)) return { ok: false, kicked: [] };  // host tak bisa matikan tim sendiri
    const activeAfter = G.teamOff.filter((x, t) => !x && t !== team).length;
    if (activeAfter < 2) return { ok: false, kicked: [] };   // minimal 2 tim aktif
    const kicked = [];
    for (const s of G.slots) if (s.team === team) {
      if (s.type === 'human' && s.socketId && s.socketId !== hostId) kicked.push(s.socketId);
      s.type = 'disabled'; s.name = null; s.kaum = null; s.socketId = null; s.token = null;
    }
    G.teamOff[team] = true;
    return { ok: true, kicked };
  } else {
    for (const s of G.slots) if (s.team === team) { s.type = 'open'; s.name = null; s.kaum = null; s.socketId = null; s.token = null; }
    G.teamOff[team] = false;
    return { ok: true, kicked: [] };
  }
}
// Lobi: pindah pemain ke tim lain (team 0..3). team=-1 = acak antar tim yg masih ada slot kosong.
function setTeam(G, socketId, team) {
  if (G.started) return false;
  const cur = G.slots.find(s => s.socketId === socketId); if (!cur) return false;
  if (team === -1) {
    const avail = [0, 1, 2, 3].filter(t => G.slots.some(s => s.type === 'open' && s.team === t && s.faction !== cur.faction));
    if (!avail.length) return false;
    team = avail[(Math.random() * avail.length) | 0];
  }
  const dst = G.slots.find(s => s.type === 'open' && s.team === team && s.faction !== cur.faction);
  if (!dst) return false;
  dst.type = 'human'; dst.name = cur.name; dst.kaum = cur.kaum; dst.socketId = cur.socketId; dst.token = cur.token;
  cur.type = 'open'; cur.name = null; cur.kaum = null; cur.socketId = null; cur.token = null;
  return dst.faction;
}
function joinSlot(G, socketId, name, token) {
  if (G.started) return null;
  const s = G.slots.find(s => s.type === 'open'); if (!s) return null;
  s.type = 'human'; s.name = name || ('Pemain ' + (s.faction + 1)); s.socketId = socketId; s.kaum = KAUM[s.faction % KAUM.length].id; s.token = token || null;
  return s.faction;
}
function leaveSlot(G, socketId) {
  const s = G.slots.find(s => s.socketId === socketId); if (!s) return;
  if (G.started) { s.type = 'ai'; s.socketId = null; s.away = true; initAI(s); }   // AI ambil alih sementara; token tetap untuk klaim ulang (reconnect)
  else { s.type = 'open'; s.name = null; s.kaum = null; s.socketId = null; s.token = null; }
}
function setKaum(G, socketId, kaumId) { if (G.started) return; const s = G.slots.find(s => s.socketId === socketId); if (s && KAUM.some(k => k.id === kaumId)) s.kaum = kaumId; }
function factionOf(G, socketId) { const s = G.slots.find(s => s.socketId === socketId); return s ? s.faction : null; }
function humanCount(G) { return G.slots.filter(s => s.type === 'human').length; }
function initAI(s) { s.ai = { growth: rand(0.8, 1.3) }; s.aiTimer = rand(8, 14); s.atkTimer = rand(CONFIG.aiCooldown[0], CONFIG.aiCooldown[1]); }

/* ===================== PENEMPATAN / SPAWN ===================== */
function makeNeutral(G, h, tier) {
  const T = CONFIG.neutralTiers[tier], p = HEX.pixel(h.q, h.r); G._nid = (G._nid || 0) + 1;
  return { id: 'n' + G._nid, owner: -1, team: -1, q: h.q, r: h.r, x: p.x, y: p.y, name: 'Desa ' + G._nid, isHome: false, kind: 'village', tier,
    troops: { ...T.def }, wall: T.wall, loyalty: 100,
    buildings: { markas: T.lvl, kayu: T.lvl, liat: T.lvl, besi: T.lvl, gudang: T.lvl, lumbung: T.lvl },
    res: { kayu: T.loot, liat: T.loot, besi: T.loot }, buildQueue: [], trainQueue: [] };
}
function occupiedSet(G) { return new Set(G.villages.map(v => v.q + ',' + v.r)); }
function spawnNeutral(G, count, tier) {
  const occ = occupiedSet(G);
  const empty = shuffle(HEX.all(HEX.R).filter(h => !occ.has(h.q + ',' + h.r)));
  for (let i = 0; i < count && i < empty.length; i++) G.villages.push(makeNeutral(G, empty[i], tier));
}
function placeVillages(G) {
  G.villages = []; G._nid = 0; G._spawned = {};
  const ring5 = HEX.ring(5);
  const homeHex = [ring5[0], ring5[1], ring5[8], ring5[9], ring5[15], ring5[16], ring5[22], ring5[23]];
  homeHex.forEach((h, f) => { if (G.teamOff[teamOf(f)]) return; const p = HEX.pixel(h.q, h.r); G.villages.push({ id: 'h' + f, owner: f, team: teamOf(f), q: h.q, r: h.r, x: p.x, y: p.y, name: HOME_NAMES[f], isHome: true, homeFaction: f, kind: 'home', troops: { ...CONFIG.startTroops }, wall: 0, loyalty: 100, buildings: { markas: 1, kayu: 1, liat: 1, besi: 1, lumbung: 1, gudang: 1, rally: 1 }, res: { ...CONFIG.startRes }, buildQueue: [], trainQueue: [] }); });
  const fp = HEX.pixel(0, 0);
  G.villages.push({ id: 'fort', owner: -1, team: -1, q: 0, r: 0, x: fp.x, y: fp.y, name: 'Benteng', isHome: false, kind: 'fort', tier: 'high', troops: { tombak: 60, pedang: 30, kapak: 15 }, wall: 4, loyalty: 100, buildings: { markas: 6, kayu: 6, liat: 6, besi: 6, gudang: 6, lumbung: 6 }, res: { kayu: 1500, liat: 1500, besi: 1200 }, buildQueue: [], trainQueue: [] });
  const inner = shuffle(HEX.ring(1).concat(HEX.ring(2), HEX.ring(3), HEX.ring(4)));
  for (let i = 0; i < CONFIG.neutralStartCount && i < inner.length; i++) G.villages.push(makeNeutral(G, inner[i], 'low'));
}
function startGame(G) {
  if (G.started) return;
  G.slots.forEach(s => { if (s.type === 'open') { s.type = 'ai'; s.name = 'AI ' + (s.faction + 1); s.kaum = KAUM[(Math.random() * KAUM.length) | 0].id; } s.reports = []; s.stats = { conquered: 0, looted: 0, killed: 0, lost: 0, spied: 0 }; if (s.type === 'ai') initAI(s); });
  placeVillages(G);
  G.started = true; G.time = 0; G.scores = [0, 0, 0, 0];
}

/* ===================== EFEK KAUM (by faction id) ===================== */
const kaumId = (G, f) => (f != null && G.slots[f]) ? G.slots[f].kaum : null;
const buildDiscount = (G, f) => kaumId(G, f) === 'pengrajin' ? 0.75 : 1;
const buildSpeed    = (G, f) => kaumId(G, f) === 'pengrajin' ? 1.33 : 1;
const atkMult       = (G, f) => kaumId(G, f) === 'penyerbu'  ? 1.25 : 1;
const defKaum       = (G, f) => kaumId(G, f) === 'penjaga'   ? 1.25 : 1;
const prodMult      = (G, f) => kaumId(G, f) === 'pedagang'  ? 1.30 : 1;
const cavCostMult   = (G, f) => kaumId(G, f) === 'penunggang'? 0.80 : 1;
const moveMult      = (G, f) => kaumId(G, f) === 'penunggang'? 1.30 : 1;
const nobleCostMult = (G, f) => kaumId(G, f) === 'penakluk'  ? 0.70 : 1;
const nobleHitMult  = (G, f) => kaumId(G, f) === 'penakluk'  ? 1.40 : 1;
const wallBonusMult = (G, f) => kaumId(G, f) === 'penjaga'   ? 1.30 : 1;

/* ===================== EKONOMI PER-DESA ===================== */
function lvl(v, key) { return v.buildings ? (v.buildings[key] || 0) : 0; }
function costFor(G, v, key, level) { const b = BUILDINGS[key], d = buildDiscount(G, v.owner), o = {}; for (const r of RES) o[r] = Math.round((b.base[r] || 0) * Math.pow(b.cf, level - 1) * d); return o; }
function buildTimeFor(G, v, key, level) { const b = BUILDINGS[key]; const speed = (1 + 0.10 * lvl(v, 'markas')) * buildSpeed(G, v.owner); return Math.max(3, Math.round(b.time * Math.pow(1.2, level - 1) / speed)); }
function storageCap(v) { return Math.round(CONFIG.baseStorage * Math.pow(1.63, lvl(v, 'gudang') - 1)); }   // Lv10 ~= lama Lv25
function popCap(v) { return Math.round(CONFIG.basePop * Math.pow(1.55, lvl(v, 'lumbung') - 1)); }           // Lv10 ~= lama Lv25
function prodPerSec(G, v, res) { const L = lvl(v, res); return L < 1 ? 0 : 2 * Math.pow(1.5, L - 1) * prodMult(G, v.owner); }   // eksponensial: Lv1=2, Lv10~77/dtk
function trainSpeed(v, bKey) { return 1 + 0.12 * lvl(v, bKey); }
function smithyMult(v) { return 1 + 0.05 * lvl(v, 'pandai'); }
// terapkan efek level bangunan terbaru ke antrean yang sedang/akan berjalan (skala sisa proporsional)
function refreshBuildTimes(G, v) { for (const q of v.buildQueue) { const nt = buildTimeFor(G, v, q.key, q.toLevel); if (q.total !== nt) { const fr = q.total > 0 ? Math.max(0, Math.min(1, q.remain / q.total)) : 1; q.total = nt; q.remain = nt * fr; } } }
function refreshTrainTimes(G, v) { for (const q of v.trainQueue) { const U = UNITS[q.unit], nt = Math.max(1, Math.round(U.time / trainSpeed(v, U.b))); if (q.perTime !== nt) { const fr = q.perTime > 0 ? Math.max(0, Math.min(1, q.remain / q.perTime)) : 1; q.perTime = nt; q.remain = nt * fr; } } }
function reqMet(v, key) { const b = BUILDINGS[key]; if (!b.req) return true; for (const k in b.req) if (lvl(v, k) < b.req[k]) return false; return true; }
function popUsed(v) { let p = 0; for (const u in v.troops) p += (v.troops[u] || 0) * UNITS[u].pop; for (const q of v.trainQueue) p += q.left * UNITS[q.unit].pop; return p; }
function canPay(v, cost) { for (const r of RES) if (v.res[r] < (cost[r] || 0)) return false; return true; }
function payV(v, cost) { for (const r of RES) v.res[r] -= (cost[r] || 0); }
function clampRes(v) { const cap = storageCap(v); for (const r of RES) v.res[r] = Math.min(cap, Math.max(0, v.res[r])); }
function villageById(G, id) { return G.villages.find(v => v.id === id); }
function ownedBy(G, f) { return G.villages.filter(v => v.owner === f); }

function queueBuild(G, f, vid, key) {
  const v = villageById(G, vid); if (!v || v.owner !== f || !BUILDINGS[key] || !G.started || G.ended) return false;
  const cur = lvl(v, key), b = BUILDINGS[key], inQ = v.buildQueue.filter(q => q.key === key).length, target = cur + inQ + 1;
  if (target > b.max || v.buildQueue.length >= CONFIG.buildQueueMax || !reqMet(v, key)) return false;
  const cost = costFor(G, v, key, target); if (!canPay(v, cost)) return false;
  payV(v, cost); const t = buildTimeFor(G, v, key, target);
  v.buildQueue.push({ key, toLevel: target, remain: t, total: t }); return true;
}
function cancelBuild(G, f, vid, i) {
  const v = villageById(G, vid); if (!v || v.owner !== f) return;
  const first = v.buildQueue[i]; if (!first) return; const key = first.key;
  // batalkan item i + semua bangunan TIPE SAMA yang ada SETELAHNYA (refund semua)
  for (let j = v.buildQueue.length - 1; j >= i; j--) {
    const q = v.buildQueue[j];
    if (j === i || q.key === key) { const cost = costFor(G, v, q.key, q.toLevel); for (const r of RES) v.res[r] += cost[r]; v.buildQueue.splice(j, 1); }
  }
  clampRes(v); refreshBuildTimes(G, v);
}
function queueTrain(G, f, vid, unit, count) {
  const v = villageById(G, vid); if (!v || v.owner !== f || !UNITS[unit] || !G.started || G.ended) return false;
  const U = UNITS[unit]; count = Math.floor(count);
  if (count <= 0 || lvl(v, U.b) < 1) return false;
  const maxByPop = Math.floor((popCap(v) - popUsed(v)) / U.pop); if (maxByPop <= 0) return false;
  count = Math.min(count, maxByPop);
  let cm = U.cav ? cavCostMult(G, f) : 1; if (U.noble) cm = nobleCostMult(G, f);
  while (count > 0) { let ok = true; for (const r of RES) if (v.res[r] < Math.round((U.cost[r] || 0) * cm) * count) ok = false; if (ok) break; count--; }
  if (count <= 0) return false;
  for (const r of RES) v.res[r] -= Math.round((U.cost[r] || 0) * cm) * count;
  const t = Math.max(1, Math.round(U.time / trainSpeed(v, U.b)));
  v.trainQueue.push({ unit, left: count, total: count, perTime: t, remain: t }); return true;
}
function cancelTrain(G, f, vid, i) { const v = villageById(G, vid); if (!v || v.owner !== f) return; const q = v.trainQueue[i]; if (!q) return; const U = UNITS[q.unit]; let cm = U.cav ? cavCostMult(G, f) : 1; if (U.noble) cm = nobleCostMult(G, f); for (const r of RES) v.res[r] += Math.round((U.cost[r] || 0) * cm) * q.left; v.trainQueue.splice(i, 1); clampRes(v); }
function renameVillage(G, f, vid, name) { const v = villageById(G, vid); if (!v || v.owner !== f) return; name = String(name || '').slice(0, 18).trim(); if (name) v.name = name; }

/* ===================== KIRIM PASUKAN (jarak hex) ===================== */
function armySpeed(units) { let s = 0; for (const u in units) if (units[u] > 0) s = Math.max(s, UNITS[u].spd); return s || 18; }
function carryCap(units) { let c = 0; for (const u in units) c += (units[u] || 0) * (UNITS[u].carry || 0); return c; }
function travelTime(G, fromV, toV, units, owner) { const hd = HEX.dist(fromV, toV); return Math.max(1, hd * HEX.SEC * (armySpeed(units) / 18) / moveMult(G, owner)); }
function sendArmy(G, f, fromId, toId, units, mission) {
  if (!G.started || G.ended) return false;
  const from = villageById(G, fromId), to = villageById(G, toId);
  if (!from || !to || from === to || from.owner !== f) return false;
  const send = {}; let any = false;
  for (const u in units) { const n = Math.floor(units[u]); if (n > 0 && (from.troops[u] || 0) >= n) { send[u] = n; any = true; } else if (n > 0) return false; }
  if (!any) return false;
  if (send.bangsawan > 1) send.bangsawan = 1;   // maks 1 Bangsawan per pengiriman
  for (const u in send) from.troops[u] -= send[u];
  if (!mission) mission = (to.owner !== -1 && teamOf(to.owner) === teamOf(f)) ? 'support' : 'attack';
  const rem = travelTime(G, from, to, send, f);
  G.armies.push({ owner: f, team: teamOf(f), fromId, toId, fromX: from.x, fromY: from.y, tx: to.x, ty: to.y, units: send, mission, remain: rem, total: rem, loot: null, atkMult: atkMult(G, f) * smithyMult(from), spyLvl: lvl(from, 'pandai') });
  return true;
}
function sendResource(G, f, fromId, toId, amount) {
  if (!G.started || G.ended) return false;
  const from = villageById(G, fromId), to = villageById(G, toId);
  if (!from || !to || from === to || from.owner !== f) return false;
  if (to.owner === -1 || teamOf(to.owner) !== teamOf(f)) return false;   // hanya ke desa sendiri/sekutu
  const send = {}; let any = false;
  for (const r of RES) { const n = Math.min(Math.floor(amount && amount[r] || 0), Math.floor(from.res[r])); send[r] = Math.max(0, n); if (send[r] > 0) any = true; }
  if (!any) return false;
  for (const r of RES) from.res[r] -= send[r];
  const rem = travelTime(G, from, to, {}, f);
  G.armies.push({ owner: f, team: teamOf(f), fromId, toId, fromX: from.x, fromY: from.y, tx: to.x, ty: to.y, units: {}, mission: 'res', remain: rem, total: rem, loot: send, atkMult: 1 });
  return true;
}

/* ===================== PERTEMPURAN ===================== */
function nodeDefBonus(v) { return v.kind === 'home' ? CONFIG.HOME_DEF_BONUS : v.kind === 'fort' ? CONFIG.FORT_DEF_BONUS : 1; }
function armyPower(units, mult) { let inf = 0, cav = 0; for (const u in units) { const c = units[u] || 0; if (!c) continue; const a = UNITS[u].atk * c; if (isCav(u)) cav += a; else inf += a; } return { inf: inf * mult, cav: cav * mult, total: (inf + cav) * mult }; }
function defPower(G, v, fInf, fCav) {
  let d = 0; for (const u in v.troops) { const c = v.troops[u] || 0; if (!c) continue; d += c * (fInf * UNITS[u].dInf + fCav * UNITS[u].dCav); }
  const wall = v.wall * (v.owner !== -1 ? wallBonusMult(G, v.owner) : 1);
  const kd = v.owner !== -1 ? defKaum(G, v.owner) : 1;
  return (d * kd * nodeDefBonus(v) * (1 + 0.10 * wall)) + wall * 50;   // Tembok max10: Lv10 ~= lama Lv20
}
function stealLoot(stock, cap) { const total = stock.kayu + stock.liat + stock.besi, out = { kayu: 0, liat: 0, besi: 0 }; if (total <= 0 || cap <= 0) return out; const take = Math.min(cap, total); for (const r of RES) { out[r] = Math.floor(take * (stock[r] / total)); stock[r] -= out[r]; } return out; }
function conquerVillage(G, v, newOwner) { v.owner = newOwner; v.team = teamOf(newOwner); v.loyalty = 25; v.troops = {}; v.wall = Math.max(0, v.wall - 2); v.buildQueue = []; v.trainQueue = []; if (!v.res) v.res = { kayu: 0, liat: 0, besi: 0 }; if (!v.buildings) v.buildings = {}; delete v.tier; }
function fmt(t) { const left = Math.max(0, CONFIG.MATCH_MINUTES * 60 - t); return String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(Math.floor(left % 60)).padStart(2, '0'); }
function diffUnits(before, after) { const o = {}; for (const u in before) { const d = (before[u] || 0) - (after[u] || 0); if (d > 0) o[u] = d; } return o; }
function addReport(G, f, txt, cls, detail) { if (f == null || f < 0) return; const s = G.slots[f]; if (!s || s.type !== 'human') return; s.reports.unshift({ id: (G._rid = (G._rid || 0) + 1), txt, cls, when: fmt(G.time), detail: detail || null }); if (s.reports.length > 40) s.reports.pop(); }
function resolveArrival(G, a) {
  const v = villageById(G, a.toId); if (!v) return;
  if (a.mission === 'spy') { resolveSpy(G, a, v); return; }
  if (a.mission === 'support' || a.mission === 'return' || a.mission === 'res') {
    if (v.owner !== -1 && teamOf(v.owner) === a.team) { mergeTroops(v.troops, a.units); if (a.loot) { for (const r of RES) v.res[r] += a.loot[r]; clampRes(v); } }
    return;
  }
  attack(G, a, v);
}
function attack(G, a, v) {
  const ap = armyPower(a.units, a.atkMult || 1);
  const fInf = ap.total > 0 ? ap.inf / (ap.inf + ap.cav || 1) : 0.5, fCav = 1 - fInf;
  const dp = defPower(G, v, fInf, fCav);
  const place = v.name, defOwner = v.owner, wallBefore = v.wall, loyBefore = Math.round(v.loyalty);
  const atkSent = { ...a.units }, defBefore = { ...v.troops };
  const D = { place, atk: G.slots[a.owner] ? G.slots[a.owner].name : 'Musuh', def: defOwner >= 0 ? (G.slots[defOwner] ? G.slots[defOwner].name : 'Pemain') : 'Netral',
    atkKaum: kaumId(G, a.owner), defKaum: defOwner >= 0 ? kaumId(G, defOwner) : null, kind: v.kind, wallBefore, loyBefore, atkSent, defBefore };
  if (ap.total > dp) {                                       // PENYERANG MENANG
    const lossRatio = Math.pow(dp / ap.total, 1.5);
    const surv = {}; for (const u in a.units) { const s = Math.round(a.units[u] * (1 - lossRatio)); if (s > 0) surv[u] = s; }
    const defLost = totalUnits(v.troops); v.troops = {};
    const rams = surv['pendobrak'] || a.units['pendobrak'] || 0;
    if (rams > 0 && v.wall > 0) v.wall = Math.max(0, v.wall - Math.min(v.wall, 1 + Math.floor(rams / 3)));
    let conquered = false; const nobles = surv['bangsawan'] || 0;
    if (nobles > 0 && (v.owner === -1 || teamOf(v.owner) !== a.team)) {
      if (v.owner === -1) { conquerVillage(G, v, a.owner); conquered = true; delete surv['bangsawan']; }   // NETRAL: 1 Bangsawan = langsung diduduki
      else { v.loyalty -= nobles * rand(20, 35) * nobleHitMult(G, a.owner); if (v.loyalty <= 0) { conquerVillage(G, v, a.owner); conquered = true; delete surv['bangsawan']; } }   // MUSUH: turunkan loyalitas hingga 0
    }
    let loot = null;
    if (!conquered && v.res && (v.owner === -1 || teamOf(v.owner) !== a.team)) loot = stealLoot(v.res, carryCap(surv));
    if (totalUnits(surv) > 0) G.armies.push({ owner: a.owner, team: a.team, fromId: a.toId, toId: a.fromId, fromX: v.x, fromY: v.y, tx: a.fromX, ty: a.fromY, units: surv, mission: 'return', remain: a.total, total: a.total, loot });
    D.result = conquered ? 'taklukkan' : (loot && (loot.kayu + loot.liat + loot.besi) > 0 ? 'jarah' : 'menang');
    D.atkSurv = surv; D.atkLost = totalUnits(diffUnits(atkSent, surv)); D.defLost = defLost; D.defSurv = {};
    D.wallAfter = v.wall; D.loot = loot; D.nobles = nobles; D.loyAfter = conquered ? 0 : Math.round(v.loyalty); D.conquered = conquered;
    if (conquered) addReport(G, a.owner, `👑 Kamu MENAKLUKKAN ${place}!`, 'win', D);
    else if (loot && (loot.kayu + loot.liat + loot.besi) > 0) addReport(G, a.owner, `💰 Jarah ${place} berhasil (+🪵${loot.kayu} 🧱${loot.liat} ⚙️${loot.besi}).`, 'win', D);
    else addReport(G, a.owner, `⚔️ Seranganmu di ${place} berhasil.`, 'win', D);
    if (defOwner >= 0) addReport(G, defOwner, `🛑 ${place} diserang ${D.atk}!` + (conquered ? ' Desa JATUH!' : ''), 'lose', D);
  } else {                                                   // BERTAHAN MENANG
    const lossRatio = Math.pow(ap.total / Math.max(1, dp), 1.5);
    const defSurv = {}; for (const u in v.troops) { const n = Math.round(v.troops[u] * (1 - lossRatio)); v.troops[u] = n; if (n > 0) defSurv[u] = n; }
    D.result = 'gagal'; D.atkSurv = {}; D.atkLost = totalUnits(atkSent); D.defSurv = defSurv; D.defLost = totalUnits(diffUnits(defBefore, defSurv));
    D.wallAfter = v.wall; D.loot = null; D.nobles = 0; D.loyAfter = Math.round(v.loyalty); D.conquered = false;
    addReport(G, a.owner, `💥 Seranganmu di ${place} GAGAL.`, 'lose', D);
    if (defOwner >= 0) addReport(G, defOwner, `🛡️ Kamu menahan serangan ${D.atk} di ${place}!`, 'win', D);
  }
  const aS = (G.slots[a.owner] || {}).stats, dS = defOwner >= 0 ? (G.slots[defOwner] || {}).stats : null;   // statistik utk rekap akhir
  if (aS) { aS.killed += D.defLost || 0; aS.lost += D.atkLost || 0; if (D.conquered) aS.conquered++; if (D.loot) aS.looted += (D.loot.kayu + D.loot.liat + D.loot.besi); }
  if (dS) { dS.killed += D.atkLost || 0; dS.lost += D.defLost || 0; }
}
/* ===================== MATA-MATA (intip) ===================== */
function buildSpyReport(G, v, m) {   // intel target sesuai level Pandai Besi penyerang (berjenjang seperti Menara)
  const D = { spy: true, place: v.name, kind: v.kind, pandai: m, owner: v.owner };
  if (m >= 1) D.troopTotal = totalUnits(v.troops);
  if (m >= 2) D.res = { kayu: Math.floor(v.res.kayu), liat: Math.floor(v.res.liat), besi: Math.floor(v.res.besi) };
  if (m >= 3) { D.wall = v.wall; D.loyalty = Math.round(v.loyalty); }
  if (m >= 4) D.troops = { ...v.troops };
  if (m >= 5) D.markas = lvl(v, 'markas');
  if (m >= 6) D.buildings = { ...v.buildings };
  if (m >= 7) D.pop = popUsed(v) + '/' + popCap(v);
  if (m >= 8) D.queues = { build: v.buildQueue.map(q => q.key + '→' + q.toLevel), train: v.trainQueue.map(q => q.unit + '×' + q.left) };
  if (m >= 9) D.incoming = G.armies.filter(x => x.toId === v.id && x.mission === 'attack').length;
  return D;
}
function resolveSpy(G, a, v) {
  const atk = a.units.mata || 0, def = v.troops.mata || 0;
  if (atk > def) {                                            // SUKSES: mata penyerang lebih banyak
    v.troops.mata = 0;                                        // mata-mata bertahan kalah
    const surv = atk - def;                                   // sebagian tertangkap saat bentrok mata-mata
    const D = buildSpyReport(G, v, a.spyLvl || 0); D.result = 'intip'; D.atkSpy = atk; D.atkSpyLost = def;
    addReport(G, a.owner, `🕵️ Mata-mata sukses mengintip ${v.name}.`, 'win', D);
    { const sS = (G.slots[a.owner] || {}).stats; if (sS) sS.spied++; }
    if (v.owner >= 0) addReport(G, v.owner, `🕵️ ${v.name} diintip mata-mata musuh.`, 'lose', null);
    if (surv > 0) G.armies.push({ owner: a.owner, team: a.team, fromId: a.toId, toId: a.fromId, fromX: v.x, fromY: v.y, tx: a.fromX, ty: a.fromY, units: { mata: surv }, mission: 'return', remain: a.total, total: a.total, loot: null });
  } else {                                                    // GAGAL: mata-mata tertangkap mata-mata lawan
    v.troops.mata = Math.max(0, def - Math.floor(atk / 2));
    addReport(G, a.owner, `🚫 Mata-matamu (${atk}) tertangkap di ${v.name}.`, 'lose', null);
    if (v.owner >= 0) addReport(G, v.owner, `🛡️ Mata-mata musuh tertangkap di ${v.name}!`, 'win', null);
  }
}

/* ===================== AI ===================== */
function offensiveUnits(tr) { const o = {}; for (const u in tr) if ((UNITS[u].atk >= 40 || isCav(u) || UNITS[u].ram) && tr[u] > 0) o[u] = tr[u]; return o; }
function capTroops(tr, cap) { let n = totalUnits(tr); if (n <= cap) return; const f = cap / n; for (const u in tr) tr[u] = Math.floor(tr[u] * f); }
function aiTick(G, s, dt) {
  const f = s.faction, t = G.time / 60;
  s.aiTimer -= dt;
  if (s.aiTimer <= 0) {
    s.aiTimer = rand(8, 14);
    const owned = ownedBy(G, f);
    const econ = 1 + 0.25 * Math.max(0, owned.length - 1);   // tiap desa ekstra = +25% pertumbuhan (simulasi ekonomi)
    const g = s.ai.growth, add = Math.max(1, Math.round((1.6 + t * 0.9) * g * econ));
    for (const v of owned) {
      v.troops.tombak = (v.troops.tombak || 0) + add; v.troops.kapak = (v.troops.kapak || 0) + Math.round(add * 0.6);
      if (t > 3) v.troops.ringan = (v.troops.ringan || 0) + Math.round(add * 0.35);
      if (t > 6) v.troops.pedang = (v.troops.pedang || 0) + Math.round(add * 0.4);
      if (t > 9) v.troops.berat = (v.troops.berat || 0) + Math.round(add * 0.12);
      if (v.wall < 10 && Math.random() < 0.18) v.wall++;
      capTroops(v.troops, CONFIG.aiCap + owned.length * 150);
      if (t > 5 && v.isHome && (v.troops.bangsawan || 0) < 3 && Math.random() < 0.14) v.troops.bangsawan = (v.troops.bangsawan || 0) + 1;   // siapkan penakluk (duduki netral & musuh)
    }
  }
  s.atkTimer -= dt; if (s.atkTimer > 0) return;
  s.atkTimer = rand(CONFIG.aiCooldown[0], CONFIG.aiCooldown[1]);
  if (t < CONFIG.aiGraceMin || Math.random() > CONFIG.aiChance) return;
  const armies = ownedBy(G, f).map(v => ({ v, off: offensiveUnits(v.troops) })).filter(x => totalUnits(x.off) >= CONFIG.aiMinArmy).sort((a, b) => totalUnits(b.off) - totalUnits(a.off));
  if (!armies.length) return;
  const { v: src, off } = armies[0];
  const mult = atkMult(G, f) * smithyMult(src);
  const myPow = armyPower(off, mult).total;
  // pilih target paling bernilai yang bisa dimenangi: netral diprioritaskan (ekspansi gratis), musuh hanya bernilai bila punya Bangsawan
  const hasNoble = (src.troops.bangsawan || 0) > 0;
  let best = null, bestScore = -1;
  for (const tg of G.villages) {
    if (tg.team === teamOf(f)) continue;
    const neutral = tg.owner === -1;
    const ratio = myPow / Math.max(1, defPower(G, tg, 0.6, 0.4));
    if (ratio < (neutral ? 1.15 : CONFIG.aiEdge)) continue;
    const dist = HEX.dist(src, tg);
    let val = neutral ? (hasNoble ? 1.6 : 0.6) : (hasNoble ? 1.0 : 0.25);   // netral perlu Bangsawan utk diduduki; tanpa noble cuma jarah
    if (tg.kind === 'fort') val += 0.8;                  // Benteng pusat sangat berharga
    const score = val * Math.min(ratio, 3) / (1 + dist * (neutral ? 0.12 : 0.25));   // netral lebih toleran jarak
    if (score > bestScore) { bestScore = score; best = { tg, neutral }; }
  }
  if (!best) return;
  const send = {}; for (const u in off) send[u] = Math.floor(off[u] * CONFIG.aiSendFrac);   // sisakan ~40% utk bertahan
  if ((src.troops.bangsawan || 0) > 0) send.bangsawan = 1;   // bawa Bangsawan: duduki netral / turunkan loyalitas musuh
  if (totalUnits(send) > 0) sendArmy(G, f, src.id, best.tg.id, send, 'attack');
}

/* ===================== TICK ===================== */
function tick(G, dt) {
  if (!G.started || G.ended) return;
  G.time += dt;
  CONFIG.spawnWaves.forEach((w, i) => { if (!G._spawned[i] && G.time >= w.min * 60) { G._spawned[i] = true; spawnNeutral(G, w.count, w.tier); } });
  for (const v of G.villages) {
    v.loyalty = Math.min(100, v.loyalty + CONFIG.loyaltyRegenPerMin * dt / 60);
    if (v.owner === -1) {
      const cap = storageCap(v); for (const r of RES) v.res[r] = Math.min(cap, v.res[r] + 0.6 * lvl(v, r) * dt);
      v._dr = (v._dr || 0) + dt; const per = 60 / CONFIG.neutralDefRegenPerMin; if (v._dr >= per) { v._dr -= per; v.troops.tombak = (v.troops.tombak || 0) + 1; }
    } else {
      const s = G.slots[v.owner];
      if (s && s.type === 'human') {
        for (const r of RES) v.res[r] += prodPerSec(G, v, r) * dt; clampRes(v);
        if (v.buildQueue.length) { const q = v.buildQueue[0]; q.remain -= dt; if (q.remain <= 0) { v.buildings[q.key] = q.toLevel; if (q.key === 'tembok') v.wall = q.toLevel; v.buildQueue.shift(); refreshBuildTimes(G, v); refreshTrainTimes(G, v); } }
        if (v.trainQueue.length) {   // latihan PARALEL: batch terdepan tiap kategori bangunan jalan bersamaan
          const seen = {}; let done = false;
          for (const q of v.trainQueue) { const bld = UNITS[q.unit].b; if (seen[bld]) continue; seen[bld] = true; q.remain -= dt; let g = 0; while (q.remain <= 0 && q.left > 0 && g < 5000) { v.troops[q.unit] = (v.troops[q.unit] || 0) + 1; q.left--; q.remain += q.perTime; g++; } if (q.left <= 0) done = true; }
          if (done) v.trainQueue = v.trainQueue.filter(q => q.left > 0);
        }
      }
      G.scores[v.team] += (v.kind === 'home' ? CONFIG.PTS_HOME : v.kind === 'fort' ? CONFIG.PTS_FORT : CONFIG.PTS_VILLAGE) * dt;
    }
  }
  for (let i = G.armies.length - 1; i >= 0; i--) { const a = G.armies[i]; a.remain -= dt; if (a.remain <= 0) { resolveArrival(G, a); G.armies.splice(i, 1); } }
  for (const s of G.slots) if (s.type === 'ai') aiTick(G, s, dt);
  pruneOffers(G);
  // King of the Hill: tahan Benteng pusat berturut-turut
  const fort = G.villages.find(v => v.kind === 'fort');
  if (fort && fort.owner !== -1) {
    if (G._fortTeam === fort.team) G._fortHold = (G._fortHold || 0) + dt;
    else { G._fortTeam = fort.team; G._fortHold = 0; }
  } else { G._fortTeam = -1; G._fortHold = 0; }
  checkWin(G);
}
function villageCount(G) { const c = [0, 0, 0, 0]; for (const v of G.villages) if (v.owner !== -1) c[v.team]++; return c; }
function checkWin(G) {
  const alive = [0, 1, 2, 3].filter(t => G.villages.some(v => v.owner !== -1 && v.team === t));
  if (alive.length === 1) return end(G, alive[0], 'eliminasi');
  if ((G._fortHold || 0) >= CONFIG.fortHoldSec && G._fortTeam >= 0) return end(G, G._fortTeam, 'benteng');   // king of the hill
  const total = G.villages.length, vc = villageCount(G);
  for (let t = 0; t < 4; t++) if (!G.teamOff[t] && total > 0 && vc[t] >= CONFIG.dominationPct * total) return end(G, t, 'dominasi');
  if (CONFIG.endOnTime && G.time >= G.duration) { const c = villageCount(G); let b = 0; for (let t = 1; t < 4; t++) if (c[t] > c[b] || (c[t] === c[b] && G.scores[t] > G.scores[b])) b = t; return end(G, b, 'waktu'); }
}
function end(G, team, reason) { G.ended = true; G.winner = team; G.reason = reason; }

/* ===================== DETEKSI SERANGAN MASUK (Menara) ===================== */
function incomingFor(G, f) {
  const out = [];
  for (const a of G.armies) {
    if (a.mission !== 'attack') continue;
    const v = villageById(G, a.toId);
    if (!v || v.owner !== f) continue;
    const m = lvl(v, 'menara'); if (m < 1) continue;          // Lv1: baru tahu ada serangan
    const total = totalUnits(a.units);
    const info = { toId: v.id, toName: v.name, menara: m, eta: m >= 2 ? Math.ceil(a.remain) : null };
    if (m >= 3) info.from = G.slots[a.owner] ? G.slots[a.owner].name : 'Musuh';
    if (m >= 4) info.types = Object.keys(a.units).filter(u => a.units[u] > 0).map(u => UNITS[u].nm);
    if (m === 5) info.count = Math.round(total / 1000) * 1000;
    else if (m === 6) info.count = Math.round(total / 100) * 100;
    else if (m >= 7) info.count = total;
    if (m >= 8) info.perType = { ...a.units };
    if (m >= 9) info.noble = (a.units.bangsawan || 0) > 0;
    if (m >= 10) { const ap = armyPower(a.units, a.atkMult || 1); const fInf = ap.total > 0 ? ap.inf / (ap.inf + ap.cav || 1) : 0.5; info.outcome = ap.total > defPower(G, v, fInf, 1 - fInf) ? 'kalah' : 'bertahan'; }
    out.push(info);
  }
  return out.sort((x, y) => (x.eta || 1e9) - (y.eta || 1e9));
}

/* ===================== PASAR (instan, global) ===================== */
function hasMarket(v) { return v && v.buildings && (v.buildings.pasar || 0) >= 1; }
function pruneOffers(G) { G.offers = G.offers.filter(o => { const v = villageById(G, o.vid); return v && v.owner === o.faction; }); }
// Tukar dgn sistem: bayar `giveAmt` giveRes → dapat floor(giveAmt/fee) getRes.
function marketSwap(G, f, vid, giveRes, getRes, giveAmt) {
  if (!G.started || G.ended) return false;
  const v = villageById(G, vid);
  if (!v || v.owner !== f || !hasMarket(v)) return false;
  if (!RES.includes(giveRes) || !RES.includes(getRes) || giveRes === getRes) return false;
  giveAmt = Math.floor(giveAmt); if (!(giveAmt > 0) || v.res[giveRes] < giveAmt) return false;
  const getAmt = Math.floor(giveAmt / CONFIG.MARKET.fee + 1e-6); if (getAmt < 1) return false;   // +eps: hindari 110/1.1=99.999
  v.res[giveRes] -= giveAmt; v.res[getRes] += getAmt; clampRes(v); return true;
}
// Pasang tawaran: kunci (escrow) giveAmt giveRes; minta wantAmt wantRes (rasio bebas).
function marketPost(G, f, vid, giveRes, giveAmt, wantRes, wantAmt) {
  if (!G.started || G.ended) return false;
  const v = villageById(G, vid);
  if (!v || v.owner !== f || !hasMarket(v)) return false;
  if (!RES.includes(giveRes) || !RES.includes(wantRes) || giveRes === wantRes) return false;
  giveAmt = Math.floor(giveAmt); wantAmt = Math.floor(wantAmt);
  if (giveAmt < CONFIG.MARKET.minAmt || wantAmt < CONFIG.MARKET.minAmt) return false;
  if (v.res[giveRes] < giveAmt) return false;
  if (G.offers.filter(o => o.faction === f).length >= CONFIG.MARKET.maxOffers) return false;
  v.res[giveRes] -= giveAmt;
  G.offers.push({ id: (G._oid = (G._oid || 0) + 1), faction: f, team: teamOf(f), vid, giveRes, giveAmt, wantRes, wantAmt });
  return true;
}
// Terima tawaran (global): pembeli bayar wantAmt wantRes, dapat giveAmt giveRes (escrow). Penjual terima wantAmt wantRes.
function marketAccept(G, f, vid, offerId) {
  if (!G.started || G.ended) return false;
  const i = G.offers.findIndex(o => o.id === offerId); if (i < 0) return false;
  const o = G.offers[i]; if (o.faction === f) return false;
  const buyer = villageById(G, vid);
  if (!buyer || buyer.owner !== f || !hasMarket(buyer)) return false;
  if (buyer.res[o.wantRes] < o.wantAmt) return false;
  buyer.res[o.wantRes] -= o.wantAmt; buyer.res[o.giveRes] += o.giveAmt; clampRes(buyer);
  const seller = villageById(G, o.vid);
  if (seller && seller.owner === o.faction) { seller.res[o.wantRes] += o.wantAmt; clampRes(seller); }
  G.offers.splice(i, 1); return true;
}
// Batalkan tawaran sendiri: kembalikan escrow.
function marketCancel(G, f, offerId) {
  const i = G.offers.findIndex(o => o.id === offerId); if (i < 0) return false;
  const o = G.offers[i]; if (o.faction !== f) return false;
  const v = villageById(G, o.vid);
  if (v && v.owner === f) { v.res[o.giveRes] += o.giveAmt; clampRes(v); }
  G.offers.splice(i, 1); return true;
}

/* ===================== VIEW (per faksi, fog) ===================== */
function gameView(G, faction) {
  const myTeam = faction != null ? teamOf(faction) : -1;
  let me = null, menara = 0;
  if (faction != null && G.started) {
    const owned = ownedBy(G, faction);
    owned.forEach(v => { menara = Math.max(menara, lvl(v, 'menara')); });
    me = { faction, team: myTeam, kaum: G.slots[faction].kaum, menara, reports: G.slots[faction].reports.slice(0, 40), incoming: incomingFor(G, faction),
      villages: owned.map(v => ({ id: v.id, name: v.name, isHome: v.isHome, kind: v.kind, q: v.q, r: v.r, x: v.x, y: v.y, wall: v.wall, loyalty: Math.round(v.loyalty),
        res: { kayu: Math.floor(v.res.kayu), liat: Math.floor(v.res.liat), besi: Math.floor(v.res.besi) },
        cap: storageCap(v), popUsed: popUsed(v), popCap: popCap(v),
        prod: { kayu: +prodPerSec(G, v, 'kayu').toFixed(2), liat: +prodPerSec(G, v, 'liat').toFixed(2), besi: +prodPerSec(G, v, 'besi').toFixed(2) },
        buildings: { ...v.buildings },
        buildQueue: v.buildQueue.map(q => ({ key: q.key, toLevel: q.toLevel, remain: +q.remain.toFixed(1), total: q.total })),
        trainQueue: v.trainQueue.map(q => ({ unit: q.unit, left: q.left, remain: +q.remain.toFixed(1), perTime: q.perTime })),
        troops: { ...v.troops } })) };
  }
  const seeAll = menara > 0;
  const visT = v => v.owner === -1 || (v.owner !== -1 && teamOf(v.owner) === myTeam) || seeAll;
  return {
    started: G.started, ended: G.ended, time: Math.floor(G.time), duration: G.duration, winner: G.winner, reason: G.reason, noTimer: !CONFIG.endOnTime,
    scores: G.scores.map(s => Math.floor(s)), villageCount: villageCount(G), hexR: HEX.R, me, teamOff: G.teamOff,
    fortHold: (G._fortTeam >= 0) ? { team: G._fortTeam, time: Math.floor(G._fortHold || 0), need: CONFIG.fortHoldSec } : null, domPct: CONFIG.dominationPct,
    recap: G.ended ? G.slots.map(s => ({ faction: s.faction, team: s.team, name: s.name, type: s.type, stats: s.stats || null })) : null,
    offers: G.offers.map(o => ({ id: o.id, team: o.team, mine: o.faction === faction, ally: faction != null && teamOf(o.faction) === myTeam, giveRes: o.giveRes, giveAmt: o.giveAmt, wantRes: o.wantRes, wantAmt: o.wantAmt })),
    villages: G.villages.map(v => {
      const ownTeam = v.owner !== -1 && teamOf(v.owner) === myTeam;
      return { id: v.id, owner: v.owner, team: v.team, q: v.q, r: v.r, x: v.x, y: v.y, name: v.name, isHome: v.isHome, kind: v.kind,
        dev: lvl(v, 'markas'), wall: v.wall,
        troops: ownTeam ? totalUnits(v.troops) : null,
        loyalty: ownTeam ? Math.round(v.loyalty) : null,
        units: v.owner === faction ? { ...v.troops } : undefined };
    }),
    armies: G.armies.filter(a => a.team === myTeam || seeAll).map(a => ({ owner: a.owner, team: a.team, fromX: a.fromX, fromY: a.fromY, tx: a.tx, ty: a.ty, progress: 1 - a.remain / a.total, troops: totalUnits(a.units), mission: a.mission })),
  };
}
// viewer = faction penonton: kaum pemain lain DIRAHASIAKAN (hanya kaum sendiri yang terlihat).
function lobbyView(G, code, viewer) { const hs = G.slots.find(s => s.socketId === G.hostId); return { code, started: G.started, hostFaction: hs ? hs.faction : 0, teamOff: G.teamOff, slots: G.slots.map(s => ({ faction: s.faction, team: s.team, type: s.type, name: s.name, kaum: (viewer != null && s.faction === viewer) ? s.kaum : null, hasKaum: !!s.kaum })) }; }

module.exports = { createGame, joinSlot, leaveSlot, setKaum, setTeam, setTeamActive, kickSlot, factionOf, humanCount, startGame, tick, queueBuild, cancelBuild, queueTrain, cancelTrain, renameVillage, sendArmy, sendResource, marketSwap, marketPost, marketAccept, marketCancel, gameView, lobbyView, villageCount, teamOf };
