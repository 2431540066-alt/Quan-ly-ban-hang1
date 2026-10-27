require('dotenv').config();
const express = require('express'), cors = require('cors'), jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs'), ExcelJS = require('exceljs'), crypto = require('node:crypto'), nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const { calcOrder, avgCost } = require('./calc');
const { buildInsights } = require('./insights');
const { canTransition } = require('./order-status');
const { momoCreateSigningData, signMomo, signVnpay, verifyMomo, verifyVnpay, vnpayQueryString } = require('./payment');
const db = new PrismaClient(), app = express();
const SECRET = process.env.JWT_SECRET || 'dev-secret', FORECAST = process.env.FORECAST_URL || 'http://localhost:8000';
app.use(cors(), express.json({ limit: '1mb' }));

class Err extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const ah = f => (req, res, next) => f(req, res).catch(next);
const publicUrl = (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/+$/, '');
const shippingFee = Number(process.env.SHIPPING_FEE || 0);
if (!Number.isSafeInteger(shippingFee) || shippingFee < 0 || shippingFee > 2147483647) throw new Error('SHIPPING_FEE phải là số nguyên không âm hợp lệ');
const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
const mailer = smtpReady ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined,
}) : null;
const pageArgs = (query, defaultSize = 25) => {
  const page = query.page == null ? 1 : Number(query.page);
  const pageSize = query.pageSize == null ? defaultSize : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Err('Thông tin phân trang không hợp lệ (page >= 1, pageSize từ 1 đến 100)');
  }
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};
const paginated = (items, total, page, pageSize) => ({ items, total, page, pageSize, pages: Math.ceil(total / pageSize) });
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
async function sendMail(to, subject, text) {
  if (!mailer) throw new Err('Chưa cấu hình SMTP để gửi email', 503);
  await mailer.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}
async function sendOrderNotification(orderId, subject, text) {
  try {
    const order = await db.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order?.user.email) {
      console.warn(`Không gửi email đơn #${orderId}: tài khoản khách chưa có email`);
      return;
    }
    if (!mailer) {
      console.warn(`Không gửi email đơn #${orderId}: chưa cấu hình SMTP`);
      return;
    }
    await sendMail(order.user.email, subject, text);
  } catch (error) {
    console.error(`Gửi email đơn #${orderId} thất bại:`, error.message);
  }
}
app.get('/api/health', ah(async (_, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
}));
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
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const u = await db.user.findUnique({ where: { username } });
  if (!u || !bcrypt.compareSync(String(body.password || ''), u.password)) throw new Err('Sai tên đăng nhập hoặc mật khẩu', 400);
  const user = { id: u.id, name: u.name, role: u.role };
  res.json({ token: jwt.sign(user, SECRET, { expiresIn: '12h' }), user });
}));
app.post('/api/register', ah(async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new Err('Tên đăng nhập phải có 3-32 ký tự: chữ thường, số, gạch ngang hoặc gạch dưới');
  if (!name || name.length > 120) throw new Err('Họ tên không hợp lệ');
  if (email && !validEmail(email)) throw new Err('Địa chỉ email không hợp lệ');
  if (phone.length > 30) throw new Err('Số điện thoại quá dài');
  if (password.length < 8 || password.length > 72) throw new Err('Mật khẩu phải có từ 8 đến 72 ký tự');
  const user = await db.$transaction(async tx => {
    const created = await tx.user.create({ data: { username, password: bcrypt.hashSync(password, 10), name, email: email || null, role: 'CUSTOMER' } });
    await tx.customer.create({ data: { name, phone: phone || null, userId: created.id } });
    return { id: created.id, name: created.name, role: created.role };
  });
  res.status(201).json({ token: jwt.sign(user, SECRET, { expiresIn: '12h' }), user });
}));

// ---- Tài khoản nhân viên
app.get('/api/staff', auth('OWNER'), ah(async (_, res) => {
  res.json(await db.user.findMany({
    where: { role: { in: ['SALES', 'WAREHOUSE'] } },
    select: { id: true, username: true, name: true, role: true },
    orderBy: { name: 'asc' },
  }));
}));
function staffData(body, create = false) {
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const role = String(body.role || '');
  const password = String(body.password || '');
  if (create && !/^[a-z0-9_-]{3,32}$/.test(username)) throw new Err('Tên đăng nhập phải có 3-32 ký tự hợp lệ');
  if (!name || name.length > 120) throw new Err('Họ tên không hợp lệ');
  if (!['SALES', 'WAREHOUSE'].includes(role)) throw new Err('Vai trò nhân viên không hợp lệ');
  if (create && (password.length < 8 || password.length > 72)) throw new Err('Mật khẩu phải có từ 8 đến 72 ký tự');
  if (!create && password && (password.length < 8 || password.length > 72)) throw new Err('Mật khẩu phải có từ 8 đến 72 ký tự');
  return {
    ...(create ? { username, password: bcrypt.hashSync(password, 10) } : password ? { password: bcrypt.hashSync(password, 10) } : {}),
    name, role,
  };
}
app.post('/api/staff', auth('OWNER'), ah(async (req, res) => {
  const user = await db.user.create({ data: staffData(req.body || {}, true), select: { id: true, username: true, name: true, role: true } });
  res.status(201).json(user);
}));
app.put('/api/staff/:id', auth('OWNER'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Tài khoản nhân viên không hợp lệ');
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing || !['SALES', 'WAREHOUSE'].includes(existing.role)) throw new Err('Không tìm thấy tài khoản nhân viên', 404);
  const user = await db.user.update({ where: { id }, data: staffData(req.body || {}), select: { id: true, username: true, name: true, role: true } });
  res.json(user);
}));
app.delete('/api/staff/:id', auth('OWNER'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Tài khoản nhân viên không hợp lệ');
  const user = await db.user.findUnique({ where: { id } });
  if (!user || !['SALES', 'WAREHOUSE'].includes(user.role)) throw new Err('Không tìm thấy tài khoản nhân viên', 404);
  await db.user.delete({ where: { id } });
  res.json({ ok: true });
}));

// ---- Hồ sơ, địa chỉ và khôi phục tài khoản khách
app.get('/api/customer/profile', auth('CUSTOMER'), ah(async (req, res) => {
  const user = await db.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, username: true, name: true, email: true, emailVerifiedAt: true, customer: { select: { phone: true } }, addresses: { orderBy: [{ isDefault: 'desc' }, { id: 'desc' }] } },
  });
  if (!user) throw new Err('Không tìm thấy tài khoản', 404);
  res.json(user);
}));
app.put('/api/customer/profile', auth('CUSTOMER'), ah(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim(), email = String(body.email || '').trim().toLowerCase(), phone = String(body.phone || '').trim();
  if (!name || name.length > 120) throw new Err('Họ tên không hợp lệ');
  if (email && !validEmail(email)) throw new Err('Địa chỉ email không hợp lệ');
  if (phone.length > 30) throw new Err('Số điện thoại quá dài');
  await db.$transaction(async tx => {
    const current = await tx.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
    const updated = await tx.user.update({ where: { id: req.user.id }, data: { name, email: email || null, emailVerifiedAt: email && email === current.email ? undefined : null } });
    await tx.customer.update({ where: { userId: req.user.id }, data: { name, phone: phone || null } });
    return updated;
  });
  res.json({ ok: true, emailVerificationRequired: Boolean(email) });
}));
app.post('/api/customer/password', auth('CUSTOMER'), ah(async (req, res) => {
  const body = req.body || {}, current = String(body.currentPassword || ''), next = String(body.newPassword || '');
  if (next.length < 8 || next.length > 72) throw new Err('Mật khẩu mới phải có từ 8 đến 72 ký tự');
  const user = await db.user.findUnique({ where: { id: req.user.id } });
  if (!user || !bcrypt.compareSync(current, user.password)) throw new Err('Mật khẩu hiện tại không đúng');
  await db.user.update({ where: { id: user.id }, data: { password: bcrypt.hashSync(next, 10) } });
  res.json({ ok: true });
}));
app.post('/api/customer/email/verification', auth('CUSTOMER'), ah(async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.user.id } });
  if (!user?.email) throw new Err('Hãy thêm email trong hồ sơ trước');
  if (user.emailVerifiedAt) throw new Err('Email này đã được xác minh');
  if (!mailer) throw new Err('Chưa cấu hình SMTP để gửi email xác minh', 503);
  const recent = await db.emailVerificationToken.findFirst({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 1000) } } });
  if (recent) throw new Err('Vui lòng đợi một phút trước khi gửi lại email xác minh', 429);
  const token = crypto.randomBytes(32).toString('hex');
  await db.emailVerificationToken.create({ data: { userId: user.id, email: user.email, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  await sendMail(user.email, 'Xác minh email cửa hàng', `Mở liên kết sau để xác minh email trong 24 giờ:\n${publicUrl}/?verify=${token}`);
  res.json({ ok: true });
}));
app.get('/api/auth/verify-email', ah(async (req, res) => {
  const token = String(req.query.token || '');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw new Err('Liên kết xác minh không hợp lệ hoặc đã hết hạn');
  await db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: record.userId }, select: { email: true } });
    if (user?.email !== record.email) throw new Err('Email tài khoản đã thay đổi; hãy gửi liên kết xác minh mới');
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await tx.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  });
  res.redirect(`${publicUrl}/?verified=1`);
}));
app.post('/api/auth/forgot-password', ah(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!validEmail(email)) throw new Err('Địa chỉ email không hợp lệ');
  const user = await db.user.findUnique({ where: { email } });
  if (user?.emailVerifiedAt) {
    if (!mailer) console.error('Không gửi được liên kết đặt lại mật khẩu: chưa cấu hình SMTP');
    else if (!await db.passwordResetToken.findFirst({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 1000) } } })) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
      await sendMail(user.email, 'Đặt lại mật khẩu', `Mở liên kết sau để đặt mật khẩu mới trong 1 giờ:\n${publicUrl}/?reset=${token}`);
    }
  }
  res.json({ ok: true, message: 'Nếu email đã xác minh thuộc tài khoản, liên kết đặt lại sẽ được gửi.' });
}));
app.post('/api/auth/reset-password', ah(async (req, res) => {
  const body = req.body || {}, token = String(body.token || ''), password = String(body.password || '');
  if (password.length < 8 || password.length > 72) throw new Err('Mật khẩu phải có từ 8 đến 72 ký tự');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw new Err('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { password: bcrypt.hashSync(password, 10) } }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  res.json({ ok: true });
}));
app.post('/api/customer/addresses', auth('CUSTOMER'), ah(async (req, res) => {
  const body = req.body || {}, label = String(body.label || '').trim(), address = String(body.address || '').trim();
  if (!label || label.length > 60 || address.length < 8 || address.length > 500) throw new Err('Tên hoặc địa chỉ nhận hàng không hợp lệ');
  const result = await db.$transaction(async tx => {
    if (body.isDefault) await tx.userAddress.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    return tx.userAddress.create({ data: { userId: req.user.id, label, address, isDefault: Boolean(body.isDefault) } });
  });
  res.status(201).json(result);
}));
app.delete('/api/customer/addresses/:id', auth('CUSTOMER'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Địa chỉ không hợp lệ');
  const result = await db.userAddress.deleteMany({ where: { id, userId: req.user.id } });
  if (!result.count) throw new Err('Không tìm thấy địa chỉ', 404);
  res.json({ ok: true });
}));
app.put('/api/customer/addresses/:id/default', auth('CUSTOMER'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Địa chỉ không hợp lệ');
  await db.$transaction(async tx => {
    const address = await tx.userAddress.findFirst({ where: { id, userId: req.user.id } });
    if (!address) throw new Err('Không tìm thấy địa chỉ', 404);
    await tx.userAddress.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    await tx.userAddress.update({ where: { id }, data: { isDefault: true } });
  });
  res.json({ ok: true });
}));

// ---- Danh mục & sản phẩm
app.get('/api/store/categories', ah(async (_, res) => res.json(await db.category.findMany({ orderBy: { name: 'asc' } }))));
app.get('/api/store/payment-options', ah(async (_, res) => res.json({
  shippingFee: Number.isSafeInteger(shippingFee) && shippingFee >= 0 ? shippingFee : 0,
  vnpay: Boolean(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET),
  momo: Boolean(process.env.MOMO_PARTNER_CODE && process.env.MOMO_ACCESS_KEY && process.env.MOMO_SECRET_KEY),
})));
app.get('/api/store/products', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const categoryId = req.query.categoryId ? posInt(req.query.categoryId, 'Danh mục không hợp lệ') : undefined;
  const where = {
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q } }] } : {}),
    ...(categoryId ? { categoryId } : {}),
  };
  const pg = pageArgs(req.query, 24);
  const [products, total] = await Promise.all([
    db.product.findMany({ where, include: { category: true, _count: { select: { reviews: true } } }, orderBy: { name: 'asc' }, skip: pg.skip, take: pg.take }),
    db.product.count({ where }),
  ]);
  res.json(paginated(products.map(({ id, name, description, imageUrl, price, stock, barcode, category, _count }) => ({
    id, name, description, imageUrl, price, inStock: stock > 0, barcode, category, reviewCount: _count.reviews,
  })), total, pg.page, pg.pageSize));
}));
app.get('/api/categories', auth('SALES', 'WAREHOUSE'), ah(async (_, res) => res.json(await db.category.findMany({ orderBy: { name: 'asc' } }))));
app.post('/api/categories', auth('WAREHOUSE'), ah(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) throw new Err('Thiếu tên danh mục');
  if (name.length > 100) throw new Err('Tên danh mục quá dài');
  res.json(await db.category.create({ data: { name } }));
}));
const prodData = b => {
  b = b || {};
  if (b.price == null || b.price === '') throw new Err('Thiếu giá bán');
  const price = Number(b.price), cost = Number(b.cost ?? 0), minStock = Number(b.minStock ?? 5);
  const categoryId = b.categoryId ? Number(b.categoryId) : null;
  const description = String(b.description || '').trim();
  const imageUrl = String(b.imageUrl || '').trim();
  const d = { name: String(b.name || '').trim(), description: description || null, imageUrl: imageUrl || null, barcode: b.barcode ? String(b.barcode).trim() : null, price: Math.round(price), cost, minStock: Math.round(minStock), categoryId };
  if (!d.name) throw new Err('Thiếu tên sản phẩm');
  if (d.name.length > 160 || description.length > 2000 || imageUrl.length > 2048) throw new Err('Tên, mô tả hoặc đường dẫn ảnh quá dài');
  if (imageUrl) {
    let url;
    try { url = new URL(imageUrl); } catch { throw new Err('Đường dẫn ảnh không hợp lệ'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Err('Ảnh chỉ được dùng đường dẫn HTTP hoặc HTTPS');
  }
  if (!Number.isInteger(price) || price < 0 || price > 2147483647) throw new Err('Giá bán phải là số nguyên không âm hợp lệ');
  if (!Number.isFinite(cost) || cost < 0) throw new Err('Giá vốn không hợp lệ');
  if (!Number.isInteger(minStock) || minStock < 0 || minStock > 2147483647) throw new Err('Tồn kho tối thiểu phải là số nguyên không âm hợp lệ');
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) throw new Err('Danh mục không hợp lệ');
  return d;
};
app.get('/api/products', auth('SALES', 'WAREHOUSE'), ah(async (req, res) => {
  const { q, barcode } = req.query;
  const where = barcode ? { barcode: String(barcode) } : q ? { OR: [{ name: { contains: String(q), mode: 'insensitive' } }, { barcode: { contains: String(q) } }] } : {};
  const pg = pageArgs(req.query, 100);
  const [items, total] = await Promise.all([
    db.product.findMany({ where, include: { category: true }, orderBy: { name: 'asc' }, skip: pg.skip, take: pg.take }),
    db.product.count({ where }),
  ]);
  res.json(paginated(items, total, pg.page, pg.pageSize));
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
app.get('/api/store/products/:id/reviews', ah(async (req, res) => {
  const productId = posInt(req.params.id, 'Sản phẩm không hợp lệ');
  const pg = pageArgs(req.query, 10);
  const where = { productId };
  const [items, total, aggregate] = await Promise.all([
    db.productReview.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
    db.productReview.count({ where }),
    db.productReview.aggregate({ where, _avg: { rating: true } }),
  ]);
  res.json({ ...paginated(items, total, pg.page, pg.pageSize), averageRating: aggregate._avg.rating || 0 });
}));
app.get('/api/customer/favorites', auth('CUSTOMER'), ah(async (req, res) => {
  const pg = pageArgs(req.query, 24), where = { userId: req.user.id };
  const [items, total] = await Promise.all([
    db.favorite.findMany({ where, include: { product: { include: { category: true } } }, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
    db.favorite.count({ where }),
  ]);
  res.json(paginated(items.map(item => item.product), total, pg.page, pg.pageSize));
}));
app.post('/api/customer/favorites/:productId', auth('CUSTOMER'), ah(async (req, res) => {
  const productId = posInt(req.params.productId, 'Sản phẩm không hợp lệ');
  if (!await db.product.findUnique({ where: { id: productId }, select: { id: true } })) throw new Err('Không tìm thấy sản phẩm', 404);
  await db.favorite.upsert({ where: { userId_productId: { userId: req.user.id, productId } }, create: { userId: req.user.id, productId }, update: {} });
  res.status(201).json({ ok: true });
}));
app.delete('/api/customer/favorites/:productId', auth('CUSTOMER'), ah(async (req, res) => {
  const productId = posInt(req.params.productId, 'Sản phẩm không hợp lệ');
  await db.favorite.deleteMany({ where: { userId: req.user.id, productId } });
  res.json({ ok: true });
}));
app.post('/api/customer/reviews', auth('CUSTOMER'), ah(async (req, res) => {
  const body = req.body || {}, productId = posInt(body.productId, 'Sản phẩm không hợp lệ');
  const rating = Number(body.rating), comment = String(body.comment || '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Err('Đánh giá phải từ 1 đến 5 sao');
  if (comment.length > 2000) throw new Err('Nội dung đánh giá quá dài');
  const purchased = await db.order.count({ where: { userId: req.user.id, status: 'PAID', items: { some: { productId } } } });
  if (!purchased) throw new Err('Chỉ khách đã mua sản phẩm và nhận đủ đơn mới được đánh giá');
  res.status(201).json(await db.productReview.create({ data: { userId: req.user.id, productId, rating, comment: comment || null }, include: { user: { select: { name: true } } } }));
}));

// ---- Khách hàng, khuyến mãi
app.get('/api/customers', auth('SALES'), ah(async (_, res) => res.json(await db.customer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { orders: true } } } }))));
app.post('/api/customers', auth('SALES'), ah(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim(), phone = String(body.phone || '').trim();
  if (!name) throw new Err('Thiếu tên khách hàng');
  if (name.length > 120 || phone.length > 30) throw new Err('Tên khách hàng hoặc số điện thoại quá dài');
  res.json(await db.customer.create({ data: { name, phone: phone || null } }));
}));
app.put('/api/customers/:id', auth('SALES'), ah(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim(), phone = String(body.phone || '').trim();
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
  body = body || {};
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
app.post('/api/promotions/validate', auth('SALES', 'CUSTOMER'), ah(async (req, res) => res.json(await findPromo((req.body || {}).code))));

// ---- Bán hàng: lưu đơn trong một transaction
async function createOrder(tx, { userId, items, code, customerId, payment, status = 'PAID', paymentStatus = 'PAID', shippingAddress = null, shippingFee = 0 }) {
  if (!Array.isArray(items) || !items.length) throw new Err('Giỏ hàng trống');
  if (items.length > 100) throw new Err('Đơn hàng không được vượt quá 100 dòng sản phẩm');
  if (items.some(item => !item || typeof item !== 'object')) throw new Err('Dòng sản phẩm trong đơn hàng không hợp lệ');
  if (!['CASH', 'TRANSFER', 'COD', 'VNPAY', 'MOMO'].includes(payment)) throw new Err('Hình thức thanh toán không hợp lệ');
  if (!Number.isInteger(shippingFee) || shippingFee < 0 || shippingFee > 2147483647) throw new Err('Phí vận chuyển không hợp lệ');
  if (customerId) posInt(customerId, 'Khách hàng không hợp lệ');
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
  const total = t.total + shippingFee;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(t.discount) || total > 2147483647 || t.discount > 2147483647) throw new Err('Tổng tiền đơn hàng vượt giới hạn cho phép');
  const order = await tx.order.create({
    data: {
      userId, customerId: customerId ? Number(customerId) : null, payment, paymentStatus, status,
      shippingAddress, shippingFee, discount: t.discount, total, completedAt: status === 'PAID' ? new Date() : null,
      items: { create: lines.map(({ name, ...line }) => line) },
    },
    include: { items: { include: { product: true } }, customer: true, user: true },
  });
  for (const line of lines) {
    const updated = await tx.product.updateMany({
      where: { id: line.productId, stock: { gte: line.qty } },
      data: { stock: { decrement: line.qty } },
    });
    if (!updated.count) throw new Err(`"${line.name}" không đủ tồn kho`);
    await tx.stockMovement.create({ data: { productId: line.productId, type: 'OUT', qty: -line.qty, ref: 'HD' + order.id } });
  }
  return order;
}
app.post('/api/orders', auth('SALES'), ah(async (req, res) => {
  const { items = [], code, customerId, payment = 'CASH' } = req.body || {};
  res.json(await db.$transaction(tx => createOrder(tx, {
    userId: req.user.id, items, code, customerId, payment,
  })));
}));
app.get('/api/orders', auth('SALES', 'WAREHOUSE'), ah(async (req, res) => {
  const pg = pageArgs(req.query, 25);
  const [items, total] = await Promise.all([
    db.order.findMany({ orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take, include: { customer: true, user: true, items: { include: { product: true } } } }),
    db.order.count(),
  ]);
  res.json(paginated(items, total, pg.page, pg.pageSize));
}));
app.put('/api/orders/:id/status', auth('SALES', 'WAREHOUSE'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Đơn hàng không hợp lệ');
  const next = String((req.body || {}).status || '');
  const status = await db.$transaction(async tx => {
    const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new Err('Không tìm thấy đơn hàng', 404);
    if (!canTransition(order.status, next)) throw new Err('Không thể chuyển đơn hàng sang trạng thái này');
    if (next === 'CANCELLED' && (order.payment !== 'COD' || order.paymentStatus !== 'PENDING')) throw new Err('Đơn đã thanh toán hoặc đang xử lý trực tuyến không thể hủy; hãy lập yêu cầu trả hàng');
    if (order.payment !== 'COD' && order.paymentStatus !== 'PAID') throw new Err('Chỉ xác nhận giao đơn online sau khi máy chủ xác thực thanh toán thành công');
    if (next === 'PAID' && order.paymentStatus !== 'PAID' && order.payment !== 'COD') throw new Err('Đơn hàng chưa được cổng thanh toán xác nhận');
    const changed = await tx.order.updateMany({
      where: { id, status: order.status, paymentStatus: order.paymentStatus },
      data: { status: next, ...(next === 'CANCELLED' ? { paymentStatus: 'FAILED' } : {}), ...(next === 'PAID' ? { paymentStatus: 'PAID', completedAt: new Date() } : {}) },
    });
    if (!changed.count) throw new Err('Đơn hàng đã được cập nhật ở một phiên khác', 409);
    if (next === 'CANCELLED') {
      for (const item of order.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.qty } } });
        await tx.stockMovement.create({ data: { productId: item.productId, type: 'IN', qty: item.qty, ref: `HD${id}-HUY` } });
      }
    }
    return next;
  });
  const order = await db.order.findUnique({ where: { id }, include: { customer: true, user: true, items: { include: { product: true } } } });
  const statusLabel = { CONFIRMED: 'đã được xác nhận', SHIPPING: 'đang được giao', PAID: 'đã giao hoàn tất', CANCELLED: 'đã bị hủy' }[status];
  if (statusLabel) await sendOrderNotification(id, `Cập nhật đơn hàng #${id}`, `Đơn hàng #${id} ${statusLabel}.`);
  res.json(order);
}));
app.put('/api/orders/:id/shipping', auth('SALES', 'WAREHOUSE'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Đơn hàng không hợp lệ');
  const code = String((req.body || {}).trackingCode || '').trim();
  if (code.length > 100) throw new Err('Mã vận đơn không được vượt quá 100 ký tự');
  const order = await db.order.findUnique({ where: { id } });
  if (!order || !order.shippingAddress) throw new Err('Không tìm thấy đơn giao hàng', 404);
  const updated = await db.order.update({ where: { id }, data: { shippingTrackingCode: code || null } });
  if (code && code !== order.shippingTrackingCode) await sendOrderNotification(id, `Mã vận đơn đơn #${id}`, `Mã vận đơn giao hàng của bạn: ${code}`);
  res.json(updated);
}));

// ---- Cửa hàng trực tuyến cho khách hàng
app.get('/api/customer/orders', auth('CUSTOMER'), ah(async (req, res) => {
  const customer = await db.customer.findUnique({ where: { userId: req.user.id } });
  if (!customer) throw new Err('Không tìm thấy hồ sơ khách hàng', 404);
  const pg = pageArgs(req.query, 20), where = { customerId: customer.id };
  const [items, total] = await Promise.all([
    db.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take, include: { items: { include: { product: true } }, returnRequest: true } }),
    db.order.count({ where }),
  ]);
  res.json(paginated(items, total, pg.page, pg.pageSize));
}));
async function cancelOrderAndRestock(tx, id, reason) {
  const order = await tx.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.status !== 'PENDING') return false;
  const changed = await tx.order.updateMany({
    where: { id, status: 'PENDING', paymentStatus: 'PENDING' },
    data: { status: 'CANCELLED', paymentStatus: 'FAILED' },
  });
  if (!changed.count) return false;
  for (const item of order.items) {
    await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.qty } } });
    await tx.stockMovement.create({ data: { productId: item.productId, type: 'IN', qty: item.qty, ref: `HD${id}-HUY` } });
  }
  console.warn(`Đã hủy đơn #${id}: ${reason}`);
  return true;
}
async function createPaymentUrl(order, provider, req) {
  const apiUrl = (process.env.API_PUBLIC_URL || publicUrl).replace(/\/+$/, '');
  const ref = `${order.id}${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.paymentAttempt.create({ data: { orderId: order.id, provider, transactionRef: ref, amount: order.total, expiresAt } });
  if (provider === 'VNPAY') {
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const expiry = new Date(expiresAt.getTime() + 7 * 60 * 60 * 1000);
    const datePart = value => value.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const params = {
      vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: process.env.VNPAY_TMN_CODE,
      vnp_Amount: String(order.total * 100), vnp_CreateDate: datePart(now),
      vnp_ExpireDate: datePart(expiry),
      vnp_CurrCode: 'VND', vnp_IpAddr: String(req.ip || '127.0.0.1').replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1'),
      vnp_Locale: 'vn', vnp_OrderInfo: `Thanh toan don hang ${order.id}`, vnp_OrderType: 'other',
      vnp_ReturnUrl: `${publicUrl}/api/payments/vnpay/return`, vnp_TxnRef: ref,
    };
    const signature = signVnpay(params, process.env.VNPAY_HASH_SECRET);
    const query = vnpayQueryString(params);
    let gateway;
    try { gateway = new URL(process.env.VNPAY_PAYMENT_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'); }
    catch { throw new Err('Địa chỉ cổng VNPay không hợp lệ', 500); }
    if (gateway.protocol !== 'https:' || !['.vnpayment.vn', '.vnpay.vn'].some(domain => gateway.hostname.endsWith(domain))) throw new Err('Địa chỉ cổng VNPay phải là HTTPS thuộc miền VNPay', 500);
    return `${gateway.toString()}?${query}&vnp_SecureHash=${signature}`;
  }
  const accessKey = process.env.MOMO_ACCESS_KEY;
  const body = {
    partnerCode: process.env.MOMO_PARTNER_CODE, requestId: ref, amount: String(order.total), orderId: ref,
    orderInfo: `Thanh toan don hang ${order.id}`, redirectUrl: `${publicUrl}/api/payments/momo/return`,
    ipnUrl: `${apiUrl}/api/payments/momo/ipn`, lang: 'vi', requestType: 'captureWallet',
    autoCapture: true, extraData: '',
  };
  body.signature = signMomo(momoCreateSigningData(body, accessKey), process.env.MOMO_SECRET_KEY);
  let endpoint;
  try { endpoint = new URL(process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create'); }
  catch { throw new Err('Địa chỉ cổng MoMo không hợp lệ', 500); }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.momo.vn')) throw new Err('Địa chỉ cổng MoMo phải là HTTPS thuộc miền MoMo', 500);
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Err(`MoMo không phản hồi (${response.status})`, 502);
  const result = await response.json();
  let payUrl;
  try { payUrl = new URL(result.payUrl); } catch { throw new Err('MoMo trả về liên kết thanh toán không hợp lệ', 502); }
  if (result.resultCode !== 0 || payUrl.protocol !== 'https:' || !payUrl.hostname.endsWith('.momo.vn')) throw new Err('Không tạo được giao dịch MoMo', 502);
  return payUrl.toString();
}
async function settlePayment(provider, transactionRef, success, providerTxnId, amount) {
  return db.$transaction(async tx => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { transactionRef }, include: { order: { include: { items: true } } } });
    if (!attempt || attempt.provider !== provider || attempt.amount !== amount) throw new Err('Giao dịch thanh toán không hợp lệ', 400);
    if (attempt.status === 'PAID') return { order: attempt.order, changed: false };
    if (attempt.status === 'FAILED') {
      if (!success) return { order: attempt.order, changed: false };
      const latePayment = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'FAILED' }, data: { status: 'PAID', providerTxnId: String(providerTxnId || '') || null } });
      if (!latePayment.count) return { order: await tx.order.findUnique({ where: { id: attempt.orderId } }), changed: false };
      return { order: await tx.order.update({ where: { id: attempt.orderId }, data: { paymentStatus: 'PAID' } }), changed: true };
    }
    if (success) {
      if (attempt.order.status !== 'PENDING') throw new Err('Đơn hàng không còn chờ thanh toán', 409);
      const changed = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'PENDING' }, data: { status: 'PAID', providerTxnId: String(providerTxnId || '') || null } });
      if (!changed.count) return { order: await tx.order.findUnique({ where: { id: attempt.orderId } }), changed: false };
      return { order: await tx.order.update({ where: { id: attempt.orderId }, data: { paymentStatus: 'PAID' } }), changed: true };
    }
    const changed = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'PENDING' }, data: { status: 'FAILED', providerTxnId: String(providerTxnId || '') || null } });
    if (!changed.count) return { order: await tx.order.findUnique({ where: { id: attempt.orderId } }), changed: false };
    await cancelOrderAndRestock(tx, attempt.orderId, `${provider} từ chối thanh toán`);
    return { order: attempt.order, changed: true };
  });
}
function paymentReturnUrl(status, orderId) {
  const params = new URLSearchParams({ payment: status, ...(orderId ? { orderId: String(orderId) } : {}) });
  return `${publicUrl}/?${params}`;
}
app.get('/api/payments/vnpay/ipn', ah(async (req, res) => {
  const params = req.query, secret = process.env.VNPAY_HASH_SECRET;
  if (!secret || !verifyVnpay(params, secret) || params.vnp_TmnCode !== process.env.VNPAY_TMN_CODE) return res.json({ RspCode: '97', Message: 'Invalid signature' });
  const attempt = await db.paymentAttempt.findUnique({ where: { transactionRef: String(params.vnp_TxnRef || '') } });
  if (!attempt || attempt.provider !== 'VNPAY') return res.json({ RspCode: '01', Message: 'Order not found' });
  if (Number(params.vnp_Amount) !== attempt.amount * 100) return res.json({ RspCode: '04', Message: 'Invalid amount' });
  try {
    const result = await settlePayment('VNPAY', attempt.transactionRef, params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00', params.vnp_TransactionNo, attempt.amount);
    if (result.changed) await sendOrderNotification(attempt.orderId,
      params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00' ? `Đã thanh toán đơn #${attempt.orderId}` : `Thanh toán đơn #${attempt.orderId} thất bại`,
      params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00' ? `VNPay đã xác nhận thanh toán đơn #${attempt.orderId}.` : `Giao dịch VNPay của đơn #${attempt.orderId} thất bại; đơn đã bị hủy và tồn kho được hoàn lại.`);
    return res.json({ RspCode: '00', Message: 'Confirm Success' });
  } catch (error) {
    console.error('Xử lý IPN VNPay thất bại:', error.message);
    return res.json({ RspCode: '99', Message: 'Processing error' });
  }
}));
app.get('/api/payments/vnpay/return', ah(async (req, res) => {
  const params = req.query, secret = process.env.VNPAY_HASH_SECRET;
  if (!secret || !verifyVnpay(params, secret) || params.vnp_TmnCode !== process.env.VNPAY_TMN_CODE) return res.redirect(paymentReturnUrl('failure'));
  const attempt = await db.paymentAttempt.findUnique({ where: { transactionRef: String(params.vnp_TxnRef || '') } });
  if (!attempt || Number(params.vnp_Amount) !== attempt.amount * 100) return res.redirect(paymentReturnUrl('failure'));
  const success = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
  let result;
  try { result = await settlePayment('VNPAY', attempt.transactionRef, success, params.vnp_TransactionNo, attempt.amount); }
  catch (error) { console.error('Xử lý kết quả quay về VNPay thất bại:', error.message); }
  if (result?.changed && success) await sendOrderNotification(attempt.orderId, `Đã thanh toán đơn #${attempt.orderId}`, `VNPay đã xác nhận thanh toán đơn #${attempt.orderId}.`);
  res.redirect(paymentReturnUrl(success ? 'success' : 'failure', attempt.orderId));
}));
app.post('/api/payments/momo/ipn', ah(async (req, res) => {
  const body = req.body || {}, accessKey = process.env.MOMO_ACCESS_KEY, secret = process.env.MOMO_SECRET_KEY;
  if (!accessKey || !secret || !verifyMomo(body, accessKey, secret)) return res.status(401).json({ message: 'Invalid signature' });
  const attempt = await db.paymentAttempt.findUnique({ where: { transactionRef: String(body.orderId || '') } });
  if (!attempt || attempt.provider !== 'MOMO' || Number(body.amount) !== attempt.amount) return res.status(400).json({ message: 'Invalid transaction' });
  try {
    const result = await settlePayment('MOMO', attempt.transactionRef, Number(body.resultCode) === 0, body.transId, attempt.amount);
    if (result.changed) await sendOrderNotification(attempt.orderId,
      Number(body.resultCode) === 0 ? `Đã thanh toán đơn #${attempt.orderId}` : `Thanh toán đơn #${attempt.orderId} thất bại`,
      Number(body.resultCode) === 0 ? `MoMo đã xác nhận thanh toán đơn #${attempt.orderId}.` : `Giao dịch MoMo của đơn #${attempt.orderId} thất bại; đơn đã bị hủy và tồn kho được hoàn lại.`);
    res.json({ message: 'Received' });
  } catch (error) {
    console.error('Xử lý IPN MoMo thất bại:', error.message);
    res.status(500).json({ message: 'Processing error' });
  }
}));
app.get('/api/payments/momo/return', ah(async (req, res) => {
  const body = req.query || {}, accessKey = process.env.MOMO_ACCESS_KEY, secret = process.env.MOMO_SECRET_KEY;
  if (!accessKey || !secret || !verifyMomo(body, accessKey, secret)) return res.redirect(paymentReturnUrl('failure'));
  const attempt = await db.paymentAttempt.findUnique({ where: { transactionRef: String(body.orderId || '') } });
  if (!attempt || Number(body.amount) !== attempt.amount) return res.redirect(paymentReturnUrl('failure'));
  const success = Number(body.resultCode) === 0;
  let result;
  try { result = await settlePayment('MOMO', attempt.transactionRef, success, body.transId, attempt.amount); }
  catch (error) { console.error('Xử lý kết quả quay về MoMo thất bại:', error.message); }
  if (result?.changed && success) await sendOrderNotification(attempt.orderId, `Đã thanh toán đơn #${attempt.orderId}`, `MoMo đã xác nhận thanh toán đơn #${attempt.orderId}.`);
  res.redirect(paymentReturnUrl(success ? 'success' : 'failure', attempt.orderId));
}));
app.post('/api/customer/orders', auth('CUSTOMER'), ah(async (req, res) => {
  const body = req.body || {};
  const address = String(body.address || '').trim();
  if (address.length < 8 || address.length > 500) throw new Err('Địa chỉ giao hàng phải có từ 8 đến 500 ký tự');
  const payment = String(body.payment || 'COD');
  if (!['COD', 'VNPAY', 'MOMO'].includes(payment)) throw new Err('Hình thức thanh toán không hợp lệ');
  if (payment === 'VNPAY' && (!process.env.VNPAY_TMN_CODE || !process.env.VNPAY_HASH_SECRET)) throw new Err('Chưa cấu hình tài khoản VNPay', 503);
  if (payment === 'MOMO' && (!process.env.MOMO_PARTNER_CODE || !process.env.MOMO_ACCESS_KEY || !process.env.MOMO_SECRET_KEY)) throw new Err('Chưa cấu hình tài khoản MoMo', 503);
  if (!Number.isSafeInteger(shippingFee) || shippingFee < 0) throw new Err('Phí vận chuyển cấu hình không hợp lệ', 500);
  const customer = await db.customer.findUnique({ where: { userId: req.user.id } });
  if (!customer) throw new Err('Không tìm thấy hồ sơ khách hàng', 404);
  const order = await db.$transaction(tx => createOrder(tx, {
    userId: req.user.id, customerId: customer.id, items: body.items, code: body.code,
    payment, status: 'PENDING', paymentStatus: 'PENDING',
    shippingAddress: address, shippingFee,
  }));
  if (payment === 'COD') {
    await sendOrderNotification(order.id, `Đã nhận đơn hàng #${order.id}`, `Cửa hàng đã nhận đơn hàng #${order.id}; tổng tiền ${order.total} VND, thanh toán khi nhận hàng.`);
    return res.status(201).json(order);
  }
  try {
    const paymentUrl = await createPaymentUrl(order, payment, req);
    await sendOrderNotification(order.id, `Thanh toán đơn hàng #${order.id}`, `Đơn hàng #${order.id} đang chờ thanh toán trực tuyến.`);
    res.status(201).json({ ...order, paymentUrl });
  } catch (error) {
    await db.paymentAttempt.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED' } });
    await db.$transaction(tx => cancelOrderAndRestock(tx, order.id, 'Không tạo được phiên thanh toán'));
    throw error;
  }
}));
app.post('/api/customer/orders/:id/cancel', auth('CUSTOMER'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Đơn hàng không hợp lệ');
  const customer = await db.customer.findUnique({ where: { userId: req.user.id } });
  if (!customer) throw new Err('Không tìm thấy hồ sơ khách hàng', 404);
  await db.$transaction(async tx => {
    const order = await tx.order.findFirst({ where: { id, customerId: customer.id }, include: { items: true } });
    if (!order) throw new Err('Không tìm thấy đơn hàng', 404);
    if (order.status !== 'PENDING') throw new Err('Chỉ có thể hủy đơn đang chờ xác nhận');
    if (order.payment !== 'COD' || order.paymentStatus !== 'PENDING') throw new Err('Đơn online không thể tự hủy khi đang chờ kết quả thanh toán; liên hệ cửa hàng để hỗ trợ');
    const changed = await cancelOrderAndRestock(tx, id, 'Khách yêu cầu hủy');
    if (!changed) throw new Err('Đơn hàng đã được cập nhật ở một phiên khác', 409);
  });
  await sendOrderNotification(id, `Đơn hàng #${id} đã được hủy`, `Đơn hàng #${id} đã được hủy theo yêu cầu của bạn.`);
  res.json({ ok: true });
}));
app.post('/api/customer/orders/:id/return', auth('CUSTOMER'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Đơn hàng không hợp lệ');
  const reason = String((req.body || {}).reason || '').trim();
  if (reason.length < 8 || reason.length > 2000) throw new Err('Lý do trả hàng phải có từ 8 đến 2000 ký tự');
  const order = await db.order.findFirst({ where: { id, userId: req.user.id } });
  if (!order) throw new Err('Không tìm thấy đơn hàng', 404);
  if (order.status !== 'PAID') throw new Err('Chỉ có thể yêu cầu trả hàng cho đơn đã hoàn tất');
  if (Date.now() - (order.completedAt || order.createdAt).getTime() > 7 * 864e5) throw new Err('Đã quá thời hạn yêu cầu trả hàng 7 ngày');
  const request = await db.returnRequest.create({ data: { orderId: id, userId: req.user.id, reason } });
  await sendOrderNotification(id, `Yêu cầu trả hàng đơn #${id}`, `Cửa hàng đã nhận yêu cầu trả hàng của bạn. Nhân viên sẽ xem xét và phản hồi.`);
  res.status(201).json(request);
}));
app.get('/api/returns', auth('SALES', 'WAREHOUSE'), ah(async (req, res) => {
  const pg = pageArgs(req.query, 25);
  const [items, total] = await Promise.all([
    db.returnRequest.findMany({ orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take, include: { user: { select: { name: true, email: true } }, order: { include: { items: { include: { product: true } } } } } }),
    db.returnRequest.count(),
  ]);
  res.json(paginated(items, total, pg.page, pg.pageSize));
}));
app.put('/api/returns/:id', auth('SALES', 'WAREHOUSE'), ah(async (req, res) => {
  const id = posInt(req.params.id, 'Yêu cầu trả hàng không hợp lệ');
  const body = req.body || {}, status = String(body.status || ''), staffNote = String(body.staffNote || '').trim();
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new Err('Kết quả duyệt không hợp lệ');
  if (staffNote.length > 1000) throw new Err('Ghi chú không được vượt quá 1000 ký tự');
  const result = await db.$transaction(async tx => {
    const request = await tx.returnRequest.findUnique({ where: { id } });
    if (!request) throw new Err('Không tìm thấy yêu cầu trả hàng', 404);
    if (request.status !== 'PENDING') throw new Err('Yêu cầu này đã được xử lý');
    const updated = await tx.returnRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status, staffNote: staffNote || null } });
    if (!updated.count) throw new Err('Yêu cầu đã được xử lý ở một phiên khác', 409);
    return tx.returnRequest.findUnique({ where: { id }, include: { order: true, user: true } });
  });
  await sendOrderNotification(result.orderId, `Yêu cầu trả hàng đơn #${result.orderId} đã được xử lý`, `Yêu cầu trả hàng của bạn đã ${status === 'APPROVED' ? 'được duyệt; vui lòng liên hệ cửa hàng để hoàn tiền thủ công' : 'bị từ chối'}.${staffNote ? ` Ghi chú: ${staffNote}` : ''}`);
  res.json(result);
}));

// ---- Kho
const WH = auth('WAREHOUSE');
app.get('/api/suppliers', WH, ah(async (_, res) => res.json(await db.supplier.findMany())));
app.post('/api/suppliers', WH, ah(async (req, res) => {
  const body = req.body || {}, name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim(), address = String(body.address || '').trim();
  if (!name) throw new Err('Thiếu tên nhà cung cấp');
  if (name.length > 120 || phone.length > 30 || address.length > 300) throw new Err('Thông tin nhà cung cấp quá dài');
  res.json(await db.supplier.create({ data: { name, phone: phone || null, address: address || null } }));
}));
app.put('/api/suppliers/:id', WH, ah(async (req, res) => {
  const body = req.body || {}, name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim(), address = String(body.address || '').trim();
  if (!name) throw new Err('Thiếu tên nhà cung cấp');
  if (name.length > 120 || phone.length > 30 || address.length > 300) throw new Err('Thông tin nhà cung cấp quá dài');
  res.json(await db.supplier.update({
    where: { id: posInt(req.params.id, 'Nhà cung cấp không hợp lệ') },
    data: { name, phone: phone || null, address: address || null },
  }));
}));
app.delete('/api/suppliers/:id', WH, ah(async (req, res) => {
  const id = posInt(req.params.id, 'Nhà cung cấp không hợp lệ');
  if (await db.receipt.count({ where: { supplierId: id } })) throw new Err('Nhà cung cấp đã có phiếu nhập, không thể xóa');
  await db.supplier.delete({ where: { id } });
  res.json({ ok: true });
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
  const { supplierId, note, items = [], confirm } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new Err('Phiếu chưa có sản phẩm');
  if (items.length > 100) throw new Err('Phiếu nhập không được vượt quá 100 dòng sản phẩm');
  if (supplierId) posInt(supplierId, 'Nhà cung cấp không hợp lệ');
  const lines = items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new Err(`Dòng ${i + 1}: sản phẩm không hợp lệ`);
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
  const body = req.body || {};
  const qty = posInt(body.qty, 'Số lượng phải là số nguyên dương'), id = posInt(body.productId, 'Sản phẩm không hợp lệ');
  await db.$transaction(async tx => {
    const r = await tx.product.updateMany({ where: { id, stock: { gte: qty } }, data: { stock: { decrement: qty } } });
    if (!r.count) throw new Err('Không đủ tồn kho để xuất');
    await tx.stockMovement.create({ data: { productId: id, type: 'OUT', qty: -qty, ref: 'PX: ' + (body.note || 'xuất kho') } });
  });
  res.json({ ok: true });
}));
app.post('/api/stocktakes', WH, ah(async (req, res) => {
  const ref = 'KK' + Date.now(); let changed = 0;
  const body = req.body || {};
  if (!Array.isArray(body.items)) throw new Err('Danh sách kiểm kê không hợp lệ');
  await db.$transaction(async tx => {
    const items = body.items.map(it => {
      if (!it || typeof it !== 'object') throw new Err('Dòng kiểm kê không hợp lệ');
      if (it.actual == null || it.actual === '') throw new Err('Số thực tế không hợp lệ');
      return {
        productId: posInt(it.productId, 'Sản phẩm kiểm kê không hợp lệ'),
        actual: Number(it.actual),
      };
    });
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
app.get('/api/assistant/insights', OWN, ah(async (_, res) => {
  const since = new Date(Date.now() - 30 * 864e5);
  const [orders, products] = await Promise.all([
    db.order.findMany({
      where: { status: 'PAID', createdAt: { gte: since } },
      select: { total: true, items: { select: { productId: true, qty: true, product: { select: { name: true } } } } },
    }),
    db.product.findMany({ select: { id: true, name: true, stock: true, minStock: true } }),
  ]);
  res.json(buildInsights(orders, products));
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
  if (e.code === 'P2002') return res.status(400).json({ error: 'Dữ liệu bị trùng (tên đăng nhập, email, mã vạch hoặc mã khuyến mãi)' });
  if (e.code === 'P2003') return res.status(400).json({ error: 'Không thể xóa hoặc thay đổi dữ liệu đang được sử dụng' });
  if (e.code === 'P2025') return res.status(404).json({ error: 'Không tìm thấy dữ liệu yêu cầu' });
  if (e.status || e.message.includes('khuyến mãi')) return res.status(e.status || 400).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại' });
});
async function expirePaymentAttempts() {
  const expired = await db.paymentAttempt.findMany({
    where: { status: 'PENDING', expiresAt: { lte: new Date() } },
    select: { id: true, orderId: true },
  });
  for (const attempt of expired) {
    const changed = await db.$transaction(async tx => {
      const updated = await tx.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      if (!updated.count) return false;
      return cancelOrderAndRestock(tx, attempt.orderId, 'Hết thời gian thanh toán');
    });
    if (changed) await sendOrderNotification(attempt.orderId, `Đơn hàng #${attempt.orderId} hết hạn thanh toán`, `Đơn hàng #${attempt.orderId} đã được hủy do hết thời gian thanh toán.`);
  }
}
const expiryTimer = setInterval(() => {
  expirePaymentAttempts().catch(error => console.error('Dọn giao dịch thanh toán hết hạn thất bại:', error.message));
}, 60 * 1000);
expiryTimer.unref();
app.listen(4000, () => console.log('API chạy ở cổng 4000'));
