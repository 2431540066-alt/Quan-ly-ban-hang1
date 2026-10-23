import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// ---------- tiện ích ----------
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') }, body: body && JSON.stringify(body) });
  if (r.status === 401 && path !== '/login') { localStorage.clear(); location.reload(); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Có lỗi xảy ra');
  return d;
}
function useLoad(path) {
  const [d, setD] = useState(null), [n, setN] = useState(0), [err, setErr] = useState('');
  useEffect(() => { setErr(''); api(path).then(setD).catch(e => setErr(e.message)); }, [path, n]);
  return [d, () => setN(x => x + 1), err];
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

// ---------- đăng nhập ----------
function Login({ onLogin }) {
  const [f, setF] = useState({ username: 'owner', password: '123456' }), [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault(); setErr('');
    try { const d = await api('/login', { method: 'POST', body: f }); localStorage.setItem('token', d.token); localStorage.setItem('user', JSON.stringify(d.user)); onLogin(d.user); }
    catch (x) { setErr(x.message); }
  };
  return (
    <div className="min-h-screen grid place-items-center p-4 bg-[#11263a]">
      <form onSubmit={go} className="bg-[#f4f4ef] rounded-lg p-8 w-full max-w-sm space-y-3">
        <h1 className="text-2xl font-semibold">Đăng nhập</h1>
        <p className="text-stone-600 text-sm">Tài khoản mẫu: owner, sales, stock (mật khẩu 123456)</p>
        <label className="block text-sm">Tên đăng nhập<input className={C.inp} value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
        <label className="block text-sm">Mật khẩu<input type="password" className={C.inp} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
        <Msg m={err} />
        <button className={C.btn + ' w-full'}>Đăng nhập</button>
      </form>
    </div>
  );
}

// ---------- bán hàng (POS) ----------
function POS() {
  const [q, setQ] = useState(''), [cart, setCart] = useState([]), [code, setCode] = useState(''), [promo, setPromo] = useState(null);
  const [cust, setCust] = useState(''), [pay, setPay] = useState('CASH'), [done, setDone] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [prods, reloadP] = useLoad('/products?q=' + encodeURIComponent(q));
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
    const hit = prods?.find(p => p.barcode === q.trim()) || (prods?.length === 1 ? prods[0] : null);
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
          {prods?.map(p => (
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
  const [d, , err] = useLoad('/orders');
  return (
    <div className={C.card + ' overflow-x-auto'}><Msg m={err} />
      <table className="w-full text-sm"><thead><tr>{['Mã', 'Thời gian', 'Nhân viên', 'Khách', 'Sản phẩm', 'Tổng tiền'].map(h => <th key={h} className={C.th}>{h}</th>)}</tr></thead>
        <tbody>{d?.map(o => <tr key={o.id}><td className={C.td}>#{o.id}</td><td className={C.td}>{dt(o.createdAt)}</td><td className={C.td}>{o.user.name}</td><td className={C.td}>{o.customer?.name || 'Khách lẻ'}</td><td className={C.td}>{o.items.map(i => `${i.product.name} ×${i.qty}`).join(', ')}</td><td className={C.td}>{money(o.total)}</td></tr>)}</tbody></table>
    </div>
  );
}

// ---------- sản phẩm ----------
function Products() {
  const empty = { name: '', barcode: '', price: '', cost: 0, minStock: 5, categoryId: '' };
  const [f, setF] = useState(empty), [err, setErr] = useState(''), [ok, setOk] = useState('');
  const [list, reload] = useLoad('/products'), [cats, reloadCats] = useLoad('/categories');
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
          <tbody>{list?.map(p => <tr key={p.id}><td className={C.td}>{p.name}</td><td className={C.td}>{p.barcode}</td><td className={C.td}>{p.category?.name}</td><td className={C.td}>{money(p.price)}</td><td className={C.td}>{money(Math.round(p.cost))}</td><td className={C.td}>{p.stock}</td>
            <td className={C.td + ' whitespace-nowrap'}><button className="text-teal-800 mr-3" onClick={() => setF({ ...p, categoryId: p.categoryId || '' })}>Sửa</button><button className="text-red-700" onClick={() => del(p)}>Xóa</button></td></tr>)}</tbody></table>
      </div>
      <form onSubmit={save} className={C.card + ' space-y-2 h-fit'}>
        <h2 className="font-semibold">{f.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2>
        {F('name', 'Tên sản phẩm')}{F('barcode', 'Mã vạch')}{F('price', 'Giá bán (₫)', 'number')}{F('minStock', 'Tồn tối thiểu để cảnh báo', 'number')}
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
  const tabs = [['stock', 'Tồn kho & kiểm kê'], ['in', 'Nhập kho'], ['out', 'Xuất kho'], ['log', 'Sổ kho']];
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={tab === k ? C.btn : C.btn2}>{l}</button>)}</div>
      {tab === 'stock' && <StockList />}{tab === 'in' && <ReceiptForm />}{tab === 'out' && <IssueForm />}{tab === 'log' && <Movements />}
    </div>
  );
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
  const [prods] = useLoad('/products'), [sups, reloadS] = useLoad('/suppliers'), [recs, reloadR] = useLoad('/receipts');
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
  const [prods, reload] = useLoad('/products'), [f, setF] = useState({ productId: '', qty: 1, note: '' }), [err, setErr] = useState(''), [ok, setOk] = useState('');
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
const NAV = [['pos', 'Bán hàng', ['SALES'], POS], ['orders', 'Lịch sử đơn', ['SALES'], Orders], ['products', 'Sản phẩm', ['WAREHOUSE'], Products], ['stock', 'Kho', ['WAREHOUSE'], Stock], ['reports', 'Báo cáo và dự báo', [], Reports]];
export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const items = user ? NAV.filter(n => user.role === 'OWNER' || n[2].includes(user.role)) : [];
  const [page, setPage] = useState('');
  if (!user) return <Login onLogin={u => { setUser(u); setPage(''); }} />;
  const cur = items.find(n => n[0] === page) || items[0], Page = cur?.[3];
  const roleName = { OWNER: 'Chủ cửa hàng', SALES: 'Nhân viên bán hàng', WAREHOUSE: 'Thủ kho' }[user.role];
  return (
    <div className="min-h-screen md:flex">
      <nav className="bg-[#11263a] text-stone-100 md:w-56 md:min-h-screen p-4 flex md:block gap-2 flex-wrap items-center">
        <div className="font-semibold text-lg md:mb-1">Cửa hàng nhỏ</div>
        <div className="text-xs text-stone-400 md:mb-5 mr-auto">{user.name} · {roleName}</div>
        {items.map(n => <button key={n[0]} onClick={() => setPage(n[0])} className={`block w-full text-left px-3 py-2 rounded md:mb-1 ${cur === n ? 'bg-teal-700' : 'hover:bg-white/10'}`} style={{ width: 'auto' }}>{n[1]}</button>)}
        <button className="px-3 py-2 text-stone-400 hover:text-white md:mt-6" onClick={() => { localStorage.clear(); setUser(null); }}>Đăng xuất</button>
      </nav>
      <main className="flex-1 p-4 md:p-6 min-w-0"><h1 className="text-2xl font-semibold mb-4">{cur?.[1]}</h1>{Page && <Page key={cur[0]} />}</main>
    </div>
  );
}
