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
const posInt = (v, msg) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new Err(msg); return n; };

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
  const d = { name: String(b.name || '').trim(), barcode: b.barcode ? String(b.barcode).trim() : null, price: Math.round(Number(b.price)), cost: Number(b.cost || 0), minStock: Math.round(Number(b.minStock ?? 5)), categoryId: b.categoryId ? Number(b.categoryId) : null };
  if (!d.name) throw new Err('Thiếu tên sản phẩm');
  if (!(d.price >= 0)) throw new Err('Giá bán không hợp lệ');
  return d;
};
app.get('/api/products', auth(), ah(async (req, res) => {
  const { q, barcode } = req.query;
  const where = barcode ? { barcode: String(barcode) } : q ? { OR: [{ name: { contains: String(q), mode: 'insensitive' } }, { barcode: { contains: String(q) } }] } : {};
  res.json(await db.product.findMany({ where, include: { category: true }, orderBy: { name: 'asc' }, take: 200 }));
}));
app.post('/api/products', auth('WAREHOUSE'), ah(async (req, res) => res.json(await db.product.create({ data: prodData(req.body) }))));
app.put('/api/products/:id', auth('WAREHOUSE'), ah(async (req, res) => res.json(await db.product.update({ where: { id: +req.params.id }, data: prodData(req.body) }))));
app.delete('/api/products/:id', auth('WAREHOUSE'), ah(async (req, res) => {
  const id = +req.params.id;
  if (await db.orderItem.count({ where: { productId: id } }) + await db.stockMovement.count({ where: { productId: id } })) throw new Err('Sản phẩm đã có giao dịch, không thể xóa');
  await db.product.delete({ where: { id } }); res.json({ ok: true });
}));

// ---- Khách hàng, khuyến mãi
app.get('/api/customers', auth('SALES'), ah(async (_, res) => res.json(await db.customer.findMany({ orderBy: { name: 'asc' } }))));
app.post('/api/customers', auth('SALES'), ah(async (req, res) => {
  if (!String(req.body.name || '').trim()) throw new Err('Thiếu tên khách hàng');
  res.json(await db.customer.create({ data: { name: req.body.name.trim(), phone: req.body.phone || null } }));
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
  if (!items.length) throw new Err('Giỏ hàng trống');
  if (!['CASH', 'TRANSFER'].includes(payment)) throw new Err('Hình thức thanh toán không hợp lệ');
  const order = await db.$transaction(async tx => {
    const lines = [];
    for (const it of items) {
      const qty = posInt(it.qty, 'Số lượng không hợp lệ');
      const p = await tx.product.findUnique({ where: { id: Number(it.productId) } });
      if (!p) throw new Err('Sản phẩm không tồn tại');
      lines.push({ productId: p.id, qty, price: p.price, cost: p.cost, name: p.name }); // server tự lấy giá từ DB
    }
    const t = calcOrder(lines, code ? await findPromo(code, tx) : null);
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
  if (!items.length) throw new Err('Phiếu chưa có sản phẩm');
  const lines = items.map((it, i) => {
    const cost = Number(it.cost);
    if (!it.productId) throw new Err(`Dòng ${i + 1}: chưa chọn sản phẩm`);
    if (!(cost >= 0)) throw new Err(`Dòng ${i + 1}: giá nhập không hợp lệ`);
    return { productId: Number(it.productId), qty: posInt(it.qty, `Dòng ${i + 1}: số lượng phải là số nguyên dương`), cost: Math.round(cost) };
  });
  res.json(await db.$transaction(async tx => {
    const r = await tx.receipt.create({ data: { supplierId: supplierId ? Number(supplierId) : null, note: note || null, total: lines.reduce((s, l) => s + l.qty * l.cost, 0), items: { create: lines } } });
    return confirm ? confirmReceipt(tx, r.id) : r;
  }));
}));
app.post('/api/receipts/:id/confirm', WH, ah(async (req, res) => res.json(await db.$transaction(tx => confirmReceipt(tx, +req.params.id)))));
app.get('/api/receipts', WH, ah(async (_, res) => res.json(await db.receipt.findMany({ orderBy: { id: 'desc' }, take: 30, include: { supplier: true, items: { include: { product: true } } } }))));
app.post('/api/issues', WH, ah(async (req, res) => {
  const qty = posInt(req.body.qty, 'Số lượng phải là số nguyên dương'), id = Number(req.body.productId);
  await db.$transaction(async tx => {
    const r = await tx.product.updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } });
    if (!r.count) throw new Err('Không đủ tồn kho để xuất');
    await tx.stockMovement.create({ data: { productId: id, type: 'OUT', qty: -qty, ref: 'PX: ' + (req.body.note || 'xuất kho') } });
  });
  res.json({ ok: true });
}));
app.post('/api/stocktakes', WH, ah(async (req, res) => {
  const ref = 'KK' + Date.now(); let changed = 0;
  await db.$transaction(async tx => {
    for (const it of req.body.items || []) {
      const actual = Number(it.actual);
      if (!Number.isInteger(actual) || actual < 0) throw new Err('Số thực tế không hợp lệ');
      const p = await tx.product.findUnique({ where: { id: Number(it.productId) } });
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
  if (e.code === 'P2002') return res.status(400).json({ error: 'Dữ liệu bị trùng (mã vạch hoặc tên đã tồn tại)' });
  if (e.status || e.message.includes('khuyến mãi')) return res.status(e.status || 400).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại' });
});
app.listen(4000, () => console.log('API chạy ở cổng 4000'));
