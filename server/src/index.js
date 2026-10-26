const express = require('express'), cors = require('cors'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs'), ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const { calcOrder, avgCost } = require('./calc');
const db = new PrismaClient(), app = express();
const SECRET = process.env.JWT_SECRET || 'dev-secret', FORECAST = process.env.FORECAST_URL || 'http://localhost:8000';
app.use(cors(), express.json());

class Err extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const ah = f => (req, res, next) => f(req, res).catch(next);
// Phân quyền: chủ cửa hàng được vào mọi chức năng
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET); }
  catch { return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' }); }
  if (roles.length && req.user.role !== 'OWNER' && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Bạn không có quyền thực hiện chức năng này' });
  next();
};
const posInt = (v, msg) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new Err(msg); return n; };

// ---- Đăng nhập
app.post('/api/login', ah(async (req, res) => {
  const u = await db.user.findUnique({ where: { username: String(req.body.username || '') } });
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password)) throw new Err('Sai tên đăng nhập hoặc mật khẩu', 400);
  const user = { id: u.id, name: u.name, role: u.role };
  res.json({ token: jwt.sign(user, SECRET, { expiresIn: '12h' }), user });
}));

// ---- Danh mục & sản phẩm
app.get('/api/categories', auth(), ah(async (_, res) => res.json(await db.category.findMany({ orderBy: { name: 'asc' } }))));
app.post('/api/categories', auth('WAREHOUSE'), ah(async (req, res) => {
  if (!String(req.body.name || '').trim()) throw new Err('Thiếu tên danh mục');
  res.json(await db.category.create({ data: { name: req.body.name.trim() } }));
}));
const prodData = b => {
  const price = Number(b.price), cost = Number(b.cost ?? 0), minStock = Number(b.minStock ?? 5);
  const categoryId = b.categoryId ? Number(b.categoryId) : null;
  const d = { name: String(b.name || '').trim(), barcode: b.barcode ? String(b.barcode).trim() : null, price: Math.round(price), cost, minStock: Math.round(minStock), categoryId };
  if (!d.name) throw new Err('Thiếu tên sản phẩm');
  if (!Number.isInteger(price) || price < 0 || price > 2147483647) throw new Err('Giá bán phải là số nguyên không âm hợp lệ');
  if (!Number.isFinite(cost) || cost < 0) throw new Err('Giá vốn không hợp lệ');
  if (!Number.isInteger(minStock) || minStock < 0 || minStock > 2147483647) throw new Err('Tồn kho tối thiểu phải là số nguyên không âm hợp lệ');
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) throw new Err('Danh mục không hợp lệ');
  return d;
};
app.get('/api/products', auth(), ah(async (req, res) => {
  const { q, barcode } = req.query;
  const where = barcode ? { barcode: String(barcode) } : q ? { OR: [{ name: { contains: String(q), mode: 'insensitive' } }, { barcode: { contains: String(q) } }] } : {};
  res.json(await db.product.findMany({ where, include: { category: true }, orderBy: { name: 'asc' }, take: 200 }));
}));
async function ensureCategoryExists(categoryId, client = db) {
  if (categoryId !== null && !await client.category.findUnique({ where: { id: categoryId } })) throw new Err('Danh mục không tồn tại');
}
app.post('/api/products', auth('WAREHOUSE'), ah(async (req, res) => {
  const data = prodData(req.body);
  await ensureCategoryExists(data.categoryId);
  res.json(await db.product.create({ data }));
}));
app.put('/api/products/:id', auth('WAREHOUSE'), ah(async (req, res) => {
  const data = prodData(req.body);
  await ensureCategoryExists(data.categoryId);
  res.json(await db.product.update({ where: { id: posInt(req.params.id, 'Sản phẩm không hợp lệ') }, data }));
}));
app.delete('/api/products/:id', auth('WAREHOUSE'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Sản phẩm không hợp lệ');
  if (await db.orderItem.count({ where: { productId: id } }) + await db.stockMovement.count({ where: { productId: id } })) throw new Err('Sản phẩm đã có giao dịch, không thể xóa');
  await db.product.delete({ where: { id } }); res.json({ ok: true });
}));

// ---- Khách hàng, khuyến mãi
app.get('/api/customers', auth('SALES'), ah(async (_, res) => res.json(await db.customer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { orders: true } } } }))));
app.post('/api/customers', auth('SALES'), ah(async (req, res) => {
  const name = String(req.body.name || '').trim(), phone = String(req.body.phone || '').trim();
  if (!name) throw new Err('Thiếu tên khách hàng');
  if (name.length > 120 || phone.length > 30) throw new Err('Tên khách hàng hoặc số điện thoại quá dài');
  res.json(await db.customer.create({ data: { name, phone: phone || null } }));
}));
app.put('/api/customers/:id', auth('SALES'), ah(async (req, res) => {
  const name = String(req.body.name || '').trim(), phone = String(req.body.phone || '').trim();
  if (!name) throw new Err('Thiếu tên khách hàng');
  if (name.length > 120 || phone.length > 30) throw new Err('Tên khách hàng hoặc số điện thoại quá dài');
  res.json(await db.customer.update({ where: { id: posInt(req.params.id, 'Khách hàng không hợp lệ') }, data: { name, phone: phone || null } }));
}));
app.delete('/api/customers/:id', auth('SALES'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Khách hàng không hợp lệ');
  if (await db.order.count({ where: { customerId: id } })) throw new Err('Khách hàng đã có đơn hàng, không thể xóa');
  await db.customer.delete({ where: { id } });
  res.json({ ok: true });
}));
app.get('/api/promotions', auth('OWNER'), ah(async (_, res) => res.json(await db.promotion.findMany({ orderBy: { code: 'asc' } }))));
const promoData = body => {
  const code = String(body.code || '').trim().toUpperCase();
  const type = String(body.type || '');
  const value = Number(body.value);
  let expiresAt = null;
  if (body.expiresAt) {
    expiresAt = new Date(`${body.expiresAt}T23:59:59.999+07:00`);
    if (Number.isNaN(expiresAt.getTime())) throw new Err('Ngày hết hạn không hợp lệ');
  }
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new Err('Mã khuyến mãi chỉ gồm 2-32 chữ cái, số, dấu gạch ngang hoặc gạch dưới');
  if (!['PERCENT', 'AMOUNT'].includes(type)) throw new Err('Loại khuyến mãi không hợp lệ');
  if (!Number.isInteger(value) || value <= 0 || value > 2147483647 || (type === 'PERCENT' && value > 100)) throw new Err('Giá trị khuyến mãi không hợp lệ');
  return { code, type, value, expiresAt };
};
app.post('/api/promotions', auth('OWNER'), ah(async (req, res) => res.json(await db.promotion.create({ data: promoData(req.body) }))));
app.put('/api/promotions/:id', auth('OWNER'), ah(async (req, res) => res.json(await db.promotion.update({ where: { id: posInt(req.params.id, 'Mã khuyến mãi không hợp lệ') }, data: promoData(req.body) }))));
app.delete('/api/promotions/:id', auth('OWNER'), ah(async (req, res) => {
  await db.promotion.delete({ where: { id: posInt(req.params.id, 'Mã khuyến mãi không hợp lệ') } });
  res.json({ ok: true });
}));
async function findPromo(code, client = db) {
  const p = await client.promotion.findUnique({ where: { code: String(code || '').trim().toUpperCase() } });
  if (!p) throw new Err('Mã khuyến mãi không đúng');
  if (p.expiresAt && p.expiresAt < new Date()) throw new Err('Mã khuyến mãi đã hết hạn');
  return p;
}
app.post('/api/promotions/validate', auth('SALES'), ah(async (req, res) => res.json(await findPromo(req.body.code))));

// ---- Bán hàng: lưu đơn trong một transaction
app.post('/api/orders', auth('SALES'), ah(async (req, res) => {
  const { items = [], code, customerId, payment = 'CASH' } = req.body;
  if (!Array.isArray(items) || !items.length) throw new Err('Giỏ hàng trống');
  if (items.length > 100) throw new Err('Đơn hàng không được vượt quá 100 dòng sản phẩm');
  if (!['CASH', 'TRANSFER'].includes(payment)) throw new Err('Hình thức thanh toán không hợp lệ');
  if (customerId) posInt(customerId, 'Khách hàng không hợp lệ');
  const order = await db.$transaction(async tx => {
    const quantities = new Map();
    for (const it of items) {
      const qty = posInt(it.qty, 'Số lượng không hợp lệ');
      const id = posInt(it.productId, 'Sản phẩm không hợp lệ');
      quantities.set(id, (quantities.get(id) || 0) + qty);
    }
    if ([...quantities.values()].some(qty => qty > 2147483647)) throw new Err('Số lượng sản phẩm vượt giới hạn');
    if (customerId && !await tx.customer.findUnique({ where: { id: Number(customerId) } })) throw new Err('Khách hàng không tồn tại');
    const lines = [];
    for (const [id, qty] of quantities) {
      const p = await tx.product.findUnique({ where: { id } });
      if (!p) throw new Err('Sản phẩm không tồn tại');
      lines.push({ productId: p.id, qty, price: p.price, cost: p.cost, name: p.name });
    }
    const t = calcOrder(lines, code ? await findPromo(code, tx) : null);
    if (!Number.isSafeInteger(t.total) || !Number.isSafeInteger(t.discount) || t.total > 2147483647 || t.discount > 2147483647) throw new Err('Tổng tiền đơn hàng vượt giới hạn cho phép');
    const o = await tx.order.create({
      data: { userId: req.user.id, customerId: customerId ? Number(customerId) : null, payment, discount: t.discount, total: t.total, items: { create: lines.map(({ name, ...l }) => l) } },
      include: { items: { include: { product: true } }, customer: true, user: true },
    });
    for (const l of lines) { // trừ kho có điều kiện: tồn không bao giờ âm
      const r = await tx.product.updateMany({ where: { id: l.productId, stock: { gte: l.qty } }, data: { stock: { decrement: l.qty } } });
      if (!r.count) throw new Err(`"${l.name}" không đủ tồn kho`);
      await tx.stockMovement.create({ data: { productId: l.productId, type: 'OUT', qty: -l.qty, ref: 'HD' + o.id } });
    }
    return o;
  });
  res.json(order);
}));
app.get('/api/orders', auth('SALES'), ah(async (_, res) => res.json(await db.order.findMany({ orderBy: { id: 'desc' }, take: 50, include: { customer: true, user: true, items: { include: { product: true } } } }))));

// ---- Kho
const WH = auth('WAREHOUSE');
app.get('/api/suppliers', WH, ah(async (_, res) => res.json(await db.supplier.findMany())));
app.post('/api/suppliers', WH, ah(async (req, res) => {
  if (!String(req.body.name || '').trim()) throw new Err('Thiếu tên nhà cung cấp');
  res.json(await db.supplier.create({ data: { name: req.body.name.trim(), phone: req.body.phone || null } }));
}));
async function confirmReceipt(tx, id) {
  const r = await tx.receipt.findUnique({ where: { id }, include: { items: true } });
  if (!r) throw new Err('Không tìm thấy phiếu', 404);
  if (r.status !== 'DRAFT') throw new Err('Phiếu đã được xác nhận');
  for (const it of r.items) {
    const p = await tx.product.findUnique({ where: { id: it.productId } });
    await tx.product.update({ where: { id: p.id }, data: { stock: p.stock + it.qty, cost: avgCost(p.stock, p.cost, it.qty, it.cost) } });
    await tx.stockMovement.create({ data: { productId: p.id, type: 'IN', qty: it.qty, ref: 'PN' + id } });
  }
  return tx.receipt.update({ where: { id }, data: { status: 'CONFIRMED' } });
}
app.post('/api/receipts', WH, ah(async (req, res) => {
  const { supplierId, note, items = [], confirm } = req.body;
  if (!Array.isArray(items) || !items.length) throw new Err('Phiếu chưa có sản phẩm');
  if (items.length > 100) throw new Err('Phiếu nhập không được vượt quá 100 dòng sản phẩm');
  if (supplierId) posInt(supplierId, 'Nhà cung cấp không hợp lệ');
  const lines = items.map((it, i) => {
    const cost = Number(it.cost);
    if (it.cost === '' || it.cost == null || !Number.isInteger(cost) || cost < 0 || cost > 2147483647) throw new Err(`Dòng ${i + 1}: giá nhập phải là số nguyên không âm hợp lệ`);
    return { productId: posInt(it.productId, `Dòng ${i + 1}: sản phẩm không hợp lệ`), qty: posInt(it.qty, `Dòng ${i + 1}: số lượng phải là số nguyên dương`), cost };
  });
  res.json(await db.$transaction(async tx => {
    if (supplierId && !await tx.supplier.findUnique({ where: { id: Number(supplierId) } })) throw new Err('Nhà cung cấp không tồn tại');
    const productIds = [...new Set(lines.map(line => line.productId))];
    const foundProducts = await tx.product.count({ where: { id: { in: productIds } } });
    if (foundProducts !== productIds.length) throw new Err('Sản phẩm trong phiếu nhập không tồn tại');
    const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
    if (!Number.isSafeInteger(total) || total > 2147483647) throw new Err('Tổng tiền phiếu nhập vượt giới hạn cho phép');
    const r = await tx.receipt.create({ data: { supplierId: supplierId ? Number(supplierId) : null, note: note || null, total, items: { create: lines } } });
    return confirm ? confirmReceipt(tx, r.id) : r;
  }));
}));
app.post('/api/receipts/:id/confirm', WH, ah(async (req, res) => res.json(await db.$transaction(tx => confirmReceipt(tx, +req.params.id)))));
app.get('/api/receipts', WH, ah(async (_, res) => res.json(await db.receipt.findMany({ orderBy: { id: 'desc' }, take: 30, include: { supplier: true, items: { include: { product: true } } } }))));
app.post('/api/issues', WH, ah(async (req, res) => {
  const qty = posInt(req.body.qty, 'Số lượng phải là số nguyên dương'), id = posInt(req.body.productId, 'Sản phẩm không hợp lệ');
  await db.$transaction(async tx => {
    const r = await tx.product.updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } });
    if (!r.count) throw new Err('Không đủ tồn kho để xuất');
    await tx.stockMovement.create({ data: { productId: id, type: 'OUT', qty: -qty, ref: 'PX: ' + (req.body.note || 'xuất kho') } });
  });
  res.json({ ok: true });
}));
app.post('/api/stocktakes', WH, ah(async (req, res) => {
  const ref = 'KK' + Date.now(); let changed = 0;
  if (!Array.isArray(req.body.items)) throw new Err('Danh sách kiểm kê không hợp lệ');
  await db.$transaction(async tx => {
    const items = req.body.items.map(it => ({
      productId: posInt(it.productId, 'Sản phẩm kiểm kê không hợp lệ'),
      actual: Number(it.actual),
    }));
    if (items.some(it => !Number.isInteger(it.actual) || it.actual < 0 || it.actual > 2147483647)) throw new Err('Số thực tế không hợp lệ');
    const ids = [...new Set(items.map(it => it.productId))];
    if (await tx.product.count({ where: { id: { in: ids } } }) !== ids.length) throw new Err('Sản phẩm kiểm kê không tồn tại');
    for (const it of items) {
      const actual = it.actual;
      const p = await tx.product.findUnique({ where: { id: it.productId } });
      if (!p || p.stock === actual) continue;
      await tx.product.update({ where: { id: p.id }, data: { stock: actual } });
      await tx.stockMovement.create({ data: { productId: p.id, type: 'ADJUST', qty: actual - p.stock, ref } });
      changed++;
    }
  });
  res.json({ changed });
}));
app.get('/api/stock', WH, ah(async (req, res) => {
  const all = await db.product.findMany({ orderBy: { name: 'asc' } });
  res.json(req.query.low === 'true' ? all.filter(p => p.stock <= p.minStock) : all);
}));
app.get('/api/stock/movements', WH, ah(async (_, res) => res.json(await db.stockMovement.findMany({ orderBy: { id: 'desc' }, take: 100, include: { product: true } }))));

// ---- Báo cáo (chỉ chủ cửa hàng)
const OWN = auth('OWNER');
const day = d => new Date(d.getTime() + 7 * 36e5).toISOString().slice(0, 10); // theo giờ Việt Nam
function range(q) {
  const to = q.to ? new Date(q.to + 'T23:59:59+07:00') : new Date();
  const from = q.from ? new Date(q.from + 'T00:00:00+07:00') : new Date(Date.now() - 29 * 864e5);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Err('Khoảng thời gian báo cáo không hợp lệ');
  return { gte: from, lte: to };
}
const paid = q => db.order.findMany({ where: { status: 'PAID', createdAt: range(q) }, include: { items: { include: { product: true } } } });
async function summary(q) {
  const orders = await paid(q); let revenue = 0, cogs = 0; const daily = {};
  for (const o of orders) {
    revenue += o.total; cogs += o.items.reduce((s, i) => s + i.cost * i.qty, 0);
    daily[day(o.createdAt)] = (daily[day(o.createdAt)] || 0) + o.total;
  }
  return { revenue, cogs: Math.round(cogs), profit: Math.round(revenue - cogs), orders: orders.length, avg: orders.length ? Math.round(revenue / orders.length) : 0, daily: Object.entries(daily).sort().map(([date, revenue]) => ({ date, revenue })) };
}
app.get('/api/reports/summary', OWN, ah(async (req, res) => res.json(await summary(req.query))));
app.get('/api/reports/top-products', OWN, ah(async (req, res) => {
  const m = {};
  for (const o of await paid(req.query)) for (const i of o.items) {
    const r = m[i.productId] ||= { productId: i.productId, name: i.product.name, qty: 0, revenue: 0 };
    r.qty += i.qty; r.revenue += i.qty * i.price;
  }
  res.json(Object.values(m).sort((a, b) => b.qty - a.qty).slice(0, 10));
}));
app.get('/api/reports/export', OWN, ah(async (req, res) => {
  if ((req.query.format || 'xlsx') !== 'xlsx') throw new Err('Hiện chỉ hỗ trợ xuất Excel (xlsx)');
  const s = await summary(req.query), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Tổng quan');
  ws.addRows([['Doanh thu', s.revenue], ['Giá vốn', s.cogs], ['Lợi nhuận', s.profit], ['Số đơn', s.orders], ['Giá trị đơn TB', s.avg]]);
  const d = wb.addWorksheet('Doanh thu theo ngày'); d.addRow(['Ngày', 'Doanh thu']).font = { bold: true }; s.daily.forEach(r => d.addRow([r.date, r.revenue]));
  ws.getColumn(1).width = 20; d.getColumn(1).width = 14; d.getColumn(2).width = 16;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=bao-cao.xlsx');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));
// Dự báo: gom chuỗi bán theo ngày, gọi dịch vụ FastAPI, so với tồn kho để đề xuất nhập
app.get('/api/forecast', OWN, ah(async (req, res) => {
  const days = [7, 14].includes(+req.query.days) ? +req.query.days : 7;
  const items = await db.orderItem.findMany({ where: { order: { status: 'PAID', createdAt: { gte: new Date(Date.now() - 120 * 864e5) } } }, include: { order: true } });
  if (!items.length) return res.json({ available: true, days, items: [] });
  const toDay = d => new Date(day(d) + 'T00:00:00Z');
  const start = toDay(items.reduce((m, i) => (i.order.createdAt < m ? i.order.createdAt : m), new Date()));
  const n = Math.round((toDay(new Date()) - start) / 864e5) + 1, series = {};
  for (const i of items) {
    const k = Math.round((toDay(i.order.createdAt) - start) / 864e5);
    (series[i.productId] ||= Array(n).fill(0))[k] += i.qty;
  }
  const ids = req.query.productId ? [+req.query.productId] : Object.keys(series).map(Number);
  const prods = (await db.product.findMany({ where: { id: { in: ids } } })).filter(p => series[p.id]);
  try {
    const out = await Promise.all(prods.map(async p => {
      const r = await fetch(FORECAST + '/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: series[p.id], days }), signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('forecast ' + r.status);
      const f = await r.json();
      return { productId: p.id, name: p.name, stock: p.stock, minStock: p.minStock, ...f, suggest: Math.max(0, Math.ceil(f.demand + p.minStock - p.stock)) };
    }));
    res.json({ available: true, days, items: out.sort((a, b) => b.suggest - a.suggest) });
  } catch (e) { console.error('Dịch vụ dự báo lỗi:', e.message); res.json({ available: false, items: [] }); } // báo cáo vẫn dùng được
}));

app.use((e, req, res, next) => {
  if (e.code === 'P2002') return res.status(400).json({ error: 'Dữ liệu bị trùng (tên, mã vạch hoặc mã khuyến mãi đã tồn tại)' });
  if (e.code === 'P2003') return res.status(400).json({ error: 'Không thể xóa hoặc thay đổi dữ liệu đang được sử dụng' });
  if (e.code === 'P2025') return res.status(404).json({ error: 'Không tìm thấy dữ liệu yêu cầu' });
  if (e.status || e.message.includes('khuyến mãi')) return res.status(e.status || 400).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại' });
});
app.listen(4000, () => console.log('API chạy ở cổng 4000'));
