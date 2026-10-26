const test = require('node:test'), assert = require('node:assert');
const { canTransition } = require('./order-status');

test('customer orders follow the fulfillment lifecycle', () => {
  assert.equal(canTransition('PENDING', 'CONFIRMED'), true);
  assert.equal(canTransition('CONFIRMED', 'SHIPPING'), true);
  assert.equal(canTransition('SHIPPING', 'PAID'), true);
  assert.equal(canTransition('PENDING', 'PAID'), false);
  assert.equal(canTransition('PAID', 'CANCELLED'), false);
  assert.equal(canTransition('CANCELLED', 'CONFIRMED'), false);
});

test('unconfirmed and confirmed orders may be cancelled', () => {
  assert.equal(canTransition('PENDING', 'CANCELLED'), true);
  assert.equal(canTransition('CONFIRMED', 'CANCELLED'), true);
  assert.equal(canTransition('SHIPPING', 'CANCELLED'), false);
});
