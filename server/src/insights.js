function buildInsights(orders, products) {
  const activeOrders = orders.filter(order => order.returnRequest?.refundStatus !== 'COMPLETED');
  const revenue = activeOrders.reduce((sum, order) =>
    sum + order.items.reduce((sales, item) => sales + (item.price || 0) * item.qty, 0) - (order.discount || 0), 0);
  const quantityByProduct = new Map();
  for (const order of activeOrders) {
    for (const item of order.items) {
      const current = quantityByProduct.get(item.productId) || { name: item.product.name, qty: 0 };
      current.qty += item.qty;
      quantityByProduct.set(item.productId, current);
    }
  }

  const topProducts = [...quantityByProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  const lowStock = products.filter(product => product.stock <= product.minStock)
    .sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock))
    .slice(0, 10);
  const messages = [];

  if (!activeOrders.length) messages.push('Chưa có đơn đã thanh toán trong 30 ngày gần đây; hãy thu thập dữ liệu bán hàng để cải thiện phân tích.');
  else {
    messages.push(`30 ngày gần đây có ${activeOrders.length} đơn đã thanh toán, doanh thu sản phẩm sau giảm giá ${revenue.toLocaleString('vi-VN')} ₫ (chưa gồm phí vận chuyển).`);
    if (topProducts.length) messages.push(`Sản phẩm bán nhiều nhất là ${topProducts[0].name} (${topProducts[0].qty} sản phẩm).`);
  }
  if (lowStock.length) messages.push(`Có ${lowStock.length} sản phẩm chạm hoặc thấp hơn mức tồn tối thiểu: ${lowStock.slice(0, 5).map(product => `${product.name} (${product.stock}/${product.minStock})`).join(', ')}.`);
  else messages.push('Tồn kho các sản phẩm hiện đều cao hơn mức tối thiểu.');

  return {
    generatedAt: new Date().toISOString(),
    basis: 'Phân tích quy tắc nội bộ từ đơn đã thanh toán và tồn kho; dự báo chuỗi thời gian dùng Holt-Winters/MA7 và so sánh MAE. Không phải chatbot AI hay mô hình ngôn ngữ lớn.',
    revenue,
    orderCount: activeOrders.length,
    topProducts,
    lowStock: lowStock.map(product => ({ id: product.id, name: product.name, stock: product.stock, minStock: product.minStock })),
    messages,
  };
}

module.exports = { buildInsights };
