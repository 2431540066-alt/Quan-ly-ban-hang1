# Hệ thống quản lý bán hàng

Cửa hàng trực tuyến cho khách vãng lai và khách có tài khoản; bán hàng tại quầy; quản lý đơn hàng, khách hàng, sản phẩm, kho, nhà cung cấp, khuyến mãi; báo cáo, dự báo nhập và trợ lý phân tích nội bộ.

**Stack:** React + Vite + Tailwind · Node/Express + JWT · PostgreSQL + Prisma · FastAPI + statsmodels.

## Chạy bằng Docker

```bash
docker compose up --build
```

Mở http://localhost:5173. Docker Compose khởi chạy PostgreSQL, API, giao diện và dịch vụ dự báo. API tự cập nhật schema và tạo dữ liệu mẫu khi khởi động lần đầu.

| Vai trò | Tài khoản mẫu | Mật khẩu mẫu |
|---|---|---|
| Quản trị viên | `owner` | `123456` |
| Nhân viên bán hàng | `sales` | `123456` |
| Nhân viên kho | `stock` | `123456` |
| Khách hàng | `customer` | `123456` |

Khách cũng có thể xem danh mục sản phẩm mà không cần đăng nhập và tự đăng ký tài khoản. Mật khẩu tài khoản đăng ký phải có ít nhất 8 ký tự.

Mã khuyến mãi mẫu: `GIAM10` (10%), `GIAM20K` (20.000 ₫), `HETHAN` (đã hết hạn).

## Chức năng chính

- **Cửa hàng:** tìm kiếm/lọc sản phẩm, xem mô tả và tình trạng còn hàng, giỏ hàng được lưu trong trình duyệt, đặt đơn giao hàng COD và theo dõi/hủy đơn đang chờ xác nhận.
- **Quản trị viên:** toàn quyền quản lý, báo cáo doanh thu/giá vốn/lợi nhuận, xuất Excel, xem phân tích AI nội bộ, dự báo nhu cầu và đề xuất nhập hàng.
- **Nhân viên bán hàng:** POS, quét mã vạch, áp dụng khuyến mãi, chọn khách hàng, in hóa đơn; quản lý khách hàng và trạng thái đơn trực tuyến.
- **Nhân viên kho:** quản lý sản phẩm/danh mục, nhà cung cấp, phiếu nhập/xuất, kiểm kê và sổ biến động; phối hợp cập nhật trạng thái đơn.
- **Trợ lý phân tích nội bộ:** tổng hợp doanh thu, sản phẩm bán chạy và cảnh báo tồn kho từ dữ liệu cửa hàng. Dự báo nhu cầu sử dụng Holt-Winters so sánh với MA7; không gửi dữ liệu tới dịch vụ AI bên ngoài.

## Dữ liệu và vận hành

- PostgreSQL lưu dữ liệu nghiệp vụ; Docker volume `pgdata` giữ dữ liệu qua lần khởi động lại.
- Dừng dịch vụ bằng `docker compose down`. **Không dùng `docker compose down -v` nếu cần giữ dữ liệu**, vì lệnh đó xóa volume cơ sở dữ liệu.
- Đơn POS được ghi thành giao dịch đã thanh toán. Đơn COD trực tuyến giữ tồn ngay khi đặt, cần nhân viên xác nhận → giao hàng → hoàn tất; hủy đơn trước khi giao sẽ hoàn tồn và ghi sổ kho.
- Giá, khuyến mãi, tổng tiền và tồn được xác minh ở máy chủ; thao tác bán/nhập/xuất được thực hiện trong transaction để tránh tồn kho âm hoặc cập nhật dở dang.
- Tài khoản mẫu chỉ dành cho phát triển. Trước khi triển khai thật, thay `JWT_SECRET` trong môi trường, đặt mật khẩu riêng, cấu hình HTTPS và sao lưu PostgreSQL thường xuyên. Không sử dụng dữ liệu mẫu trong môi trường thật.

## Chạy từng phần (không Docker)

1. Khởi động PostgreSQL; cấu hình `server/.env` từ `.env.example`.
2. Trong `server`: `npm install`, `npx prisma db push`, `npm run seed`, `npm start`.
3. Trong `forecast`: `pip install -r requirements.txt`, sau đó `uvicorn main:app --port 8000`.
4. Trong `web`: `npm install`, `npm run dev`.

## Kiểm thử

```bash
cd server
npm test
```
