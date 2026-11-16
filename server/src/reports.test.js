const test = require('node:test'), assert = require('node:assert');
const { summarizeOrders } = require('./reports');

test('report separates product sales, discounts, shipping, and provisional profit', () => {
  const result = summarizeOrders([{
    createdAt: new Date('2026-01-02T03:00:00Z'),
    total: 125000,
    discount: 10000,
    shippingFee: 5000,
    items: [
      { price: 60000, qty: 2, cost: 40000 },
      { price: 10000, qty: 1, cost: 5000 },
    ],
  }]);

  assert.equal(result.productRevenue, 130000);
  assert.equal(result.discount, 10000);
  assert.equal(result.shippingRevenue, 5000);
  assert.equal(result.revenue, 120000);
  assert.equal(result.cogs, 85000);
  assert.equal(result.profit, 35000);
  assert.equal(result.totalCollected, 125000);
  assert.deepEqual(result.daily, [{ date: '2026-01-02', revenue: 120000 }]);
});
