function buildInsights(orders, products) {
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const quantityByProduct = new Map();
  for (const order of orders) {
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

  if (!orders.length) messages.push('Chưa có đơn đã thanh toán trong 30 ngày gần đây; hãy thu thập dữ liệu bán hàng để cải thiện phân tích.');
  else {
    messages.push(`30 ngày gần đây có ${orders.length} đơn đã thanh toán, doanh thu ${revenue.toLocaleString('vi-VN')} ₫.`);
    if (topProducts.length) messages.push(`Sản phẩm bán nhiều nhất là ${topProducts[0].name} (${topProducts[0].qty} sản phẩm).`);
  }
  if (lowStock.length) messages.push(`Có ${lowStock.length} sản phẩm chạm hoặc thấp hơn mức tồn tối thiểu: ${lowStock.slice(0, 5).map(product => `${product.name} (${product.stock}/${product.minStock})`).join(', ')}.`);
  else messages.push('Tồn kho các sản phẩm hiện đều cao hơn mức tối thiểu.');

  return {
    generatedAt: new Date().toISOString(),
    basis: 'Phân tích nội bộ từ đơn đã thanh toán và tồn kho; dự báo nhu cầu dùng Holt-Winters/MA7.',
    revenue,
    orderCount: orders.length,
    topProducts,
    lowStock: lowStock.map(product => ({ id: product.id, name: product.name, stock: product.stock, minStock: product.minStock })),
    messages,
  };
}

module.exports = { buildInsights };
