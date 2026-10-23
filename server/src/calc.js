// Hàm tính tiền thuần (dễ viết unit test)
function calcOrder(lines, promo, now = new Date()) {
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  let discount = 0;
  if (promo) {
    if (promo.expiresAt && new Date(promo.expiresAt) < now) throw new Error('Mã khuyến mãi đã hết hạn');
    discount = promo.type === 'PERCENT' ? Math.round((subtotal * promo.value) / 100) : promo.value;
    discount = Math.min(discount, subtotal);
  }
  return { subtotal, discount, total: subtotal - discount };
}
// Giá vốn bình quân gia quyền
function avgCost(oldStock, oldCost, qty, cost) {
  const s = Math.max(oldStock, 0), t = s + qty;
  return t ? (s * oldCost + qty * cost) / t : cost;
}
module.exports = { calcOrder, avgCost };
