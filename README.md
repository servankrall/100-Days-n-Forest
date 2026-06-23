# 🌴🔪 100 GÜN ORMANDA — 3B Survival Horror (Masaüstü Uygulaması)

Amazon ormanının derinliklerinde **100 gün** hayatta kalmaya çalıştığın, **gerçek 3B**,
ilk-şahıs, atmosferik ve **korkutucu** bir hayatta kalma-macera oyunu.

> Bu bir **website değil** — gerçek bir **uygulama**. Three.js (WebGL 3B) ile yapılıp
> **Electron** ile native masaüstü uygulamasına paketlenir (Discord / VS Code gibi).
> **Unity kullanılmadı.** Çift tıklayıp açılan bir `.exe` / `.AppImage` / `.dmg` üretir.

> ⚠️ **UYARI:** Oyun bilinçli **jump scare** ve ani yüksek sesler içerir. Korku öğeleri
> tasarımın merkezindedir. Kulaklık + ses açık önerilir.

---

## ▶️ Çalıştırma (Masaüstü Uygulaması)

Gereken tek şey [Node.js](https://nodejs.org) (18+).

```bash
npm install      # Three.js + Electron'u indirir
npm start        # oyunu native bir pencerede açar
```

İlk açılışta **BAŞLA**'ya bas; fare ekrana kilitlenir (Esc ile bırakılır).

### Kurulabilir dosya (.exe / .AppImage / .dmg) üretmek

```bash
npm run dist          # bulunduğun işletim sistemi için
npm run dist:win      # Windows kurulum sihirbazı (.exe)
npm run dist:linux    # Linux (.AppImage)
npm run dist:mac      # macOS (.dmg)
```

Çıktılar `dist/` klasöründe oluşur.

---

## 🎮 Kontroller

| Aksiyon | 🖥️ PC | 📱 Mobil |
|---|---|---|
| Etrafa bak | **Tıkla** (fareyi kilitle) + fareyi oynat | Sağ ekranı **sürükle** |
| Hareket | `W A S D` | Sol **joystick** |
| Koş | `Shift` | **KOŞ** butonu |
| Vur (odun kes / avlan) | **Sol tık** veya `E` | **VUR** butonu |
| Ateş yak / odun ekle | `F` | **🔥** butonu |
| Ye | `G` | **🍗** butonu |
| Fareyi bırak / Duraklat | `Esc` / ⏸ | ⏸ butonu |
| Tam ekran / Konsol | `F11` / `F12` | — |

> 👁️ **İPUCU:** Geceleri ağaçların arasında seni izleyen **uzun, kanlı adama** doğru
> nişan al / **bak** — o zaman kaybolur. Bakmazsan akıl sağlığını emer ve üstüne atlar.

---

## 🎯 Amaç & Mekanikler

- **100 gün hayatta kal.** Gerçek 3B gündüz-gece döngüsü; 100. günü tamamla = kazandın.
- **5 hayatta kalma çubuğu:** ❤️ Sağlık · 🍖 Açlık · 🔥 Sıcaklık · 🧠 Akıl Sağlığı · ⚡ Enerji.
- **Odun kes** → ağaca bak ve VUR. **Ateş yak** (5 odun) → ışık, sıcaklık, akıl sağlığı,
  jaguarları korkutur ve **çiğ eti pişirir** (ateşin yanında dur).
- **Avlan:** kapibara, geyik, tapir; yaban domuzu saldırır; geceleri **jaguar** seni avlar.
- **Ye:** pişmiş et en iyisi; çiğ et seni hasta edebilir.

## 👁️ Korku Sistemi

- **İzleyen (uzun, kanlı adam):** Geceleri ağaçların arasında, hareketsiz, sana bakarak
  belirir — **3B'de doğrudan ona baktığında kaybolur.** Bakmazsan yaklaşır, akıl sağlığını
  emer ve yeterince yaklaşınca **üstüne atlar (jumpscare).**
- **Gece jump scare'leri:** Ekranı kaplayan kanlı yüz + çığlık + ekran sarsıntısı.
  İlk gece **garantili** bir korkutma seni bekliyor.
- **Atmosfer:** Yoğun gece sisi, kafa lambası ışığıyla dar görüş, kalp atışı (tehlike
  yaklaşınca hızlanır), fısıltılar, akıl sağlığı düşünce ekran bozulması, tamamen
  **prosedürel** ses motoru (uğultu, rüzgar, ateş çıtırtısı, hırıltı, çığlık).

---

## 🗂️ Proje Yapısı

```
.
├── package.json           # bağımlılıklar + electron-builder + mobil scriptler
├── main.js                # Electron ana süreç (native masaüstü pencere)
├── index.html             # uygulama arayüzü (importmap → yerel Three.js)
├── app.css                # karanlık korku teması, mobil uyumlu
├── vite.config.mjs        # mobil için web paketleyici (www/ üretir)
├── capacitor.config.json  # Android sarmalayıcı ayarı (webDir: www)
├── src/
│   └── game3d.js          # 3B oyun motoru: orman + hayatta kalma + korku + ses
├── web-2d/                # hafif 2B tarayıcı sürümü (yedek/hızlı oyna)
├── www/                   # (üretilen) Vite paketi — git'te yok
└── android/               # (üretilen) Capacitor Android projesi — git'te yok
```

- **Bağımlılık:** sadece `three` (çalışma) + `electron`, `electron-builder` (geliştirme).
- 3B render: Three.js / WebGL. Sesler Web Audio API ile prosedürel (ses dosyası yok).
- `index.html` `three`'yi **import map** ile yerel `node_modules`'tan yükler — paketleyici (bundler) gerekmez.

---

## 📱 Mobil Uygulama (Android APK)

Aynı 3B kod **dokunmatik** kontrolleri (joystick + sürükleyerek bakış) zaten içeriyor.
Capacitor + Vite kurulumu **hazır ve doğrulandı** — web varlıkları Vite ile tek pakete
derlenip (`www/`) Android projesine gömülüyor.

**Ön koşul:** [Android Studio](https://developer.android.com/studio) (içinde Android SDK +
JDK 17 gelir).

```bash
npm install            # (bir kez) tüm bağımlılıklar
npm run mobile:add     # (bir kez) www/ derler + android/ native projesini oluşturur
npm run mobile:open    # her seferinde: derle + senkronla + Android Studio'da aç
```

Android Studio açıldığında: **Run ▶** (cihaz/emülatör) veya **Build > Build APK(s)**.

CLI'dan doğrudan APK (Android SDK kuruluysa, `android/` oluştuktan sonra):

```bash
npm run mobile:sync                       # son web derlemesini Android'e kopyalar
cd android && ./gradlew assembleDebug     # -> android/app/build/outputs/apk/debug/app-debug.apk
```

Cihaza/emülatöre doğrudan kurup çalıştırmak için: `npm run mobile:run`.

> Bu bulut ortamında `cap add android` adımına kadar her şey **çalıştırılıp doğrulandı**
> (Vite paketi `www/` + Android projesi + varlık kopyalama). Yalnızca son APK derlemesi
> Android SDK/Gradle gerektirdiği için senin makinende yapılır. İstersen özel uygulama
> ikonu/açılış ekranı da ekleyebilirim.

---

## 🗺️ Yol Haritası
- [x] Masaüstü uygulaması (Three.js + Electron).
- [x] Android paketleme altyapısı (Capacitor + Vite) — `cap add android`'e kadar doğrulandı.
- [ ] Özel uygulama ikonu + açılış ekranı (Android/masaüstü).
- [ ] **Çok oyunculu co-op (5 kişiye kadar)** — WebRTC ile; biri oda kurar, diğerleri katılır,
      İzleyen'i herkes aynı anda görür.
- [ ] Kalıcı kayıt (kaldığın günden devam).
- [ ] Barınak/çadır, mızrak, tuzak, meşale; yağmur/sis/fırtına; daha fazla korku senaryosu.

---

## 🧪 Doğrulama notu

3B render gerçek bir GPU/tarayıcı gerektirdiğinden ve bu ortam GUI/derleme aracı içermediğinden,
geliştirme sırasında: modül söz dizimi, **kullanılan tüm Three.js API'lerinin gerçekten var olduğu**
(r160) ve oyun **mantığı** (hareket+çarpışma, istatistikler, İzleyen, hayvanlar, gün döngüsü)
binlerce kare boyunca istisna/NaN olmadan otomatik test edildi. Görsel render'ı kendi makinende
`npm start` ile göreceksin.
