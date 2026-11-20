// SnagWalk live inspector relay.
//
// Browser <-> this service <-> Gemini Live (Vertex AI). The browser streams mic audio (PCM16, 16 kHz) and about one
// camera frame per second; Gemini answers with speech (PCM16, 24 kHz) and calls `log_snag` when it sees a defect.
// The relay never touches the database: the browser saves the snag through the main app's photo route, so every
// snag goes through the same validation, storage and guardrails as a manual capture.
//
// Runs as its own Cloud Run service because Next.js route handlers and Firebase Hosting cannot hold WebSockets.

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';

const PORT = Number(process.env.PORT || 8080);
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'snagwalk-515212';
const LOCATION = process.env.LIVE_LOCATION || 'asia-south1';
const MODEL = process.env.LIVE_MODEL || 'gemini-3.8-live';
const MAX_SESSION_MS = Number(process.env.LIVE_MAX_SESSION_MS || 5 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.LIVE_MAX_SESSIONS || 8);
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'https://snagwalk-app.web.app,https://snagwalk-app.firebaseapp.com,https://snagwalk-351000257799.asia-southeast1.run.app,http://localhost:3000,http://localhost:3200,http://localhost:3201'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CATEGORIES = ['wall_paint', 'tiles', 'plumbing', 'electrical', 'doors_windows', 'woodwork', 'ceiling', 'flooring', 'other'];

const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });

const logSnagTool = {
  functionDeclarations: [
    {
      name: 'log_snag',
      description:
        'Log a defect that is clearly visible in the current camera view, or that the buyer explicitly reports. ' +
        'The app captures a sharp photo at this moment and adds it to the snag list.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: 'One short sentence naming the defect and where it is.' },
          category: { type: Type.STRING, enum: CATEGORIES },
          severity: { type: Type.STRING, enum: ['minor', 'major', 'critical'] },
        },
        required: ['description', 'category', 'severity'],
      },
    },
  ],
};

function systemInstruction(room) {
  return `You are SnagWalk's live inspector, on a video call with a first-time home buyer during the possession-day
inspection of their new flat in India. They are in the ${room}. You receive their camera about once a second and hear them.

How to behave:
- Speak in short, warm, practical sentences (one or two at a time). You are guiding, not lecturing.
- Walk them through what to check in this room, one item at a time, and tell them where to point the camera.
- When a defect is clearly visible (crack, seepage or damp, hollow/chipped/uneven tile, grout gap, paint flaw, loose or
  damaged fitting, scorched or loose socket, leak, door or window not closing flush), ask them to hold steady, name it in
  one sentence, and call log_snag. Log each defect once.
- Never invent a defect. If the view is unclear, ask them to move closer or add light.
- Answer in the language the buyer speaks (English, Hindi or Marathi).
- Severity: critical = water seepage, exposed or scorched wiring, structural or glass crack, sewage leak;
  major = chipped or hollow tile, broken latch, water pooling, unpainted patch, jamming door; minor = cosmetic.`;
}

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
let active = 0;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, model: MODEL, location: LOCATION, active }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://x');
  const origin = req.headers.origin || '';
  if (url.pathname !== '/ws' || !ALLOWED_ORIGINS.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, url));
});

wss.on('connection', async (ws, url) => {
  if (active >= MAX_SESSIONS) {
    send(ws, { type: 'error', message: 'The live inspector is busy. Try again in a minute.' });
    ws.close(1013, 'busy');
    return;
  }
  active++;
  const room = (url.searchParams.get('room') || 'room').replace(/[^\p{L}\p{N} &'-]/gu, '').slice(0, 40) || 'room';
  const started = Date.now();
  let session = null;
  let closed = false;

  const finish = (reason) => {
    if (closed) return;
    closed = true;
    active--;
    clearTimeout(cap);
    try {
      session?.close();
    } catch {}
    send(ws, { type: 'end', reason });
    try {
      ws.close(1000, reason);
    } catch {}
    console.log(JSON.stringify({ event: 'live_session_end', room, reason, seconds: Math.round((Date.now() - started) / 1000) }));
  };
  const cap = setTimeout(() => finish('time'), MAX_SESSION_MS);

  try {
    session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: systemInstruction(room),
        tools: [logSnagTool],
      },
      callbacks: {
        onmessage: (m) => {
          const sc = m.serverContent;
          if (sc?.modelTurn?.parts) {
            for (const p of sc.modelTurn.parts) {
              if (p.inlineData?.data) send(ws, { type: 'audio', data: p.inlineData.data });
            }
          }
          if (sc?.outputTranscription?.text) send(ws, { type: 'transcript', role: 'model', text: sc.outputTranscription.text });
          if (sc?.inputTranscription?.text) send(ws, { type: 'transcript', role: 'user', text: sc.inputTranscription.text });
          if (sc?.interrupted) send(ws, { type: 'interrupted' });
          if (sc?.turnComplete) send(ws, { type: 'turn' });
          const calls = m.toolCall?.functionCalls || [];
          if (calls.length) {
            for (const c of calls) if (c.name === 'log_snag') send(ws, { type: 'log_snag', id: c.id, args: c.args || {} });
            session?.sendToolResponse({
              functionResponses: calls.map((c) => ({
                id: c.id,
                name: c.name,
                response: { result: 'Photo captured and added to the snag list. Briefly confirm, then continue.' },
              })),
            });
          }
        },
        onerror: (e) => {
          console.error('[live] gemini error', e?.message || e);
          send(ws, { type: 'error', message: 'The live connection to Gemini dropped.' });
          finish('error');
        },
        onclose: () => finish('gemini_closed'),
      },
    });
  } catch (e) {
    console.error('[live] connect failed', e?.message || e);
    send(ws, { type: 'error', message: 'Could not reach Gemini Live.' });
    finish('connect_failed');
    return;
  }

  if (closed) return;
  send(ws, { type: 'ready', model: MODEL, maxSeconds: Math.round(MAX_SESSION_MS / 1000) });
  // Gemini speaks first: a one-line greeting and the first thing to check.
  session.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: `I am in the ${room}. Greet me in one sentence and tell me the first thing to check.` }] }],
    turnComplete: true,
  });

  ws.on('message', (raw) => {
    if (closed) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'audio' && typeof msg.data === 'string') {
      session.sendRealtimeInput({ audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } });
    } else if (msg.type === 'frame' && typeof msg.data === 'string') {
      session.sendRealtimeInput({ video: { data: msg.data, mimeType: 'image/jpeg' } });
    } else if (msg.type === 'text' && typeof msg.text === 'string') {
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: msg.text.slice(0, 500) }] }], turnComplete: true });
    } else if (msg.type === 'end') {
      finish('client_end');
    }
  });
  ws.on('close', () => finish('client_closed'));
  ws.on('error', () => finish('client_error'));
});

server.listen(PORT, () => console.log(`snagwalk-live on :${PORT} (${MODEL} @ ${LOCATION})`));
