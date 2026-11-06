const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MyRoom } = require('../lib/rooms/MyRoom');

test('ignores malformed movement instead of poisoning shared player state', () => {
  const room = new MyRoom();
  room.autoDispose = false;
  room.setPatchRate(null);
  const handlers = {};
  room.onMessage = (name, handler) => { handlers[name] = handler; };
  room.onCreate({});
  const client = { sessionId: 'movement-test' };
  room.onJoin(client, {});
  const player = room.state.players.get(client.sessionId);
  handlers.updatePosition(client, { x: 'bad', y: null, z: Infinity });
  assert.equal(player.x, 0);
  assert.equal(player.y, 0);
  assert.equal(player.z, 0);
  assert.doesNotThrow(() => handlers.updatePosition(client, null));
});

test('ignores malformed text messages without corrupting the shared schema', () => {
  const room = new MyRoom();
  room.autoDispose = false;
  room.setPatchRate(null);
  const handlers = {};
  room.onMessage = (name, handler) => { handlers[name] = handler; };
  room.onCreate({});
  const client = { sessionId: 'text-test' };
  room.onJoin(client, {});
  const player = room.state.players.get(client.sessionId);
  const before = player.toJSON();
  handlers.updateName(client, { name: {} });
  handlers.updateAnimation(client, { animstate: 5 });
  handlers.updateCharacter(client, { base: [], head: null, body: {}, pants: 1 });
  assert.deepEqual(player.toJSON(), before);
  for (const name of ['updateName', 'updateAnimation', 'updateCharacter']) {
    assert.doesNotThrow(() => handlers[name](client, null));
  }
});
