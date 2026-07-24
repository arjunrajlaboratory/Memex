const test = require('node:test');
const assert = require('node:assert/strict');

const { externalNavigationPolicy, installDenyByDefaultPermissions } = require('../dist/main/web-policy.js');

test('only explicit renderer requests may leave the app', () => {
  assert.equal(externalNavigationPolicy('explicit', 'https://example.com'), 'open');
  assert.equal(externalNavigationPolicy('automatic', 'https://example.com'), 'deny');
  assert.equal(externalNavigationPolicy('explicit', 'file:///etc/passwd'), 'deny');
});

test('session permission guards deny checks, requests, and device grants', () => {
  const installed = {};
  const fakeSession = {
    setPermissionCheckHandler(handler) { installed.check = handler; },
    setPermissionRequestHandler(handler) { installed.request = handler; },
    setDevicePermissionHandler(handler) { installed.device = handler; },
  };
  installDenyByDefaultPermissions(fakeSession);

  assert.equal(installed.check(null, 'media', 'https://example.com', {}), false);
  let granted = true;
  installed.request({}, 'media', (value) => { granted = value; }, {});
  assert.equal(granted, false);
  assert.equal(installed.device({ deviceType: 'usb', origin: 'https://example.com', device: {} }), false);
});
