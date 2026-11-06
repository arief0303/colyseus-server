const assert = require('node:assert/strict');
const { test } = require('node:test');
const lockfile = require('../package-lock.json');

test('dependencies are downloadable outside the former Tencent host', () => {
  for (const [name, pkg] of Object.entries(lockfile.packages || {})) {
    if (pkg.resolved) {
      assert.ok(!pkg.resolved.includes('mirrors.tencentyun.com'), `${name} still uses the private Tencent mirror`);
    }
  }
});
