# 🌴 100 GÜN ORMANDA — Amazon Survival Horror

Amazon ormanının derinliklerinde **100 gün** hayatta kalmaya çalıştığın, atmosferik ve
**korkutucu** bir hayatta kalma–macera oyunu. Tarayıcıda çalışır — **kurulum yok**, hem
**PC** hem **mobil** (telefon/tablet) destekler.

> ⚠️ **UYARI:** Bu oyun bilinçli olarak **jump scare** ve ani yüksek sesler içerir.
> Korku öğeleri tasarımın merkezindedir. Sesi açık oynaman önerilir.

---

## ▶️ Nasıl Oynanır

Hiçbir şey kurmana gerek yok. Sadece dosyayı tarayıcıda aç:

```bash
# Proje klasöründe basit bir sunucu başlat (önerilir):
python3 -m http.server 8000
# sonra tarayıcıda aç:  http://localhost:8000
```

Ya da doğrudan `index.html` dosyasını çift tıklayarak tarayıcıda açabilirsin.
Telefonda oynamak için: aynı ağdaki bilgisayarın IP'sini kullan (`http://<pc-ip>:8000`)
veya dosyaları bir statik hosting'e (GitHub Pages, Netlify vb.) koy.

---

## 🎮 Kontroller

| Aksiyon | 🖥️ PC | 📱 Mobil |
|---|---|---|
| Hareket | `W A S D` / Ok tuşları | Sol **joystick** |
| Bakış yönü | **Fare** (etrafına bak) | Joystick yönü |
| Koş | `Shift` | **KOŞ** butonu |
| Vur (odun kes / avlan) | `E` veya `Boşluk` / Sol tık | **VUR** butonu |
| Ateş yak / odun ekle | `F` | **🔥** butonu |
| Ye | `G` | **🍗** butonu |
| Duraklat | `Esc` | ⏸ butonu |

> 👁️ **İPUCU:** Ağaçların arasında seni izleyen **uzun, kanlı adama** doğru **bak** — o
> zaman kaybolur. Ona sırtını dönersen akıl sağlığını emer.

---

## 🎯 Amaç ve Mekanikler

- **100 gün hayatta kal.** Her gün-gece döngüsü geçtikçe sayaç artar; 100. günü
  tamamlarsan kazanırsın.
- **5 hayatta kalma çubuğu** dengede tutulmalı:
  - ❤️ **Sağlık** — sıfırlanırsa ölürsün.
  - 🍖 **Açlık** — düşerse sağlığın erir. Et ve yaban mersini ye.
  - 🔥 **Sıcaklık** — geceleri düşer, ateş başında yükselir. Donma öldürür.
  - 🧠 **Akıl Sağlığı** — karanlık, yalnızlık ve **İzleyen** düşürür; ateş başında
    iyileşir. Sıfırlanırsa kâbus başlar ve sağlığın erir.
  - ⚡ **Enerji** — koşunca tükenir.
- **Odun kes** 🪓 → ağaçlara vur, odun topla.
- **Ateş yak** 🔥 → 5 odunla kamp ateşi kur. Ateş ışık + sıcaklık + akıl sağlığı verir,
  jaguarları korkutur ve **çiğ eti pişirir** (ateşin yanında dur).
- **Avlan** ⚔️ → kapibara, geyik, tapir avla; yaban domuzu sana saldırır; geceleri
  **jaguar** seni avlamaya gelir (gerçek tehlike!).
- **Ye** 🍗 → pişmiş et en iyisi; çiğ et seni hasta edebilir.

---

## 👁️ Korku Sistemi

- **İzleyen (uzun, kanlı adam):** Bazı günler — özellikle **geceleri** — ağaçların
  arasında, hareketsiz, sana bakarak belirir. **Ona baktığın an kaybolur.** Bakmazsan
  yaklaşır, akıl sağlığını emer ve yeterince yaklaşırsa üzerine **atlar (jumpscare)**.
  Akıl sağlığın düştükçe daha sık gelir.
- **Gece jump scare'leri:** Karanlıkta, akıl sağlığın düşükken aniden ekranı kaplayan
  korkunç bir yüz + çığlık sesi + ekran sarsıntısı. İlk gece garantili bir korkutma seni
  bekliyor.
- **Atmosfer:** Dar görüş çemberi, dinamik karanlık, kalp atışı (tehlike yaklaşınca
  hızlanır), fısıltılar, akıl sağlığı düşünce ekran bozulması, prosedürel ses motoru
  (ortam uğultusu, rüzgar, ateş çıtırtısı, hırıltı).

---

## 🛠️ Teknik

- **Saf JavaScript + HTML5 Canvas 2D.** Çerçeve/derleme gerektirmez, bağımlılık yok.
- **Web Audio API** ile tüm sesler **prosedürel** üretilir (ses dosyası yok → hızlı yüklenir).
- Tek dosya motor: `game.js`. Arayüz: `index.html` + `style.css`.
- Mobil + masaüstü duyarlı; dokunmatik ve klavye/fare otomatik algılanır.

```
.
├── index.html   # arayüz, HUD, menüler, mobil kontroller
├── style.css    # karanlık korku teması, mobil uyumlu
└── game.js      # oyun motoru: hayatta kalma + korku + ses
```

---

## 🌐 "Crossplay / Multiplayer" Hakkında (Dürüst Not)

Şu an oyun **tek cihazda** oynanır ama **her platformda** çalışır: aynı oyun PC
tarayıcısında da, telefon tarayıcısında da açılır (gerçek **cross-platform** budur —
kurulum yok). Arkadaşlarınla aynı dünyada **gerçek zamanlı 5 kişilik ağ üzerinden co-op**
ise bir **sunucu/eşler-arası bağlantı** gerektirir; bunu sağlam yapmadan eklemek istemedim.

**Sıradaki adım (isteğe bağlı):** WebRTC (PeerJS) ile **5 kişiye kadar P2P co-op** — bir
kişi "oda" kurar, diğerleri linkle katılır; oyuncular, can/açlık paylaşımı ve İzleyen'i
herkesin aynı anda görmesi senkronize edilir. İstersen bunu bir sonraki sürümde ekleyeyim.

## 🗺️ Yol Haritası
- [ ] WebRTC ile 5 kişilik gerçek zamanlı co-op
- [ ] Kalıcı kayıt (localStorage) — kaldığın günden devam
- [ ] Daha fazla eşya: barınak/çadır, mızrak, tuzak, meşale
- [ ] Yağmur, sis ve fırtına gibi hava olayları
- [ ] Daha fazla korku senaryosu ve "İzleyen" varyasyonları

---

🤖 Geliştirici notu: Hızlı, kurulumsuz ve gerçekten korkutucu olması için 2D atmosferik
yaklaşım seçildi. "Aşırı gerçekçi" 3B/AAA görünüm ayrı bir motor (Unity/Unreal) işidir;
istenirse o yöne de bir prototip planı çıkarılabilir.
