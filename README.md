# GitSec E2E Test Otomasyon Projesi

Bu proje, GitSec platformunun tüm kritik işlevlerini, entegrasyonlarını ve güvenlik sınırlarını doğrulamak amacıyla geliştirilmiş kapsamlı bir uçtan uca (E2E) test otomasyon paketidir. Playwright test kütüphanesi üzerine inşa edilmiş olup, modüler ve güvenli bir mimari yapıyı takip eder.

---

## 📂 Proje Yapısı ve Klasör Mimarisi

Test paketi, sürdürülebilirliği artırmak ve kod tekrarlarını önlemek amacıyla **Page Object Model (POM)** tasarım desenine uygun olarak yapılandırılmıştır:

* **[tests/e2e/](./tests/e2e)**: Tüm işlevsel ve uç durum test senaryolarını (`spec.ts` dosyalarını) içerir.
  * **[auth/](./tests/e2e/auth)**: Giriş, kayıt, mail aktivasyonu ve doğrulama süreçleri.
  * **[providers/](./tests/e2e/providers)**: GitHub ve Bitbucket entegrasyonları, depo dahil/hariç tutma, yedekleme ve bulut depolama sağlayıcı testleri.
  * **[backups/](./tests/e2e/backups)**: Yedekleme zamanlayıcıları ve geri yükleme (restore) senaryoları.
  * **[audit/](./tests/e2e/audit)**: Denetim günlükleri (Audit Logs) ve kullanıcı arayüzü doğrulamaları.
* **[tests/pages/](./tests/pages)**: Arayüz elemanlarını (selectors) ve kullanıcı etkileşimlerini barındıran Page Object sınıfları (Örn: [StoragePage](./tests/pages/StoragePage.ts), [LoginPage](./tests/pages/LoginPage.ts)).
* **[tests/support/](./tests/support)**: Ortam değişkeni kontrolleri, ağ/API mock yardımcıları ve OAuth oturum yönetim araçları.
* **[tests/fixtures/](./tests/fixtures)**: Playwright test fixture tanımlamaları ve mock veri dosyaları.

---

## 🔍 Temel Test Alanları ve Kapsamı

Projedeki test senaryoları GitSec platformunun aşağıdaki temel işlevlerini kapsar:

### 1. Kimlik Doğrulama ve Kayıt (Authentication & Registration)
* **Kayıt Akışı**: Mail.tm API entegrasyonuyla geçici e-posta oluşturma, Captcha algılama, aktivasyon maili polling akışı ve kullanıcı doğrulama adımları.
* **Giriş Güvenliği**: Başarılı ve başarısız giriş denemeleri, şifre alanı doğrulamaları ve hata toast mesajlarının kontrolü.

### 2. Kod Sağlayıcı Entegrasyonları (GitHub & Bitbucket)
* **Bağlantı Kurulumu**: OAuth popup pencerelerinin yönetimi, yetkilendirme süreçleri ve çoklu tıklama (spam protection) korumaları.
* **Yedekleme Kapsamı**: Depoların dahil edilmesi (Include), hariç tutulması (Exclude) ve lisans limit aşımlarında sistem davranışlarının doğrulanması.
* **Yedekleme (Backup)**: Seçilen depoların yedekleme süreçlerinin başlatılması, durum takibi ve API hata toleransları.

### 3. Depolama Sağlayıcıları (Storage Providers)
* **Bulut Sağlayıcı Entegrasyonları**: AWS S3, Google Drive, OneDrive, Azure Blob ve Huawei OBS entegrasyon formlarının doğrulanması.
* **API ve Ağ Hataları**: API yavaşlamalarında (latency) çift tıklama koruması, 500/401/400 sunucu hatalarında arayüzün kilitlenmemesi ve internet kesintilerinde (offline mode) kurtarma senaryoları.

### 4. Geri Yükleme (Restore)
* **Geri Yükleme Süreçleri**: Yedeklenmiş depoların hedef depolara geri yüklenmesi, dosya bazlı kontroller ve lisans sınırlarındaki 403 engellemeleri.

### 5. Denetim ve Güvenlik (Audit & Security Edge Cases)
* **Denetim Günlükleri (Audit Logs)**: Yapılan kritik işlemlerin (sağlayıcı ekleme/silme, zamanlayıcı oluşturma vb.) veritabanına doğru parametrelerle (IP, User Agent, Tarih) yazıldığının API seviyesinde doğrulanması.
* **Workspace Yalıtımı**: Yetkisiz çalışma alanlarına (Workspace ID) erişim isteklerinin engellenmesi.
* **Token Yönetimi**: JWT token yenileme yarış durumlarının (Token Refresh Race Condition) arayüzü çökertmeden yönetilmesi.

---

## 🛠️ Kurulum ve Çalıştırma

### 1. Bağımlılıkların Yüklenmesi
Projeyi çalıştırmadan önce yerel bağımlılıkları ve Playwright tarayıcılarını yükleyin:
```bash
npm install
npx playwright install
```

### 2. Ortam Değişkenleri (`.env`)
Proje kök dizininde bir `.env` dosyası oluşturun ve gerekli değişkenleri tanımlayın:
```env
WORKSPACE_ID=your-workspace-id
DASHBOARD_BASE_URL=https://staging.dashboard.gitsec.io
API_BASE_URL=https://staging.api.gitsec.io
E2E_USER_EMAIL=your-email
E2E_USER_PASSWORD=your-password
GITHUB_TEST_USER=your-github-username
GITHUB_TEST_PASSWORD=your-github-password
AWS_S3_BUCKET=your-s3-bucket
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_REGION=your-aws-region
```

### 3. Test Çalıştırma Komutları

* **Tüm Testleri Koşturma**:
  ```bash
  npx playwright test
  ```

* **Testleri Listeleme (Ortam Değişkenleri Olmadan da Çalışır)**:
  ```bash
  npx playwright test --list
  ```

* **Belirli Bir Testi Başlıklı (Headed) Modda Koşturma**:
  ```bash
  npx playwright test tests/e2e/auth/login.spec.ts --headed
  ```

* **Dinamik Kod Sağlayıcısı Seçimiyle Koşturma**:
  Testlerin GitHub veya Bitbucket üzerinde çalışacağı ortam değişkeniyle dinamik olarak belirlenebilir:
  ```bash
  # PowerShell
  $env:E2E_CODE_PROVIDER="bitbucket"; npx playwright test tests/e2e/providers/repositories-backup.spec.ts
  
  # Bash
  E2E_CODE_PROVIDER=bitbucket npx playwright test tests/e2e/providers/repositories-backup.spec.ts
  ```

---

## 🖥️ Yerel Yönetim ve Koşum Paneli (Local Dashboard)

Proje, testleri tarayıcı üzerinden tetikleyebileceğiniz, canlı logları ve hata ekran görüntülerini izleyebileceğiniz modern bir yerel yönetim paneli sunar.

* **Sunucuyu Başlatma**:
  ```bash
  node tests-server.js
  ```
* Sunucu çalıştıktan sonra tarayıcınızdan **`http://127.0.0.1:3001`** adresine giderek arayüz üzerinden testleri yönetebilir, global kod sağlayıcısını (GitHub/Bitbucket) tek bir tıkla değiştirebilirsiniz.
