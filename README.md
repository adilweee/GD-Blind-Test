# 7. GD Blind Test

AREDL seviyelerini görsel veya kısa ses ipuçlarıyla tahmin ettiğin Geometry Dash hayran projesi. Sayfa doğrudan `index.html` dosyasından açılabilir; yerel sunucu gerekmez.

## Özellikler

- AREDL’in canlı level listesi (autocomplete ve yakın sıra ipucu).
- Her tur rastgele görsel veya 15 saniyelik müzik ipucu. GDBrowser şarkı URL’si sağlamazsa otomatik olarak görsel ipucuna düşer; video başlığı/kontrolleri gösterilmez.
- 5 turluk oturum; puan ve sonuç yalnızca beşinci turda gösterilir. Puan, doğru tahmin, seri ve son 100 tur yalnızca bu tarayıcıda saklanır.
- İlk kullanım bilgilendirmesi, kullanım koşulları, gizlilik politikası ve yerel verileri silme düğmesi.
- Profil, clan detay sayfası, üye kadrosu ve dünya sırası Supabase ile çevrimiçi çalışır. Duel ekranı ortak seed, sonuç karşılaştırma ve yerel maç geçmişi sunar.
- Supabase yapılandırılana kadar hesap ve çevrimiçi clan/duel kayıtları kapalıdır. Supabase etkinleştirildiğinde kullanıcılar cihazlar arasında eşitlenir; duel asenkron seed kodlarıyla oynanır.

## Bilgisayarında aç

`index.html` dosyasına çift tıkla. İnternet bağlantısı gerekir; level listesi AREDL API’sinden, görseller AREDL’in GitHub thumbnail deposundan yüklenir. Şarkı eşlemesi Geometry Dash level ID’sini GDBrowser API’sine sorar; varsa doğrudan ses URL’sini sayfa içinde 15 saniye oynatır. Dosyaları aynı klasörde tut. AREDL API’nin `file://` sayfasından gelen `null` origin isteğini kabul ettiği doğrulandı.

İstersen `Run-GD-Blind-Test.bat` ile Python HTTP sunucusunu da çalıştırabilirsin; artık zorunlu değil.

## Çevrimiçi clan, hesap ve dünya sıralaması

1. Supabase’te bir proje oluştur.
2. Sırasıyla `supabase/migrations/202611160001_online_clans_duels.sql` ve `supabase/migrations/202611160002_clan_controls.sql` dosyalarını Supabase SQL Editor’de çalıştır. İkinci migration co-owner rolleri, katılım modu ve 100 üyeye kadar kapasiteyi ekler.
3. `backend-config.js` içindeki `url` alanına Project URL’yi, `anonKey` alanına publishable/anon public key’i yaz. `siteUrl` alanına yayımlanmış HTTPS adresini yazarsan, localhost üzerinden kayıt açılsa bile doğrulama e-postası yayın adresine döner. `service_role` anahtarını web uygulamasına koyma.
4. Supabase Dashboard → Authentication → URL Configuration içinde Site URL’yi yayın adresin yap ve Redirect URLs listesine bu adresi (gerekirse `http://localhost:.../**` test adresini de) ekle. E-posta şablonundaki yönlendirme `.RedirectTo` değerini kullanmalı. Ardından e-posta doğrulama ayarını seç. Doğrulama açıksa yeni kullanıcı e-postasındaki linkten hesabı onaylar.
5. GitHub Pages’e yayımlamadan önce hesabı, clan oluşturma/davet/katılımı, sıralamayı ve duel sonuç kaydını Supabase projesinde dene.

Clan liderleri co-owner atayabilir; co-owner davet oluşturabilir, açık/davetli katılımı ve 2–100 üye kapasitesini ayarlayabilir, normal üyeleri yönetebilir. Profil, clan üyeliği, oturum puanları ve duel sonuçları Supabase’te tutulur. Dünya clan sırası üye puanlarının toplamıyla hesaplanır. Skor gönderimi tarayıcıdan geldiği için bu sürüm profesyonel anti-cheat ya da doğrulanmış turnuva sıralaması sağlamaz. Kullanıcı hesabını profil sayfasındaki **Hesabı sil** düğmesinden silebilir.

## GitHub Pages’e yayımla

Bu klasörün içeriğini (`index.html`, `app.js`, `backend-config.js`, `terms.html`, `privacy.html`, `netlify.toml` ve `supabase/` klasörü) deponun köküne koyup GitHub **Settings → Pages** bölümünden `main / (root)` seç. Yayımlamadan önce gizlilik sayfasındaki iletişim bölümüne depo Issues bağlantısını ekle.

## Veri kaynakları

- [AREDL API](https://api.aredl.net/v2/docs) ve [AREDL koşulları](https://aredl.net/terms)
- AREDL’in [resmî Thumbnails deposu](https://github.com/All-Rated-Extreme-Demon-List/Thumbnails); level görselleri ID’ye göre `raw.githubusercontent.com` üzerinden yüklenir.
- GDBrowser topluluk servisi güvenilirlik garantisi vermez; şarkı metadatası ya da ses URL’si eksik olduğunda tur görsel ipucuyla devam eder. Kaynak servisler değişebilir veya kapalı olabilir.

Bu, RobTop Games veya AREDL tarafından işletilmeyen bağımsız bir hayran projesidir. Üçüncü taraf içeriklerin hakları ilgili sahiplerinde kalır.