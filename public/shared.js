/* =======================================================================
   DATA BERSAMA (server & klien) — EKONOMI PENUH + PETA HEXAGON.
   Konstanta + util hex. Modul Node & global browser (window.SHARED).
   ======================================================================= */
(function (root) {
  const CONFIG = {
    MATCH_MINUTES: 30,
    endOnTime: true,         // timer 30 menit AKTIF untuk publik (ubah ke false saat mau tes lama)
    dominationPct: 0.60,     // menang jika satu tim menguasai >=60% desa di peta
    fortHoldSec: 180,        // menang jika tahan Benteng pusat 3 menit berturut (king of the hill)
    TICK_MS: 250,
    startRes: { kayu: 600, liat: 600, besi: 400 },
    startTroops: { tombak: 20, pedang: 10 },
    baseStorage: 1200,
    basePop: 200,
    buildQueueMax: 5,
    MARKET: { fee: 1.1, maxOffers: 6, minAmt: 10 },   // tukar sistem: bayar fee× dapat 1; tawaran pemain rasio bebas
    loyaltyRegenPerMin: 2,
    HOME_DEF_BONUS: 1.30, FORT_DEF_BONUS: 1.40,
    PTS_HOME: 3, PTS_VILLAGE: 1, PTS_FORT: 5,
    // desa netral berekonomi (untuk dijarah)
    neutralStartLoot: { kayu: 400, liat: 400, besi: 300 },
    neutralLootRate: 1.4,          // pertumbuhan loot/detik tiap sumber daya
    neutralLootCap: 3000,          // batas timbunan tiap sumber daya
    neutralDefRegenPerMin: 6,      // penjaga netral pulih perlahan (tombak/menit)
    // AI (jarang menyerang)
    aiGraceMin: 4, aiCooldown: [45, 110], aiChance: 0.45, aiEdge: 1.6, aiMinArmy: 25, aiSendFrac: 0.6, aiCap: 600,
    neutralStartCount: 16,
    spawnWaves: [
      { min: 5, count: 4, tier: 'low' }, { min: 10, count: 3, tier: 'low' }, { min: 15, count: 3, tier: 'low' },
      { min: 20, count: 3, tier: 'mid' }, { min: 23, count: 3, tier: 'mid' }, { min: 26, count: 2, tier: 'mid' },
      { min: 29, count: 3, tier: 'high' }, { min: 30, count: 2, tier: 'high' },
    ],
    neutralTiers: {
      low:  { lvl: 2, wall: 1, def: { tombak: 25, pedang: 10 },                         loot: 300 },
      mid:  { lvl: 5, wall: 3, def: { tombak: 60, pedang: 30, kapak: 15 },              loot: 900 },
      high: { lvl: 9, wall: 6, def: { tombak: 150, pedang: 80, kapak: 40, ringan: 20 }, loot: 2200 },
    },
  };

  // ---- PETA HEXAGON ----
  const HEX = {
    R: 5,            // radius peta (radius 5 = 91 hex)
    SEC: 2.3,        // detik tempuh per 1 hex (cepat)
    size: 1,         // ukuran hex (center→corner)
    all(R) { R = R || HEX.R; const out = []; for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) out.push({ q, r }); return out; },
    dist(a, b) { return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2; },
    pixel(q, r) { return { x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r }; },
    ring(R) {
      if (R <= 0) return [{ q: 0, r: 0 }];
      const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      const out = []; let q = dirs[4][0] * R, r = dirs[4][1] * R;
      for (let i = 0; i < 6; i++) for (let j = 0; j < R; j++) { out.push({ q, r }); q += dirs[i][0]; r += dirs[i][1]; }
      return out;
    },
  };

  const KAUM = [
    { id:'pengrajin', ic:'🏗️', nm:'Kaum Pengrajin', tg:'Ahli Bangun',   ds:'Membangun jauh lebih cepat & murah.' },
    { id:'penyerbu',  ic:'⚔️', nm:'Kaum Penyerbu',  tg:'Garis Depan',   ds:'Serangan pasukan lebih kuat.' },
    { id:'penjaga',   ic:'🛡️', nm:'Kaum Penjaga',   tg:'Benteng Kokoh', ds:'Pertahanan & Tembok lebih tangguh.' },
    { id:'pedagang',  ic:'💰', nm:'Kaum Pedagang',  tg:'Lumbung Emas',  ds:'Produksi sumber daya lebih melimpah.' },
    { id:'penunggang',ic:'🐎', nm:'Kaum Penunggang',tg:'Angin Padang',  ds:'Kavaleri lebih murah & pasukan bergerak cepat.' },
    { id:'penakluk',  ic:'👑', nm:'Kaum Penakluk',  tg:'Perebut Tanah', ds:'Bangsawan lebih murah & lebih ampuh menaklukkan.' },
  ];

  const BUILDINGS = {
    markas:  {nm:'Markas Utama',     ic:'🏛️', max:10, base:{kayu:90,liat:80,besi:70},     cf:1.40, time:30, ds:'Pusat desa. Mempercepat semua pembangunan.'},
    kayu:    {nm:'Penebang Kayu',    ic:'🪓', max:10, base:{kayu:50,liat:60,besi:20},     cf:1.35, time:18, prod:'kayu', ds:'Memproduksi kayu.'},
    liat:    {nm:'Galian Tanah Liat',ic:'🧱', max:10, base:{kayu:65,liat:50,besi:20},     cf:1.35, time:18, prod:'liat', ds:'Memproduksi tanah liat.'},
    besi:    {nm:'Tambang Besi',     ic:'⛏️', max:10, base:{kayu:75,liat:65,besi:40},     cf:1.35, time:20, prod:'besi', ds:'Memproduksi besi.'},
    lumbung: {nm:'Peternakan',       ic:'🌾', max:10, base:{kayu:45,liat:40,besi:30},     cf:1.35, time:18, ds:'Menambah kapasitas penduduk (batas pasukan).'},
    gudang:  {nm:'Gudang',           ic:'🏚️', max:10, base:{kayu:60,liat:50,besi:40},     cf:1.35, time:18, ds:'Menambah kapasitas simpan sumber daya.'},
    barak:   {nm:'Barak',            ic:'⚔️', max:10, base:{kayu:200,liat:170,besi:90},   cf:1.38, time:40, ds:'Melatih infanteri; makin tinggi makin cepat.'},
    kandang: {nm:'Kandang Kuda',     ic:'🐎', max:10, base:{kayu:270,liat:240,besi:260},  cf:1.38, time:55, req:{barak:3}, ds:'Melatih kavaleri ringan & berat.'},
    bengkel: {nm:'Bengkel',          ic:'🛠️', max:10, base:{kayu:300,liat:240,besi:260},  cf:1.38, time:60, req:{barak:4}, ds:'Pasukan khusus: Pendobrak (peroboh Tembok) & Mata-mata.'},
    akademi: {nm:'Akademi',          ic:'👑', max:3,  base:{kayu:1500,liat:1300,besi:1200},cf:1.5,  time:120,req:{markas:6}, ds:'Melatih Bangsawan untuk menaklukkan desa.'},
    tembok:  {nm:'Tembok',           ic:'🧱', max:10, base:{kayu:80,liat:120,besi:30},    cf:1.38, time:30, ds:'Memperkuat pertahanan desa.'},
    pasar:   {nm:'Pasar',            ic:'⚖️', max:10, base:{kayu:100,liat:100,besi:100},  cf:1.35, time:30, req:{markas:3}, ds:'Buka tab Pasar: tukar & dagang sumber daya.'},
    pandai:  {nm:'Pandai Besi',      ic:'🔨', max:10, base:{kayu:220,liat:180,besi:240},  cf:1.38, time:45, req:{barak:3}, ds:'Menempa: pasukan lebih kuat & Mata-mata mengintip lebih dalam.'},
    menara:  {nm:'Menara Pengawas',  ic:'🗼', max:10, base:{kayu:120,liat:120,besi:80},   cf:1.38, time:40, req:{markas:5}, ds:'Melihat pasukan musuh yang menuju desamu.'},
    rally:   {nm:'Tempat Berkumpul', ic:'🚩', max:1,  base:{kayu:110,liat:100,besi:90},   cf:1.0,  time:12, ds:'Mengatur & mengirim pasukan.'},
  };
  const RES = ['kayu', 'liat', 'besi'];
  const RES_IC = { kayu:'🪵', liat:'🧱', besi:'⚙️' };
  const RES_NM = { kayu:'Kayu', liat:'Tanah Liat', besi:'Besi' };

  // unit: + 'carry' = kapasitas angkut hasil jarah
  const UNITS = {
    tombak:    {nm:'Tombak',          ic:'🔱', b:'barak',   cost:{kayu:50,liat:30,besi:20},     pop:1, time:5,  atk:10,  dInf:25, dCav:45, spd:18, carry:25, ds:'Murah. Perisai melawan kavaleri.'},
    pedang:    {nm:'Pedang',          ic:'🗡️', b:'barak',   cost:{kayu:30,liat:30,besi:70},     pop:1, time:7,  atk:25,  dInf:50, dCav:15, spd:22, carry:15, ds:'Kuat bertahan vs infanteri.'},
    kapak:     {nm:'Kapak',           ic:'🪓', b:'barak',   cost:{kayu:60,liat:30,besi:40},     pop:1, time:6,  atk:45,  dInf:10, dCav:5,  spd:18, carry:10, ds:'Penyerang infanteri ganas.'},
    ringan:    {nm:'Kavaleri Ringan', ic:'🐎', b:'kandang', cost:{kayu:125,liat:100,besi:250},  pop:4, time:15, atk:115, dInf:30, dCav:40, spd:10, carry:80, cav:true, ds:'Cepat, perampok hebat (angkut banyak jarahan).'},
    berat:     {nm:'Kavaleri Berat',  ic:'🛡️', b:'kandang', cost:{kayu:200,liat:150,besi:550},  pop:6, time:25, atk:150, dInf:200,dCav:80, spd:11, carry:50, cav:true, ds:'Mahal, pertahanan tinggi.'},
    pendobrak: {nm:'Pendobrak',       ic:'🪵', b:'bengkel', cost:{kayu:300,liat:200,besi:200},  pop:5, time:30, atk:2,   dInf:20, dCav:50, spd:30, carry:0,  ram:true, ds:'Merobohkan Tembok lawan.'},
    mata:      {nm:'Mata-mata',       ic:'🕵️', b:'bengkel', cost:{kayu:80,liat:50,besi:30},     pop:1, time:8,  atk:0,   dInf:0,  dCav:0,  spd:8,  carry:0,  spy:true, ds:'Mengintip desa lain (lewat tombol Intip). Hanya beradu dengan mata-mata musuh.'},
    bangsawan: {nm:'Bangsawan',       ic:'👑', b:'akademi', cost:{kayu:6000,liat:7000,besi:7000}, pop:80, time:70, atk:30, dInf:100, dCav:50, spd:35, carry:0, noble:true, ds:'Menaklukkan desa (menurunkan loyalitas).'},
  };
  const UNIT_KEYS = Object.keys(UNITS);

  const TEAM_COLORS = ['#4a90e2', '#e2574a', '#5bb85b', '#e0a93a'];
  const TEAM_NAMES  = ['Biru', 'Merah', 'Hijau', 'Kuning'];
  const HOME_NAMES = ['Wijaya','Sentosa','Maharaja','Garuda','Singa Hitam','Elang','Naga Api','Banteng'];

  const SHARED = { CONFIG, HEX, KAUM, BUILDINGS, RES, RES_IC, RES_NM, UNITS, UNIT_KEYS, TEAM_COLORS, TEAM_NAMES, HOME_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = SHARED;
  else root.SHARED = SHARED;
})(typeof window !== 'undefined' ? window : globalThis);
