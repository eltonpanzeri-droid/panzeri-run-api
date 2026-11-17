// Servidor de TESTE local para o app do relogio (emulador): imita as tres rotas do Panzeri Run sem banco e sem dados reais.
//   node tools/mock-server.js            -> http://localhost:8787 (no emulador: http://10.0.2.2:8787)
// O pareamento e' "confirmado" sozinho na 4a consulta; a semana tem treinos ficticios com datas de hoje em diante.
const http = require('http');
const PORT = Number(process.env.PORT || 8787);
let polls = 0;
let consent = false; // POST /__consent liga/desliga a autorizacao da aluna (teste do 403 wear_consent_required)
const received = [];
const TOKEN = 'mock-token-' + Math.random().toString(36).slice(2);
const iso = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const week = () => ({
  generatedAt: new Date().toISOString(),
  sessions: [
    { id: 's1', date: iso(0), weekday: 1, kind: 'corrida', title: 'Corrida', durationMin: 40, distanceKm: 6, done: false, steps: [{ kind: 'step', label: null, role: 'main', goal: { type: 'distance', meters: 6000 }, pace: { fastSecPerKm: 370, slowSecPerKm: 410 } }] },
    { id: 's2', date: iso(1), weekday: 2, kind: 'forca', title: 'Musculação', durationMin: 60, distanceKm: null, done: false, steps: [] },
    { id: 's3', date: iso(2), weekday: 3, kind: 'corrida', title: 'Intervalado', durationMin: 70, distanceKm: 10.8, done: false, steps: [
      { kind: 'step', label: 'Aquecimento', role: 'main', goal: { type: 'distance', meters: 2000 }, pace: null },
      { kind: 'repeat', repeatCount: 5, steps: [
        { kind: 'step', label: 'Forte', role: 'work', goal: { type: 'distance', meters: 1000 }, pace: { fastSecPerKm: 310, slowSecPerKm: 310 } },
        { kind: 'step', label: null, role: 'recovery', goal: { type: 'time', seconds: 120 }, pace: null } ] },
      { kind: 'step', label: 'Desaquecimento', role: 'main', goal: { type: 'distance', meters: 1800 }, pace: null } ] },
    { id: 's4', date: iso(-1), weekday: 0, kind: 'corrida', title: 'Corrida feita', durationMin: 30, distanceKm: 5, done: true, steps: [] },
  ],
});
http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    console.log(req.method, req.url, req.headers.authorization ? '(com credencial)' : '');
    if (req.method === 'POST' && req.url === '/wear/pairing/start') { polls = 0; return send(201, { pairingId: 'p1', code: 'AB3K-7MPQ', pollSecret: 'segredo', expiresAt: new Date(Date.now() + 600000).toISOString() }); }
    if (req.method === 'POST' && req.url === '/wear/pairing/poll') { polls += 1; return send(201, polls >= 4 ? (polls === 4 ? { status: 'paired', token: TOKEN } : { status: 'already_issued' }) : { status: 'pending' }); }
    if (req.method === 'POST' && req.url === '/__consent') { consent = !consent; return send(200, { consent }); }
    if (req.method === 'GET' && req.url === '/__received') return send(200, received.map((r) => ({ clientId: r.clientId, points: r.points.length, durationSec: r.durationSec, elapsedSec: r.elapsedSec, movingSec: r.movingSec })));
    if (req.method === 'POST' && req.url === '/wear/activities') {
      if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { message: 'Unauthorized' });
      if (!consent) return send(403, { code: 'wear_consent_required', message: 'Autorize o relogio no Panzeri Run.' });
      try { const body = JSON.parse(raw); if (!received.some((r) => r.clientId === body.clientId)) received.push(body); return send(201, { stored: true, classification: null, removed: [] }); } catch { return send(400, { code: 'wear_activity_invalid', message: 'json' }); }
    }
    if (req.method === 'GET' && req.url === '/wear/week') { return req.headers.authorization === 'Bearer ' + TOKEN ? send(200, week()) : send(401, { message: 'Unauthorized' }); }
    send(404, { message: 'nao existe' });
  });
}).listen(PORT, () => console.log('mock do Panzeri Run em http://localhost:' + PORT));
