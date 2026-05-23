const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const multer = require('multer');
const os = require('os');

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG  — edit these values to customize your instance
// ─────────────────────────────────────────────────────────────────────────────

const BANNER_TEXT   = 'Local Share';

const WRITE_ENABLED = true;           // false → hides Upload & New Folder for everyone

const AUTH_USER     = 'admin';        // username required for upload / folder creation
const AUTH_PASS     = 'admin';     // password required for upload / folder creation

// ─────────────────────────────────────────────────────────────────────────────

const app        = express();
const PORT       = process.env.PORT     || 3000;
const SHARE_ROOT = process.env.SHARE_DIR || path.join(process.cwd(), 'shared');

// Ensure shared directory exists
if (!fs.existsSync(SHARE_ROOT)) {
  fs.mkdirSync(SHARE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(SHARE_ROOT, 'README.txt'),
    'Welcome to Share!\nDrop files and folders here to share them over your network.\n');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function safeJoin(base, rel) {
  const target = path.normalize(path.join(base, rel || ''));
  if (!target.startsWith(base)) return null;
  return target;
}

function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, ip: iface.address });
      }
    }
  }
  return ips;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileInfo(filePath, name) {
  try {
    const stat = fs.statSync(filePath);
    return {
      name,
      isDir: stat.isDirectory(),
      size: stat.isDirectory() ? null : stat.size,
      sizeFormatted: stat.isDirectory() ? '—' : formatSize(stat.size),
      modified: stat.mtime.toISOString(),
      modifiedFormatted: stat.mtime.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    };
  } catch { return null; }
}

// ─── AUTH MIDDLEWARE (write operations only) ──────────────────────────────────

function requireAuth(req, res, next) {
  if (!WRITE_ENABLED) {
    return res.status(403).json({ error: 'Write operations are disabled.' });
  }
  const { user, pass } = req.body || {};
  const u = user || req.headers['x-auth-user'];
  const p = pass || req.headers['x-auth-pass'];
  if (u === AUTH_USER && p === AUTH_PASS) return next();
  return res.status(401).json({ error: 'Invalid credentials.' });
}

// Multer — destination resolved after auth (called from /api/upload which uses requireAuth)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const rel  = req.query.path || '';
    const dest = safeJoin(SHARE_ROOT, rel);
    if (!dest) return cb(new Error('Invalid path'));
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ─── STATIC UI ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ─── PUBLIC APIs ──────────────────────────────────────────────────────────────

app.get('/api/info', (req, res) => {
  const ips       = getNetworkIPs();
  const primaryIp = ips.length > 0 ? ips[0].ip : '127.0.0.1';
  const url       = `http://${primaryIp}:${PORT}`;
  res.json({ ips, primaryUrl: url, port: PORT, shareRoot: SHARE_ROOT,
             writeEnabled: WRITE_ENABLED, banner: BANNER_TEXT });
});

app.get('/api/list', (req, res) => {
  const rel = req.query.path || '';
  const dir = safeJoin(SHARE_ROOT, rel);
  if (!dir)                             return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(dir))              return res.status(404).json({ error: 'Not found' });
  if (!fs.statSync(dir).isDirectory())  return res.status(400).json({ error: 'Not a directory' });

  try {
    const entries = fs.readdirSync(dir);
    const items = entries
      .map(name => {
        const info = getFileInfo(path.join(dir, name), name);
        return info ? { ...info, path: path.posix.join(rel || '', name) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const parts = rel ? rel.split('/').filter(Boolean) : [];
    const breadcrumbs = [{ name: 'root', path: '' }];
    parts.forEach((p, i) => {
      breadcrumbs.push({ name: p, path: parts.slice(0, i + 1).join('/') });
    });

    res.json({ items, breadcrumbs, currentPath: rel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download', (req, res) => {
  const rel      = req.query.path;
  if (!rel)       return res.status(400).json({ error: 'No path' });
  const filePath = safeJoin(SHARE_ROOT, rel);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => res.status(500).end());
    archive.pipe(res);
    archive.directory(filePath, path.basename(filePath));
    archive.finalize();
  } else {
    res.download(filePath, path.basename(filePath));
  }
});

app.post('/api/download-multi', express.json(), (req, res) => {
  const { paths } = req.body;
  if (!paths || !paths.length) return res.status(400).json({ error: 'No paths' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="share-download.zip"');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.status(500).end());
  archive.pipe(res);

  for (const rel of paths) {
    const filePath = safeJoin(SHARE_ROOT, rel);
    if (!filePath || !fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) archive.directory(filePath, path.basename(filePath));
    else                    archive.file(filePath, { name: path.basename(filePath) });
  }
  archive.finalize();
});

// ─── WRITE APIs  (auth-gated) ──────────────────────────────────────────────────

// Upload: credentials come as custom headers set by the client
app.post('/api/upload', (req, res, next) => {
  if (!WRITE_ENABLED) return res.status(403).json({ error: 'Write operations are disabled.' });
  const u = req.headers['x-auth-user'];
  const p = req.headers['x-auth-pass'];
  if (u !== AUTH_USER || p !== AUTH_PASS) return res.status(401).json({ error: 'Invalid credentials.' });
  next();
}, upload.array('files'), (req, res) => {
  res.json({ uploaded: req.files.length, files: req.files.map(f => f.originalname) });
});

app.post('/api/mkdir', express.json(), requireAuth, (req, res) => {
  const { path: rel, name } = req.body;
  if (!name) return res.status(400).json({ error: 'No name' });
  const dirPath = safeJoin(SHARE_ROOT, path.join(rel || '', name));
  if (!dirPath) return res.status(400).json({ error: 'Invalid path' });
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/delete', express.json(), requireAuth, (req, res) => {
  const { path: rel } = req.body;
  if (!rel) return res.status(400).json({ error: 'No path' });
  const target = safeJoin(SHARE_ROOT, rel);
  if (!target || !fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
  try {
    fs.rmSync(target, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const ips = getNetworkIPs();
  const w   = 44;
  const line = (s) => console.log('║  ' + s.padEnd(w) + '  ║');
  console.log('\n╔' + '═'.repeat(w + 4) + '╗');
  line('  share — file server');
  console.log('╠' + '═'.repeat(w + 4) + '╣');
  line(`Local :  http://localhost:${PORT}`);
  ips.forEach(({ name, ip }) => line(`${name.substring(0,8).padEnd(8)}:  http://${ip}:${PORT}`));
  console.log('╠' + '═'.repeat(w + 4) + '╣');
  line(`Dir   :  ${SHARE_ROOT.substring(0, w - 9)}`);
  line(`Write :  ${WRITE_ENABLED ? 'enabled  (auth required)' : 'DISABLED'}`);
  console.log('╚' + '═'.repeat(w + 4) + '╝\n');
});
