const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.VOICE_CORE_PORT || 6060);
const HOST = process.env.VOICE_CORE_HOST || '127.0.0.1';
const BEARER = process.env.VOICE_CORE_BEARER_TOKEN || '';

const sessions = new Map();

function log(msg, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), msg, ...extra });
  console.log(line);
}

function wsAcceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function encodeWsTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset];
    const b2 = buffer[offset + 1];
    const fin = !!(b1 & 0x80);
    const opcode = b1 & 0x0f;
    const masked = !!(b2 & 0x80);
    let len = b2 & 0x7f;
    let headerLen = 2;

    if (len === 126) {
      if (offset + 4 > buffer.length) break;
      len = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (offset + 10 > buffer.length) break;
      const n = Number(buffer.readBigUInt64BE(offset + 2));
      len = n;
      headerLen = 10;
    }

    const maskLen = masked ? 4 : 0;
    const total = headerLen + maskLen + len;
    if (offset + total > buffer.length) break;

    let payload = buffer.subarray(offset + headerLen + maskLen, offset + total);
    if (masked) {
      const mask = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    frames.push({ fin, opcode, payload });
    offset += total;
  }

  return { frames, rest: buffer.subarray(offset) };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'elpaseo-voice-core' }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  if (BEARER) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${BEARER}`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = wsAcceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  let buf = Buffer.alloc(0);
  let callSid = null;

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const decoded = decodeWsFrames(buf);
    buf = decoded.rest;

    for (const frame of decoded.frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode !== 0x1) continue;

      const msg = safeJsonParse(frame.payload.toString('utf8'));
      if (!msg || typeof msg !== 'object') continue;

      if (msg.type === 'session-start') {
        callSid = msg.callSid || null;
        if (callSid) sessions.set(callSid, { startedAt: Date.now(), streamSid: msg.streamSid || null });
        log('session-start', { callSid: msg.callSid, streamSid: msg.streamSid });
        socket.write(encodeWsTextFrame(JSON.stringify({ type: 'session-ack', callSid: msg.callSid })));
        continue;
      }

      if (msg.type === 'session-stop') {
        if (msg.callSid) sessions.delete(msg.callSid);
        log('session-stop', { callSid: msg.callSid, reason: msg.reason || null });
        continue;
      }

      if (msg.type === 'twilio-media') {
        // Placeholder for future duplex/barge-in logic:
        // - VAD on inbound media
        // - emit {type:"bargein.detected"}
        // - stream assistant audio back as {type:"audio", payload:"<mulaw b64>"}
        continue;
      }
    }
  });

  socket.on('close', () => {
    if (callSid) sessions.delete(callSid);
  });

  socket.on('error', (err) => {
    log('ws-error', { error: String(err) });
  });
});

server.listen(PORT, HOST, () => {
  log('voice-core-started', { host: HOST, port: PORT, bearerProtected: !!BEARER });
});
