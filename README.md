# GitSec E2E Test Otomasyon Projesi

Bu proje, **GitSec** platformunun tüm kritik işlevlerini, bulut entegrasyonlarını, kimlik doğrulama süreçlerini, lisans yönetimini ve güvenlik kısıtlarını doğrulamak amacıyla geliştirilmiş **uçtan uca (E2E) test otomasyon paketidir**. 

Playwright kütüphanesi ve TypeScript kullanılarak geliştirilmiş olup, **Page Object Model (POM)** tasarım desenine, yüksek hata toleransına ve dinamik çalışma alanı (Workspace) mimarisine sahiptir.

---

## 📂 Proje Yapısı ve Klasör Mimarisi

Test mimarisi, modülerlik ve sürdürülebilirlik ilkelerine uygun olarak dizayn edilmiştir:

```
TestAutomation/
├── tests/
│   ├── e2e/                           # E2E Test Senaryoları (spec.ts)
│   │   ├── auth/                      # Giriş, Kayıt, Şifre Sıfırlama ve Çıkış
│   │   ├── providers/                 # GitHub/Bitbucket ve Bulut Depolama (S3, Drive, OneDrive vb.)
│   │   ├── backups/                   # Zamanlayıcılar (Schedulers) ve Geri Yükleme (Restore)
│   │   ├── billing/                   # Lisans Değişimi, Plan Yükseltme & iyzico Ödeme Akışları
│   │   ├── audit/                     # Denetim Günlükleri (Audit Logs) ve Sistem Doğrulamaları
│   │   ├── ui/                        # Arayüz ve Buton Durum Doğrulama Testleri
│   │   ├── auth.setup.ts              # Global Oturum & Token Saklama Setup'ı
│   │   ├── provider.setup.ts          # Sağlayıcı Kurulum & Oturum Hazırlığı
│   │   ├── mocked-edge-cases.spec.ts  # Mocked API ve Hata İzolasyon Testleri
│   │   └── system-edge-cases.spec.ts  # Sistem Sınır Değer & Edge Case Testleri
│   ├── pages/                         # Page Object Model (POM) Sınıfları
│   │   ├── LoginPage.ts               # Giriş Sayfası POM
│   │   ├── RegisterPage.ts            # Kayıt Sayfası & Captcha POM
│   │   ├── ForgotPasswordPage.ts      # Şifre Sıfırlama POM
│   │   ├── ProviderPage.ts            # GitHub/Bitbucket ve Depo Yönetimi POM
│   │   ├── StoragePage.ts             # Depolama Sağlayıcıları POM
│   │   ├── RestorePage.ts             # Geri Yükleme Sihirbazı POM
│   │   ├── GithubLoginPage.ts         # GitHub OAuth Giriş POM
│   │   ├── Github2FaHandler.ts        # GitHub 2FA / TOTP İşleyici
│   │   ├── GithubInstallFlowHandler.ts# GitHub App Kurulum Akış İşleyici
│   │   ├── GoogleLoginPage.ts         # Google SSO Giriş POM
│   │   └── OneDriveLoginPage.ts       # Microsoft / OneDrive Giriş POM
│   ├── support/                       # Yardımcı Araçlar ve Servisler
│   │   ├── audit-helper.ts            # Arka Plan Ağ ve Konsol Hata Denetleyicisi
│   │   ├── dashboard-ui-helpers.ts    # safeGoto ve Yönlendirme Kurtarma Fonksiyonları
│   │   ├── workspace-resolver.ts      # Dinamik Workspace ID Çözümleyici
│   │   ├── atlassian-email-otp.ts     # Atlassian Email OTP Dinleyici
│   │   ├── password-reset-email.ts    # Gmail IMAP Şifre Sıfırlama Mail Çekici
│   │   ├── bitbucket-auth-helper.ts   # Bitbucket OAuth Popup İşleyici
│   │   ├── workspace-settings-helpers.ts # Çalışma Alanı Ayar Yardımcıları
│   │   └── require-env.ts             # Ortam Değişkeni Doğrulayıcı
│   └── fixtures/                      # Custom Fixtures ve Test Kurulumları
├── scripts/                           # Otomasyon ve Mail Kontrol Scriptleri
├── tests-server.js                    # Yerel Yönetim ve Koşum Paneli (Express Server)
├── playwright.config.ts               # Playwright Global Konfigürasyonu
└── package.json                       # Proje Bağımlılıkları ve Scriptler
```

---

## 🔍 Temel Test Kapsamı ve Modüller

### 1. Kimlik Doğrulama ve Güvenlik (`tests/e2e/auth/`)
* **Giriş (Login)**: `login.spec.ts`, `login-failures.spec.ts`, `login-mocked.spec.ts`
  - Başarılı giriş, 2FA/TOTP doğrulaması, hatalı e-posta/şifre uyarıları.
  - API 429 (Rate Limit), API 500 (Server Error) ve Ağ Kopması (`net::ERR_FAILED`) durumlarında UI kurtarma testleri.
* **Kayıt (Register)**: `register.spec.ts`, `register-failures.spec.ts`
  - `Mail.tm` API entegrasyonuyla dinamik e-posta oluşturma ve aktivasyon linki dinleme.
  - Google reCAPTCHA & Cloudflare Turnstile otomatik token algılama ve manuel çözüm desteği.
* **Şifre Sıfırlama (Forgot Password)**: `forgot-password.spec.ts`, `forgot-password-edge-cases.spec.ts`
  - Gmail IMAP entegrasyonuyla `gitsectest+2@gmail.com` e-posta kutusuna gelen canlı `Reset Password` linklerinin çekilmesi.
  - 12+ uç durum (eşleşmeyen şifre, zayıf şifre, süresi dolmuş token, 401/422/429/500 API hataları).
* **Oturum Kapatma (Logout)**: `logout.spec.ts`
  - Oturum çerezlerinin temizlenmesi ve yetkisiz erişimlerin engellenmesi.

### 2. Kod Sağlayıcıları ve Depo Yönetimi (`tests/e2e/providers/`)
* **GitHub Entegrasyonu**: `github-connect.spec.ts`, `github-sync.spec.ts`
  - OAuth App yetkilendirmesi, 2FA OTP girişi, App kurulum/kaldırma adımları ve depo senkronizasyonu.
* **Bitbucket Entegrasyonu**: `bitbucket-connect.spec.ts`
  - Atlassian OAuth popup yönetimi, e-posta/şifre doğrulaması ve aktif entegrasyon kontrolü.
* **Depo Kapsam Kuralları**: `repositories-include.spec.ts`, `repositories-exclude.spec.ts`, `repositories-backup.spec.ts`
  - Depo bazlı veya toplu Dahil Etme (Include) / Hariç Tutma (Exclude) ayarları.
  - Manuel yedekleme tetikleme ve lisans limit engellemeleri.

### 3. Bulut Depolama Sağlayıcıları (`tests/e2e/providers/`)
* **Sağlayıcı Testleri**: `storage.spec.ts`, `storage-validation.spec.ts`, `storage-edge-cases.spec.ts`, `storage-api-failures.spec.ts`
  - AWS S3, Google Drive, OneDrive, Azure Blob ve Huawei OBS entegrasyon formları.
  - Hatalı IAM Key/Bucket doğrulamaları, ağ gecikmelerinde çift tıklama koruması.

### 4. Zamanlayıcılar ve Geri Yükleme (`tests/e2e/backups/`)
* **Zamanlayıcılar (Schedulers)**: `schedulers.spec.ts`, `schedulers-validation.spec.ts`
  - Günlük (Daily), Haftalık (Weekly), Aylık (Monthly) ve Cron formatında yedekleme planları oluşturma.
* **Geri Yükleme (Restore)**: `restore.spec.ts`, `restore-validation.spec.ts`
  - Kapsam seçimleri (Code & Commits, PRs, Issues), hedef depo restorasyonu ve lisans sınırı (403) testleri.

### 5. Lisans ve Fatura Yönetimi (`tests/e2e/billing/`)
* **Lisans ve Plan Değişimi**: `license-change.spec.ts`
  - Free, Pro ve Enterprise planlar arasında geçiş (Upgrade/Downgrade).
  - Aylık/Yıllık faturalandırma döngüsü değişimleri ve iyzico SMS OTP ödeme altyapı simülasyonu.

### 6. Denetim Günlükleri ve Audit (`tests/e2e/audit/`)
* **Audit Monitoring**: `activity-log.spec.ts`, `activity-ui.spec.ts`, `full-flow-auditor.spec.ts`
  - İşlem yapan kullanıcının IP, User-Agent, tarih ve çalışma alanı bilgilerinin denetim günlüklerine yazıldığının teyit edilmesi.
  - Arka plan JS hataları ve yetkisiz 401/403 API isteklerinin denetlenmesi.

### 7. Arayüz ve Buton Doğrulamaları (`tests/e2e/ui/`)
* Arayüz elemanları, sayfalama (pagination) kontrolleri, modal butonları ve yönlendirme kararlılığı:
  - `backups-ui.spec.ts`, `dashboard-layout-ui.spec.ts`, `repositories-ui.spec.ts`, `restore-ui.spec.ts`, `schedulers-ui.spec.ts`, `storage-ui.spec.ts`, `workspace-settings-ui.spec.ts`, `workspace-switcher-mocked.spec.ts`.

---

## ⚡ Öne Çıkan Teknik Özellikler

1. **Dinamik Workspace ID Çözümleme (`workspace-resolver.ts`)**:
   - Testler sabit bir Workspace ID'ye (örn. `345`) bağımlı kalmaz. Canlı oturumdaki çalışma alanını (`351`, `352` vb.) URL'den dinamik olarak tespit eder ve testlerin farklı hesaplarda patlamasını engeller.
2. **Yönlendirme Kurtarması (`safeGoto`)**:
   - Chromium ve Next.js istemci taraflı yönlendirmelerde oluşan `net::ERR_ABORTED` hatalarını yakalar ve testi düşürmeden kararlı bir şekilde sayfayı yükler.
3. **Canlı OTP ve E-posta Dinleyicileri**:
   - Gmail IMAP, Mail.tm API, Atlassian Email OTP ve Microsoft OTP entegrasyonları ile doğrulama kodlarını insan müdahalesine gerek kalmadan milisaniyeler içinde çeker.
4. **Captcha Toleransı**:
   - Google reCAPTCHA ve Cloudflare Turnstile token alanlarını arka planda polling yöntemiyle takip eder. Manuel müdahale gereken durumlarda konsola açıklayıcı yönlendirme basar.

---

## 🛠️ Kurulum ve Çalıştırma

### 1. Bağımlılıkların Yüklenmesi
Projeyi çalıştırmadan önce yerel paketleri ve Playwright tarayıcılarını yükleyin:
```bash
npm install
npx playwright install
```

### 2. Ortam Değişkenleri (`.env`)
Proje kök dizininde bir `.env` dosyası oluşturun ve gerekli değişkenleri tanımlayın:
```env
WORKSPACE_ID=351
DASHBOARD_BASE_URL=https://staging.dashboard.gitsec.io
API_BASE_URL=https://staging.api.gitsec.io
E2E_USER_EMAIL=your-email@example.com
E2E_USER_PASSWORD=your-password
BITBUCKET_TEST_USER=your-bitbucket-email
BITBUCKET_TEST_PASSWORD=your-bitbucket-password
GITHUB_TEST_USER=your-github-username
GITHUB_TEST_PASSWORD=your-github-password
```

### 3. Test Çalıştırma Komutları

* **Tüm Testleri Koşturma**:
  ```bash
  npm test
  ```

* **Belirli Bir Testi Başlıklı (Headed) Modda Koşturma**:
  ```bash
  npx playwright test tests/e2e/auth/login.spec.ts --headed
  ```

* **Manuel / İnteraktif Testleri Koşturma**:
  ```bash
  npm run test:manual-ui
  ```

* **Dinamik Kod Sağlayıcı Seçimiyle Koşturma**:
  ```bash
  # PowerShell
  $env:E2E_CODE_PROVIDER="bitbucket"; npx playwright test tests/e2e/providers/repositories-backup.spec.ts

  # Bash
  E2E_CODE_PROVIDER=bitbucket npx playwright test tests/e2e/providers/repositories-backup.spec.ts
  ```

---

## 🖥️ Yerel Yönetim ve Koşum Paneli (Local Test Dashboard)

Projede, tüm test senaryolarını web arayüzü üzerinden tek tıkla başlatabileceğiniz, canlı konsol çıktılarını ve ekran görüntülerini izleyebileceğiniz **Yerel Test Yönetim Paneli** bulunmaktadır.

* **Sunucuyu Başlatma**:
  ```bash
  node tests-server.js
  ```
* Sunucu başladıktan sonra tarayıcınızdan **`http://127.0.0.1:3000`** (veya `http://127.0.0.1:3001`) adresine giderek:
  - Testleri tekil veya toplu olarak tetikleyebilir,
  - Kod sağlayıcısını (GitHub / Bitbucket) dinamik olarak değiştirebilir,
  - Zamanlayıcı tiplerini (Weekly, Daily, Cron) seçebilir,
  - Lisans planlarını test etmek için ödeme / sms girdilerini belirleyebilirsiniz.
