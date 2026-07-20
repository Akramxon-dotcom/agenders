
## Umumiy kelishuv
Loyihaga quyidagi katta modul qoʻshiladi. Ishlashi uchun **Lovable Cloud** yoqiladi (real-time sinxronizatsiya, sessiya, QR handshake, qurilmalar roʻyxati uchun kerak). Sen bu haqda tashvishlanma — sozlash avtomatik.

Telegram/Google login va barmoq izini xotirada saqlash — **qoʻshilmaydi** (senga eslab qolaman, keyinroq qoʻshamiz).

---

## 1. Dynamic PIN + Master/Secondary qurilma tizimi

**Master (asosiy) qurilma:**
- Birinchi kirganda "Bu qurilmani asosiy qilib belgilaymi?" deb soʻraladi.
- Ha → `isMasterDevice=true` localStorage-ga yoziladi.
- Keyingi kirishlarda faqat **Dynamic PIN** soʻraladi (joriy vaqt HHMM: 22:37 → `2237`, 09:20 → `0920`).
- Master qurilmada kirish sahifasida "📷 QR skanerlash" tugmasi bor.

**Secondary (yangi) qurilma:**
- QR-kodli sahifa ochiladi (skanerlash tugmasi yoʻq).
- QR har 60 soniyada yangilanadi, ichida `session_id` boʻladi.
- Realtime kutadi: master tasdiqlaguncha kutish, tasdiqlangach — sahifa yangilanmasdan asosiy sahifaga oʻtadi.

**Handshake:**
- Master QR-ni skanerlaydi → `session_id` Cloud-ga yuboriladi → Cloud secondary qurilmaga realtime SUCCESS xabar → secondary avtomatik kiradi.

---

## 2. Faol qurilmalar & masofadan chiqarish
- Sozlamalarda "Faol qurilmalar" boʻlimi.
- Har bir qurilma: User-Agent parse (Windows 11 — Chrome), IP, oxirgi faollik.
- "Chiqarib yuborish" tugmasi → realtime `FORCE_LOGOUT` → oʻsha qurilma sahifa yangilanmasdan QR sahifaga qaytadi.

---

## 3. Real-time data sinxronizatsiyasi
- Vazifalar, sozlamalar, kunlik bajarilish — bir foydalanuvchining hamma qurilmalarida realtime yangilanadi.
- Cloud (Postgres + Realtime) markaziy hisoblanadi, localStorage esa keshdan ibrat.
- Bir qurilmada oʻzgartirsa — boshqasida 1-2 soniyada koʻrinadi.

---

## 4. PIN kirish oqimi qayta ishlanadi
Ilova birinchi ochilganda: "PIN kirishni yoqasizmi? [Ha] [Yoʻq]"
- **Yoʻq** → parolsiz kiradi.
- **Ha** → PIN sozlanadi, keyin "Biometrikani ham yoqasizmi?" soʻraladi.
- Master qurilmada Dynamic PIN faol boʻlsa — foydalanuvchi belgilagan PIN oʻrniga vaqt-PIN ishlaydi (sozlamada tanlash mumkin).

---

## 5. Vazifa qoʻshish oynasi kengaytiriladi
Yangi "➕ Vazifa qoʻshish" oynasida:
- Nomi
- Boshlanish vaqti (soat/daqiqa)
- Tugash vaqti
- Kategoriya (roʻyxatdan; boʻsh → AI avto-aniqlaydi)
- Auto-select toggle + vaqt (bosilgan vaqtda vazifa avto-bajarildi belgisi + bildirishnoma)
- Muhimlik (past/oʻrta/yuqori)

**Toʻqnashuv mantiqi:**
- Belgilangan vaqtda boshqa vazifa bor va yangi vazifa **yuqori muhim** boʻlsa → eski vazifa 2 ga boʻlinadi ("Nomi (1-qism)", "Nomi (2-qism)"), orasiga yangi qoʻshiladi.
- Yangi vazifa oʻchirilsa — ikki qism yana bir vazifaga qayta birlashadi.

**Proporsional taqsimlash:**
- Har qanday vaqt oʻzgarishida (kun boshi/yakuni, vazifa qoʻshish/oʻchirish) — qolgan vazifalar teng foizda qisqaradi/kengayadi.

---

## 6. Kunlik koʻrinish (7 kunlik lenta)
- Topbarda namoz vaqtlari ostida **7 kunlik hafta lentasi** (Du-Ya).
- Faqat oʻtgan + bugungi kunni bosish mumkin, kelajak — bloklangan.
- Har kun oʻz vazifalari va bajarilish foizi bilan alohida saqlanadi.
- **Muhim:** yangi vazifa qoʻshsam, u faqat bugundan boshlab qoʻllanadi — oʻtgan kunlarning 100% foizi buzilmaydi.

---

## 7. Sozlamalarda "Chiqish" + 5-soniyalik bekor qilish
- Sozlamalarda "🚪 Chiqish" tugmasi.
- Bosilganda: modal + "Bekor qilish (5)" tugmasi va sanoq boshlanadi.
- 5 soniya ichida bekor qilinsa — hech nima soʻralmay qaytadi.
- Sanoq tugasa — sessiya oʻchadi, QR/PIN sahifasiga oʻtadi.

---

## 8. Xotirada saqlanadigan (hozircha qoʻshilmaydigan) narsalar
- Telegram bot orqali tasdiqlash (bot token allaqachon sozlangan).
- Google orqali kirish.
- Barmoq izini serverda saqlash.
- Maxfiy kod bilan 37 ta vazifani qaytarish + 3 xato → IP blok.

Sen keyinchalik "eski shu narsani qoʻshaylik" desang — men eslayman va qoʻshamiz.

---

## Texnik reja (qisqacha)
1. `supabase--enable` bilan Cloud yoqiladi.
2. Migratsiyalar: `devices`, `sessions`, `qr_sessions`, `user_data` (JSONB — vazifalar/sozlamalar), `daily_history` jadvallari + RLS.
3. `public/kun-tartibim.html` faylida:
   - Supabase JS clientni CDN orqali yuklash.
   - QR generatsiya (`qrcode` CDN) + skaner (`html5-qrcode` CDN).
   - Realtime channellar: `session:{id}`, `user:{userId}` uchun.
   - Boot oqimi: qurilma → master/secondary aniqlash → PIN/QR oqimi → asosiy ilova.
4. Vazifa qoʻshish modali + toʻqnashuv/split mantiqi.
5. 7-kunlik lenta UI + kunlik snapshot saqlash.
6. Sozlamalarga: Faol qurilmalar, Chiqish (5s bekor).

---

## Nima soʻrayman
1. **Master qurilma aniqlash:** birinchi kirishda "asosiy qurilma qilaymi?" soʻrash yaxshimi, yoki har doim manual sozlamada belgilash?
2. **Dynamic PIN faqat masterda ishlaydimi?** yoki oddiy sozlangan PIN bilan tanlov (radio) boʻlsinmi?
3. **Kategoriyalar roʻyxati:** Ish, Sport, Ovqat, Namoz, Uy ishi, Oʻqish, Dam olish, Boshqa — shu yetadimi, yoki qoʻshimcha?
