const test = require('node:test'), assert = require('node:assert');
const { buildInsights } = require('./insights');

test('insights summarize paid sales and rank products', () => {
  const result = buildInsights([
    { discount: 0, items: [{ productId: 1, qty: 2, price: 10000, product: { name: 'Nước' } }, { productId: 2, qty: 1, price: 10000, product: { name: 'Bánh' } }] },
    { discount: 0, items: [{ productId: 1, qty: 2, price: 10000, product: { name: 'Nước' } }] },
  ], []);
  assert.equal(result.revenue, 50000);
  assert.equal(result.orderCount, 2);
  assert.deepEqual(result.topProducts[0], { name: 'Nước', qty: 4 });
});

test('insights exclude shipping and discount from product revenue', () => {
  const result = buildInsights([
    { total: 9500, discount: 1000, items: [{ productId: 1, qty: 1, price: 10000, product: { name: 'Bánh' } }] },
  ], []);
  assert.equal(result.revenue, 9000);
  assert.match(result.messages[0], /doanh thu sản phẩm sau giảm giá 9\.000/);
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
