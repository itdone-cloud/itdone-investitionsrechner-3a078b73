// Investitionsrechner — statischer Dateiserver (Resolver-Reihenfolge wie im
// Plattform-Standard: exakte Datei -> Datei+.html -> index.html) PLUS eine
// einzige API-Route für die Live-Zinsempfehlung. Zero Dependencies, Node 22.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DIST = path.join(HERE, 'dist');
const ROOT = fs.existsSync(path.join(DIST, 'index.html')) ? DIST : HERE;
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function resolveStatic(pathname) {
  let p = pathname;
  if (p !== '/') p = p.replace(/\/+$/, '');
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return null;
  const isFile = (f) => fs.existsSync(f) && fs.statSync(f).isFile();
  if (isFile(file)) return file;
  if (isFile(file + '.html')) return file + '.html';
  if (fs.existsSync(file) && fs.statSync(file).isDirectory() && isFile(path.join(file, 'index.html'))) {
    return path.join(file, 'index.html');
  }
  return path.join(ROOT, 'index.html');
}

// --- Live-Zinsempfehlung -----------------------------------------------
// Basis: EZB-Hauptrefinanzierungssatz (öffentliche SDMX-Schnittstelle, kein
// Schlüssel nötig) + fester Risikoaufschlag für ein durchschnittliches
// Investitionsrisiko. Ergebnis wird 1h im Speicher zwischengehalten; schlägt
// der Live-Abruf fehl, greift ein plausibler Ersatzwert statt eines Fehlers.
const ECB_URL =
  'https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.MRR_FR.LEV?format=jsondata&lastNObservations=1';
const RISIKOAUFSCHLAG = 1.75;
const ERSATZ_BASISZINS = 2.65;
const CACHE_MS = 60 * 60 * 1000;
let cache = { at: 0, basiszins: null, stand: null };

async function holeBasiszins() {
  const now = Date.now();
  if (cache.basiszins !== null && now - cache.at < CACHE_MS) return cache;
  try {
    const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const series = data.dataSets[0].series;
    const seriesKey = Object.keys(series)[0];
    const obs = series[seriesKey].observations;
    const obsKeys = Object.keys(obs).sort((a, b) => Number(b) - Number(a));
    const value = obs[obsKeys[0]][0];
    const timeValues = data.structure.dimensions.observation[0].values;
    const stand = (timeValues[Number(obsKeys[0])] || timeValues[timeValues.length - 1] || {}).id || null;
    if (typeof value !== 'number') throw new Error('kein Zahlenwert');
    cache = { at: now, basiszins: value, stand };
    return cache;
  } catch (err) {
    if (cache.basiszins !== null) return cache; // alten Wert weiterverwenden statt Fehler
    return { at: now, basiszins: ERSATZ_BASISZINS, stand: null };
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

http
  .createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }

    if (pathname === '/api/zinssatz-empfehlung') {
      holeBasiszins()
        .then(({ basiszins, stand }) => {
          const empfehlung = Math.round((basiszins + RISIKOAUFSCHLAG) * 100) / 100;
          sendJson(res, 200, {
            basiszins,
            aufschlag: RISIKOAUFSCHLAG,
            empfehlung,
            quelle: stand ? 'EZB-Hauptrefinanzierungssatz' : 'Ersatzwert (Live-Daten gerade nicht erreichbar)',
            stand,
          });
        })
        .catch(() => {
          const empfehlung = Math.round((ERSATZ_BASISZINS + RISIKOAUFSCHLAG) * 100) / 100;
          sendJson(res, 200, {
            basiszins: ERSATZ_BASISZINS,
            aufschlag: RISIKOAUFSCHLAG,
            empfehlung,
            quelle: 'Ersatzwert (Live-Daten gerade nicht erreichbar)',
            stand: null,
          });
        });
      return;
    }

    const file = resolveStatic(pathname);
    if (!file) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not Found');
      }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`investitionsrechner läuft auf :${PORT}`);
  });
