# 99 Nights in the Forest — Kapsamlı Rehber · BÖLÜM 2
### İleri, Gizli, Teknik ve Sistem-Tabanlı Mekanikler + Yönetici Paneli

> **Not:** Bölüm 1 (POI'ler, loot, baltalar, biyomlar, temel sistemler) ayrı dosyadadır. Bu bölüm
> standart hayatta kalma döngüsünün *dışındaki* derin mekaniklere odaklanır. Aşağıdaki bazı konular
> (respawn süreleri, netcode/desync davranışı, denge yaması geçmişi, aktif oyun kodları) **sürümle ve
> sunucuyla değişir**; bu yüzden sabit sayı uydurmak yerine **mekanik mantığını** anlatıyorum. Aktif
> kodlar hızla eskidiği için "şu an geçerli kod" listesi vermek yanıltıcı olur — nereden bulunacağını
> yazdım. Yönetici/geliştirici komutları yalnızca **yetkili adminler** içindir ve buraya oyun özelliği
> olarak (kavramsal) belgelenmiştir.

---

## A) ÖLÜM, EŞYA KAYBI VE GÜN ATLAMA (SLEEP) CEZASI

### ☠️ Death & Loot Drop (Ölünce Eşya Düşürme)
- **Temel mantık:** Karakter öldüğünde envanterindeki eşyaların bir kısmı (veya tamamı) **öldüğün
  noktaya yere düşer** (drop on death). Silahlar, hurdalar, malzemeler bir "çanta/mezar" yığını olarak
  yerde kalır.
- **Geri toplama (recovery):** Yeniden doğduğunda (veya arkadaşın seni dirilttiğinde) **ölüm noktasına
  geri gidip** düşen eşyalarını toplayabilirsin — ama bu bir **yarış**tır: yığın belirli bir süre sonra
  **kaybolur/despawn olur** ve o bölge tehlikeliyse (gece, uç biyom) eşyanı almadan tekrar ölebilirsin.
- **Risk hesabı:** Çok değerli eşya (Chainsaw, Rifle, bol mühimmat) taşırken ölmek ağır cezadır; bu
  yüzden "hepsini üstünde gezdirme" — kritik yedekleri **üsteki bir sandığa/depoya** koy. Uç biyoma
  girerken sadece o tur için gerekeni taşı.
- **Co-op farkı:** Takım oyununda ölüm genelde önce **downed (yere düşme)** durumudur; arkadaşın
  **bandajla** seni kaldırırsa eşya düşmez. Kimse yoksa/kimse ulaşamazsa tam ölüm + drop gerçekleşir.
  Tek başına oynarken bu daha ölümcüldür (kaldıracak kimse yok).

### 🛏️ Sleeping (Yatakta Uyuma) Mekaniği
Yatak kurup uyumak sadece "zamanı hızlandırmak" değildir; birkaç yan etkisi vardır:
- **Zaman ilerletme:** Uyku, geceyi/günü **hızlıca sabaha sarar**. Elinde yeterince ateş yakıtı varsa
  can sıkıcı geceyi "atlatmanın" hızlı yoludur.
- **Fırtına geçirme:** Dışarıda **fırtına** varsa, uyuyarak fırtınanın geçmesini sağlayabilirsin — yani
  yıldırım/yağmur baskısını beklemek yerine "uyu, sabah açık havada uyan" taktiği.
- **Savunmasızlık riski:** Uyurken **kontrol sende değildir**; o sırada üsse bir yaratık dalgası gelirse
  savunma yapamazsın. Bu yüzden uyku **yalnızca güvenli alandayken** (yanan ateş/meşale/totem yakını,
  yakında tehlike yokken) mantıklıdır. Zayıf bir üste uyumak, uyanınca duvarların yıkılmış/ateşin sönmüş
  olması demek olabilir.
- **Respawn'a etkisi:** Uyku günleri hızla ilerlettiği için, **kaynak yenilenmesini de dolaylı olarak
  hızlandırır** (aşağıdaki respawn algoritması "geçen güne" bağlı olduğundan). Yani "uyu → sabah
  ağaçlar/sandıklar tazelenmiş olsun" gibi bir kullanım mümkündür; ama bu, o gecelerin loot/keşif
  fırsatını da atlaman anlamına gelir (uyurken ganimet toplayamazsın).
- **Denge:** Uyku, "güvendeysen zamanı hızlandır, değilsen uyuma" mantığıyla tasarlanmıştır. En iyi
  kullanım: yakıtı bol, savunması sağlam bir üste, fırtınayı/tehlikesiz geceyi atlamak.

---

## B) KARAKTER VE HASAR SİSTEMLERİ

### 🛡️ Armor (Zırh) ve Hasar Azaltma
- **Defense Rating (Zırh puanı):** Oyunda can barının yanında bir de **zırh/savunma puanı** vardır.
  Sandıklardan çıkan ya da **kürklerle takas edilen** kıyafetler/askeri yelekler, karakterin aldığı
  hasarı **yüzde bazında azaltır** (örn. %20-%40 hasar azaltımı). Yani aynı ısırık, zırhlıyken daha az
  can götürür.
- **Katmanlar:** Farklı parçalar (yelek, kıyafet, kürk) farklı savunma oranı verir ve bazıları **ek
  fayda** taşır (örn. kürk giysi karlı biyomda hem hasar azaltır hem **donmayı yavaşlatır**).
- **Zırh Dayanıklılığı (Durability):** Zırh sonsuz değildir. Aldığın **her darbede zırhın koruma oranı
  azalır** ve yeterince hasar alınca **kırılır** (koruma sıfırlanır). Yani zırh bir "tampon"dur —
  yoğun dövüşten sonra tazelemen/değiştirmen gerekir. Kritik dövüşlere (boss, horde) **tam zırhla** gir,
  kırılınca yedeğini kuşan.
- **Taktik:** Zırh, "can potu" gibi düşünülmeli — düşük tehlikede yıpratma, yüksek tehlikede kullan.
  Kürk ekonomisi (avcılık) hem Pelt Trader hem zırh için çift değerlidir.

### 🎒 Envanter Ağırlığı ve Yavaşlama (Weight / Encumbrance)
- **Ağırlık sınırı:** Envanterde taşıdığın **tomruklar (log)** ve **ağır hurdalar (scrap)** bir ağırlık
  değeri taşır. Toplam ağırlık bir **limiti aşarsa**, karakterin **hareket hızı düşer** (encumbered/aşırı
  yüklü durumu). Yani "her şeyi topla" hep iyi değildir; aşırı yüklüyken yaratıklardan kaçmak zorlaşır.
- **Neden önemli:** Uç biyomdan (mağara/volkan) çıkarken tıka basa dolu olmak = yavaş = tehlikeli. Bu
  yüzden ağır kaynakları **partiler halinde** taşımak (özellikle Teleporter ağı varsa) mantıklıdır.
- **Backpack Upgrade (Çanta Geliştirmesi):** Sandıklardan çıkan sırt çantaları sadece **slot** açmaz;
  aynı zamanda **ağırlık limitini de rahatlatır** — yani daha çok ağır eşyayı yavaşlamadan taşırsın.
  İyi bir çanta, "her seferinde üsse dönme" zorunluluğunu azaltıp keşif verimini ciddi artırır. Bulur
  bulmaz kuşan; erken oyunun en sinsi verim yükseltmelerinden biridir.

---

## C) DÜNYA VE KAYNAK SİSTEMLERİ

### 🌲 Kaynak Yenilenme (Resource Respawn) Algoritması
- **Ağaçlar:** Kesilen ağaçlar **belirli bir süre sonra yeniden büyür** (respawn). Bu süre genelde
  **geçen gün sayısına** ve/veya **oyuncunun o bölgeden uzaklaşmasına** bağlıdır — yakınında dikilip
  beklersen tazelenmesi yavaşken, uzaklaşıp birkaç gün sonra döndüğünde orman yeniden dolu olur. Yani
  "aynı koruyu sürekli sömürme", **dönüşümlü** kes (bir bölgeyi kes, başka bölgeye geç, sonra geri dön).
- **Sandıklar:** Yapılardaki/evlerdeki sandıklar yağmalandıktan sonra **bir süre boş kalır** ve
  genelde **birkaç gün geçince yeniden loot ile dolar** (tam respawn süresi sürüme göre değişir).
  Bu yüzden erken günlerde yağmaladığın Safehouse/Church'e **birkaç gün sonra tekrar** uğramak,
  yeni loot bulmanı sağlar.
- **Biyom sınırları (önemli):** Özel biyomlardaki (**Volkanik, Karlı**) değerli kaynaklar ve sandıklar,
  normal ormana kıyasla **çok daha yavaş yenilenir**. Yani Ruby/Ice sandıkları veya nadir madenler bir
  kez alınınca uzun süre tekrar dolmaz — "orman bol ve hızlı tazelenir, uç biyomlar cimri ve yavaş"
  kuralı geçerlidir. Bu, uç biyom loot'unu **planlı** kullanmayı gerektirir.
- **Taktik:** Ormanı "yenilenebilir tarla" gibi dönüşümlü işlet; uç biyom kaynağını "sınırlı hazine"
  gibi düşün ve gerçekten gerekince harca.

### 🧱 Yapı Dayanıklılığı ve Tamir (Building Decay & Repair)
- **Decay (Aşınma):** Kurduğun **ahşap duvarlar (Log Wall)** ve **kapılar** sadece yaratık vurunca
  hasar almaz; **zaman geçtikçe** ve özellikle **fırtınalı havada** kendi kendine de **yavaşça aşınır**
  (decay). Yani "bir kez kur ve unut" olmaz — bakımsız bir üssün duvarları haftalarca dayanmaz.
- **Fırtına etkisi:** Fırtına hem ateşe hem yapılara baskı yapar; art arda fırtınalar duvarlarını
  beklediğinden hızlı yıpratabilir. Uzun süreli üste bu yüzden **paratoner + sağlam yapı + düzenli
  bakım** üçlüsü gerekir.
- **Hammer (Çekiç) ile Tamir:** Yapıları ayakta tutmak için **çekiç** kullanarak, belirli aralıklarla
  **odun ve hurda harcayıp** duvar/kapıları **tamir** etmen gerekir. Geç-oyun rutininin bir parçası
  "gündüz turu → ateşi besle → **duvarları çekiçle tamir et**" olmalıdır. İhmal edersen bir gece
  duvarın zaten yıpranmışken dalga gelir ve üs düşer.

---

## D) SES, GİZLİLİK VE MULTIPLAYER

### 🔊 Ses (Noise) ve Tehdit Çekme (Aggro)
- **Gürültü = tehlike çağırma:** Bazı eylemler **ses çıkarır** ve **geniş bir alandaki yaratıkları senin
  konumuna çeker**. En gürültülüleri:
  - **Chainsaw (Motorlu Testere):** Ağaç keserken sürekli yüksek ses çıkarır — hızlı odun verir ama
    "buradayım!" diye bağırır. Gece veya tehlikeli biyomda Chainsaw'la kesmek, dalga davet etmek olabilir.
  - **Ateşli silahlar (Shotgun/Rifle/Pistol):** Ateş etmek ses patlaması yaratır; uzaktaki yaratıkları
    üstüne çeker. Bir tehdidi vururken **başka üçünü uyandırabilirsin**.
- **Sessiz alternatifler (Stealth):** **Yay (Bow)** ve **Crossbow (Arbalet)** sessizdir. Yaratıkları
  **uyandırmadan** avlanmak, sessizce ilerlemek, veya bir tehdidi diğerlerini alarma geçirmeden
  temizlemek için stratejik olarak çok değerlidir. "Az mühimmatlı ama sessiz" oyun tarzı, kalabalık
  gecelerde ateşli silahtan daha güvenli olabilir.
- **Taktik:** Güvenli/gündüz = Chainsaw ve ateşli silah serbest. Tehlikeli/gece/uç biyom = **sessiz
  kesim (normal balta) + sessiz av (yay/arbalet)**; gerçekten gerekince gürültülü silaha geç.

### 🎯 Dost Ateşi ve Takım Hasarı (Friendly Fire)
- **Durum:** Özellikle **Shotgun (saçma/alan)** ve patlayıcı/alan hasarı veren silahlarda, **takım
  arkadaşına da hasar verme (friendly fire)** riski gündeme gelir. Kaos anında (dalga sırasında) yanlış
  hizada duran arkadaşına saçma isabet edebilir.
- **Güvenli pozisyon:** Multiplayer'da mermilerin arkadaşa gitmemesi için:
  - Ateşli silahlıysan **arkadaşınla aynı hizada / önünde durma**; yanlara açıl, çapraz ateş hattı kur.
  - Shotgun kullanan kişi **en önde ve dış kanatta** dursun; arkadan gelenler menzilli (rifle/yay) ile
    üstünden değil, **açıdan** vursun.
  - Dar kapıda/koridorda toplaşmayın — friendly fire ve sıkışma (hitbox) riski birlikte artar.
- **Not:** Friendly fire'ın açık/kapalı olması sürüme/sunucu ayarına bağlı olabilir; "açık" varsayıp
  ona göre pozisyon almak en güvenlisidir (kapalıysa zaten zararı yok).

---

## E) KAÇIŞ VE OYUN SONU (The Rescue / Escape)

### 🚁 100. Günün Sonu ve Nihai Amaç
- **Amaç:** Oyunun ana hedefi **belirlenen gece sayısını (99/100) hayatta çıkmaktır**. Bütün ekonomi,
  üs, otomasyon ve loot; bu son geceye **hazırlıklı** varmak içindir.
- **Bitiş mekaniği:** Son geceyi çıkardığında genelde bir **kurtarma/kaçış olayı** tetiklenir — sıklıkla
  bir **kurtarma helikopteri** gelir veya bir **telsiz/kurtarma görevi** aktifleşir; hayatta kalan
  oyuncular "kurtarıldı" sayılır ve oyun **zafer/bitiş ekranıyla** sonlanır. (Radyo/Watchtower gibi
  yapıların tematik olarak "kurtarma çağrısı" hissi vermesi bununla uyumludur.)
- **Skor/Leaderboard:** Bitişte (ve erken ölümlerde) genelde **hayatta kalınan gün sayısına** göre
  **skor/rozet/leaderboard** kaydı olur; ne kadar çok gece = o kadar iyi sıralama. Yani "kaçamasan bile
  kaç gece dayandığın" ölçülür.
- **Özet:** Nihai amaç = **son geceyi çıkıp kurtarılmak** (helikopter/telsiz) + **mümkün olduğunca çok
  gece dayanıp skor/rozet** kazanmak. Geç-oyun otomasyonu ve kalıcı üs, bu finale "otomatik pilotla"
  gitmeni sağlar.

---

## F) İLERİ TEKNİK / META MEKANİKLER

### 🎬 Animation Cancelling ve Hitbox
- **Vuruş hızlandırma (anim cancel):** Balta sallarken veya Chainsaw kullanırken, **saldırı
  animasyonunu yarıda kesmek** (hızlıca silah değiştirip geri dönmek, zıplamak veya belirli bir input
  ritmi) bazı sürümlerde **daha hızlı kesim / daha sık vuruş** sağlayabilir. Bu bir "tech"tir —
  animasyonun bekleme (recovery) kısmını atlayıp bir sonraki vuruşu erken tetikleme mantığı. Kaynak
  toplama ve savaşta ciddi hız kazandırır ama input hassasiyeti ister ve yamalarla düzeltilebilir.
- **Karakter boyutu ve Hitbox:** Roblox'ta karakterin **giydiği paket/gövde tipi** (Rthro, blok kafa,
  farklı avatar ölçekleri) **hitbox'ı** etkileyebilir: büyük Rthro gövdeler **dar mağara girişlerinde
  veya dar üs kapılarında sıkışabilir** ya da yaratık saldırılarından **daha çok isabet** alabilir;
  küçük/blok avatarlar daha kolay sığıp daha az isabet alabilir. Kompetitif hayatta kalmada bazı
  oyuncular bu yüzden **daha küçük/kompakt avatar** tercih eder. Üssünü tasarlarken kapılarını "en büyük
  avatarın rahat geçeceği" genişlikte yap.

### 💾 Kayıt (Save) ve Dünya Paylaşımı
- **Data Persistence:** Oyundan çıkıp girdiğinde **gün sayısı, üs ve envanterin** kaydedilir. Kritik
  ayrım: genelde **dünya/ilerleme durumu kurucuya (Host) bağlıdır** — yani sunucunun/dünyanın "sahibi"
  gün sayısını ve üssü tutar; **her oyuncu ise kendi envanterini/karakter ilerlemesini** taşıyabilir
  (katıldığı sunucuya göre). Bu yüzden "ilerlememi kaybetmemek" için genelde **aynı Host'un dünyasına**
  dönmek gerekir.
- **Crash / Çökme:** Sunucu aniden kapanırsa **son birkaç dakikanın** kaydı kaybolabilir (kayıt periyodik
  olduğu için son anki değişiklikler yazılmamış olabilir). Önemli bir ilerlemeden (boss loot'u, büyük
  craft) sonra oyunu **düzgün kapatmak** (aniden değil) kaybı azaltır.
- **Dupe (Eşya Klonlama) Önlemleri:** Oyunlar, envanter değişimlerini **sunucu tarafında doğrulayarak**
  ve kayıtları senkronize ederek **eşya klonlamayı** engellemeye çalışır; tespit edilen dupe genelde
  **rollback (geri alma)** veya **ban** ile cezalandırılır. Yani "dupe glitch'i" ararsan hem işe
  yaramaz (anti-cheat) hem hesabını riske atarsın.

### 📡 Ping / Desync ve Sunucu Performansı
- **Hit-Reg (İsabet Kaydı):** Ateşli silah (Shotgun/Rifle) kullanırken, sunucu **ping**lediğinde
  isabetlerin **sunucuda geç/yanlış kaydolabilir** (mermi "değdi gibi göründü ama saymadı"). Yüksek
  ping = güvenilmez hit-reg. Bu yüzden lag varken **yakın mesafe (Shotgun)** uzak menzil atıştan daha
  güvenilir olabilir.
- **Desync birikimi:** Özellikle **50.+ günlerde** üste **çok fazla yapı/makine (duvar, otomasyon)**
  biriktiğinde sunucu yükü artar ve **senkronizasyon kaybı (desync)** görülebilir — konum/animasyon
  ışınlamaları, gecikmeli tepkiler. Çözüm: gereksiz yapıyı **sadeleştir**, aşırı makineyi dağıtma.
- **Lag-Teleport (Yaratık Duvardan Geçmesi):** Ping yüksekken yaratıklar, kurduğun **düz tomruk
  duvarların içinden glitched geçebilir** (çarpışma sunucuda geç işlenir). Buna karşı:
  - **Tek sıra duvar yerine kademeli/çift katman** savunma kur (bir katman kaçırsa diğeri tutar).
  - **Tuzakları duvarın hemen içine** diz (geçen yaralanır).
  - Kritik köşeleri **ateş/meşale güvenli alanıyla** kapat (bazı yaratıklar ışıktan çekinir).

### 🩹 Geliştirici Güncellemeleri ve Denge (Buff/Nerf) Geçmişi
- **Balans yamaları:** Yapımcı ekip zaman içinde **stat'ları günceller** — baltaların **vuruş sayıları**,
  Chainsaw'un **yakıt/tick tüketimi**, silah hasarları ve **biyomlardaki sandık düşme oranları** yamalarla
  değişir (bir sürümde güçlü olan bir eşya sonra nerf'lenebilir). Bu yüzden "kesin sayı" ezberlemek yerine
  **mevcut sürümde birkaç ağaç kesip kendi hit-count'unu ölçmek** en doğru bilgidir.
- **Sonuç:** Bu rehberdeki sayıların bir kısmı sürümle kayabilir; mantık (sıralama, göreli avantaj)
  kalıcıdır ama **kesin değerleri oyunun güncel sürümünde teyit et**.

### 🎁 Game Codes (Oyun Kodları)
- **Mantık:** Oyunun menüsündeki **kod (code) alanına** veya sohbete girilen geçerli kodlar, envantere
  **ekstra hurda (scrap), başlangıç malzemesi, kısa süreli buff veya kozmetik** verebilir. Yeni sezon/
  güncelleme zamanlarında yapımcılar tanıtım kodları yayınlar.
- **Önemli:** Kodlar **hızla eskir/expire olur**; sabit bir liste vermek yanıltıcıdır. Güncel kodları
  **oyunun resmi kanallarından** (oyunun Roblox sayfası/açıklaması, resmi Discord/sosyal medya, oyun içi
  duyurular) al. "Şu an geçerli kod" iddia eden üçüncü taraf listelerine güvenme; çoğu ölüdür.

---

## G) YÖNETİCİ / GELİŞTİRİCİ PANELİ (Admin / Dev Panel)
> **Kapsam:** Aşağıdaki komutlar **yalnızca yetkili adminler/geliştiriciler** içindir ve oyunun
> **sunucu yönetimi/test** özellikleridir. Normal oyuncu bunlara erişemez; burada **oyunun bir sistemi
> olarak** (kavramsal) belgelenmiştir. Bu bir "hile" rehberi değildir — komutlar yetkiye bağlıdır ve
> her kullanım loglanır.

### 🔑 Panele Erişim ve Yetkilendirme
- **Yetki kontrolü (User ID Check):** Panel yalnızca, oyun kodunda **ID'si tanımlı yöneticilere** veya
  ilgili **Roblox grup/klan yetkililerine** açılır. Tetikleme genelde bir **kısayol tuşu** (örn. `~`
  veya F9 geliştirici konsolu) ya da ekranda yalnızca yetkiliye görünen **gizli bir UI butonu** iledir.
- **Loglama (Admin Logs):** Panelden yazılan **her komut sunucu log sistemine düşer** — kimin hangi
  eşyayı spawn'ladığı, günü değiştirdiği vb. diğer adminlerce **kalıcı olarak** görülebilir. Bu,
  yetkinin kötüye kullanımını caydırır ve denetlenebilir kılar.

### ⏱️ Zaman ve Çevre Manipülasyonu
- **Gün ayarı (`/setday [sayı]`):** 99 gecelik döngüyü **anında** değiştirir — 1. güne dönmek veya
  sunucuyu doğrudan **98. gün** gibi en zor aşamaya fırlatmak (etkinlik/test için).
- **Zamanı dondurma/hızlandırma:** Gece-gündüz döngüsünü **durdurup** sürekli **gündüz** (loot testi) ya
  da sürekli **gece** (savunma/dalga testi) yapmak.
- **Hava durumu (`/weather [rain/storm/clear]`):** Fırtınayı anında **başlat/durdur**, yıldırım
  sıklığını ayarla veya havayı **güneşli** sabitle (test ve etkinlik kontrolü).

### 📦 Eşya ve Kaynak Spawn'lama
- **`/give [oyuncu] [eşya_ID] [miktar]`:** Sandık aramadan envantere anında eşya basar — 999 **Scrap
  Metal**, **Chainsaw**, **Strong Axe**, mühimmat kutusu vb. (test/etkinlik dağıtımı).
- **Özel yapı yerleştirme:** Crafting menüsünde bile olmayan, **kodda gömülü** gizli duvarları veya
  **test aşamasındaki otomasyon makinelerini** haritaya **ızgarasız (grid-free)** doğrudan yerleştirme.

### 👹 Canavar ve Boss Tetikleyicileri (Mob)
- **`/starthorde`:** Periyodik **Kanlı Gece (Horde Night)**'ı normal gününü beklemeden **anında**
  başlatır (etkinlik/test).
- **Boss çağırma:** Volkana gitmeden **Cultist King** veya diğer bossları **kampın ortasına** spawn'layıp
  sunucuya canlı etkinlik yaptırmak.
- **`/killall`:** Aşırı yaratık doğup **ping/lag** yükseldiğinde tüm canavarları tek komutla temizleyip
  **sunucu performansını** rahatlatmak.

### 🧑‍✈️ Oyuncu Yönetimi ve Moderasyon
- **`/fly`, `/god`:** Adminin haritayı **yukarıdan izlemesi**, **hitbox/harita testi** yapması ve
  yaratıklardan **hasar almaması** (invulnerable) için.
- **Kick / Ban:** Kural ihlali yapan, duvar trolleyen veya **dupe (klonlama)** deneyen oyuncuları
  sunucudan uzaklaştırma/engelleme.

### 🎃 Etkinlik ve Mevsimsel Tetikleyiciler
- **Manuel event başlatma:** Normalde sadece gerçek dünyadaki **Cadılar Bayramı/Yılbaşı** gibi dönemlerde
  otomatik açılan özel etkinlikleri, **2x Loot** çarpanlarını veya gizli bossları **koddan zorla (force
  trigger)** aktif etmek.
- **Biyom debuff sabitleme:** Karlı biyomun **donma** veya volkanın **lav/sıcaklık hasarı** mekaniğini,
  test için sunucu genelinde **tamamen kapatmak** ya da hasar katsayısını (**x2, x5**) değiştirmek.

---

## 🧭 KAPANIŞ — Rehberin İki Bölümünün Özeti
- **Bölüm 1:** Ne bulacağın ve nasıl güçleneceğin — POI'ler, sandıklar, baltalar/chainsaw, 5 biyom,
  hava/sınıf/NPC/tarım/otomasyon.
- **Bölüm 2 (bu dosya):** Nasıl *hayatta kalıp verimli oynayacağın* ve oyunun *derin sistemleri* — ölüm
  cezası & uyku, zırh & ağırlık, respawn & yapı bakımı, ses & dost ateşi, oyun sonu, netcode/kayıt/denge
  ve yetkili admin paneli.
- **Altın kural:** Ateşi asla söndürme, güvendeysen uyu-tehlikedeysen uyuma, ağır yükle gezme, duvarını
  çekiçle, gürültüyü tehlikeye göre ayarla, uç biyom kaynağını planlı harca ve her şeyi otomasyona
  bağlayıp **son geceye hazır** var.
