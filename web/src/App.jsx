import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// ---------- tiện ích ----------
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, body: body && JSON.stringify(body) });
  if (r.status === 401 && path !== '/login' && path !== '/register') {
    localStorage.removeItem('token'); localStorage.removeItem('user'); location.reload();
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Có lỗi xảy ra');
  return d;
}
function useLoad(path) {
  const [d, setD] = useState(null), [n, setN] = useState(0), [err, setErr] = useState('');
  useEffect(() => {
    let active = true;
    setErr('');
    api(path).then(value => { if (active) setD(value); }).catch(error => { if (active) setErr(error.message); });
    return () => { active = false; };
  }, [path, n]);
  return [d, () => setN(x => x + 1), err];
}
function Pager({ data, onChange }) {
  if (!data || data.pages <= 1) return null;
  return <div className="flex items-center justify-between gap-3 text-sm py-2">
    <span>Trang {data.page}/{data.pages} · {data.total} kết quả</span>
    <div className="flex gap-2"><button className={C.btn2} disabled={data.page <= 1} onClick={() => onChange(data.page - 1)}>Trước</button>
      <button className={C.btn2} disabled={data.page >= data.pages} onClick={() => onChange(data.page + 1)}>Tiếp</button></div>
  </div>;
}
const money = n => Number(n || 0).toLocaleString('vi-VN') + ' ₫';
const dt = s => new Date(s).toLocaleString('vi-VN');
const C = {
  inp: 'border border-stone-300 rounded px-3 py-2 bg-white w-full focus:outline-2 focus:outline-teal-700',
  btn: 'bg-teal-700 hover:bg-teal-800 text-white rounded px-4 py-2 font-medium disabled:opacity-50',
  btn2: 'border border-stone-300 bg-white rounded px-3 py-2 hover:bg-stone-100',
  card: 'bg-white border border-stone-200 rounded-lg p-4',
  th: 'text-left font-medium text-stone-500 py-2 pr-3', td: 'py-2 pr-3 border-t border-stone-100',
};
const Msg = ({ m }) => m ? <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 my-2">{m}</p> : null;
const Ok = ({ m }) => m ? <p className="text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded px-3 py-2 my-2">{m}</p> : null;

const orderStatus = {
  PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', SHIPPING: 'Đang giao',
  PAID: 'Hoàn tất', CANCELLED: 'Đã hủy',
};
function Storefront({ user, paymentNotice = '' }) {
  const [query, setQuery] = useState(''), [categoryId, setCategoryId] = useState(''), [catalogPage, setCatalogPage] = useState(1);
  const [categories, , categoryError] = useLoad('/store/categories');
  const [catalog, , loadError] = useLoad(`/store/products?q=${encodeURIComponent(query)}&categoryId=${categoryId}&page=${catalogPage}`);
  const [checkoutConfig] = useLoad('/store/payment-options');
  const products = catalog?.items || [];
  const [cart, setCart] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('shop-cart') || '[]');
      return Array.isArray(saved) ? saved.filter(item => item && Number.isInteger(item.id) && Number.isInteger(item.qty) && item.qty > 0) : [];
    } catch { return []; }
  });
  const [selected, setSelected] = useState(null), [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '' });
  const [address, setAddress] = useState(''), [code, setCode] = useState(''), [promo, setPromo] = useState(null), [payment, setPayment] = useState('COD');
  const [err, setErr] = useState(''), [ok, setOk] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { localStorage.setItem('shop-cart', JSON.stringify(cart)); }, [cart]);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = promo ? Math.min(subtotal, promo.type === 'PERCENT' ? Math.round(subtotal * promo.value / 100) : promo.value) : 0;
  const deliveryFee = checkoutConfig?.shippingFee || 0;
  const total = subtotal - discount + deliveryFee;
  const add = product => {
    if (!product.inStock) return;
    setCart(current => current.some(item => item.id === product.id)
      ? current.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item)
      : [...current, { ...product, qty: 1 }]);
    setSelected(null); setErr(''); setOk('');
  };
  const authenticate = async event => {
    event.preventDefault(); setErr(''); setOk(''); setBusy(true);
    try {
      if (mode === 'forgot') {
        const data = await api('/auth/forgot-password', { method: 'POST', body: { email: form.email } });
        setOk(data.message); setMode('login'); return;
      }
      const data = await api(mode === 'register' ? '/register' : '/login', {
        method: 'POST',
        body: mode === 'register' ? form : { username: form.username, password: form.password },
      });
      localStorage.setItem('token', data.token); localStorage.setItem('user', JSON.stringify(data.user));
      location.reload();
    } catch (error) { setErr(error.message); } finally { setBusy(false); }
  };
  const checkout = async () => {
    setErr(''); setOk(''); setBusy(true);
    try {
      const order = await api('/customer/orders', {
        method: 'POST',
        body: { address, code: promo?.code, payment, items: cart.map(item => ({ productId: item.id, qty: item.qty })) },
      });
      if (order.paymentUrl) { location.assign(order.paymentUrl); return; }
      setCart([]); setAddress(''); setCode(''); setPromo(null); setOk(`Đặt hàng thành công. Mã đơn #${order.id}; tổng thanh toán ${money(order.total)}, đơn đang chờ cửa hàng xác nhận.`);
    } catch (error) { setErr(error.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen">
      <header className="bg-[#11263a] text-white px-4 py-4 md:px-8 flex flex-wrap items-center gap-3">
        <div className="mr-auto"><div className="text-xl font-semibold">Cửa hàng của bạn</div><div className="text-xs text-stone-300">Xem hàng và đặt hàng trực tuyến</div></div>
        {user?.role === 'CUSTOMER' && <span className="text-sm">Xin chào, {user.name}</span>}
        {user && user.role !== 'CUSTOMER' && <span className="text-sm text-amber-200">Đang xem với tài khoản nhân viên</span>}
        {user?.role === 'CUSTOMER' && <button className="border border-white/40 rounded px-3 py-2" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); location.reload(); }}>Đăng xuất</button>}
      </header>
      <main className="p-4 md:p-8">
        <Ok m={paymentNotice} />
        <div className="grid lg:grid-cols-[1fr_22rem] gap-5">
          <section>
            <div className="flex flex-wrap gap-2 mb-4">
              <input className={C.inp + ' min-w-56 flex-1'} placeholder="Tìm sản phẩm..." value={query} onChange={event => { setCatalogPage(1); setQuery(event.target.value); }} />
              <select className={C.inp + ' !w-auto'} value={categoryId} onChange={event => { setCatalogPage(1); setCategoryId(event.target.value); }}>
                <option value="">Tất cả danh mục</option>{categories?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <Msg m={loadError || categoryError} />
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {products.map(product => <article key={product.id} className={C.card + ' flex flex-col gap-2'}>
                <button className="text-left flex-1" onClick={() => setSelected(product)}>
                  {product.imageUrl && <img src={product.imageUrl} alt={product.name} loading="lazy" className="w-full h-40 object-cover rounded mb-2" />}
                  <span className="text-xs text-stone-500">{product.category?.name || 'Sản phẩm'}</span>
                  <h2 className="font-semibold text-lg">{product.name}</h2>
                  <p className="text-teal-800 font-semibold">{money(product.price)}</p>
                  {product.reviewCount > 0 && <p className="text-xs text-amber-700">★ {product.reviewCount} đánh giá</p>}
                  <p className="text-sm text-stone-500">{product.inStock ? 'Còn hàng' : 'Tạm hết hàng'}</p>
                </button>
                {user?.role === 'CUSTOMER' && <button className={C.btn2} onClick={async () => { try { await api(`/customer/favorites/${product.id}`, { method: 'POST' }); setOk('Đã thêm vào yêu thích'); } catch (error) { setErr(error.message); } }}>♡ Yêu thích</button>}
                <button className={C.btn} disabled={!product.inStock} onClick={() => add(product)}>Thêm vào giỏ</button>
              </article>)}
            </div>
            {!products.length && !loadError && <p className="text-stone-500">Không tìm thấy sản phẩm.</p>}
            <Pager data={catalog} onChange={setCatalogPage} />
          </section>
          <aside className={C.card + ' h-fit space-y-3'}>
            <h2 className="text-lg font-semibold">Giỏ hàng ({cart.reduce((sum, item) => sum + item.qty, 0)})</h2>
            {!cart.length && <p className="text-sm text-stone-500">Chọn sản phẩm để bắt đầu mua hàng.</p>}
            {cart.map(item => <div key={item.id} className="flex items-center gap-2 text-sm border-t pt-2">
              <div className="flex-1">{item.name}<div className="text-stone-500">{money(item.price)} × {item.qty}</div></div>
              <button aria-label={`Giảm ${item.name}`} className={C.btn2} onClick={() => setCart(items => items.map(row => row.id === item.id ? { ...row, qty: row.qty - 1 } : row).filter(row => row.qty > 0))}>−</button>
              <button aria-label={`Tăng ${item.name}`} className={C.btn2} onClick={() => setCart(items => items.map(row => row.id === item.id ? { ...row, qty: row.qty + 1 } : row))}>+</button>
              <button aria-label={`Xóa ${item.name}`} className="text-red-700 px-1" onClick={() => setCart(items => items.filter(row => row.id !== item.id))}>✕</button>
            </div>)}
            <div className="space-y-1 border-t pt-2 text-sm"><div className="flex justify-between"><span>Tạm tính</span><span>{money(subtotal)}</span></div><div className="flex justify-between"><span>Giảm giá</span><span>-{money(discount)}</span></div><div className="flex justify-between"><span>Phí giao hàng</span><span>{money(deliveryFee)}</span></div><div className="flex justify-between text-base font-semibold"><span>Tổng thanh toán</span><span>{money(total)}</span></div></div>
            {user?.role === 'CUSTOMER' && <>
              <div className="flex gap-2"><input className={C.inp} placeholder="Mã khuyến mãi" value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setPromo(null); }} /><button className={C.btn2} disabled={!code.trim()} onClick={async () => { setErr(''); setPromo(null); try { setPromo(await api('/promotions/validate', { method: 'POST', body: { code } })); } catch (error) { setErr(error.message); } }}>Áp dụng</button></div>
              <label className="text-sm block">Địa chỉ nhận hàng<textarea required minLength="8" maxLength="500" className={C.inp} rows="3" value={address} onChange={event => setAddress(event.target.value)} placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" /></label>
              <CheckoutAddresses onChoose={setAddress} />
              <label className="text-sm block">Thanh toán<select className={C.inp} value={payment} onChange={event => setPayment(event.target.value)}>
                <option value="COD">Thanh toán khi nhận hàng (COD)</option>
                {checkoutConfig?.vnpay && <option value="VNPAY">VNPay</option>}
                {checkoutConfig?.momo && <option value="MOMO">MoMo</option>}
              </select></label>
              <p className="text-xs text-stone-500">Tồn kho được giữ sau khi đặt đơn. Đơn thanh toán online chỉ được xác nhận sau khi máy chủ nhận chữ ký hợp lệ từ cổng thanh toán.</p>
              <button className={C.btn + ' w-full'} disabled={!cart.length || !address.trim() || busy} onClick={checkout}>{busy ? 'Đang đặt hàng...' : 'Đặt hàng'}</button>
            </>}
            {!user && <form onSubmit={authenticate} className="border-t pt-3 space-y-2">
              <div className="flex gap-2"><button type="button" className={mode === 'login' ? C.btn : C.btn2} onClick={() => setMode('login')}>Đăng nhập</button><button type="button" className={mode === 'register' ? C.btn : C.btn2} onClick={() => setMode('register')}>Tạo tài khoản</button></div>
              {mode === 'forgot' && <label className="text-sm block">Email<input required type="email" className={C.inp} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>}
              {mode === 'register' && <>
                <label className="text-sm block">Họ tên<input required maxLength="120" className={C.inp} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                <label className="text-sm block">Email (dùng để xác minh/khôi phục mật khẩu)<input type="email" maxLength="254" className={C.inp} value={form.email || ''} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
                <label className="text-sm block">Số điện thoại<input type="tel" maxLength="30" className={C.inp} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
              </>}
              {mode !== 'forgot' && <label className="text-sm block">Tên đăng nhập<input required minLength="3" maxLength="32" className={C.inp} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></label>}
              {mode !== 'forgot' && <label className="text-sm block">Mật khẩu<input required minLength={mode === 'register' ? 8 : 1} type="password" className={C.inp} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>}
              {mode === 'login' && <button type="button" className="text-teal-800 text-sm" onClick={() => setMode('forgot')}>Quên mật khẩu?</button>}
              {mode === 'forgot' && <button type="button" className="text-teal-800 text-sm" onClick={() => setMode('login')}>Quay lại đăng nhập</button>}
              <Msg m={err} /><Ok m={ok} /><button className={C.btn + ' w-full'} disabled={busy}>{busy ? 'Đang xử lý...' : mode === 'register' ? 'Đăng ký khách hàng' : mode === 'forgot' ? 'Gửi liên kết đặt lại' : 'Đăng nhập'}</button>
            </form>}
            {user && user.role !== 'CUSTOMER' && <p className="text-sm text-amber-800">Đăng nhập tài khoản khách hàng để hoàn tất đơn trực tuyến.</p>}
            <Msg m={user ? err : ''} /><Ok m={ok} />
          </aside>
        </div>
      </main>
      {selected && <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4" onClick={() => setSelected(null)}>
        <div className="bg-white rounded-lg p-6 w-full max-w-lg space-y-3" onClick={event => event.stopPropagation()}>
          <p className="text-sm text-stone-500">{selected.category?.name || 'Sản phẩm'}</p><h2 className="text-2xl font-semibold">{selected.name}</h2>
          <p className="text-xl text-teal-800 font-semibold">{money(selected.price)}</p>
          <p className="whitespace-pre-wrap">{selected.description || 'Sản phẩm hiện chưa có mô tả.'}</p>
          {selected.imageUrl && <img src={selected.imageUrl} alt={selected.name} className="w-full max-h-64 object-contain rounded" />}
          <p className="text-sm">{selected.inStock ? 'Còn hàng' : 'Tạm hết hàng'}</p>
          <ProductReviews key={selected.id} product={selected} user={user} />
          <div className="flex gap-2"><button className={C.btn} disabled={!selected.inStock} onClick={() => add(selected)}>Thêm vào giỏ</button><button className={C.btn2} onClick={() => setSelected(null)}>Đóng</button></div>
        </div>
      </div>}
    </div>
  );
}
function CheckoutAddresses({ onChoose }) {
  const [profile] = useLoad('/customer/profile');
  if (!profile?.addresses?.length) return null;
  return <label className="text-xs block">Dùng địa chỉ đã lưu<select className={C.inp} defaultValue="" onChange={event => { if (event.target.value) onChoose(event.target.value); }}>
    <option value="">Chọn địa chỉ</option>{profile.addresses.map(item => <option key={item.id} value={item.address}>{item.label}{item.isDefault ? ' (mặc định)' : ''}</option>)}
  </select></label>;
}
function ProductReviews({ product, user }) {
  const [page, setPage] = useState(1), [reviews, reload, loadError] = useLoad(`/store/products/${product.id}/reviews?page=${page}`);
  const [rating, setRating] = useState(5), [comment, setComment] = useState(''), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const submit = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try { await api('/customer/reviews', { method: 'POST', body: { productId: product.id, rating, comment } }); setComment(''); setOk('Đã gửi đánh giá'); reload(); }
    catch (error) { setErr(error.message); }
  };
  return <section className="border-t pt-3 space-y-2">
    <h3 className="font-semibold">Đánh giá {reviews?.total ? `· ★ ${Number(reviews.averageRating).toFixed(1)} (${reviews.total})` : ''}</h3>
    <Msg m={loadError || err} /><Ok m={ok} />
    {reviews?.items.map(review => <div key={review.id} className="text-sm border-t pt-2"><b>{review.user.name}</b> <span className="text-amber-700">{'★'.repeat(review.rating)}</span><p>{review.comment}</p></div>)}
    <Pager data={reviews} onChange={setPage} />
    {user?.role === 'CUSTOMER' && <form onSubmit={submit} className="space-y-2">
      <label className="text-sm block">Số sao<select className={C.inp} value={rating} onChange={event => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map(n => <option value={n} key={n}>{n} sao</option>)}</select></label>
      <textarea className={C.inp} rows="2" maxLength="2000" placeholder="Chia sẻ trải nghiệm (khách đã nhận hàng mới được đánh giá)" value={comment} onChange={event => setComment(event.target.value)} />
      <button className={C.btn2}>Gửi đánh giá</button>
    </form>}
  </section>;
}

function CustomerOrders() {
  const [page, setPage] = useState(1), [orders, reload, loadError] = useLoad(`/customer/orders?page=${page}`);
  const [ok, setOk] = useState(''), [err, setErr] = useState('');
  const [returnId, setReturnId] = useState(null), [reason, setReason] = useState('');
  const cancel = async id => {
    setOk(''); setErr('');
    if (!confirm(`Hủy đơn hàng #${id}?`)) return;
    try { await api(`/customer/orders/${id}/cancel`, { method: 'POST' }); setOk(`Đã hủy đơn hàng #${id}`); reload(); }
    catch (error) { setErr(error.message); }
  };
  return <div className="space-y-3"><Msg m={loadError || err} /><Ok m={ok} />
    {orders?.items.map(order => <article key={order.id} className={C.card}>
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Đơn hàng #{order.id}</h2><span>{orderStatus[order.status] || order.status}</span></div>
      <p className="text-sm text-stone-500">{dt(order.createdAt)} · {order.payment} · Thanh toán: {order.paymentStatus === 'PAID' ? 'Đã thanh toán' : order.paymentStatus === 'FAILED' ? 'Thất bại' : 'Chưa thanh toán'}</p>
      <p className="text-sm">Giao đến: {order.shippingAddress}</p>
      {order.shippingTrackingCode && <p className="text-sm">Mã vận đơn: {order.shippingTrackingCode}</p>}
      <ul className="my-2 text-sm">{order.items.map(item => <li key={item.id}>{item.product.name} × {item.qty} — {money(item.price * item.qty)}</li>)}</ul>
      <div className="flex justify-between text-sm"><span>Phí vận chuyển</span><span>{money(order.shippingFee)}</span></div>
      <div className="flex justify-between font-semibold"><span>Tổng đơn</span><span>{money(order.total)}</span></div>
      {order.status === 'PENDING' && <button className="mt-3 text-red-700" onClick={() => cancel(order.id)}>Hủy đơn</button>}
      {order.status === 'PAID' && !order.returnRequest && Date.now() - new Date(order.completedAt || order.createdAt).getTime() <= 7 * 864e5 && <button className="mt-3 text-teal-800" onClick={() => { setReturnId(order.id); setReason(''); }}>Yêu cầu trả hàng</button>}
      {order.returnRequest && <p className="text-sm mt-2">Trả hàng: {{ PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt – liên hệ cửa hàng để hoàn tiền thủ công', REJECTED: 'Bị từ chối' }[order.returnRequest.status]}</p>}
      {returnId === order.id && <form className="mt-3 space-y-2" onSubmit={async event => { event.preventDefault(); try { await api(`/customer/orders/${order.id}/return`, { method: 'POST', body: { reason } }); setOk('Đã gửi yêu cầu trả hàng'); setReturnId(null); reload(); } catch (error) { setErr(error.message); } }}>
        <textarea required minLength="8" maxLength="2000" className={C.inp} placeholder="Lý do trả hàng" value={reason} onChange={event => setReason(event.target.value)} />
        <button className={C.btn}>Gửi yêu cầu</button>
      </form>}
    </article>)}
    <Pager data={orders} onChange={setPage} />
    {!orders?.items.length && !loadError && <div className={C.card + ' text-stone-500'}>Bạn chưa có đơn hàng nào.</div>}
  </div>;
}

function CustomerAccount({ updateUser }) {
  const [profile, reload, loadError] = useLoad('/customer/profile');
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [address, setAddress] = useState({ label: '', address: '', isDefault: true });
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
  const [err, setErr] = useState(''), [ok, setOk] = useState('');
  useEffect(() => {
    if (profile) setForm({ name: profile.name, email: profile.email || '', phone: profile.customer?.phone || '' });
  }, [profile]);
  const save = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try {
      await api('/customer/profile', { method: 'PUT', body: form });
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const nextUser = { ...currentUser, name: form.name };
      localStorage.setItem('user', JSON.stringify(nextUser));
      updateUser?.(nextUser);
      setOk('Đã lưu hồ sơ. Nếu email thay đổi, hãy xác minh email mới.'); reload();
    }
    catch (error) { setErr(error.message); }
  };
  const addAddress = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try { await api('/customer/addresses', { method: 'POST', body: address }); setAddress({ label: '', address: '', isDefault: false }); setOk('Đã lưu địa chỉ'); reload(); }
    catch (error) { setErr(error.message); }
  };
  const changePassword = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try { await api('/customer/password', { method: 'POST', body: password }); setPassword({ currentPassword: '', newPassword: '' }); setOk('Đã đổi mật khẩu'); }
    catch (error) { setErr(error.message); }
  };
  const verifyEmail = async () => {
    setErr(''); setOk('');
    try { await api('/customer/email/verification', { method: 'POST', body: {} }); setOk('Đã gửi liên kết xác minh email.'); }
    catch (error) { setErr(error.message); }
  };
  return <div className="grid lg:grid-cols-2 gap-4">
    <form onSubmit={save} className={C.card + ' space-y-3'}>
      <h2 className="font-semibold">Hồ sơ cá nhân</h2>
      <p className="text-sm text-stone-500">Tên đăng nhập: {profile?.username}</p>
      <label className="text-sm block">Họ tên<input required maxLength="120" className={C.inp} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label className="text-sm block">Email<input type="email" maxLength="254" className={C.inp} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      <label className="text-sm block">Số điện thoại<input type="tel" maxLength="30" className={C.inp} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      <p className="text-xs">{profile?.emailVerifiedAt ? 'Email đã xác minh' : 'Email chưa xác minh'}</p>
      {form.email && !profile?.emailVerifiedAt && <button type="button" className={C.btn2} onClick={verifyEmail}>Gửi liên kết xác minh</button>}
      <button className={C.btn}>Lưu hồ sơ</button>
    </form>
    <form onSubmit={changePassword} className={C.card + ' space-y-3'}>
      <h2 className="font-semibold">Đổi mật khẩu</h2>
      <label className="text-sm block">Mật khẩu hiện tại<input required type="password" className={C.inp} value={password.currentPassword} onChange={event => setPassword({ ...password, currentPassword: event.target.value })} /></label>
      <label className="text-sm block">Mật khẩu mới (8-72 ký tự)<input required minLength="8" maxLength="72" type="password" className={C.inp} value={password.newPassword} onChange={event => setPassword({ ...password, newPassword: event.target.value })} /></label>
      <button className={C.btn}>Đổi mật khẩu</button>
    </form>
    <section className={C.card + ' space-y-3'}>
      <h2 className="font-semibold">Sổ địa chỉ</h2>
      {profile?.addresses?.map(item => <div key={item.id} className="flex items-start gap-2 border-t pt-2 text-sm"><div className="flex-1"><b>{item.label}</b> {item.isDefault && <span className="text-teal-700">(Mặc định)</span>}<p>{item.address}</p></div>
        {!item.isDefault && <button className="text-teal-800" onClick={async () => { try { await api(`/customer/addresses/${item.id}/default`, { method: 'PUT', body: {} }); reload(); } catch (error) { setErr(error.message); } }}>Đặt mặc định</button>}
        <button className="text-red-700" onClick={async () => { try { await api(`/customer/addresses/${item.id}`, { method: 'DELETE' }); reload(); } catch (error) { setErr(error.message); } }}>Xóa</button></div>)}
      <form onSubmit={addAddress} className="space-y-2 border-t pt-2">
        <input required maxLength="60" className={C.inp} placeholder="Tên địa chỉ (Nhà, Công ty...)" value={address.label} onChange={event => setAddress({ ...address, label: event.target.value })} />
        <textarea required minLength="8" maxLength="500" className={C.inp} placeholder="Địa chỉ đầy đủ" value={address.address} onChange={event => setAddress({ ...address, address: event.target.value })} />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={address.isDefault} onChange={event => setAddress({ ...address, isDefault: event.target.checked })} />Đặt làm mặc định</label>
        <button className={C.btn2}>Thêm địa chỉ</button>
      </form>
    </section>
    <div><Msg m={loadError || err} /><Ok m={ok} /></div>
  </div>;
}

function Favorites() {
  const [page, setPage] = useState(1), [data, reload, loadError] = useLoad(`/customer/favorites?page=${page}`);
  const remove = async id => { try { await api(`/customer/favorites/${id}`, { method: 'DELETE' }); reload(); } catch (error) { alert(error.message); } };
  return <div className="space-y-3"><Msg m={loadError} /><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
    {data?.items.map(product => <article key={product.id} className={C.card}>{product.imageUrl && <img src={product.imageUrl} alt={product.name} className="w-full h-40 object-cover rounded" />}<h2 className="font-semibold">{product.name}</h2><p>{money(product.price)}</p><button className="text-red-700" onClick={() => remove(product.id)}>Bỏ yêu thích</button></article>)}
  </div><Pager data={data} onChange={setPage} /></div>;
}

function Staff() {
  const empty = { username: '', name: '', role: 'SALES', password: '' };
  const [form, setForm] = useState(empty), [staff, reload, loadError] = useLoad('/staff'), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const save = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try { await api(form.id ? `/staff/${form.id}` : '/staff', { method: form.id ? 'PUT' : 'POST', body: form }); setForm(empty); setOk('Đã lưu tài khoản nhân viên'); reload(); }
    catch (error) { setErr(error.message); }
  };
  const remove = async user => {
    if (!confirm(`Xóa tài khoản "${user.username}"?`)) return;
    try { await api(`/staff/${user.id}`, { method: 'DELETE' }); reload(); setOk('Đã xóa tài khoản'); }
    catch (error) { setErr(error.message); }
  };
  return <div className="grid lg:grid-cols-[1fr_20rem] gap-4">
    <div className={C.card + ' overflow-x-auto'}><Msg m={loadError} /><table className="w-full text-sm"><thead><tr>{['Tên đăng nhập', 'Họ tên', 'Vai trò', ''].map(x => <th key={x} className={C.th}>{x}</th>)}</tr></thead>
      <tbody>{staff?.map(user => <tr key={user.id}><td className={C.td}>{user.username}</td><td className={C.td}>{user.name}</td><td className={C.td}>{user.role === 'SALES' ? 'Bán hàng' : 'Kho'}</td><td className={C.td}><button className="text-teal-800 mr-3" onClick={() => setForm({ id: user.id, username: user.username, name: user.name, role: user.role, password: '' })}>Sửa</button><button className="text-red-700" onClick={() => remove(user)}>Xóa</button></td></tr>)}</tbody>
    </table></div>
    <form onSubmit={save} className={C.card + ' space-y-2 h-fit'}><h2 className="font-semibold">{form.id ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2>
      <label className="text-sm block">Tên đăng nhập<input required={!form.id} minLength="3" maxLength="32" pattern="[a-zA-Z0-9_-]+" disabled={Boolean(form.id)} className={C.inp} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></label>
      <label className="text-sm block">Họ tên<input required maxLength="120" className={C.inp} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label className="text-sm block">Vai trò<select className={C.inp} value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}><option value="SALES">Bán hàng</option><option value="WAREHOUSE">Kho</option></select></label>
      <label className="text-sm block">Mật khẩu {form.id ? '(để trống để giữ nguyên)' : '(8-72 ký tự)'}<input required={!form.id} minLength="8" maxLength="72" type="password" className={C.inp} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
      <Msg m={err} /><Ok m={ok} /><div className="flex gap-2"><button className={C.btn}>Lưu</button>{form.id && <button type="button" className={C.btn2} onClick={() => setForm(empty)}>Hủy</button>}</div>
    </form>
  </div>;
}

function Returns() {
  const [page, setPage] = useState(1), [data, reload, loadError] = useLoad(`/returns?page=${page}`), [err, setErr] = useState('');
  const decide = async (item, status) => {
    const staffNote = prompt(status === 'APPROVED' ? 'Duyệt trả hàng. Ghi chú hoàn tiền thủ công (không bắt buộc):' : 'Lý do từ chối:') || '';
    try { await api(`/returns/${item.id}`, { method: 'PUT', body: { status, staffNote } }); reload(); }
    catch (error) { setErr(error.message); }
  };
  return <div className="space-y-3"><Msg m={loadError || err} />
    {data?.items.map(item => <article key={item.id} className={C.card}>
      <div className="flex justify-between"><b>Đơn #{item.orderId} · {item.user.name}</b><span>{item.status === 'PENDING' ? 'Chờ duyệt' : item.status === 'APPROVED' ? 'Đã duyệt' : 'Từ chối'}</span></div>
      <p className="text-sm text-stone-500">{dt(item.createdAt)} · {money(item.order.total)}</p><p className="my-2">{item.reason}</p>
      {item.staffNote && <p className="text-sm">Ghi chú: {item.staffNote}</p>}
      {item.status === 'PENDING' && <div className="flex gap-2"><button className={C.btn} onClick={() => decide(item, 'APPROVED')}>Duyệt (hoàn tiền thủ công)</button><button className={C.btn2} onClick={() => decide(item, 'REJECTED')}>Từ chối</button></div>}
    </article>)}
    <Pager data={data} onChange={setPage} />
  </div>;
}

// ---------- bán hàng (POS) ----------
function POS() {
  const [q, setQ] = useState(''), [cart, setCart] = useState([]), [code, setCode] = useState(''), [promo, setPromo] = useState(null);
  const [cust, setCust] = useState(''), [pay, setPay] = useState('CASH'), [done, setDone] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [prodsPage, reloadP] = useLoad('/products?q=' + encodeURIComponent(q));
  const prods = prodsPage?.items || [];
  const [custs, reloadC] = useLoad('/customers');
  const sub = cart.reduce((s, l) => s + l.p.price * l.qty, 0);
  const discount = promo ? Math.min(sub, promo.type === 'PERCENT' ? Math.round(sub * promo.value / 100) : promo.value) : 0;
  const add = p => {
    setErr('');
    const cur = cart.find(l => l.p.id === p.id)?.qty || 0;
    if (p.stock <= cur) return setErr(p.stock ? `"${p.name}" chỉ còn ${p.stock} trong kho` : `"${p.name}" đã hết hàng`);
    setCart(c => c.some(l => l.p.id === p.id) ? c.map(l => l.p.id === p.id ? { ...l, qty: l.qty + 1 } : l) : [...c, { p, qty: 1 }]);
  };
  const scan = e => { // Enter: mã vạch khớp chính xác thì thêm luôn
    if (e.key !== 'Enter') return;
    const hit = prods.find(p => p.barcode === q.trim()) || (prods.length === 1 ? prods[0] : null);
    if (hit) { add(hit); setQ(''); } else setErr('Không tìm thấy sản phẩm');
  };
  const setQty = (id, v) => setCart(c => c.map(l => l.p.id === id ? { ...l, qty: Math.max(1, Math.min(l.p.stock, Number(v) || 1)) } : l));
  const applyCode = async () => { setErr(''); try { setPromo(await api('/promotions/validate', { method: 'POST', body: { code } })); } catch (x) { setPromo(null); setErr(x.message); } };
  const newCust = async () => { const name = prompt('Tên khách hàng:'); if (!name) return; try { const c = await api('/customers', { method: 'POST', body: { name, phone: prompt('Số điện thoại (có thể bỏ trống):') || '' } }); reloadC(); setCust(String(c.id)); } catch (x) { setErr(x.message); } };
  const checkout = async () => {
    setErr(''); setBusy(true);
    try { setDone(await api('/orders', { method: 'POST', body: { items: cart.map(l => ({ productId: l.p.id, qty: l.qty })), code: promo?.code, customerId: cust || null, payment: pay } })); setCart([]); setPromo(null); setCode(''); reloadP(); }
    catch (x) { setErr(x.message); reloadP(); } finally { setBusy(false); }
  };
  return (
    <div className="grid lg:grid-cols-[1fr_24rem] gap-4">
      <section>
        <input autoFocus className={C.inp} placeholder="Quét mã vạch hoặc gõ tên sản phẩm rồi nhấn Enter" value={q} onChange={e => setQ(e.target.value)} onKeyDown={scan} />
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3">
          {prods.map(p => (
            <button key={p.id} disabled={!p.stock} onClick={() => add(p)} className={C.card + ' text-left hover:border-teal-700 disabled:opacity-40'}>
              <div className="font-medium">{p.name}</div>
              <div className="text-teal-800">{money(p.price)}</div>
              <div className="text-xs text-stone-500">{p.stock ? `Còn ${p.stock}` : 'Hết hàng'}</div>
            </button>
          ))}
        </div>
      </section>
      <aside className={C.card + ' h-fit space-y-3'}>
        <h2 className="font-semibold text-lg">Giỏ hàng</h2>
        {!cart.length && <p className="text-stone-500 text-sm">Chưa có sản phẩm. Quét mã hoặc chọn sản phẩm bên trái.</p>}
        {cart.map(l => (
          <div key={l.p.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{l.p.name}<br /><span className="text-stone-500">{money(l.p.price * l.qty)}</span></span>
            <input type="number" min="1" max={l.p.stock} className="w-16 border rounded px-2 py-1" value={l.qty} onChange={e => setQty(l.p.id, e.target.value)} />
            <button aria-label="Xóa" className="text-red-700 px-2" onClick={() => setCart(c => c.filter(x => x.p.id !== l.p.id))}>✕</button>
          </div>
        ))}
        <div className="flex gap-2"><select className={C.inp} value={cust} onChange={e => setCust(e.target.value)}><option value="">Khách lẻ</option>{custs?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className={C.btn2} onClick={newCust}>Thêm</button></div>
        <div className="flex gap-2"><input className={C.inp} placeholder="Mã khuyến mãi" value={code} onChange={e => { setCode(e.target.value); setPromo(null); }} /><button className={C.btn2} onClick={applyCode} disabled={!code}>Áp dụng</button></div>
        <select className={C.inp} value={pay} onChange={e => setPay(e.target.value)}><option value="CASH">Tiền mặt</option><option value="TRANSFER">Chuyển khoản</option></select>
        <div className="text-sm space-y-1 border-t pt-2"><div className="flex justify-between"><span>Tạm tính</span><span>{money(sub)}</span></div><div className="flex justify-between"><span>Giảm giá</span><span>-{money(discount)}</span></div><div className="flex justify-between text-lg font-semibold"><span>Tổng tiền</span><span>{money(sub - discount)}</span></div></div>
        <Msg m={err} />
        <button className={C.btn + ' w-full'} disabled={!cart.length || busy} onClick={checkout}>{busy ? 'Đang lưu...' : 'Thanh toán'}</button>
      </aside>
      {done && <Invoice o={done} onClose={() => setDone(null)} />}
    </div>
  );
}
function Invoice({ o, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-10">
      <div className="bg-white rounded-lg p-6 w-full max-w-md print-area">
        <h2 className="text-xl font-semibold text-center">Hóa đơn #{o.id}</h2>
        <p className="text-center text-sm text-stone-500 mb-3">{dt(o.createdAt)} · {o.user?.name}{o.customer ? ` · ${o.customer.name}` : ''}</p>
        <table className="w-full text-sm"><tbody>{o.items.map(i => <tr key={i.id}><td className="py-1">{i.product.name} × {i.qty}</td><td className="text-right">{money(i.price * i.qty)}</td></tr>)}</tbody></table>
        <div className="border-t mt-2 pt-2 text-sm"><div className="flex justify-between"><span>Giảm giá</span><span>-{money(o.discount)}</span></div><div className="flex justify-between font-semibold text-lg"><span>Tổng</span><span>{money(o.total)}</span></div><p className="text-stone-500">{o.payment === 'CASH' ? 'Tiền mặt' : 'Chuyển khoản'} · Đã thanh toán</p></div>
        <div className="flex gap-2 mt-4 print:hidden"><button className={C.btn + ' flex-1'} onClick={() => window.print()}>In hóa đơn</button><button className={C.btn2} onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}
function Orders() {
  const [page, setPage] = useState(1), [d, reload, err] = useLoad(`/orders?page=${page}`), [actionError, setActionError] = useState('');
  const changeStatus = async (order, status) => {
    setActionError('');
    try { await api(`/orders/${order.id}/status`, { method: 'PUT', body: { status } }); reload(); }
    catch (error) { setActionError(error.message); }
  };
  const nextStatus = { PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['SHIPPING', 'CANCELLED'], SHIPPING: ['PAID'] };
  return (
    <div className={C.card + ' overflow-x-auto'}><Msg m={err || actionError} />
      <table className="w-full text-sm"><thead><tr>{['Mã', 'Thời gian', 'Người tạo', 'Khách', 'Sản phẩm / giao đến', 'Tổng tiền', 'Trạng thái', 'Cập nhật'].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
        <tbody>{d?.items.map(o => <tr key={o.id}><td className={C.td}>#{o.id}</td><td className={C.td}>{dt(o.createdAt)}</td><td className={C.td}>{o.user.role === 'CUSTOMER' ? 'Trực tuyến' : o.user.name}</td><td className={C.td}>{o.customer?.name || 'Khách lẻ'}</td><td className={C.td}>{o.items.map(i => `${i.product.name} ×${i.qty}`).join(', ')}{o.shippingAddress && <div className="text-xs text-stone-500">{o.shippingAddress}</div>}{o.shippingAddress && <ShippingTracking order={o} reload={reload} />}</td><td className={C.td}>{money(o.total)}<div className="text-xs text-stone-500">{o.payment} · {o.paymentStatus === 'PAID' ? 'Đã thanh toán' : 'Chưa thanh toán'}{o.paymentStatus === 'PAID' && o.status === 'CANCELLED' ? ' · Cần xử lý hoàn tiền' : ''}</div></td><td className={C.td}>{orderStatus[o.status] || o.status}</td>
          <td className={C.td}>{nextStatus[o.status]?.length > 0 && <select aria-label={`Cập nhật đơn ${o.id}`} className="border rounded px-2 py-1" defaultValue="" onChange={event => { if (event.target.value) changeStatus(o, event.target.value); event.target.value = ''; }}><option value="">Chọn...</option>{nextStatus[o.status].map(status => <option key={status} value={status}>{orderStatus[status]}</option>)}</select>}</td></tr>)}</tbody></table>
      <Pager data={d} onChange={setPage} />
    </div>
  );
}
function ShippingTracking({ order, reload }) {
  const [code, setCode] = useState(order.shippingTrackingCode || ''), [err, setErr] = useState('');
  const save = async () => { setErr(''); try { await api(`/orders/${order.id}/shipping`, { method: 'PUT', body: { trackingCode: code } }); reload(); } catch (error) { setErr(error.message); } };
  return <div className="mt-1 flex gap-1"><input aria-label={`Mã vận đơn đơn ${order.id}`} className="border rounded px-2 py-1 text-xs min-w-0" maxLength="100" placeholder="Mã vận đơn" value={code} onChange={event => setCode(event.target.value)} /><button className="text-xs text-teal-800" onClick={save}>Lưu</button>{err && <span className="text-xs text-red-700">{err}</span>}</div>;
}

function Customers() {
  const empty = { name: '', phone: '' };
  const [form, setForm] = useState(empty), [customers, reload, loadError] = useLoad('/customers');
  const [query, setQuery] = useState(''), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const save = async e => {
    e.preventDefault(); setErr(''); setOk('');
    try {
      await api(form.id ? `/customers/${form.id}` : '/customers', { method: form.id ? 'PUT' : 'POST', body: form });
      setForm(empty); setOk('Đã lưu khách hàng'); reload();
    } catch (x) { setErr(x.message); }
  };
  const remove = async customer => {
    if (!confirm(`Xóa khách hàng "${customer.name}"?`)) return;
    setErr(''); setOk('');
    try { await api(`/customers/${customer.id}`, { method: 'DELETE' }); setOk('Đã xóa khách hàng'); reload(); }
    catch (x) { setErr(x.message); }
  };
  const filtered = customers?.filter(c => `${c.name} ${c.phone || ''}`.toLowerCase().includes(query.toLowerCase())) || [];
  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-4">
      <div className={C.card + ' overflow-x-auto space-y-3'}>
        <Msg m={loadError} />
        <input className={C.inp} placeholder="Tìm theo tên hoặc số điện thoại" value={query} onChange={e => setQuery(e.target.value)} />
        <table className="w-full text-sm"><thead><tr>{['Tên khách hàng', 'Số điện thoại', 'Số đơn', ''].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(c => <tr key={c.id}><td className={C.td}>{c.name}</td><td className={C.td}>{c.phone || '—'}</td><td className={C.td}>{c._count?.orders ?? '—'}</td>
            <td className={C.td + ' whitespace-nowrap'}><button className="text-teal-800 mr-3" onClick={() => setForm({ id: c.id, name: c.name, phone: c.phone || '' })}>Sửa</button><button className="text-red-700" onClick={() => remove(c)}>Xóa</button></td></tr>)}</tbody>
        </table>
        {!filtered.length && <p className="text-sm text-stone-500">Chưa có khách hàng phù hợp.</p>}
      </div>
      <form onSubmit={save} className={C.card + ' space-y-2 h-fit'}>
        <h2 className="font-semibold">{form.id ? 'Sửa khách hàng' : 'Thêm khách hàng'}</h2>
        <label className="text-sm block">Tên khách hàng<input required maxLength="120" className={C.inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-sm block">Số điện thoại<input type="tel" maxLength="30" className={C.inp} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
        <Msg m={err} /><Ok m={ok} />
        <div className="flex gap-2"><button className={C.btn}>Lưu khách hàng</button>{form.id && <button type="button" className={C.btn2} onClick={() => setForm(empty)}>Hủy sửa</button>}</div>
      </form>
    </div>
  );
}

function Promotions() {
  const empty = { code: '', type: 'PERCENT', value: '', expiresAt: '' };
  const [form, setForm] = useState(empty), [promotions, reload, loadError] = useLoad('/promotions');
  const [err, setErr] = useState(''), [ok, setOk] = useState('');
  const save = async e => {
    e.preventDefault(); setErr(''); setOk('');
    try {
      await api(form.id ? `/promotions/${form.id}` : '/promotions', { method: form.id ? 'PUT' : 'POST', body: form });
      setForm(empty); setOk('Đã lưu mã khuyến mãi'); reload();
    } catch (x) { setErr(x.message); }
  };
  const remove = async promotion => {
    if (!confirm(`Xóa mã "${promotion.code}"?`)) return;
    setErr(''); setOk('');
    try { await api(`/promotions/${promotion.id}`, { method: 'DELETE' }); setOk('Đã xóa mã khuyến mãi'); reload(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-4">
      <div className={C.card + ' overflow-x-auto'}>
        <Msg m={loadError} />
        <table className="w-full text-sm"><thead><tr>{['Mã', 'Mức giảm', 'Hết hạn', 'Trạng thái', ''].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
          <tbody>{promotions?.map(p => {
            const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
            return <tr key={p.id}><td className={C.td + ' font-medium'}>{p.code}</td><td className={C.td}>{p.type === 'PERCENT' ? `${p.value}%` : money(p.value)}</td><td className={C.td}>{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('vi-VN') : 'Không giới hạn'}</td>
              <td className={C.td + (expired ? ' text-red-700' : ' text-teal-800')}>{expired ? 'Hết hạn' : 'Đang áp dụng'}</td>
              <td className={C.td + ' whitespace-nowrap'}><button className="text-teal-800 mr-3" onClick={() => setForm({ id: p.id, code: p.code, type: p.type, value: p.value, expiresAt: p.expiresAt ? p.expiresAt.slice(0, 10) : '' })}>Sửa</button><button className="text-red-700" onClick={() => remove(p)}>Xóa</button></td></tr>;
          })}</tbody>
        </table>
        {!promotions?.length && !loadError && <p className="text-sm text-stone-500">Chưa có mã khuyến mãi.</p>}
      </div>
      <form onSubmit={save} className={C.card + ' space-y-2 h-fit'}>
        <h2 className="font-semibold">{form.id ? 'Sửa mã khuyến mãi' : 'Tạo mã khuyến mãi'}</h2>
        <label className="text-sm block">Mã<input required minLength="2" maxLength="32" pattern="[A-Za-z0-9_-]+" className={C.inp} value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
        <label className="text-sm block">Loại giảm giá<select className={C.inp} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="PERCENT">Theo phần trăm</option><option value="AMOUNT">Theo số tiền</option></select></label>
        <label className="text-sm block">Giá trị{form.type === 'PERCENT' ? ' (%)' : ' (₫)'}<input required type="number" min="1" max={form.type === 'PERCENT' ? 100 : undefined} step="1" className={C.inp} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
        <label className="text-sm block">Ngày hết hạn (để trống nếu không giới hạn)<input type="date" className={C.inp} value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></label>
        <Msg m={err} /><Ok m={ok} />
        <div className="flex gap-2"><button className={C.btn}>Lưu mã</button>{form.id && <button type="button" className={C.btn2} onClick={() => setForm(empty)}>Hủy sửa</button>}</div>
      </form>
    </div>
  );
}

// ---------- sản phẩm ----------
function Products() {
  const empty = { name: '', description: '', imageUrl: '', barcode: '', price: '', cost: 0, minStock: 5, categoryId: '' };
  const [f, setF] = useState(empty), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const [page, setPage] = useState(1), [list, reload] = useLoad(`/products?page=${page}`), [cats, reloadCats] = useLoad('/categories');
  const save = async e => {
    e.preventDefault(); setErr(''); setOk('');
    try { await api(f.id ? '/products/' + f.id : '/products', { method: f.id ? 'PUT' : 'POST', body: f }); setF(empty); reload(); setOk('Đã lưu sản phẩm'); } catch (x) { setErr(x.message); }
  };
  const del = async p => { if (!confirm(`Xóa "${p.name}"?`)) return; try { await api('/products/' + p.id, { method: 'DELETE' }); reload(); } catch (x) { setErr(x.message); } };
  const addCat = async () => { const name = prompt('Tên danh mục mới:'); if (name) try { await api('/categories', { method: 'POST', body: { name } }); reloadCats(); } catch (x) { setErr(x.message); } };
  const F = (k, label, type = 'text') => <label className="text-sm block">{label}<input type={type} className={C.inp} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-4">
      <div className={C.card + ' overflow-x-auto'}>
        <table className="w-full text-sm"><thead><tr>{['Tên', 'Mã vạch', 'Danh mục', 'Giá bán', 'Giá vốn', 'Tồn', ''].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
          <tbody>{list?.items.map(p => <tr key={p.id}><td className={C.td}>{p.imageUrl && <img src={p.imageUrl} alt="" className="inline-block w-10 h-10 object-cover rounded mr-2" />}{p.name}</td><td className={C.td}>{p.barcode}</td><td className={C.td}>{p.category?.name}</td><td className={C.td}>{money(p.price)}</td><td className={C.td}>{money(Math.round(p.cost))}</td><td className={C.td}>{p.stock}</td>
            <td className={C.td + ' whitespace-nowrap'}><button className="text-teal-800 mr-3" onClick={() => setF({ ...p, categoryId: p.categoryId || '' })}>Sửa</button><button className="text-red-700" onClick={() => del(p)}>Xóa</button></td></tr>)}</tbody></table>
        <Pager data={list} onChange={setPage} />
      </div>
      <form onSubmit={save} className={C.card + ' space-y-2 h-fit'}>
        <h2 className="font-semibold">{f.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2>
        {F('name', 'Tên sản phẩm')}{F('barcode', 'Mã vạch')}{F('price', 'Giá bán (₫)', 'number')}{F('minStock', 'Tồn tối thiểu để cảnh báo', 'number')}
        {F('imageUrl', 'Đường dẫn ảnh (URL HTTPS khuyến nghị)')}
        <label className="text-sm block">Mô tả sản phẩm<textarea maxLength="2000" rows="3" className={C.inp} value={f.description || ''} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        <label className="text-sm block">Danh mục<div className="flex gap-2"><select className={C.inp} value={f.categoryId} onChange={e => setF({ ...f, categoryId: e.target.value })}><option value="">Chưa phân loại</option>{cats?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" className={C.btn2} onClick={addCat}>Thêm</button></div></label>
        <p className="text-xs text-stone-500">Tồn kho và giá vốn được cập nhật qua phiếu nhập kho.</p>
        <Msg m={err} /><Ok m={ok} />
        <div className="flex gap-2"><button className={C.btn}>Lưu sản phẩm</button>{f.id && <button type="button" className={C.btn2} onClick={() => setF(empty)}>Hủy sửa</button>}</div>
      </form>
    </div>
  );
}

// ---------- kho ----------
function Stock() {
  const [tab, setTab] = useState('stock');
  const tabs = [['stock', 'Tồn kho & kiểm kê'], ['in', 'Nhập kho'], ['out', 'Xuất kho'], ['suppliers', 'Nhà cung cấp'], ['log', 'Sổ kho']];
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={tab === k ? C.btn : C.btn2}>{l}</button>)}</div>
      {tab === 'stock' && <StockList />}{tab === 'in' && <ReceiptForm />}{tab === 'out' && <IssueForm />}{tab === 'suppliers' && <Suppliers />}{tab === 'log' && <Movements />}
    </div>
  );
}
function Suppliers() {
  const empty = { name: '', phone: '', address: '' };
  const [form, setForm] = useState(empty), [suppliers, reload, loadError] = useLoad('/suppliers');
  const [err, setErr] = useState(''), [ok, setOk] = useState('');
  const save = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try {
      await api(form.id ? `/suppliers/${form.id}` : '/suppliers', { method: form.id ? 'PUT' : 'POST', body: form });
      setForm(empty); setOk('Đã lưu nhà cung cấp'); reload();
    } catch (error) { setErr(error.message); }
  };
  const remove = async supplier => {
    if (!confirm(`Xóa nhà cung cấp "${supplier.name}"?`)) return;
    setErr(''); setOk('');
    try { await api(`/suppliers/${supplier.id}`, { method: 'DELETE' }); setOk('Đã xóa nhà cung cấp'); reload(); }
    catch (error) { setErr(error.message); }
  };
  return <div className="grid lg:grid-cols-[1fr_20rem] gap-4">
    <div className={C.card + ' overflow-x-auto'}><Msg m={loadError} />
      <table className="w-full text-sm"><thead><tr>{['Nhà cung cấp', 'Điện thoại', 'Địa chỉ', ''].map(label => <th key={label} className={C.th}>{label}</th>)}</tr></thead>
        <tbody>{suppliers?.map(supplier => <tr key={supplier.id}><td className={C.td}>{supplier.name}</td><td className={C.td}>{supplier.phone || '—'}</td><td className={C.td}>{supplier.address || '—'}</td>
          <td className={C.td + ' whitespace-nowrap'}><button className="text-teal-800 mr-3" onClick={() => setForm({ id: supplier.id, name: supplier.name, phone: supplier.phone || '', address: supplier.address || '' })}>Sửa</button><button className="text-red-700" onClick={() => remove(supplier)}>Xóa</button></td></tr>)}</tbody>
      </table>
      {!suppliers?.length && !loadError && <p className="text-sm text-stone-500">Chưa có nhà cung cấp.</p>}
    </div>
    <form onSubmit={save} className={C.card + ' space-y-2 h-fit'}>
      <h2 className="font-semibold">{form.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}</h2>
      <label className="text-sm block">Tên nhà cung cấp<input required maxLength="120" className={C.inp} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label className="text-sm block">Số điện thoại<input type="tel" maxLength="30" className={C.inp} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      <label className="text-sm block">Địa chỉ<textarea maxLength="300" rows="3" className={C.inp} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} /></label>
      <Msg m={err} /><Ok m={ok} />
      <div className="flex gap-2"><button className={C.btn}>Lưu nhà cung cấp</button>{form.id && <button type="button" className={C.btn2} onClick={() => setForm(empty)}>Hủy sửa</button>}</div>
    </form>
  </div>;
}
function StockList() {
  const [d, reload] = useLoad('/stock'), [act, setAct] = useState({}), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const low = d?.filter(p => p.stock <= p.minStock) || [];
  const submit = async () => {
    setErr(''); setMsg('');
    try { const r = await api('/stocktakes', { method: 'POST', body: { items: Object.entries(act).filter(([, v]) => v !== '').map(([productId, actual]) => ({ productId, actual })) } }); setMsg(`Đã chốt kiểm kê, điều chỉnh ${r.changed} sản phẩm`); setAct({}); reload(); } catch (x) { setErr(x.message); }
  };
  return (
    <div className={C.card + ' overflow-x-auto'}>
      {low.length > 0 && <p className="text-sm bg-amber-50 border border-amber-300 rounded px-3 py-2 mb-3">Sắp hết hàng: {low.map(p => `${p.name} (${p.stock})`).join(', ')}</p>}
      <table className="w-full text-sm"><thead><tr>{['Sản phẩm', 'Tồn hệ thống', 'Tối thiểu', 'Số thực tế (kiểm kê)'].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
        <tbody>{d?.map(p => <tr key={p.id}><td className={C.td}>{p.name}</td><td className={C.td + (p.stock <= p.minStock ? ' text-red-700 font-semibold' : '')}>{p.stock}</td><td className={C.td}>{p.minStock}</td>
          <td className={C.td}><input type="number" min="0" className="w-28 border rounded px-2 py-1" value={act[p.id] ?? ''} onChange={e => setAct({ ...act, [p.id]: e.target.value })} /></td></tr>)}</tbody></table>
      <Msg m={err} /><Ok m={msg} />
      <button className={C.btn + ' mt-3'} onClick={submit} disabled={!Object.values(act).some(v => v !== '')}>Chốt kiểm kê</button>
    </div>
  );
}
function ReceiptForm() {
  const [prodsPage] = useLoad('/products'), prods = prodsPage?.items || [], [sups, reloadS] = useLoad('/suppliers'), [recs, reloadR] = useLoad('/receipts');
  const blank = { productId: '', qty: 1, cost: '' };
  const [lines, setLines] = useState([blank]), [sup, setSup] = useState(''), [note, setNote] = useState(''), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const upd = (i, k, v) => setLines(l => l.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  const submit = async confirm => {
    setErr(''); setOk('');
    try { await api('/receipts', { method: 'POST', body: { supplierId: sup, note, items: lines, confirm } }); setLines([blank]); setNote(''); setOk(confirm ? 'Đã xác nhận phiếu, tồn kho đã tăng' : 'Đã lưu nháp, chưa cộng tồn kho'); reloadR(); } catch (x) { setErr(x.message); }
  };
  const confirmDraft = async id => { setErr(''); try { await api(`/receipts/${id}/confirm`, { method: 'POST' }); reloadR(); } catch (x) { setErr(x.message); } };
  const newSup = async () => { const name = prompt('Tên nhà cung cấp:'); if (name) try { await api('/suppliers', { method: 'POST', body: { name } }); reloadS(); } catch (x) { setErr(x.message); } };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className={C.card + ' space-y-2'}>
        <h2 className="font-semibold">Phiếu nhập mới</h2>
        <div className="flex gap-2"><select className={C.inp} value={sup} onChange={e => setSup(e.target.value)}><option value="">Chọn nhà cung cấp</option>{sups?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className={C.btn2} onClick={newSup}>Thêm</button></div>
        <input className={C.inp} placeholder="Ghi chú" value={note} onChange={e => setNote(e.target.value)} />
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <select className={C.inp} value={l.productId} onChange={e => upd(i, 'productId', e.target.value)}><option value="">Chọn sản phẩm</option>{prods?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input type="number" min="1" className={C.inp + ' !w-20'} value={l.qty} onChange={e => upd(i, 'qty', e.target.value)} aria-label="Số lượng" />
            <input type="number" min="0" className={C.inp + ' !w-28'} placeholder="Giá nhập" value={l.cost} onChange={e => upd(i, 'cost', e.target.value)} />
            <button className="text-red-700 px-1" aria-label="Xóa dòng" onClick={() => setLines(x => x.length > 1 ? x.filter((_, j) => j !== i) : x)}>✕</button>
          </div>
        ))}
        <button className={C.btn2} onClick={() => setLines([...lines, blank])}>Thêm dòng</button>
        <p className="font-medium">Tổng tiền phiếu: {money(total)}</p>
        <Msg m={err} /><Ok m={ok} />
        <div className="flex gap-2"><button className={C.btn} onClick={() => submit(true)}>Xác nhận nhập kho</button><button className={C.btn2} onClick={() => submit(false)}>Lưu nháp</button></div>
      </div>
      <div className={C.card + ' space-y-2 overflow-x-auto'}>
        <h2 className="font-semibold">Phiếu nhập gần đây</h2>
        {recs?.map(r => <div key={r.id} className="text-sm border-t pt-2"><div className="flex justify-between"><b>PN{r.id} · {r.supplier?.name || 'Không rõ NCC'}</b><span className={r.status === 'DRAFT' ? 'text-amber-700' : 'text-teal-800'}>{r.status === 'DRAFT' ? 'Nháp' : 'Đã xác nhận'}</span></div><div className="text-stone-500">{dt(r.createdAt)} · {money(r.total)}</div><div>{r.items.map(i => `${i.product.name} ×${i.qty}`).join(', ')}</div>{r.status === 'DRAFT' && <button className="text-teal-800 mt-1" onClick={() => confirmDraft(r.id)}>Xác nhận phiếu này</button>}</div>)}
      </div>
    </div>
  );
}
function IssueForm() {
  const [prodsPage, reload] = useLoad('/products'), prods = prodsPage?.items || [], [f, setF] = useState({ productId: '', qty: 1, note: '' }), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const go = async () => { setErr(''); setOk(''); try { await api('/issues', { method: 'POST', body: f }); setOk('Đã xuất kho'); setF({ productId: '', qty: 1, note: '' }); reload(); } catch (x) { setErr(x.message); } };
  return (
    <div className={C.card + ' max-w-md space-y-2'}>
      <h2 className="font-semibold">Phiếu xuất kho (hủy, hỏng, dùng nội bộ)</h2>
      <select className={C.inp} value={f.productId} onChange={e => setF({ ...f, productId: e.target.value })}><option value="">Chọn sản phẩm</option>{prods?.map(p => <option key={p.id} value={p.id}>{p.name} (tồn {p.stock})</option>)}</select>
      <input type="number" min="1" className={C.inp} value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} aria-label="Số lượng" />
      <input className={C.inp} placeholder="Lý do xuất" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
      <Msg m={err} /><Ok m={ok} /><button className={C.btn} onClick={go} disabled={!f.productId}>Xuất kho</button>
    </div>
  );
}
function Movements() {
  const [d] = useLoad('/stock/movements');
  return (
    <div className={C.card + ' overflow-x-auto'}><table className="w-full text-sm"><thead><tr>{['Thời điểm', 'Sản phẩm', 'Loại', 'Số lượng', 'Chứng từ'].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
      <tbody>{d?.map(m => <tr key={m.id}><td className={C.td}>{dt(m.createdAt)}</td><td className={C.td}>{m.product.name}</td><td className={C.td}>{{ IN: 'Nhập', OUT: 'Xuất', ADJUST: 'Điều chỉnh' }[m.type]}</td><td className={C.td + (m.qty < 0 ? ' text-red-700' : ' text-teal-800')}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td className={C.td}>{m.ref}</td></tr>)}</tbody></table></div>
  );
}

// ---------- báo cáo & dự báo ----------
const iso = d => new Date(d.getTime() + 7 * 36e5).toISOString().slice(0, 10);
function Reports() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5))), [to, setTo] = useState(iso(new Date()));
  const qs = `?from=${from}&to=${to}`;
  const [s, , e1] = useLoad('/reports/summary' + qs), [top, , e2] = useLoad('/reports/top-products' + qs);
  const [insights, reloadInsights, insightError] = useLoad('/assistant/insights');
  const [days, setDays] = useState(7), [fc, setFc] = useState(null), [loading, setLoading] = useState(false), [err, setErr] = useState('');
  const runForecast = async () => { setLoading(true); setErr(''); try { setFc(await api('/forecast?days=' + days)); } catch (x) { setErr(x.message); } finally { setLoading(false); } };
  const exportXlsx = async () => {
    const r = await fetch('/api/reports/export' + qs + '&format=xlsx', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    if (!r.ok) return setErr('Không xuất được file');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `bao-cao-${from}_${to}.xlsx`; a.click();
  };
  const Stat = ({ l, v }) => <div className={C.card}><div className="text-sm text-stone-500">{l}</div><div className="text-xl font-semibold">{v}</div></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Từ ngày<input type="date" className={C.inp} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-sm">Đến ngày<input type="date" className={C.inp} value={to} onChange={e => setTo(e.target.value)} /></label>
        {[['Hôm nay', 0], ['7 ngày', 6], ['30 ngày', 29]].map(([l, n]) => <button key={l} className={C.btn2} onClick={() => { setFrom(iso(new Date(Date.now() - n * 864e5))); setTo(iso(new Date())); }}>{l}</button>)}
        <button className={C.btn} onClick={exportXlsx}>Xuất Excel</button>
      </div>
      <Msg m={e1 || e2 || err} />
      {s && <div className="grid grid-cols-2 lg:grid-cols-5 gap-3"><Stat l="Doanh thu" v={money(s.revenue)} /><Stat l="Giá vốn hàng bán" v={money(s.cogs)} /><Stat l="Lợi nhuận" v={money(s.profit)} /><Stat l="Số đơn" v={s.orders} /><Stat l="Giá trị đơn trung bình" v={money(s.avg)} /></div>}
      <section className={C.card + ' space-y-2'}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Trợ lý AI nội bộ</h2><button className={C.btn2} onClick={reloadInsights}>Cập nhật phân tích</button></div>
        <p className="text-xs text-stone-500">Phân tích tự động từ dữ liệu bán hàng và tồn kho của cửa hàng; không gửi dữ liệu ra dịch vụ bên ngoài.</p>
        <Msg m={insightError} />
        {insights?.messages.map((message, index) => <p key={index} className="text-sm">• {message}</p>)}
        {insights && <p className="text-xs text-stone-500">Cơ sở: {insights.basis}</p>}
      </section>
      <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
        <div className={C.card}><h2 className="font-semibold mb-2">Doanh thu theo ngày</h2>
          {s?.daily.length ? <div className="h-64"><ResponsiveContainer><BarChart data={s.daily}><XAxis dataKey="date" tickFormatter={d => d.slice(5)} fontSize={12} /><YAxis tickFormatter={v => v / 1000 + 'k'} fontSize={12} width={48} /><Tooltip formatter={v => money(v)} /><Bar dataKey="revenue" fill="#0f766e" /></BarChart></ResponsiveContainer></div> : <p className="text-stone-500 text-sm">Chưa có đơn đã thanh toán trong khoảng thời gian này.</p>}</div>
        <div className={C.card}><h2 className="font-semibold mb-2">Sản phẩm bán chạy</h2><table className="w-full text-sm"><tbody>{top?.map(p => <tr key={p.productId}><td className={C.td}>{p.name}</td><td className={C.td + ' text-right'}>{p.qty}</td></tr>)}</tbody></table></div>
      </div>
      <div className={C.card + ' overflow-x-auto'}>
        <div className="flex items-center gap-3 mb-3"><h2 className="font-semibold">Dự báo nhập hàng</h2>
          <select className={C.inp + ' !w-auto'} value={days} onChange={e => setDays(+e.target.value)}><option value="7">7 ngày tới</option><option value="14">14 ngày tới</option></select>
          <button className={C.btn} onClick={runForecast} disabled={loading}>{loading ? 'Đang tính...' : 'Dự báo'}</button></div>
        {fc && !fc.available && <Msg m="Chưa có dự báo: dịch vụ dự báo đang không phản hồi. Báo cáo ở trên vẫn dùng bình thường." />}
        {fc?.available && <table className="w-full text-sm"><thead><tr>{['Sản phẩm', 'Tồn hiện tại', `Nhu cầu ${fc.days} ngày`, 'Nên nhập', 'Mô hình', 'Sai số MAE'].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
          <tbody>{fc.items.map(i => <tr key={i.productId}><td className={C.td}>{i.name}</td><td className={C.td}>{i.stock}</td><td className={C.td}>{i.demand}</td><td className={C.td + (i.suggest ? ' font-semibold text-teal-800' : '')}>{i.suggest}</td>
            <td className={C.td}>{i.method === 'holt_winters' ? 'Holt-Winters' : 'Trung bình động 7 ngày'}{i.lowConfidence && <span className="ml-2 text-xs text-amber-700 border border-amber-400 rounded px-1">Độ tin cậy thấp</span>}</td><td className={C.td}>{i.mae ?? '–'}</td></tr>)}</tbody></table>}
        <p className="text-xs text-stone-500 mt-2">Đề xuất nhập = nhu cầu dự báo + tồn tối thiểu − tồn hiện tại (không âm). Dữ liệu bán hàng mẫu do hệ thống tự sinh.</p>
      </div>
    </div>
  );
}

// ---------- khung ứng dụng ----------
const NAV = [
  ['store', 'Cửa hàng trực tuyến', ['OWNER', 'SALES', 'WAREHOUSE', 'CUSTOMER'], Storefront],
  ['pos', 'Bán hàng tại quầy', ['SALES'], POS],
  ['orders', 'Quản lý đơn hàng', ['SALES', 'WAREHOUSE'], Orders],
  ['returns', 'Yêu cầu trả hàng', ['SALES', 'WAREHOUSE'], Returns],
  ['customers', 'Khách hàng', ['SALES'], Customers],
  ['products', 'Sản phẩm', ['WAREHOUSE'], Products],
  ['stock', 'Kho', ['WAREHOUSE'], Stock],
  ['staff', 'Tài khoản nhân viên', ['OWNER'], Staff],
  ['promotions', 'Khuyến mãi', ['OWNER'], Promotions],
  ['reports', 'Báo cáo, AI và dự báo', ['OWNER'], Reports],
  ['my-orders', 'Đơn hàng của tôi', ['CUSTOMER'], CustomerOrders],
  ['favorites', 'Yêu thích', ['CUSTOMER'], Favorites],
  ['account', 'Tài khoản cá nhân', ['CUSTOMER'], CustomerAccount],
];
function PasswordReset({ token }) {
  const [password, setPassword] = useState(''), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const submit = async event => {
    event.preventDefault(); setErr(''); setOk('');
    try { await api('/auth/reset-password', { method: 'POST', body: { token, password } }); setOk('Đã đổi mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.'); }
    catch (error) { setErr(error.message); }
  };
  return <main className="min-h-screen grid place-items-center p-4 bg-stone-50"><form onSubmit={submit} className={C.card + ' w-full max-w-md space-y-3'}>
    <h1 className="text-xl font-semibold">Đặt lại mật khẩu</h1>
    <label className="text-sm block">Mật khẩu mới (8-72 ký tự)<input required minLength="8" maxLength="72" type="password" className={C.inp} value={password} onChange={event => setPassword(event.target.value)} /></label>
    <Msg m={err} /><Ok m={ok} /><button className={C.btn}>Lưu mật khẩu mới</button><a className="text-teal-800 text-sm block" href="/">Quay về cửa hàng</a>
  </form></main>;
}
export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [paymentNotice, setPaymentNotice] = useState('');
  const [page, setPage] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const verificationToken = params.get('verify');
    if (verificationToken) {
      location.assign(`/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`);
      return;
    }
    if (params.get('verified') === '1') setPaymentNotice('Email đã được xác minh.');
    if (params.has('payment')) setPaymentNotice(params.get('payment') === 'success' ? `Thanh toán đơn #${params.get('orderId')} đã được xác nhận.` : 'Thanh toán chưa thành công. Hãy kiểm tra đơn hàng hoặc thử lại.');
    if (params.has('payment') || params.has('verified')) history.replaceState(null, '', location.pathname);
  }, []);
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) return <PasswordReset token={resetToken} />;
  const items = user ? NAV.filter(n => n[2].includes(user.role) || (user.role === 'OWNER' && !n[2].includes('CUSTOMER'))) : [];
  if (!user) return <Storefront user={null} paymentNotice={paymentNotice} />;
  const landing = { OWNER: 'reports', SALES: 'pos', WAREHOUSE: 'stock', CUSTOMER: 'store' }[user.role];
  const cur = items.find(n => n[0] === page) || items.find(n => n[0] === landing) || items[0], Page = cur?.[3];
  if (!cur) return <Storefront user={user} />;
  const roleName = { OWNER: 'Quản trị viên', SALES: 'Nhân viên bán hàng', WAREHOUSE: 'Nhân viên kho', CUSTOMER: 'Khách hàng' }[user.role];
  return (
    <div className="min-h-screen md:flex">
      <nav className="bg-[#11263a] text-stone-100 md:w-56 md:min-h-screen p-4 flex md:block gap-2 flex-wrap items-center">
        <div className="font-semibold text-lg md:mb-1">Quản lý bán hàng</div>
        <div className="text-xs text-stone-400 md:mb-5 mr-auto">{user.name} · {roleName}</div>
        {items.map(n => <button key={n[0]} onClick={() => setPage(n[0])} className={`block w-full text-left px-3 py-2 rounded md:mb-1 ${cur === n ? 'bg-teal-700' : 'hover:bg-white/10'}`} style={{ width: 'auto' }}>{n[1]}</button>)}
        <button className="px-3 py-2 text-stone-400 hover:text-white md:mt-6" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); }}>Đăng xuất</button>
      </nav>
      <main className="flex-1 p-4 md:p-6 min-w-0"><h1 className="text-2xl font-semibold mb-4">{cur[1]}</h1><Ok m={paymentNotice} />{Page && <Page key={cur[0]} user={user} updateUser={setUser} paymentNotice={paymentNotice} />}</main>
    </div>
  );
}
