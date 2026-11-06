const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const { Client } = require('colyseus.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  for (let i=0; i<100; i++) { if (await check()) return; await sleep(40); }
  assert.fail('Timeout: '+label);
}

test('city and landmark isolate players and returning travel rejoins only the correct area', {timeout:20000}, async t => {
  const reservation=http.createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['lib/index.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'});
  t.after(async()=>{ if(child.exitCode===null) { const exit=once(child,'exit'); child.kill('SIGTERM'); await Promise.race([exit,sleep(1000)]); if(child.exitCode===null) child.kill('SIGKILL'); } });
  await waitFor(async()=>{try {return (await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{return false;}},'server');
  const client=new Client(`ws://127.0.0.1:${port}`);
  const rooms=new Set();
  const join=async name=>{const room=await client.joinOrCreate(name);rooms.add(room);return room;};
  const leave=async room=>{await room.leave();rooms.delete(room);};
  try {
    let a=await join('my_room');
    const b=await join('landmark_room');
    const c=await join('my_room');
    assert.notEqual(a.roomId,b.roomId);
    assert.equal(a.roomId,c.roomId);
    await waitFor(()=>a.state.players.size===2 && c.state.players.size===2 && b.state.players.size===1,'initial area isolation');
    const oldSession=a.sessionId;
    await leave(a);
    a=await join('landmark_room');
    assert.equal(a.roomId,b.roomId);
    await waitFor(()=>a.state.players.size===2 && b.state.players.size===2 && c.state.players.size===1,'departure from old area');
    assert.equal(c.state.players.has(oldSession),false);
    await leave(a);
    a=await join('my_room');
    assert.equal(a.roomId,c.roomId);
    await waitFor(()=>a.state.players.size===2 && c.state.players.size===2 && b.state.players.size===1,'return to city without landmark ghosts');
  } finally { await Promise.all([...rooms].map(room=>room.leave())); }
});
