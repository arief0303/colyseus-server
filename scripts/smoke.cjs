const assert = require('node:assert/strict');
const { Client } = require('colyseus.js');
const endpoint = process.env.COLYSEUS_URL || 'wss://artificer.taila649bb.ts.net:8443';
const waitFor = async (check, label) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
};

(async () => {
  let a, b;
  try {
    a = await new Client(endpoint).create('my_room', { name: 'Probe A' });
    b = await new Client(endpoint).joinById(a.roomId, { name: 'Probe B' });
    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2, 'two players');
    a.send('updatePosition', { x: 5, y: 0, z: 7, rx: 0, ry: 1, rz: 0 });
    a.send('updateAnimation', { animstate: 'walk' });
    a.send('updateName', { name: 'Probe A moved' });
    await waitFor(() => b.state.players.get(a.sessionId)?.x === 5 && b.state.players.get(a.sessionId)?.animstate === 'walk' && b.state.players.get(a.sessionId)?.name === 'Probe A moved', 'position, animation and name replication');
    a.send('updatePosition', { x: 'bad', y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
    a.send('updateName', { name: {} });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(b.state.players.get(a.sessionId).x, 5);
    assert.equal(b.state.players.get(a.sessionId).name, 'Probe A moved');
    await a.leave();
    a = null;
    await waitFor(() => b.state.players.size === 1, 'departure replication');
    console.log(JSON.stringify({ endpoint, join: 'pass', replication: 'pass', malformedInput: 'pass', departure: 'pass' }));
  } finally {
    if (a) await a.leave();
    if (b) await b.leave();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
