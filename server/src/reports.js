function summarizeOrders(orders) {
  let productRevenue = 0, discount = 0, shippingRevenue = 0, cogs = 0, totalCollected = 0;
  const daily = {};

  for (const order of orders) {
    const grossProductRevenue = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const netProductRevenue = grossProductRevenue - (order.discount || 0);
    productRevenue += grossProductRevenue;
    discount += order.discount || 0;
    shippingRevenue += order.shippingFee || 0;
    cogs += order.items.reduce((sum, item) => sum + item.cost * item.qty, 0);
    totalCollected += order.total;
    const date = new Date(order.createdAt.getTime() + 7 * 36e5).toISOString().slice(0, 10);
    daily[date] = (daily[date] || 0) + netProductRevenue;
  }

  const revenue = productRevenue - discount;
  return {
    productRevenue,
    discount,
    shippingRevenue,
    revenue,
    cogs: Math.round(cogs),
    profit: Math.round(revenue - cogs),
    totalCollected,
    orders: orders.length,
    avg: orders.length ? Math.round(totalCollected / orders.length) : 0,
    daily: Object.entries(daily).sort().map(([date, revenue]) => ({ date, revenue })),
  };
}

module.exports = { summarizeOrders };
