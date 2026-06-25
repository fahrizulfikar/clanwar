# Perang Kaum — Online (ekonomi penuh)

Game strategi perang **2v2v2v2** multiplayer lewat browser/HP. Server otoritatif **Node.js + Socket.IO** (semua perhitungan di server agar adil & anti-cheat).

**Isi versi ini:** bangun & upgrade desa (**15 bangunan**: Markas, Penebang Kayu, Galian, Tambang, Peternakan, Gudang, Barak, Kandang, Bengkel, Akademi, Tembok, Pasar, Pandai Besi, Menara, Tempat Berkumpul), 3 sumber daya, **7 unit** (tombak, pedang, kapak, kavaleri ringan/berat, pendobrak, bangsawan), peta dengan desa netral & benteng, **penaklukan** (duduki desa netral dengan menang; rebut desa pemain lain pakai **Bangsawan**), fog-of-war via **Menara**, dan AI mengisi slot kosong.

---

## 0) Yang kamu butuhkan
- **Node.js 18+** — download LTS dari https://nodejs.org (gratis). Cek dengan `node -v`.

## 1) Jalankan di komputermu
1. Letakkan folder `perang-kaum-online` di komputermu.
2. Buka terminal di folder itu (di Windows: buka folder lewat File Explorer, klik kolom alamat, ketik `cmd`, Enter).
3. `npm install`  (sekali saja)
4. `npm start`
5. Buka **http://localhost:3000**. Untuk uji multiplayer di 1 PC, buka tab kedua dan Quick Match / Gabung dengan kode yang sama. Slot kosong diisi AI saat host menekan **Mulai Perang**.

## 2) Main satu WiFi (LAN)
- Cari IP host: Windows `ipconfig` (IPv4, mis. `192.168.1.10`); Mac/Linux `ifconfig`.
- Teman membuka `http://192.168.1.10:3000` (ganti IP host), masuk pakai kode room.

## 3) Main dengan teman JARAK JAUH (cepat: ngrok)
1. Install ngrok: https://ngrok.com/download (set authtoken sesuai instruksi mereka).
2. `npm start` (server jalan), lalu di terminal kedua: `ngrok http 3000`.
3. Bagikan URL `https://...ngrok-free.app` ke teman → mereka buka & masuk kode room.

## 4) Deploy permanen GRATIS (Render)
1. Upload folder ke GitHub (repo baru).
2. render.com → New → Web Service → hubungkan repo.
3. Build Command `npm install`, Start Command `npm start`. Server membaca `process.env.PORT` (sudah didukung).
   (Paket gratis "tidur" saat idle — kunjungan pertama loading beberapa detik.)
Alternatif: Railway / Fly.io (langkah serupa).

---

## 5) Cara bermain
1. **Menu:** isi nama → Quick Match / Buat Room / Gabung (kode). **Lobby:** ketuk **tim** mana pun yang punya slot kosong untuk pindah (atau tombol **🎲 Tim Acak**), pilih kaum (kaum-mu **dirahasiakan** dari pemain lain), host menekan **Mulai Perang**.
   - **Host** (pembuat room): tombol **✕** untuk **keluarkan** pemain, dan **Matikan/Aktifkan** tiap tim. Matikan 1 tim → **2v2v2** (6 pemain), matikan 2 tim → **2v2** (4 pemain). Minimal 2 tim tetap aktif. Slot kosong di tim aktif diisi AI.
2. **Tab Desa:** semua bangunan **maks Level 10** (cepat, tak buang waktu). Mulai dari ekonomi (Penebang Kayu / Galian / Tambang), lalu Markas, Gudang, Peternakan, lalu **Barak**. Lv10 ekonomi = sekuat Lv25 versi lama.
3. **Tab Pasukan:** latih unit. Tombak/Pedang untuk bertahan, Kapak/Kavaleri untuk menyerang. **Bengkel→Pendobrak** (peroboh Tembok), **Akademi→Bangsawan** (penakluk).
4. **Tab Peta:** tap **desa lawan/netral** → pilih sumber & jumlah unit → **Serang**; tap desa **timmu** → **Dukung**.
   - **Duduki desa netral** = bawa **1 Bangsawan** (menang + 1 Bangsawan = langsung diduduki). Tanpa Bangsawan hanya **menjarah**.
   - Merebut **desa pemain lain** = butuh **Bangsawan** (menurunkan loyalitas hingga 0).
   - Bawa **Pendobrak** untuk merobohkan Tembok lebih dulu.
5. **Tab Pasar** (butuh bangunan **Pasar**, perlu Markas Lv3): **Tukar dengan Sistem** (kurs 1,1 : 1 — bayar 1,1× dapat 1, langsung masuk gudang) atau **Buat Tawaran** ke semua pemain dengan rasio bebas (sumber daya yang kamu beri ditahan sampai diterima/dibatalkan). Semua dagang **instan**.
6. **Tab Laporan:** hasil pertempuran (serangan & pertahananmu).
7. **Menang:** kuasai desa terbanyak saat 30 menit habis, **atau** singkirkan semua tim lawan.

**Kaum:** Pengrajin (−25% biaya/waktu bangun), Penyerbu (+25% serang), Penjaga (+25% tahan & Tembok), Pedagang (+30% produksi), Penunggang (kavaleri murah & gerak cepat), Penakluk (Bangsawan murah & lebih ampuh).

---

## 6) Struktur file
```
perang-kaum-online/
├─ package.json        ← perintah & library (npm start)
├─ server.js           ← server: lobby/room + broadcast per-pemain + loop
├─ server/engine.js    ← OTAK game (ekonomi, tempur, penaklukan, AI, menang)
├─ public/
│  ├─ index.html       ← tampilan: menu, lobby, Desa/Pasukan/Peta/Laporan
│  └─ shared.js        ← data game (bangunan, unit, kaum, peta) dipakai server & klien
└─ README.md
```
Semua angka balancing ada di **`public/shared.js`** (CONFIG, BUILDINGS, UNITS).

---

## 7) Catatan v1 & roadmap
- AI memakai model pertumbuhan (belum membangun ekonomi penuh seperti pemain) — cukup untuk lawan, akan diperdalam.
- Fog: pasukan musuh hanya terlihat bila kamu punya **Menara**.
- Berikutnya: AI yang berdagang & membangun ekonomi penuh, akun & peringkat, matchmaking otomatis.
