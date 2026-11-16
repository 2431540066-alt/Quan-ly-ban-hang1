const refunded = order => order.returnRequest?.refundStatus === 'COMPLETED';

function summarizeOrders(orders, expenses = []) {
  let productRevenue = 0, discount = 0, shippingRevenue = 0, cogs = 0, totalCollected = 0, refunds = 0;
  const daily = {};

  for (const order of orders) {
    const grossProductRevenue = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const netProductRevenue = grossProductRevenue - (order.discount || 0);
    productRevenue += grossProductRevenue;
    discount += order.discount || 0;
    const orderCogs = order.items.reduce((sum, item) => sum + item.cost * item.qty, 0);
    if (refunded(order)) {
      refunds += order.returnRequest.refundAmount ?? order.total;
    } else {
      shippingRevenue += order.shippingFee || 0;
      cogs += orderCogs;
      totalCollected += order.total;
    }
    const date = new Date(order.createdAt.getTime() + 7 * 36e5).toISOString().slice(0, 10);
    daily[date] = (daily[date] || 0) + (refunded(order) ? 0 : netProductRevenue);
  }

  const returnedSales = orders.filter(refunded).reduce((sum, order) =>
    sum + order.items.reduce((sales, item) => sales + item.price * item.qty, 0) - (order.discount || 0), 0);
  const returnedOrderCount = orders.filter(refunded).length;
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const revenue = productRevenue - discount - returnedSales;
  return {
    productRevenue,
    discount,
    shippingRevenue,
    refunds,
    returnedOrders: returnedOrderCount,
    revenue,
    cogs: Math.round(cogs),
    expenses: expenseTotal,
    profit: Math.round(revenue + shippingRevenue - cogs - expenseTotal),
    totalCollected,
    orders: orders.length - returnedOrderCount,
    avg: orders.length > returnedOrderCount ? Math.round(totalCollected / (orders.length - returnedOrderCount)) : 0,
    daily: Object.entries(daily).sort().map(([date, revenue]) => ({ date, revenue })),
  };
}

function summarizeBreakdowns(orders) {
  const employees = new Map(), categories = new Map(), payments = new Map();
  for (const order of orders) {
    const isReturned = refunded(order);
    const staff = order.user?.role === 'CUSTOMER' ? 'Bán trực tuyến' : (order.user?.name || 'Không rõ nhân viên');
    const employee = employees.get(staff) || { name: staff, orders: 0, returnedOrders: 0, revenue: 0 };
    if (isReturned) employee.returnedOrders++;
    else { employee.orders++; employee.revenue += order.total; }
    employees.set(staff, employee);

    const payment = payments.get(order.payment) || { method: order.payment, orders: 0, returnedOrders: 0, revenue: 0 };
    if (isReturned) payment.returnedOrders++;
    else { payment.orders++; payment.revenue += order.total; }
    payments.set(order.payment, payment);

    if (isReturned) continue;
    for (const item of order.items) {
      const name = item.product.category?.name || 'Chưa phân loại';
      const category = categories.get(name) || { name, quantity: 0, revenue: 0 };
      category.quantity += item.qty;
      category.revenue += item.qty * item.price;
      categories.set(name, category);
    }
  }
  return {
    employees: [...employees.values()].sort((a, b) => b.revenue - a.revenue),
    categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
    payments: [...payments.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

module.exports = { summarizeOrders, summarizeBreakdowns };
