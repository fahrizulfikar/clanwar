/* =======================================================================
   SERVER PERANG KAUM (Node.js + Express + Socket.IO) — EKONOMI PENUH
   Jalankan:  npm install  lalu  npm start
   ======================================================================= */
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const E = require('./server/engine');
const { CONFIG } = require('./public/shared');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const rooms = new Map(); // code -> { code, G, loop }

function makeCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 4 }, () => a[(Math.random() * a.length) | 0]).join(''); } while (rooms.has(c));
  return c;
}
function createRoom() { const code = makeCode(); const room = { code, G: E.createGame(), loop: null }; rooms.set(code, room); return room; }
function broadcastLobby(room) {
  // per-socket: kaum pemain lain dirahasiakan
  for (const s of room.G.slots) if (s.type === 'human' && s.socketId) io.to(s.socketId).emit('lobby', E.lobbyView(room.G, room.code, s.faction));
}
function broadcastState(room) {
  // tiap pemain menerima view-nya sendiri (ekonomi pribadi + fog)
  for (const s of room.G.slots) if (s.type === 'human' && s.socketId) io.to(s.socketId).emit('state', E.gameView(room.G, s.faction));
}
function logMatch(room) {   // catat hasil match ke file untuk balancing berbasis data
  if (room._logged) return; room._logged = true;
  try {
    const G = room.G;
    const line = JSON.stringify({ waktu: new Date().toISOString(), kode: room.code, pemenang: G.winner, alasan: G.reason, durasiDetik: Math.floor(G.time), desa: E.villageCount(G), skor: G.scores.map(s => Math.floor(s)), timNonaktif: G.teamOff }) + '\n';
    fs.appendFile(path.join(__dirname, 'matches.log'), line, () => {});
  } catch (e) {}
}
function startLoop(room) {
  if (room.loop) clearInterval(room.loop);
  const dt = CONFIG.TICK_MS / 1000;
  room.loop = setInterval(() => {
    if (room._emptyAt && Date.now() - room._emptyAt > 120000) { clearInterval(room.loop); room.loop = null; rooms.delete(room.code); return; }  // tenggang reconnect habis
    E.tick(room.G, dt);
    broadcastState(room);
    if (room.G.ended) { logMatch(room); clearInterval(room.loop); room.loop = null; setTimeout(() => { if (rooms.get(room.code) === room) rooms.delete(room.code); }, 60000); }
  }, CONFIG.TICK_MS);
}
function roomOf(socket) { const code = socket.data.code; return code ? rooms.get(code) : null; }
function myFaction(socket) { const room = roomOf(socket); return room ? E.factionOf(room.G, socket.id) : null; }

io.on('connection', (socket) => {
  function joinRoom(room, name, token) {
    const faction = E.joinSlot(room.G, socket.id, name, token);
    if (faction === null) { socket.emit('errorMsg', 'Room penuh atau sudah dimulai.'); return false; }
    if (!room.G.hostId) room.G.hostId = socket.id;   // pembuat room = host
    socket.join(room.code); socket.data.code = room.code;
    socket.emit('joined', { code: room.code, faction });
    broadcastLobby(room); return true;
  }
  // Klaim ulang slot setelah refresh (token cocok). Game lanjut; AI yang sempat mengambil alih dikembalikan ke pemain.
  socket.on('rejoin', ({ code, token }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || !token) return socket.emit('rejoinFail');
    const s = room.G.slots.find(x => x.token === token);
    if (!s) return socket.emit('rejoinFail');
    s.type = 'human'; s.socketId = socket.id; s.away = false; s.ai = null;
    socket.join(room.code); socket.data.code = room.code; room._emptyAt = null;
    if (!room.G.slots.some(x => x.socketId === room.G.hostId)) room.G.hostId = socket.id;   // pulihkan host bila kosong
    socket.emit('joined', { code: room.code, faction: s.faction });
    if (room.G.started) socket.emit('started');
    broadcastState(room); broadcastLobby(room);
  });

  socket.on('createRoom', ({ name, token }) => joinRoom(createRoom(), name, token));
  socket.on('joinRoom', ({ code, name, token }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) return socket.emit('errorMsg', 'Kode room tidak ditemukan.');
    if (room.G.started) return socket.emit('errorMsg', 'Match sudah dimulai.');
    joinRoom(room, name, token);
  });
  socket.on('quickMatch', ({ name, token }) => {
    let room = [...rooms.values()].find(r => !r.G.started && r.G.slots.some(s => s.type === 'open'));
    if (!room) room = createRoom();
    joinRoom(room, name, token);
  });
  socket.on('setKaum', ({ kaum }) => { const room = roomOf(socket); if (!room) return; E.setKaum(room.G, socket.id, kaum); broadcastLobby(room); });
  socket.on('chooseTeam', ({ team }) => {
    const room = roomOf(socket); if (!room) return;
    const nf = E.setTeam(room.G, socket.id, team);
    if (nf !== false) { socket.emit('joined', { code: room.code, faction: nf }); broadcastLobby(room); }
    else socket.emit('errorMsg', 'Tim itu sudah penuh / nonaktif.');
  });
  socket.on('kick', ({ faction }) => {
    const room = roomOf(socket); if (!room || room.G.hostId !== socket.id) return;
    const sid = E.kickSlot(room.G, socket.id, faction);
    if (sid) { io.to(sid).emit('kicked'); const ks = io.sockets.sockets.get(sid); if (ks) { ks.leave(room.code); ks.data.code = null; } broadcastLobby(room); }
  });
  socket.on('toggleTeam', ({ team, off }) => {
    const room = roomOf(socket); if (!room || room.G.hostId !== socket.id) return;
    const r = E.setTeamActive(room.G, socket.id, team, off);
    if (!r.ok) return socket.emit('errorMsg', 'Tidak bisa — minimal 2 tim harus aktif.');
    r.kicked.forEach(sid => { io.to(sid).emit('kicked'); const ks = io.sockets.sockets.get(sid); if (ks) { ks.leave(room.code); ks.data.code = null; } });
    broadcastLobby(room);
  });
  socket.on('startGame', () => {
    const room = roomOf(socket); if (!room) return;
    if (room.G.hostId !== socket.id || room.G.started) return;  // hanya host
    E.startGame(room.G);
    io.to(room.code).emit('started');
    broadcastState(room);
    startLoop(room);
  });

  // ---- intent saat main ----
  socket.on('build',       ({ vid, key })         => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.queueBuild(r.G, f, vid, key); });
  socket.on('cancelBuild', ({ vid, i })           => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.cancelBuild(r.G, f, vid, i); });
  socket.on('train',       ({ vid, unit, count }) => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.queueTrain(r.G, f, vid, unit, count); });
  socket.on('cancelTrain', ({ vid, i })           => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.cancelTrain(r.G, f, vid, i); });
  socket.on('rename',      ({ vid, name })         => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.renameVillage(r.G, f, vid, name); });
  socket.on('send', ({ fromId, toId, units, mission }) => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.sendArmy(r.G, f, fromId, toId, units, mission); });
  socket.on('sendRes', ({ fromId, toId, amount }) => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.sendResource(r.G, f, fromId, toId, amount); });
  socket.on('marketSwap',   ({ vid, giveRes, getRes, giveAmt })           => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null && !E.marketSwap(r.G, f, vid, giveRes, getRes, giveAmt)) socket.emit('errorMsg', 'Tukar gagal — perlu Pasar & sumber daya cukup.'); });
  socket.on('marketPost',   ({ vid, giveRes, giveAmt, wantRes, wantAmt }) => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null && !E.marketPost(r.G, f, vid, giveRes, giveAmt, wantRes, wantAmt)) socket.emit('errorMsg', 'Tawaran gagal — perlu Pasar, tiap sisi min 10, & sumber daya cukup.'); });
  socket.on('marketAccept', ({ vid, offerId })                            => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null && !E.marketAccept(r.G, f, vid, offerId)) socket.emit('errorMsg', 'Terima gagal — perlu Pasar & sumber daya cukup.'); });
  socket.on('marketCancel', ({ offerId })                                 => { const r = roomOf(socket), f = myFaction(socket); if (r && f != null) E.marketCancel(r.G, f, offerId); });
  // ---- chat & ping ke sesama tim ----
  function toTeam(room, team, ev, data) { for (const sm of room.G.slots) if (sm.type === 'human' && sm.socketId && E.teamOf(sm.faction) === team) io.to(sm.socketId).emit(ev, data); }
  socket.on('chat', ({ msg }) => {
    const room = roomOf(socket), f = myFaction(socket); if (!room || !room.G.started || f == null) return;
    const text = String(msg || '').slice(0, 60); if (!text) return;
    toTeam(room, E.teamOf(f), 'chat', { from: (room.G.slots[f] || {}).name || 'Pemain', team: E.teamOf(f), msg: text });
  });
  socket.on('ping', ({ vid }) => {
    const room = roomOf(socket), f = myFaction(socket); if (!room || !room.G.started || f == null) return;
    const v = room.G.villages.find(x => x.id === vid); if (!v) return;
    toTeam(room, E.teamOf(f), 'ping', { from: (room.G.slots[f] || {}).name || 'Pemain', team: E.teamOf(f), x: v.x, y: v.y, name: v.name });
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket); if (!room) return;
    E.leaveSlot(room.G, socket.id);
    if (room.G.hostId === socket.id) { const h = room.G.slots.find(s => s.type === 'human' && s.socketId); room.G.hostId = h ? h.socketId : null; }
    if (!room.G.started) {
      if (room.G.slots.every(s => s.type !== 'human')) { rooms.delete(room.code); return; }
      broadcastLobby(room);
    } else if (!room.G.slots.some(s => s.type === 'human' && s.socketId)) {
      room._emptyAt = Date.now();   // semua pemain putus saat main; beri tenggang ~2 menit untuk reconnect sebelum room ditutup
    }
  });
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  PERANG KAUM server jalan di port ' + PORT);
  console.log('  Lokal:  http://localhost:' + PORT);
  console.log('========================================');
});
