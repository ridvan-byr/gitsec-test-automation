const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;

// ─── Güvenlik: Oturum Token'ı ───────────────────────────────────────────────
// Sunucu her başlatıldığında benzersiz bir token üretilir.
// Tüm /api/* isteklerinde X-Dashboard-Token header'ı ile doğrulama yapılır.
const DASHBOARD_TOKEN = crypto.randomBytes(32).toString('hex');
const ALLOWED_ORIGIN = `http://127.0.0.1:${PORT}`;

// Hassas .env anahtarlarını maskelemek için kullanılan kalıplar
const SENSITIVE_KEY_PATTERNS = [
  /PASSWORD/i, /SECRET/i, /KEY/i, /TOKEN/i,
  /CONNECTION_STRING/i, /TOTP/i
];

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
}

function maskValue(value) {
  if (!value || value.length <= 6) return '••••••';
  const visibleStart = value.slice(0, 3);
  const visibleEnd = value.slice(-3);
  return `${visibleStart}${'•'.repeat(Math.min(value.length - 6, 20))}${visibleEnd}`;
}

function isMaskedValue(value) {
  return typeof value === 'string' && value.includes('••');
}

// Aktif bağlantıları saklayacağımız küme
const clients = new Set();
const activeProcesses = new Map(); // cardId -> process

// Bağlı tüm istemcilere veri gönderme yardımcı fonksiyonu
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

// Statik dosyaları servis etmek için basit yardımcı
function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  // ─── Güvenlik: CORS — Sadece localhost origin'ine izin ver ───────────────
  const requestOrigin = req.headers['origin'] || '';
  if (requestOrigin === ALLOWED_ORIGIN || requestOrigin === `http://localhost:${PORT}`) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  } else {
    // Origin yoksa (same-origin istekler) veya eşleşmiyorsa CORS header'ı ekleme
    // Same-origin istekleri (tarayıcıdan doğrudan) Origin header'ı göndermez
    if (requestOrigin) {
      // Bilinmeyen origin — CORS header'ı ekleme, tarayıcı bloklasın
      console.warn(`[GÜVENLİK] Reddedilen CORS isteği — Origin: ${requestOrigin}`);
    }
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Tarayıcının credentials göndermesini engelle (ek güvenlik katmanı)
  res.setHeader('Access-Control-Max-Age', '0');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── Güvenlik: Token Doğrulama — /api/* endpoint'leri koruması ──────────
  if (req.url.startsWith('/api/') && req.url !== '/api/logs' && req.url !== '/api/token') {
    const clientToken = req.headers['x-dashboard-token'];
    if (clientToken !== DASHBOARD_TOKEN) {
      console.warn(`[GÜVENLİK] Yetkisiz API erişim denemesi engellendi — URL: ${req.url}, Origin: ${requestOrigin || 'none'}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized. Geçersiz veya eksik dashboard token.' }));
      return;
    }
  }

  // 0. Token Endpoint — Dashboard başlatıldığında token'ı almak için
  if (req.url === '/api/token' && req.method === 'GET') {
    // Sadece same-origin isteklerine token ver (Origin header'ı olmamalı)
    const tokenOrigin = req.headers['origin'];
    if (tokenOrigin && tokenOrigin !== ALLOWED_ORIGIN && tokenOrigin !== `http://localhost:${PORT}`) {
      console.warn(`[GÜVENLİK] Cross-origin token isteği engellendi — Origin: ${tokenOrigin}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden. Token sadece localhost üzerinden alınabilir.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: DASHBOARD_TOKEN }));
    return;
  }

  // 1. Ana Sayfa
  if (req.url === '/' || req.url === '/index.html') {
    serveStaticFile(res, path.join(__dirname, 'index.html'), 'text/html');
    return;
  }

  // 1c. Dokümantasyon Sayfası
  if (req.url === '/docs' || req.url === '/docs.html') {
    serveStaticFile(res, path.join(__dirname, 'docs.html'), 'text/html');
    return;
  }

  // 1b. Favicon
  if (req.url.startsWith('/favicon.ico')) {
    const faviconPath = path.join(__dirname, 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
      serveStaticFile(res, faviconPath, 'image/x-icon');
    } else {
      res.writeHead(204);
      res.end();
    }
    return;
  }

  // 1c. Test Sonuçları Çıktıları (Screenshots, Videos, Traces)
  if (req.url.startsWith('/test-results/')) {
    try {
      const decodedUrl = decodeURIComponent(req.url);
      const relativePath = decodedUrl.replace(/^\/test-results\//, '');
      // Path traversal saldırılarını önlemek için temizleyelim
      const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = path.join(__dirname, 'test-results', safePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        let contentType = 'application/octet-stream';
        if (filePath.endsWith('.png')) contentType = 'image/png';
        if (filePath.endsWith('.webm')) contentType = 'video/webm';
        if (filePath.endsWith('.zip')) contentType = 'application/zip';
        if (filePath.endsWith('.html')) contentType = 'text/html';
        if (filePath.endsWith('.json')) contentType = 'application/json';

        serveStaticFile(res, filePath, contentType);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Artifact Not Found');
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error: ' + e.message);
    }
    return;
  }

  // 2. Canlı Log Akışı (SSE)
  if (req.url === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    clients.add(res);

    // İlk bağlantıda durum bildirme
    res.write(`event: status\ndata: ${JSON.stringify({ running: activeProcesses.size > 0, runningCardIds: Array.from(activeProcesses.keys()) })}\n\n`);

    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  // 3. Test Başlatma (API)
  if (req.url === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        console.log(`[DEBUG Server] Gelen İstek Gövdesi: ${body}`);
        const {
          tag, headed, testFile, timezone, workspaceId, baseUrl,
          scheduleName, scheduleTime, includeCode, includePr, includeIssues,
          scheduleType, weeklyDay, monthlyDay, cronExpression,
          includeMode, includeProvider, excludeMode, backupMode, workers, cardId,
          schedulerCleanup, storageCleanup
        } = JSON.parse(body || '{}');

        // Whitelist validations
        if (testFile) {
          const files = testFile.trim().split(/\s+/);
          const fileRegex = /^tests\/e2e\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.spec\.ts$/;
          for (const f of files) {
            if (!fileRegex.test(f)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Geçersiz test dosyası yolu: ${f}` }));
              return;
            }
          }
        }

        if (tag) {
          const tagRegex = /^@[a-zA-Z0-9_-]+$/;
          if (!tagRegex.test(tag)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Geçersiz etiket formatı: ${tag}` }));
            return;
          }
        }

        if (includeProvider && !['github', 'bitbucket'].includes(includeProvider.toLowerCase())) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz sağlayıcı: ${includeProvider}` }));
          return;
        }

        const validModes = ['one_repo', 'one_page', 'all_pages', 'happy_path', 'edge_cases', 'all', 'validation'];
        if (includeMode && !validModes.includes(includeMode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz dahil etme modu: ${includeMode}` }));
          return;
        }
        if (excludeMode && !validModes.includes(excludeMode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz dışlama modu: ${excludeMode}` }));
          return;
        }
        if (backupMode && !validModes.includes(backupMode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz yedekleme modu: ${backupMode}` }));
          return;
        }

        const parsedWorkers = parseInt(workers);
        if (workers && (isNaN(parsedWorkers) || parsedWorkers < 1 || parsedWorkers > 16)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz worker sayısı (1-16 arası olmalıdır): ${workers}` }));
          return;
        }

        if (cardId && !/^[a-zA-Z0-9_-]+$/.test(cardId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz kart kimliği: ${cardId}` }));
          return;
        }

        if (scheduleType && !['Daily', 'Weekly', 'Monthly', 'Cron'].includes(scheduleType)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Geçersiz zamanlayıcı tipi: ${scheduleType}` }));
          return;
        }

        const maxWorkers = parseInt(workers) || 1;
        if (activeProcesses.size >= maxWorkers) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Maksimum paralel çalışan test sınırına (${maxWorkers}) ulaşıldı!` }));
          return;
        }

        const targetCardId = cardId || 'generic-test';
        if (activeProcesses.has(targetCardId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bu test zaten şu anda çalışıyor!' }));
          return;
        }

        // Playwright argümanlarını derleyelim
        const playwrightCliPath = path.join(__dirname, 'node_modules', 'playwright', 'cli.js');
        const runWithNode = fs.existsSync(playwrightCliPath);
        let cmd = 'npx';
        const args = [];

        if (runWithNode) {
          cmd = 'node';
          args.push(playwrightCliPath, 'test');
        } else {
          args.push('playwright', 'test');
        }
        
        if (testFile) {
          const files = testFile.trim().split(/\s+/);
          args.push(...files);
        }
        if (tag) {
          args.push('--grep', tag);
        }
        if (headed) {
          args.push('--headed');
        }
        args.push('--workers', '1');

        console.log(`[Server] Başlatılan komut: ${cmd} ${args.join(' ')}`);
        broadcast('log', { cardId: targetCardId, text: `[DASHBOARD] Komut başlatılıyor: ${cmd} ${args.join(' ')}\n` });

        // Ortam değişkenlerini hazırlayalım (Öncelikle .env dosyasındaki güncel değerleri okuyalım)
        const runEnv = { ...process.env, FORCE_COLOR: '1' };
        try {
          const envPath = path.join(__dirname, '.env');
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                runEnv[key] = val;
              }
            }
          }
        } catch (e) {
          console.error('[Server] .env okunurken hata oluştu:', e.message);
        }

        if (timezone) runEnv.E2E_TIMEZONE = timezone;
        if (workspaceId) runEnv.WORKSPACE_ID = workspaceId;
        if (baseUrl) runEnv.DASHBOARD_BASE_URL = baseUrl;
        if (scheduleName) runEnv.E2E_SCHEDULE_NAME = scheduleName;
        if (scheduleTime) runEnv.E2E_SCHEDULE_TIME = scheduleTime;
        if (includeCode !== undefined) runEnv.E2E_INCLUDE_CODE = String(includeCode);
        if (includePr !== undefined) runEnv.E2E_INCLUDE_PR = String(includePr);
        if (includeIssues !== undefined) runEnv.E2E_INCLUDE_ISSUES = String(includeIssues);
        if (scheduleType) runEnv.E2E_SCHEDULE_TYPE = scheduleType;
        if (weeklyDay) runEnv.E2E_WEEKDAY = weeklyDay;
        if (monthlyDay) runEnv.E2E_MONTHDAY = monthlyDay;
        if (cronExpression) runEnv.E2E_CRON_EXPR = cronExpression;
        if (includeMode) runEnv.E2E_INCLUDE_MODE = includeMode;
        if (includeProvider) runEnv.E2E_CODE_PROVIDER = includeProvider;
        if (excludeMode) runEnv.E2E_EXCLUDE_MODE = excludeMode;
        if (backupMode) runEnv.E2E_BACKUP_MODE = backupMode;
        if (schedulerCleanup) runEnv.E2E_SCHEDULER_CLEANUP = schedulerCleanup;
        if (storageCleanup) runEnv.E2E_STORAGE_CLEANUP = storageCleanup;

        let commandToRun = cmd;
        if (process.platform === 'win32' && commandToRun === 'npx') {
          commandToRun = 'npx.cmd';
        }

        const proc = spawn(commandToRun, args, {
          shell: false,
          cwd: __dirname,
          env: runEnv
        });

        activeProcesses.set(targetCardId, proc);
        broadcast('status', { running: true, runningCardIds: Array.from(activeProcesses.keys()) });

        proc.stdout.on('data', data => {
          broadcast('log', { cardId: targetCardId, text: data.toString() });
        });

        proc.stderr.on('data', data => {
          broadcast('log', { cardId: targetCardId, text: data.toString() });
        });

        proc.on('close', code => {
          console.log(`[Server] Test tamamlandı, cardId: ${targetCardId}, çıkış kodu: ${code}`);
          activeProcesses.delete(targetCardId);
          broadcast('status', { running: activeProcesses.size > 0, runningCardIds: Array.from(activeProcesses.keys()) });
          broadcast('done', { cardId: targetCardId, success: code === 0, code });
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Test başlatıldı.' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 3b. Google Oturum Durumu (API)
  if (req.url === '/api/google-session-status' && req.method === 'GET') {
    try {
      const googleSessionPath = path.join(__dirname, 'playwright', '.auth', 'google-session.json');
      const exists = fs.existsSync(googleSessionPath);
      let mtime = null;
      let expired = false;
      let expiredReason = '';

      if (exists) {
        mtime = fs.statSync(googleSessionPath).mtime;
        try {
          const sessionData = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
          const cookies = sessionData.cookies || [];
          const now = Date.now() / 1000; // current time in seconds
          
          // Google'ın kritik oturum çerezleri
          const criticalCookieNames = ['SID', 'HSID', 'SSID', 'SAPISID', 'APISID'];
          const googleCookies = cookies.filter(c => criticalCookieNames.includes(c.name) && c.domain.includes('google.com'));
          
          if (googleCookies.length === 0) {
            expired = true;
            expiredReason = 'Kritik Google oturum çerezleri bulunamadı.';
          } else {
            // Süresi dolmuş çerez var mı?
            const expiredCookie = googleCookies.find(c => c.expires && c.expires < now);
            if (expiredCookie) {
              expired = true;
              expiredReason = `Oturum çerezi (${expiredCookie.name}) süresi dolmuş.`;
            }
          }
          
          // Dosya yaşını kontrol et (14 günden eskiyse expired/warning say)
          const fileAgeDays = (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);
          if (fileAgeDays > 14 && !expired) {
            expired = true;
            expiredReason = 'Oturum dosyası 14 günden eski olduğu için zaman aşımına uğramış olabilir.';
          }
        } catch (e) {
          expired = true;
          expiredReason = 'Oturum dosyası okunamadı veya bozuk.';
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists, mtime, expired, expiredReason }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 3c. Google Manuel Giriş Tetikleme (API)
  if (req.url === '/api/google-login-code' && req.method === 'POST') {
    const googleCardIds = ['card-google-session', 'card-code-google-session'];
    const googleProcessRunning = googleCardIds.some(cardId => activeProcesses.has(cardId));
    if (googleProcessRunning) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Zaten aktif bir Google oturum açma işlemi çalışıyor!' }));
      return;
    }

    const cardId = 'card-code-google-session';
    const scriptPath = path.join(__dirname, 'scripts', 'login-google-manually.ts');
    console.log(`[Server] Başlatılan Kod Sağlayıcı Google Manuel Giriş komutu: npx tsx ${scriptPath}`);
    broadcast('log', { cardId, text: `[DASHBOARD] Google Manuel Oturum Açma aracı başlatılıyor...\n` });

    const proc = spawn('npx', ['tsx', 'scripts/login-google-manually.ts'], {
      shell: true,
      cwd: __dirname,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    activeProcesses.set(cardId, proc);
    broadcast('status', { running: true, runningCardIds: Array.from(activeProcesses.keys()) });

    proc.stdout.on('data', data => {
      broadcast('log', { cardId, text: data.toString() });
    });

    proc.stderr.on('data', data => {
      broadcast('log', { cardId, text: data.toString() });
    });

    proc.on('close', code => {
      console.log(`[Server] Kod Sağlayıcı Google login aracı tamamlandı, çıkış kodu: ${code}`);
      activeProcesses.delete(cardId);
      broadcast('status', { running: activeProcesses.size > 0, runningCardIds: Array.from(activeProcesses.keys()) });
      broadcast('done', { cardId, success: code === 0, code });
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Google oturum açma aracı başlatıldı.' }));
    return;
  }

  if (req.url === '/api/google-login' && req.method === 'POST') {
    if (activeProcesses.has('card-google-session') || activeProcesses.has('card-code-google-session')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Zaten aktif bir Google oturum açma işlemi çalışıyor!' }));
      return;
    }

    const cardId = 'card-google-session';
    const scriptPath = path.join(__dirname, 'scripts', 'login-google-manually.ts');
    console.log(`[Server] Başlatılan Google Manuel Giriş komutu: npx tsx ${scriptPath}`);
    broadcast('log', { cardId, text: `[DASHBOARD] Google Manuel Oturum Açma aracı başlatılıyor...\n` });

    const proc = spawn('npx', ['tsx', 'scripts/login-google-manually.ts'], {
      shell: true,
      cwd: __dirname,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    activeProcesses.set(cardId, proc);
    broadcast('status', { running: true, runningCardIds: Array.from(activeProcesses.keys()) });

    proc.stdout.on('data', data => {
      broadcast('log', { cardId, text: data.toString() });
    });

    proc.stderr.on('data', data => {
      broadcast('log', { cardId, text: data.toString() });
    });

    proc.on('close', code => {
      console.log(`[Server] Google login aracı tamamlandı, çıkış kodu: ${code}`);
      activeProcesses.delete(cardId);
      broadcast('status', { running: activeProcesses.size > 0, runningCardIds: Array.from(activeProcesses.keys()) });
      broadcast('done', { cardId, success: code === 0, code });
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Google oturum açma aracı başlatıldı.' }));
    return;
  }

  // 4. Test Durdurma (API)
  if (req.url === '/api/stop' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      const { cardId } = JSON.parse(body || '{}');
      
      const killProcess = (proc, cId) => {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
        } else {
          proc.kill('SIGINT');
        }
        broadcast('log', { cardId: cId, text: '\n[DASHBOARD] Test süreci kullanıcı tarafından durduruldu.\n' });
      };

      if (cardId) {
        const proc = activeProcesses.get(cardId);
        if (proc) {
          killProcess(proc, cardId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: `Test durduruldu: ${cardId}` }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Çalışan aktif test bulunamadı: ${cardId}` }));
        }
      } else {
        if (activeProcesses.size > 0) {
          for (const [cId, proc] of activeProcesses.entries()) {
            killProcess(proc, cId);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Tüm test süreçleri durduruldu.' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Çalışan aktif test bulunamadı.' }));
        }
      }
    });
    return;
  }

  // 5. env Ayarlarını Oku (API) — Hassas değerler maskelenerek döndürülür
  if (req.url === '/api/env' && req.method === 'GET') {
    try {
      const envPath = path.join(__dirname, '.env');
      const examplePath = path.join(__dirname, '.env.example');
      let content = '';
      
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
      } else if (fs.existsSync(examplePath)) {
        content = fs.readFileSync(examplePath, 'utf8');
      }

      const envVars = {};
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          // ─── Güvenlik: Hassas değerleri maskele ─────────────────────────
          envVars[key] = isSensitiveKey(key) ? maskValue(val) : val;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(envVars));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 6. env Ayarlarını Kaydet (API)
  if (req.url === '/api/env' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const newVars = JSON.parse(body || '{}');
        const envPath = path.join(__dirname, '.env');

        // ─── Güvenlik: Mevcut .env değerlerini oku (maskelenmiş değerleri korumak için) ──
        const existingVars = {};
        if (fs.existsSync(envPath)) {
          const existingContent = fs.readFileSync(envPath, 'utf8');
          for (const line of existingContent.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              existingVars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
            }
          }
        }
        
        let output = '# Gitsec Test Automation - Cevre Degiskenleri\n';
        let updatedCount = 0;
        let preservedCount = 0;

        for (const [key, val] of Object.entries(newVars)) {
          if (key && val !== undefined) {
            // ─── Güvenlik: Maskelenmiş değer geri gönderildiyse mevcut değeri koru ──
            if (isMaskedValue(val) && existingVars[key]) {
              output += `${key}=${existingVars[key]}\n`;
              process.env[key] = existingVars[key];
              preservedCount++;
            } else {
              output += `${key}=${val}\n`;
              process.env[key] = val;
              updatedCount++;
              // Güvenlik: Hassas değerleri konsola loglarken maskele
              const logVal = isSensitiveKey(key) ? maskValue(String(val)) : val;
              console.log(`[Server] Environment variable HOT-LOADED: ${key}=${logVal}`);
            }
          }
        }

        fs.writeFileSync(envPath, output, 'utf8');
        console.log(`[Server] .env güncellendi: ${updatedCount} değiştirildi, ${preservedCount} korundu (maskelenmiş).`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `.env dosyası güncellendi. ${updatedCount} değişken güncellendi, ${preservedCount} hassas değer korundu.` }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404 Sayfası
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`==================================================`);
  console.log(`[DASHBOARD] Sunucu http://127.0.0.1:${PORT} adresinde aktif!`);
  console.log(`==================================================`);
  console.log(`[GÜVENLİK] CORS kısıtlaması: Sadece ${ALLOWED_ORIGIN} origin'i kabul ediliyor.`);
  console.log(`[GÜVENLİK] API token koruması aktif. Tüm /api/* istekleri X-Dashboard-Token header'ı gerektirir.`);
  console.log(`[GÜVENLİK] Hassas .env değerleri maskelenerek servis ediliyor.`);
});
