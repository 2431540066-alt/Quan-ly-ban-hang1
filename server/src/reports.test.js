const test = require('node:test'), assert = require('node:assert');
const { summarizeOrders, summarizeBreakdowns } = require('./reports');

test('report separates product sales, discounts, shipping, expenses, and profit', () => {
  const result = summarizeOrders([{
    createdAt: new Date('2026-01-02T03:00:00Z'),
    total: 125000,
    discount: 10000,
    shippingFee: 5000,
    items: [
      { price: 60000, qty: 2, cost: 40000 },
      { price: 10000, qty: 1, cost: 5000 },
    ],
  }], [{ amount: 2000 }]);

  assert.equal(result.productRevenue, 130000);
  assert.equal(result.discount, 10000);
  assert.equal(result.shippingRevenue, 5000);
  assert.equal(result.revenue, 120000);
  assert.equal(result.cogs, 85000);
  assert.equal(result.expenses, 2000);
  assert.equal(result.profit, 38000);
  assert.equal(result.totalCollected, 125000);
  assert.deepEqual(result.daily, [{ date: '2026-01-02', revenue: 120000 }]);
});

test('report removes fully refunded orders from sales, cost, and collections', () => {
  const result = summarizeOrders([{
    createdAt: new Date('2026-01-02T03:00:00Z'),
    total: 125000,
    discount: 10000,
    shippingFee: 5000,
    returnRequest: { refundStatus: 'COMPLETED', refundAmount: 125000 },
    items: [{ price: 130000, qty: 1, cost: 85000 }],
  }]);

  assert.equal(result.revenue, 0);
  assert.equal(result.shippingRevenue, 0);
  assert.equal(result.cogs, 0);
  assert.equal(result.refunds, 125000);
  assert.equal(result.returnedOrders, 1);
  assert.equal(result.orders, 0);
  assert.equal(result.totalCollected, 0);
  assert.equal(result.daily[0].revenue, 0);
});

test('report groups sales by employee, category, and payment method', () => {
  const result = summarizeBreakdowns([{
    payment: 'CASH',
    total: 25000,
    user: { name: 'Lan', role: 'SALES' },
    items: [{ qty: 2, price: 10000, product: { category: { name: 'Đồ uống' } } }],
  }]);

  assert.deepEqual(result.employees, [{ name: 'Lan', orders: 1, returnedOrders: 0, revenue: 25000 }]);
  assert.deepEqual(result.categories, [{ name: 'Đồ uống', quantity: 2, revenue: 20000 }]);
  assert.deepEqual(result.payments, [{ method: 'CASH', orders: 1, returnedOrders: 0, revenue: 25000 }]);
});
