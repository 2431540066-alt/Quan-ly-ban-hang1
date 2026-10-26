const test = require('node:test'), assert = require('node:assert');
const { buildInsights } = require('./insights');

test('insights summarize paid sales and rank products', () => {
  const result = buildInsights([
    { total: 30000, items: [{ productId: 1, qty: 2, product: { name: 'Nước' } }, { productId: 2, qty: 1, product: { name: 'Bánh' } }] },
    { total: 20000, items: [{ productId: 1, qty: 3, product: { name: 'Nước' } }] },
  ], []);
  assert.equal(result.revenue, 50000);
  assert.equal(result.orderCount, 2);
  assert.deepEqual(result.topProducts[0], { name: 'Nước', qty: 5 });
});

test('insights report low stock and handle empty sales', () => {
  const result = buildInsights([], [
    { id: 1, name: 'Hết hàng', stock: 0, minStock: 5 },
    { id: 2, name: 'Đủ hàng', stock: 8, minStock: 5 },
  ]);
  assert.equal(result.lowStock.length, 1);
  assert.equal(result.lowStock[0].name, 'Hết hàng');
  assert.match(result.messages[0], /Chưa có đơn/);
});
