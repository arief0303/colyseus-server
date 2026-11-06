const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const { Client } = require('colyseus.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await sleep(30);
  }
  assert.fail(`Timed out: ${label}`);
}

async function startServer(t) {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--max-old-space-size=96', 'lib/index.js'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(1000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    assert.equal(child.exitCode, null, `server exited during startup: ${logs}`);
    try {
      const res = await fetch(`${base}/health`);
      await res.body.cancel();
      return res.status === 200;
    } catch { return false; }
  }, `server startup: ${logs}`);
  return {
    base,
    endpoint: `ws://127.0.0.1:${port}`,
    async healthy() {
      await sleep(30);
      assert.equal(child.exitCode, null, `server process exited: ${logs}`);
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).status, 'ok');
    }
  };
}

async function verifyReplication(server) {
  let a, b;
  try {
    a = await new Client(server.endpoint).create('my_room', { name: 'Security A' });
    b = await new Client(server.endpoint).joinById(a.roomId, { name: 'Security B' });
    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2, 'two schema-v2 players');
    a.send('updatePosition', { x: 5, y: 1, z: 7, rx: 0, ry: 1, rz: 0 });
    a.send('updateAnimation', { animstate: 'walk' });
    a.send('updateName', { name: 'Still healthy' });
    a.send('updateCharacter', { base: 'Male', head: 'HeadMaleBase', body: 'BodyMaleBase', pants: 'PantsMaleBase' });
    await waitFor(() => {
      const player = b.state.players.get(a.sessionId);
      return player?.x === 5 && player.y === 1 && player.z === 7 && player.ry === 1 &&
        player.animstate === 'walk' && player.name === 'Still healthy' && player.base === 'Male';
    }, 'position/animation/name/character replication after attack');
    const sessionId = a.sessionId;
    await a.leave();
    a = null;
    await waitFor(() => b.state.players.size === 1 && !b.state.players.has(sessionId), 'departure replication');
  } finally {
    if (a) await a.leave();
    if (b) await b.leave();
  }
  await server.healthy();
}

test('inherited message types are rejected without killing the process (JSON and bytes)', { timeout: 20000 }, async t => {
  const server = await startServer(t);
  const types = [...new Set(['__proto__', 'x'.repeat(124), '🚀'.repeat(40), ...Object.getOwnPropertyNames(Object.prototype), 'unknown-message', 0])];
  for (const format of ['json', 'bytes']) {
    for (const type of types) {
      const room = await new Client(server.endpoint).create('my_room');
      let closeCode;
      room.onLeave(code => { closeCode = code; });
      if (format === 'json') room.send(type, {});
      else room.sendBytes(type, new Uint8Array([1, 2, 3]));
      await waitFor(() => closeCode !== undefined, `${format} message ${String(type)} rejection`);
      await server.healthy();
      assert.equal(closeCode, 4002, `${format} ${String(type)} must use the normal invalid-message close`);
    }
  }
  await verifyReplication(server);
});

test('malformed and allocation-sized wire data is rejected before legacy decoding', { timeout: 20000 }, async t => {
  const server = await startServer(t);
  const { encode } = require('@colyseus/schema');
  const header = [13];
  encode.string(header, 'updateName');
  const packets = [
    [13, 0xdb, 0xff, 0xff, 0xff, 0xff],
    [17, 0xdb, 0xff, 0xff, 0xff, 0xff],
    [...header, 0xdb, 0xff, 0xff, 0xff, 0xff],
    [...header, 0xdd, 0xff, 0xff, 0xff, 0xff],
    [...header, 0xdf, 0xff, 0xff, 0xff, 0xff],
    [13],
  ];
  for (const packet of packets) {
    const room = await new Client(server.endpoint).create('my_room');
    let closeCode;
    room.onLeave(code => { closeCode = code; });
    room.connection.send(new Uint8Array(packet).buffer);
    await waitFor(() => closeCode !== undefined, 'invalid packet rejection');
    await server.healthy();
    assert.equal(closeCode, 4002);
  }
  await verifyReplication(server);
});

function bodyOfSize(size) {
  return Buffer.from(JSON.stringify({ padding: 'x'.repeat(size - Buffer.byteLength('{"padding":""}')) }));
}

function post(server, { headers = {}, chunks = [], end = true, delay = 0 }) {
  return new Promise((resolve, reject) => {
    let responseStarted = false;
    const req = http.request(`${server.base}/matchmake/create/my_room`, {
      method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.test', ...headers }
    }, res => {
      responseStarted = true;
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data).toString() });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('No bounded HTTP response within 3 seconds')), 3000);
    req.on('error', error => {
      if (!responseStarted) {
        clearTimeout(timer);
        reject(error);
      }
    });
    req.flushHeaders();
    (async () => {
      for (const chunk of chunks) {
        if (req.destroyed) break;
        req.write(chunk);
        if (delay) await sleep(delay);
      }
      if (end && !req.destroyed) req.end();
    })().catch(reject);
  });
}

async function roomIds(server) {
  const res = await fetch(`${server.base}/matchmake/my_room`);
  assert.equal(res.status, 200);
  return (await res.json()).map(room => room.roomId).sort();
}

const oversizedRequests = [
  ['Content-Length 1048615 bytes', () => ({
    headers: { 'Content-Length': '1048615' }, chunks: [bodyOfSize(1048615)]
  })],
  ['Content-Length 4097 bytes', () => ({
    headers: { 'Content-Length': '4097' }, chunks: [bodyOfSize(4097)]
  })],
  ['misleading huge Content-Length before the body ends', () => ({
    headers: { 'Content-Length': '1000000000' }, chunks: ['{'], end: false
  })],
  ['chunked 1048615-byte body', () => ({
    headers: { 'Transfer-Encoding': 'chunked' }, chunks: [bodyOfSize(1048615)]
  })],
  ['streamed chunked body crossing 4096 bytes before the terminator', () => {
    const body = bodyOfSize(4097);
    return { headers: { 'Transfer-Encoding': 'chunked' },
      chunks: [body.subarray(0, 2048), body.subarray(2048, 4096), body.subarray(4096)],
      end: false, delay: 20 };
  }],
  ['UTF-8 body exceeding the byte limit but not the character limit', () => {
    const body = Buffer.from(JSON.stringify({ padding: 'é'.repeat(2042) }));
    assert.ok(body.length > 4096 && body.toString().length < 4096);
    return { headers: { 'Transfer-Encoding': 'chunked' }, chunks: [body] };
  }]
];

for (const [label, request] of oversizedRequests) {
  test(`HTTP matchmaking rejects ${label} without creating a room`, { timeout: 12000 }, async t => {
    const server = await startServer(t);
    assert.deepEqual(await roomIds(server), []);
    const res = await post(server, request());
    assert.equal(res.status, 413, `${label}: ${res.body.slice(0, 250)}`);
    assert.equal(res.headers.connection, 'close');
    assert.equal(res.headers['access-control-allow-origin'], 'https://example.test');
    assert.match(JSON.parse(res.body).error, /4096/);
    await sleep(50);
    assert.deepEqual(await roomIds(server), [], 'rejected body must never dispatch room creation');
    await verifyReplication(server);
  });
}

function rawRequest(server, data, abortAfterWrite = false) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(new URL(server.base).port), '127.0.0.1');
    let response = '';
    const timer = setTimeout(() => socket.destroy(new Error('Raw HTTP connection did not close')), 3000);
    socket.on('connect', () => {
      socket.write(data, () => {
        if (abortAfterWrite) setTimeout(() => socket.destroy(), 50);
      });
    });
    socket.on('data', chunk => { response += chunk; });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); resolve(response); });
  });
}

test('HTTP matchmaking rejects ambiguous framing and ignores aborted bodies', { timeout: 12000 }, async t => {
  const server = await startServer(t);
  const response = await rawRequest(server,
    'POST /matchmake/create/my_room HTTP/1.1\r\nHost: localhost\r\n' +
    'Content-Length: 2\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n' +
    '1001\r\n' + bodyOfSize(4097).toString() + '\r\n0\r\n\r\n');
  assert.match(response, /^HTTP\/1\.1 400 /, 'Node must reject conflicting framing before matchmaking');
  await rawRequest(server,
    'POST /matchmake/create/my_room HTTP/1.1\r\nHost: localhost\r\n' +
    'Content-Length: 4096\r\n\r\n{"padding":"incomplete', true);
  await sleep(100);
  assert.deepEqual(await roomIds(server), []);
  await verifyReplication(server);
});

test('HTTP matchmaking closes rejected keep-alive uploads after a complete 413', { timeout: 12000 }, async t => {
  const server = await startServer(t);
  const head = 'POST /matchmake/create/my_room HTTP/1.1\r\nHost: localhost\r\n' +
    'Origin: https://example.test\r\nConnection: keep-alive\r\n';
  const body = bodyOfSize(4097).toString();
  for (const request of [
    head + 'Content-Length: 1000000000\r\n\r\n',
    head + 'Transfer-Encoding: chunked\r\n\r\n1001\r\n' + body + '\r\n'
  ]) {
    // Deliberately never end the upload: only the server can close this socket.
    const response = await rawRequest(server, request);
    assert.match(response, /^HTTP\/1\.1 413 /);
    assert.match(response, /\r\nConnection: close\r\n/i);
    assert.match(response, /"error":"Matchmaking body exceeds 4096 bytes"/);
    assert.ok(response.endsWith('\r\n0\r\n\r\n'), '413 must flush its complete chunked body before closing');
    assert.deepEqual(await roomIds(server), []);
    await server.healthy();
  }
  await verifyReplication(server);
});

for (const framing of ['Content-Length', 'chunked']) {
  test(`HTTP matchmaking accepts an exactly 4096-byte valid ${framing} body`, { timeout: 12000 }, async t => {
    const server = await startServer(t);
    const body = bodyOfSize(4096);
    const res = await post(server, {
      headers: framing === 'Content-Length' ? { 'Content-Length': '4096' } : { 'Transfer-Encoding': 'chunked' },
      chunks: [body.subarray(0, 2048), body.subarray(2048)], delay: 20
    });
    assert.equal(res.status, 200);
    const reservation = JSON.parse(res.body);
    assert.equal(typeof reservation.room.roomId, 'string');
    assert.equal(typeof reservation.sessionId, 'string');
    assert.deepEqual(await roomIds(server), [reservation.room.roomId]);
    await verifyReplication(server);
  });
}
