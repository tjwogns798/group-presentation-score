// AI 한컷 교실 서버
// - 선생님 PC에서 실행: node ai-hancut-server.js  (또는 AI한컷-서버켜기.bat 더블클릭)
// - PC 브라우저로 http://localhost:8080 을 열어 촬영
// - 찍은 사진을 QR로 보여 주면, 같은 와이파이의 휴대폰이 이 PC에서 바로 받아 감
// - 사진은 인터넷에 올라가지 않고, 서버를 끄면 모두 지워짐(메모리에만 보관)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const HTML_FILE = path.join(__dirname, 'AI한컷.html');
const MAX_PHOTOS = 300;
const MAX_BYTES = 20 * 1024 * 1024;
const photos = new Map(); // id -> { buf, time }

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^169\.254\./.test(a.address)) continue; // 연결 안 된 어댑터
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const virtual = /vmware|virtualbox|vEthernet|hyper-v|wsl|docker|loopback/i.test(name);
      out.push({ address: a.address, name, score: (priv ? 2 : 0) + (virtual ? -3 : 0) });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function photoPage(id) {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 한컷 사진 받기</title>
<style>
  body{margin:0; min-height:100vh; font-family:'Malgun Gothic',system-ui,sans-serif; color:#f3eeff;
    background:radial-gradient(ellipse at top,#2d1b69,#1b1042 70%); display:flex; flex-direction:column; align-items:center;
    padding:20px 16px; box-sizing:border-box; text-align:center;}
  h1{margin:4px 0 14px; font-size:24px;}
  img{max-width:100%; border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.4);}
  a{display:inline-block; margin-top:18px; padding:14px 26px; border-radius:99px; font-size:18px; font-weight:700;
    background:linear-gradient(135deg,#ff6b9d,#ffb347); color:#2a0f3a; text-decoration:none;}
  p{color:#b8adde; font-size:14px; line-height:1.6;}
</style></head>
<body>
  <h1>📸 나의 AI 한컷</h1>
  <img src="/p/${id}.png" alt="AI 한컷 사진">
  <a href="/p/${id}.png?dl=1" download="AI한컷_${id}.png">💾 사진 저장하기</a>
  <p>저장이 안 되면 사진을 <b>길게 눌러</b> ‘사진 앱에 저장’ 또는 ‘이미지 저장’을 눌러 주세요.</p>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) return send(res, 500, 'text/plain; charset=utf-8', 'AI한컷.html 파일을 찾을 수 없어요. 서버 파일과 같은 폴더에 두세요.');
      send(res, 200, 'text/html; charset=utf-8', data);
    });
    return;
  }

  if (req.method === 'GET' && p === '/api/info') {
    return send(res, 200, 'application/json', JSON.stringify({ port: PORT, addresses: lanAddresses() }));
  }

  if (req.method === 'POST' && p === '/api/upload') {
    if (!isLocal(req)) return send(res, 403, 'text/plain; charset=utf-8', '사진 올리기는 선생님 PC에서만 할 수 있어요.');
    const chunks = []; let size = 0, aborted = false;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BYTES) { aborted = true; send(res, 413, 'text/plain', 'too large'); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const buf = Buffer.concat(chunks);
      if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return send(res, 400, 'text/plain', 'PNG only');
      const id = crypto.randomBytes(6).toString('base64url');
      photos.set(id, { buf, time: Date.now() });
      while (photos.size > MAX_PHOTOS) photos.delete(photos.keys().next().value);
      console.log(`📸 사진 저장됨 (${photos.size}장 보관 중) → /p/${id}`);
      send(res, 200, 'application/json', JSON.stringify({ id, path: `/p/${id}` }));
    });
    return;
  }

  const m = p.match(/^\/p\/([A-Za-z0-9_-]+)(\.png)?$/);
  if (req.method === 'GET' && m) {
    if (!m[2]) console.log(`📱 사진 페이지 접속: ${req.socket.remoteAddress?.replace('::ffff:', '')} → /p/${m[1]}`);
    const item = photos.get(m[1]);
    if (!item) return send(res, 404, 'text/html; charset=utf-8',
      '<meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:20px">사진을 찾을 수 없어요. 서버가 다시 켜졌다면 사진이 지워졌을 수 있어요.</p>');
    if (m[2]) {
      const headers = url.searchParams.has('dl') ? { 'Content-Disposition': `attachment; filename="AI-hancut-${m[1]}.png"` } : {};
      return send(res, 200, 'image/png', item.buf, headers);
    }
    return send(res, 200, 'text/html; charset=utf-8', photoPage(m[1]));
  }

  send(res, 404, 'text/plain; charset=utf-8', 'Not found');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\n❌ ${PORT}번 포트를 이미 쓰고 있어요. 서버가 이미 켜져 있는지 확인하세요.`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log('\n========================================');
  console.log('  📸 AI 한컷 서버가 켜졌어요!');
  console.log('========================================');
  console.log(`  선생님 PC에서 열기:  http://localhost:${PORT}`);
  if (lan.length) console.log(`  휴대폰이 받을 주소:  http://${lan[0].address}:${PORT}  (같은 와이파이)`);
  else console.log('  ⚠️ 네트워크 연결을 찾지 못했어요. 와이파이/랜 연결을 확인하세요.');
  console.log('\n  창을 닫으면 서버가 꺼지고 사진도 지워져요.');
  console.log('========================================\n');
});
