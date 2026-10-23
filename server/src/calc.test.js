const test = require('node:test'), assert = require('node:assert');
const { calcOrder, avgCost } = require('./calc');
test('giảm theo %', () => assert.equal(calcOrder([{ price: 10000, qty: 3 }], { type: 'PERCENT', value: 10 }).total, 27000));
test('giảm tiền không vượt tổng', () => assert.equal(calcOrder([{ price: 5000, qty: 1 }], { type: 'AMOUNT', value: 20000 }).total, 0));
test('mã hết hạn báo lỗi', () => assert.throws(() => calcOrder([{ price: 1, qty: 1 }], { type: 'AMOUNT', value: 1, expiresAt: '2020-01-01' })));
test('giá vốn bình quân', () => assert.equal(avgCost(10, 100, 10, 200), 150));
