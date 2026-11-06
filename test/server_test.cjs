const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('self-hosted server exposes health but not the unauthenticated admin monitor', async t => {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['lib/index.js'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), sleep(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });
  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 60; i++) {
    try { health = await fetch(`${base}/health`); break; } catch { await sleep(100); }
  }
  assert.ok(health, `server did not start: ${logs}`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal((await fetch(`${base}/colyseus`)).status, 404);
});
