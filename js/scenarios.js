// Seviye açıklamaları ve göstergedeki hazır işaretler.
// Bilimsel değerler yaklaşık ve yuvarlaktır; kaynaklar Hakkında penceresinde.

export function presets(ctx) {
  const list = [
    { value: 5137, label: 'Ağrı Dağı', note: 'Türkiye’nin en yüksek noktası; bu seviyede Türkiye tamamen su altında' },
    { value: 70, label: 'Tüm buzullar erirse', note: 'Dünyadaki bütün kara buzu ≈ +65–70 m' },
    { value: 7, label: 'Grönland erirse', note: 'Grönland buz örtüsü ≈ +7,4 m' },
    { value: 1, label: '2100 (yüksek emisyon)', note: 'IPCC AR6: 2100’e kadar ≈ +0,3 … +1 m' },
    { value: 0, label: 'Bugün', note: 'Günümüz ortalama deniz seviyesi' },
    { value: -120, label: 'Son buzul çağı', note: '~20 bin yıl önce deniz ~120–130 m daha alçaktı' },
    { value: -1500, label: 'Messiniyen krizi', note: '~5,9–5,3 milyon yıl önce Akdeniz büyük ölçüde kurudu' },
    { value: -2212, label: 'Karadeniz dibi', note: 'Karadeniz’in en derin yeri ≈ 2.212 m' },
  ];
  if (ctx && ctx.half) list.push({ value: ctx.half, label: 'Türkiye’nin yarısı', note: 'Kara alanının %50’si su altında (model)' });
  return list;
}

export function describeLevel(L, ctx) {
  const a = Math.abs(L);
  if (a < 0.05) return { title: 'Günümüz', text: 'Bugünkü ortalama deniz seviyesi. Göstergeyi sürükleyin, kaydırın veya ↑/↓ tuşlarını kullanın.' };
  if (L > 0) {
    if (L <= 1.1) return { title: '2100 projeksiyonları', text: 'IPCC AR6’ya göre 2100 yılına kadar, emisyon senaryosuna bağlı olarak yaklaşık +0,3 ile +1 m arası yükselme bekleniyor.' };
    if (L <= 2.5) return { title: 'Yüksek risk senaryosu', text: 'Çok yüksek emisyonlarda buz örtülerinin hızlı erimesiyle 2100’de ~2 m’ye yaklaşan yükselme dışlanamıyor.' };
    if (L < 6) return { title: 'Yüzyıllar ölçeği', text: 'Isınma sürerse deniz seviyesinin yüzyıllar boyunca metrelerce yükselmesi bekleniyor.' };
    if (L < 10) return { title: 'Grönland erirse', text: 'Grönland buz örtüsünün tamamen erimesi ≈ +7,4 m’ye karşılık gelir.' };
    if (L < 55) return { title: 'Antarktika da eriyor', text: 'Bu seviyeler için Antarktika buz örtüsünün büyük bölümünün de erimesi gerekir.' };
    if (L <= 75) return { title: 'Tüm buzullar eriseydi', text: 'Dünyadaki bütün kara buzu eriseydi deniz seviyesi ≈ 65–70 m yükselirdi. Bunun ötesi gerçekçi değildir.' };
    if (L < ctx.turkeyMax) return { title: 'Varsayımsal', text: 'Dünyada bu kadar yükselmeye yetecek buz yok; bu seviyeler topoğrafyayı keşfetmek içindir.' };
    return { title: 'Türkiye tamamen su altında', text: 'Ağrı Dağı’nın zirvesi (5.137 m) dahil tüm kara su altında kaldı.' };
  }
  if (a < 10) return { title: 'Hafif çekilme', text: 'Kıyıdaki sığ alanlar, lagünler ve deltalar açığa çıkar.' };
  if (a < 60) return { title: 'Buzul çağının sonu', text: 'Yaklaşık 7–12 bin yıl önce deniz bu düzeylerdeydi; sığ kıta sahanlıkları karaydı.' };
  if (a <= 140) return { title: 'Son Buzul Maksimumu', text: '~20 bin yıl önce deniz ~120–130 m alçaktı: Ege’deki birçok ada anakaraya bağlıydı; Karadeniz ve Marmara okyanustan kopuk göllerdi.' };
  if (a < 1000) return { title: 'Varsayımsal', text: 'Kıta sahanlıkları tamamen kurur, kıta yamaçları ve deniz altı kanyonları ortaya çıkar. (Model tüm denizlerde aynı seviyeyi varsayar.)' };
  if (a < 2200) return { title: 'Messiniyen Tuzluluk Krizi', text: '~5,9–5,3 milyon yıl önce Akdeniz Atlantik’ten koptu ve büyük ölçüde buharlaştı; seviye bin metrelerce düştü.' };
  if (a < 4000) return { title: 'Karadeniz kurudu', text: 'Karadeniz’in en derin yeri ≈ 2.212 m; bu seviyenin altında Karadeniz neredeyse tamamen kurur. Doğu Akdeniz’in derin havzaları kalır.' };
  return { title: 'Akdeniz’in en derin çukurları', text: 'Su yalnızca Helen Çukuru ve İyon Denizi’nin en derin yerlerinde kalır (en derin nokta: Kalipso Çukuru ≈ 5.267 m).' };
}
