const { PrismaClient } = require('@prisma/client'), bcrypt = require('bcryptjs');
const db = new PrismaClient();
const rnd = (a, b) => a + Math.random() * (b - a);
(async () => {
  if (await db.user.count()) return console.log('Đã có dữ liệu, bỏ qua seed');
  const pw = bcrypt.hashSync('123456', 10);
  await db.user.create({ data: { username: 'owner', password: pw, name: 'Chủ cửa hàng', role: 'OWNER' } });
  const sales = await db.user.create({ data: { username: 'sales', password: pw, name: 'Nhân viên bán hàng', role: 'SALES' } });
  await db.user.create({ data: { username: 'stock', password: pw, name: 'Thủ kho', role: 'WAREHOUSE' } });
  const cats = {};
  for (const n of ['Đồ uống', 'Đồ ăn vặt', 'Gia dụng']) cats[n] = (await db.category.create({ data: { name: n } })).id;
  const list = [ // tên, danh mục, giá bán, giá vốn, độ phổ biến
    ['Nước suối 500ml', 'Đồ uống', 6000, 3500, 9], ['Coca-Cola lon', 'Đồ uống', 12000, 8500, 7], ['Trà xanh 0 độ', 'Đồ uống', 10000, 7000, 6],
    ['Cà phê lon', 'Đồ uống', 14000, 9500, 4], ['Sữa tươi hộp', 'Đồ uống', 9000, 6500, 5], ['Snack khoai tây', 'Đồ ăn vặt', 8000, 5500, 6],
    ['Bánh quy bơ', 'Đồ ăn vặt', 15000, 10500, 3], ['Kẹo cao su', 'Đồ ăn vặt', 5000, 3000, 5], ['Mì ly', 'Đồ ăn vặt', 12000, 8500, 6],
    ['Khăn giấy', 'Gia dụng', 18000, 12500, 2], ['Bột giặt gói', 'Gia dụng', 7000, 4500, 3], ['Pin AA (vỉ 2)', 'Gia dụng', 20000, 14000, 1.5],
  ];
  const prods = [];
  for (const [i, [name, c, price, cost, pop]] of list.entries())
    prods.push({ pop, ...(await db.product.create({ data: { name, barcode: '893600' + String(i + 1).padStart(6, '0'), price, cost, stock: Math.round(rnd(25, 120)), minStock: 20, categoryId: cats[c] } })) });
  await db.promotion.createMany({ data: [
    { code: 'GIAM10', type: 'PERCENT', value: 10 }, { code: 'GIAM20K', type: 'AMOUNT', value: 20000 },
    { code: 'HETHAN', type: 'PERCENT', value: 15, expiresAt: new Date('2025-01-01') } ] });
  await db.supplier.create({ data: { name: 'Công ty Phân phối An Phát', phone: '0900000000' } });
  await db.customer.create({ data: { name: 'Khách quen', phone: '0911111111' } });
  // Dữ liệu bán hàng GIẢ LẬP 120 ngày: cuối tuần bán nhiều hơn, xu hướng tăng nhẹ, có nhiễu
  for (let d = 120; d >= 1; d--) {
    const date = new Date(Date.now() - d * 864e5); date.setHours(10, 0, 0, 0);
    const wk = [0, 6].includes(date.getDay()) ? 1.6 : 1, trend = 1 + (120 - d) / 600;
    const lines = prods.map(p => ({ p, qty: Math.round(p.pop * wk * trend * rnd(0.6, 1.5)) })).filter(l => l.qty > 0);
    const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
    await db.order.create({ data: { userId: sales.id, total, payment: 'CASH', createdAt: date,
      items: { create: lines.map(l => ({ productId: l.p.id, qty: l.qty, price: l.p.price, cost: l.p.cost })) } } });
  }
  console.log('Đã tạo dữ liệu mẫu');
})().finally(() => db.$disconnect());
