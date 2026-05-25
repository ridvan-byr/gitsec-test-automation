const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;

// Aktif bağlantıları saklayacağımız küme
const clients = new Set();
let activeProcess = null;
let testRunning = false;

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
  // CORS ayarları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Ana Sayfa
  if (req.url === '/' || req.url === '/index.html') {
    serveStaticFile(res, path.join(__dirname, 'index.html'), 'text/html');
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

  // 2. Canlı Log Akışı (SSE)
  if (req.url === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    clients.add(res);

    // İlk bağlantıda durum bildirme
    res.write(`event: status\ndata: ${JSON.stringify({ running: testRunning })}\n\n`);

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
          includeMode, excludeMode
        } = JSON.parse(body || '{}');

        if (testRunning) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Zaten aktif bir test çalışıyor!' }));
          return;
        }

        testRunning = true;
        broadcast('status', { running: true });

        // Playwright argümanlarını derleyelim
        const args = ['playwright', 'test'];
        
        if (testFile) {
          args.push(testFile);
        }
        if (tag) {
          args.push('--grep', tag);
        }
        if (headed) {
          args.push('--headed');
        }

        console.log(`[Server] Başlatılan komut: npx ${args.join(' ')}`);
        broadcast('log', `[DASHBOARD] Komut başlatılıyor: npx ${args.join(' ')}\n`);

        // Ortam değişkenlerini hazırlayalım
        const runEnv = { ...process.env, FORCE_COLOR: '1' };
        if (timezone) {
          runEnv.E2E_TIMEZONE = timezone;
          console.log(`[Server] E2E_TIMEZONE eklendi: ${timezone}`);
        }
        if (workspaceId) {
          runEnv.WORKSPACE_ID = workspaceId;
          console.log(`[Server] WORKSPACE_ID eklendi: ${workspaceId}`);
        }
        if (baseUrl) {
          runEnv.DASHBOARD_BASE_URL = baseUrl;
          console.log(`[Server] DASHBOARD_BASE_URL eklendi: ${baseUrl}`);
        }
        if (scheduleName) {
          runEnv.E2E_SCHEDULE_NAME = scheduleName;
          console.log(`[Server] E2E_SCHEDULE_NAME eklendi: ${scheduleName}`);
        }
        if (scheduleTime) {
          runEnv.E2E_SCHEDULE_TIME = scheduleTime;
          console.log(`[Server] E2E_SCHEDULE_TIME eklendi: ${scheduleTime}`);
        }
        if (includeCode !== undefined) {
          runEnv.E2E_INCLUDE_CODE = String(includeCode);
          console.log(`[Server] E2E_INCLUDE_CODE eklendi: ${includeCode}`);
        }
        if (includePr !== undefined) {
          runEnv.E2E_INCLUDE_PR = String(includePr);
          console.log(`[Server] E2E_INCLUDE_PR eklendi: ${includePr}`);
        }
        if (includeIssues !== undefined) {
          runEnv.E2E_INCLUDE_ISSUES = String(includeIssues);
          console.log(`[Server] E2E_INCLUDE_ISSUES eklendi: ${includeIssues}`);
        }
        if (scheduleType) {
          runEnv.E2E_SCHEDULE_TYPE = scheduleType;
          console.log(`[Server] E2E_SCHEDULE_TYPE eklendi: ${scheduleType}`);
        }
        if (weeklyDay) {
          runEnv.E2E_WEEKDAY = weeklyDay;
          console.log(`[Server] E2E_WEEKDAY eklendi: ${weeklyDay}`);
        }
        if (monthlyDay) {
          runEnv.E2E_MONTHDAY = monthlyDay;
          console.log(`[Server] E2E_MONTHDAY eklendi: ${monthlyDay}`);
        }
        if (cronExpression) {
          runEnv.E2E_CRON_EXPR = cronExpression;
          console.log(`[Server] E2E_CRON_EXPR eklendi: ${cronExpression}`);
        }
        if (includeMode) {
          runEnv.E2E_INCLUDE_MODE = includeMode;
          console.log(`[Server] E2E_INCLUDE_MODE eklendi: ${includeMode}`);
        }
        if (excludeMode) {
          runEnv.E2E_EXCLUDE_MODE = excludeMode;
          console.log(`[Server] E2E_EXCLUDE_MODE eklendi: ${excludeMode}`);
        }

        // Windows ortamında npx spawn edildiğinde bazen env değişkenleri alt süreçlere (Playwright) aktarılamayabilir.
        // Bu yüzden değerleri doğrudan .env dosyasına yazarak Playwright'ın "dotenv" kütüphanesiyle bunu %100 kararlılıkla okumasını garanti ediyoruz.
        try {
          const envPath = path.join(__dirname, '.env');
          let currentVars = {};
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
                currentVars[key] = val;
              }
            }
          }
          
          if (includeMode) {
            currentVars['E2E_INCLUDE_MODE'] = includeMode;
          }
          if (excludeMode) {
            currentVars['E2E_EXCLUDE_MODE'] = excludeMode;
          }

          let output = '# Gitsec Test Automation - Cevre Degiskenleri\n';
          for (const [key, val] of Object.entries(currentVars)) {
            if (key && val !== undefined) {
              output += `${key}=${val}\n`;
              process.env[key] = val; // Sunucu belleğinde güncelle
              runEnv[key] = val;      // Playwright sürecine geçir
            }
          }
          fs.writeFileSync(envPath, output, 'utf8');
          console.log(`[Server] .env dosyası başarıyla güncellendi: E2E_INCLUDE_MODE=${includeMode}, E2E_EXCLUDE_MODE=${excludeMode}`);
        } catch (envErr) {
          console.error('[Server] .env güncellenirken hata oluştu:', envErr.message);
        }

        activeProcess = spawn('npx', args, {
          shell: true,
          cwd: __dirname,
          env: runEnv
        });

        activeProcess.stdout.on('data', data => {
          broadcast('log', data.toString());
        });

        activeProcess.stderr.on('data', data => {
          broadcast('log', data.toString());
        });

        activeProcess.on('close', code => {
          console.log(`[Server] Test tamamlandı, çıkış kodu: ${code}`);
          testRunning = false;
          activeProcess = null;
          broadcast('status', { running: false });
          broadcast('done', { success: code === 0, code });
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
      if (exists) {
        mtime = fs.statSync(googleSessionPath).mtime;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists, mtime }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 3c. Google Manuel Giriş Tetikleme (API)
  if (req.url === '/api/google-login' && req.method === 'POST') {
    if (testRunning) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Zaten aktif bir test veya işlem çalışıyor!' }));
      return;
    }

    testRunning = true;
    broadcast('status', { running: true });

    const scriptPath = path.join(__dirname, 'scripts', 'login-google-manually.ts');
    console.log(`[Server] Başlatılan Google Manuel Giriş komutu: npx tsx ${scriptPath}`);
    broadcast('log', `[DASHBOARD] Google Manuel Oturum Açma aracı başlatılıyor...\n`);

    activeProcess = spawn('npx', ['tsx', 'scripts/login-google-manually.ts'], {
      shell: true,
      cwd: __dirname,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    activeProcess.stdout.on('data', data => {
      broadcast('log', data.toString());
    });

    activeProcess.stderr.on('data', data => {
      broadcast('log', data.toString());
    });

    activeProcess.on('close', code => {
      console.log(`[Server] Google login aracı tamamlandı, çıkış kodu: ${code}`);
      testRunning = false;
      activeProcess = null;
      broadcast('status', { running: false });
      broadcast('done', { success: code === 0, code });
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Google oturum açma aracı başlatıldı.' }));
    return;
  }

  // 4. Test Durdurma (API)
  if (req.url === '/api/stop' && req.method === 'POST') {
    if (activeProcess) {
      // Windows ortamında alt süreç ağacını öldürmek için taskkill kullanalım
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', activeProcess.pid, '/f', '/t']);
      } else {
        activeProcess.kill('SIGINT');
      }
      broadcast('log', '\n[DASHBOARD] Test süreci kullanıcı tarafından durduruldu.\n');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Test durduruldu.' }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Çalışan aktif test bulunamadı.' }));
    }
    return;
  }

  // 5. env Ayarlarını Oku (API)
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
          envVars[key] = val;
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
        
        let output = '# Gitsec Test Automation - Cevre Degiskenleri\n';
        for (const [key, val] of Object.entries(newVars)) {
          if (key && val !== undefined) {
            output += `${key}=${val}\n`;
            // Update in-memory process.env so spawned tests immediately receive it
            process.env[key] = val;
            console.log(`[Server] Environment variable HOT-LOADED: ${key}=${val}`);
          }
        }

        fs.writeFileSync(envPath, output, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '.env dosyası güncellendi ve çalışma ortamına yüklendi.' }));
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

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`[DASHBOARD] Sunucu http://localhost:${PORT} adresinde aktif!`);
  console.log(`==================================================`);
});
