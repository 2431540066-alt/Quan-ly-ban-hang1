const test = require('node:test'), assert = require('node:assert');
const { isExpired } = require('./product-expiry');

test('a product remains saleable through its expiry date in Vietnam time', () => {
  const expiryDate = new Date('2026-03-10T00:00:00.000Z');
  assert.equal(isExpired(expiryDate, new Date('2026-03-10T16:59:59.999Z')), false);
  assert.equal(isExpired(expiryDate, new Date('2026-03-10T17:00:00.000Z')), true);
});

test('products without an expiry date are not expired', () => {
  assert.equal(isExpired(null, new Date('2026-03-10T17:00:00.000Z')), false);
});
