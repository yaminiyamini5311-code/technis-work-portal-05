const http = require('http');
const fs = require('fs');
const path = require('path');
const root = 'D:/Techins Portal/technis-work-portal-05';
const types = { '.html': 'text/html', '.mp4': 'video/mp4' };
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/video-analyze.html';
  const f = path.join(root, u);
  fs.stat(f, (e, s) => {
    if (e || !s.isFile()) { res.writeHead(404); res.end('nf'); return; }
    const range = req.headers.range;
    const total = s.size;
    const ct = types[path.extname(f).toLowerCase()] || 'application/octet-stream';
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      let st = parseInt(m[1] || '0', 10), en = m[2] ? parseInt(m[2], 10) : total - 1;
      res.writeHead(206, { 'Content-Range': 'bytes ' + st + '-' + en + '/' + total, 'Accept-Ranges': 'bytes', 'Content-Length': en - st + 1, 'Content-Type': ct });
      fs.createReadStream(f, { start: st, end: en }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': total, 'Content-Type': ct, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(f).pipe(res);
    }
  });
}).listen(8901, () => console.log('up'));
