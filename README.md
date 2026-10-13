# Deniz Seviyesi Simülatörü — Türkiye (Flooder)

Deniz seviyesi **−5.000 m ile +7.000 m** arasında değişirse Türkiye ve çevresinde nerelerin su altında kalacağını ya da sudan çıkacağını gösteren etkileşimli harita.

**▶ Canlı demo: https://erenciracioglu-dotcom.github.io/flooder/**

*English: an interactive sea-level map of Türkiye and its surroundings (−5,000 m … +7,000 m), rendered on the GPU with MapLibre GL JS, with bathymetry, a hydrologically “connected” flooding model and per-province statistics. The UI is in Turkish.*

## Başlatma

- **Tarayıcıdan:** yukarıdaki canlı demo bağlantısı (kurulum gerekmez).
- **Yerelde:** depoyu indirin, ardından Windows'ta `Baslat.bat`, diğer sistemlerde `python3 serve.py` çalıştırın.
  Küçük bir yerel sunucu (port 8770) başlar ve tarayıcıda `http://127.0.0.1:8770/` açılır; sunucu zaten çalışıyorsa
  yalnızca tarayıcıyı açar, 6 saat kullanılmazsa kendiliğinden kapanır. Uygulama ES modülleri kullandığı için
  `index.html` dosyasına çift tıklayarak açmak çalışmaz; herhangi bir statik web sunucusu yeterlidir.
- İnternet bağlantısı gerekir (yükseklik, uydu ve etiket karoları çevrim içi kaynaklardan gelir). İlk açılışta
  karolar birkaç saniyede yüklenir; sonraki açılışlarda tarayıcı önbelleğinden hızla gelir.

## Kullanım

- **Sağdaki dikey gösterge**: sürükleyin, üzerinde fare tekerleğini çevirin veya seçiliyken ↑/↓, PageUp/PageDown,
  Home (0 m) tuşlarını kullanın. Ölçek logaritmiktir: sıfır civarında 10 cm, uçlarda 10 m hassasiyet.
  ▲/▼ düğmeleri seviyeyi sürekli yükseltir/alçaltır (animasyon).
- **Hazır işaretler**: 2100 (IPCC), Grönland, tüm buzullar, Son Buzul Maksimumu, Messiniyen krizi, Karadeniz dibi,
  Türkiye'nin yarısı, Ağrı Dağı.
- **Panel**: tam değer girişi (±1/±10/±100), senaryo açıklaması, Türkiye'de su altında kalan alan, su altındaki
  il merkezleri ve en çok etkilenen iller; seviye eksideyken denizlerin kalan alan/hacim yüzdeleri.
- **İl listesi**: 81 il merkezi rakıma göre sıralı; tıklayınca haritada gider. İl satırındaki çubuk, il alanının ne kadarının
  su altında olduğunu gösterir.
- **Haritaya tıklayın**: o noktanın rakımı, su derinliği veya kapalı havza bilgisi.
- **Görünüm**: Uydu / Fiziki altlık; Gerçekçi / Basit model; su basan karaları vurgulama; bugünkü kıyı çizgisi;
  rölyef gölgesi; yer adları; il merkezleri; **3B arazi** (su yüzeyi düz çizilir, yükseklik abartması ayarlanabilir).
- Adres çubuğu seviyeyi ve görünümü saklar (`#seviye=70&harita=…`); bağlantıyı kopyalayıp paylaşabilirsiniz.

## Modeller

- **Gerçekçi (varsayılan)**: Deniz yalnızca denize bağlı alanlara girer. Denize doğal çıkışı olmayan kapalı havzalar —
  Van Gölü, Erçek, Tuz Gölü, Konya Ovası, Akşehir–Eber, Burdur, Acıgöl, Salda, Seyfe, Sultan Sazlığı, Elmalı,
  Nemrut kraterinin yanı sıra Ölü Deniz, Hazar Çöküntüsü, Urmiye, Kattara vb. — en alçak eşik (taşma seviyesi) aşılana
  kadar kuru kalır. Örn. +990 m'de Ankara su altındadır ama Tuz Gölü havzası (eşik ≈ 997 m) kurudur.
- **Basit (küvet)**: Seviyenin altındaki her yer su altında sayılır.

Eşikler ~230 m çözünürlükte, deniz yüzeyinden başlayan bir priority-flood (morfolojik geri çatma) analiziyle bulundu.
Bu çözünürlükte dar kanyonlar ve barajlar sahte "kapalı çukur" ürettiği için yalnızca gerçekten kapalı olduğu bilinen
havzalar beyaz listeyle korunur; geri kalan her yer basit modelle davranır.

## Teknik yapı

| Dosya | Görev |
|---|---|
| `index.html`, `css/app.css` | Arayüz |
| `js/app.js` | Harita stili, katmanlar, durum, panel, il listesi, 3B |
| `js/dem-worker.js` | Web Worker: Terrarium karolarını indirir, z8 batimetrisiyle birleştirir, havza düzeltmesi ve 3B su yüzeyi üretir |
| `js/dem-pool.js` | İşçi havuzu + MapLibre özel protokolü `fdem://` |
| `js/palette.js` | Su/kara/deniz tabanı renk rampaları (GPU'da `color-relief` katmanı) |
| `js/gauge.js` | Dikey logaritmik seviye göstergesi |
| `js/data.js` | Önceden hesaplanmış istatistikler |
| `js/scenarios.js` | Seviye açıklamaları ve hazır işaretler |
| `data/` | Önceden hesaplanmış veri (aşağıya bakın) |
| `vendor/maplibre-gl/` | MapLibre GL JS 6.14.0 (BSD-3) |
| `tools/` | Veri hazırlama betikleri |

Renklendirme ekran kartında yapılır (MapLibre `color-relief`); seviye değişince yalnızca renk rampası güncellenir,
bu yüzden kaydırma akıcıdır. Terrarium karolarında z9 ve üstünde deniz 0 m görünür (batimetri yok); işçi bu karoları
z8 karosundaki batimetriyle birleştirir.

### `data/` içeriği

- `depressions.json` + `depr_z9.bin`: kapalı havzalar (taşma seviyeleri) ve z9 etiket karoları (PNG paketi)
- `stats.json` + `hyps.bin`: Türkiye ve 81 il için seviyeye göre su altında kalan alan (küvet ve gerçekçi)
- `seas.bin`: Karadeniz, Azak, Marmara, Ege, Akdeniz (harita bölgesi) için seviyeye göre alan/hacim
- `cities.json`: 81 il merkezi (koordinat, haritayla aynı veriden örneklenmiş rakım, TÜİK 2025 il nüfusu)

### Veriyi yeniden üretmek

Python 3.12 + `numpy scipy scikit-image pillow` gerekir (betikler argüman olarak klasör alır):

```bat
python -I tools\download_tiles.py --out <karo> --spec 8:18,30,50,48 --spec 9:18,30,50,48 --log indirme.log
python -I tools\prep_mosaic.py --tiles <karo> --out <is>
python -I tools\prep_data.py --work <is> --adm1 geoBoundaries-TUR-ADM1.geojson --out data
python -I tools\prep_cities.py --tiles <karo> --work <is> --pop pop2025.json --data data
```

İl sınırları: geoBoundaries TUR ADM1 (gbOpen). Nüfus: TÜİK ADNKS 2025 (`pop2025.json`: il adı → nüfus).

Yardımcı araçlar: `tools/prep_depressions.py` bölgedeki tüm kapalı çukurları listeler (yeni bir havzayı `prep_data.py`
içindeki `BASINS` listesine eklemeden önce keşif için); `tools/screenshot.py` başsız Chrome ile ekran görüntüsü alır.

## Veri kaynakları ve lisanslar

- Yükseklik/derinlik: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (AWS Open Data, Mapzen/Tilezen) —
  SRTM, EU-DEM (Copernicus), GMTED2010, ETOPO1 (NOAA)
- Uydu: Esri World Imagery (Esri, Maxar, Earthstar Geographics)
- Etiketler, sınırlar, kıyı çizgisi: [OpenFreeMap](https://openfreemap.org) · © OpenMapTiles · © OpenStreetMap katkıcıları
- İl sınırları: geoBoundaries (OpenStreetMap kaynaklı) · İl nüfusları: TÜİK ADNKS 2025 · İl merkezi koordinatları: Wikidata
- Harita motoru: MapLibre GL JS

## Sınırlamalar

- Kara verisinin dikey hatası birkaç metredir; birkaç metrelik yükselmeler için sonuçlar yaklaşıktır.
- Deniz tabanı ~1,8 km çözünürlüklüdür (ETOPO1); boğazlar ve kıyıya yakın sığlıklar kaba görünür, birkaç noktada
  veri kaynaklı sahte derin çukurlar vardır.
- Tüm denizlerde aynı seviye varsayılır; gelgit, erozyon, tortu, izostazi ve baraj dayanımı hesaba katılmaz.
- +70 m'nin üstü ve −130 m'nin altı fiziksel olarak gerçekçi değildir; topoğrafyayı keşfetmek içindir.

## Lisans

Bu depodaki kod MIT lisanslıdır (`LICENSE`). MapLibre GL JS kendi BSD-3 lisansıyla gelir
(`vendor/maplibre-gl/LICENSE.txt`). Harita karoları çalışma anında sağlayıcılarından yüklenir ve onların koşullarına
tabidir; `data/` içindeki türetilmiş istatistikler yukarıdaki kaynaklara dayanır.
