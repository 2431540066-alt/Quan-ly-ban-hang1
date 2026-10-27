# Hệ thống quản lý bán hàng

Cửa hàng trực tuyến cho khách vãng lai và khách có tài khoản; bán hàng tại quầy; quản lý đơn hàng, khách hàng, sản phẩm, kho, nhà cung cấp, khuyến mãi; báo cáo, dự báo nhập và trợ lý phân tích nội bộ.

**Stack:** React + Vite + Tailwind · Node/Express + JWT · PostgreSQL + Prisma · FastAPI + statsmodels · Nodemailer.

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

Khách cũng có thể xem danh mục sản phẩm mà không cần đăng nhập và tự đăng ký tài khoản. Mật khẩu tài khoản đăng ký phải có ít nhất 8 ký tự. Khách có thể thêm email trong đăng ký/hồ sơ; cần xác minh email để khôi phục mật khẩu.

Mã khuyến mãi mẫu: `GIAM10` (10%), `GIAM20K` (20.000 ₫), `HETHAN` (đã hết hạn).

## Chức năng chính

- **Cửa hàng:** tìm kiếm/lọc và phân trang sản phẩm, xem ảnh/mô tả/đánh giá, lưu yêu thích, quản lý hồ sơ/địa chỉ/mật khẩu, đặt COD hoặc thanh toán VNPay/MoMo khi đã cấu hình.
- **Quản trị viên:** quản lý tài khoản nhân viên, toàn quyền quản lý, báo cáo doanh thu/giá vốn/lợi nhuận, xuất Excel, xem phân tích AI nội bộ, dự báo nhu cầu và đề xuất nhập hàng.
- **Nhân viên bán hàng:** POS, quét mã vạch, áp dụng khuyến mãi, chọn khách hàng, in hóa đơn; quản lý khách hàng và trạng thái đơn trực tuyến.
- **Nhân viên kho:** quản lý sản phẩm/ảnh/danh mục, nhà cung cấp, phiếu nhập/xuất, kiểm kê và sổ biến động; cập nhật trạng thái/mã vận đơn, xử lý yêu cầu trả hàng.
- **Trợ lý phân tích nội bộ:** tổng hợp doanh thu, sản phẩm bán chạy và cảnh báo tồn kho từ dữ liệu cửa hàng. Dự báo nhu cầu sử dụng Holt-Winters so sánh với MA7; không gửi dữ liệu tới dịch vụ AI bên ngoài.

## Dữ liệu và vận hành

- PostgreSQL lưu dữ liệu nghiệp vụ; Docker volume `pgdata` giữ dữ liệu qua lần khởi động lại.
- Dừng dịch vụ bằng `docker compose down`. **Không dùng `docker compose down -v` nếu cần giữ dữ liệu**, vì lệnh đó xóa volume cơ sở dữ liệu.
- Đơn POS được ghi thành giao dịch đã thanh toán. Đơn COD trực tuyến giữ tồn ngay khi đặt, cần nhân viên xác nhận → giao hàng → hoàn tất; hủy đơn trước khi giao sẽ hoàn tồn và ghi sổ kho.
- Giá, khuyến mãi, tổng tiền, phí giao hàng và tồn được xác minh ở máy chủ; thao tác bán/nhập/xuất được thực hiện trong transaction để tránh tồn kho âm hoặc cập nhật dở dang. Danh sách sản phẩm/đơn hàng được phân trang.
- Phí vận chuyển do cửa hàng tự cấu hình (`SHIPPING_FEE`) và mã vận đơn được nhân viên cập nhật thủ công; hiện chưa gọi API hãng vận chuyển.
- Yêu cầu trả hàng được mở trong 7 ngày từ lúc hoàn tất đơn; nhân viên duyệt thủ công. Duyệt không tự hoàn tiền hoặc nhập lại kho.
- VNPay/MoMo chỉ được bật khi cấu hình thông tin merchant và callback công khai. IPN/callback kiểm tra chữ ký máy chủ; không coi trang quay về của trình duyệt là nguồn thanh toán duy nhất.
- Email thông báo cần SMTP và email khách hàng. Lỗi gửi email được ghi vào log máy chủ; đơn hàng vẫn được lưu.
- Tài khoản mẫu chỉ dành cho phát triển. Trước khi triển khai thật, thay `JWT_SECRET` trong môi trường, đặt mật khẩu riêng, cấu hình HTTPS và sao lưu PostgreSQL thường xuyên. Không sử dụng dữ liệu mẫu trong môi trường thật.

## Chạy từng phần (không Docker)

1. Khởi động PostgreSQL; chạy trực tiếp thì cấu hình `server/.env` từ `server/.env.example`. Với Docker Compose, đặt các biến cần dùng trong file `.env` ở thư mục gốc cạnh `docker-compose.yml`.
2. Trong `server`: `npm install`, `npx prisma db push`, `npm run seed`, `npm start`.
3. Trong `forecast`: `pip install -r requirements.txt`, sau đó `uvicorn main:app --port 8000`.
4. Trong `web`: `npm install`, `npm run dev`.

## Cấu hình thanh toán, email và giao hàng

Sao chép các biến trong `server/.env.example` vào `server/.env` khi chạy trực tiếp, hoặc vào `.env` cạnh `docker-compose.yml` khi dùng Docker Compose. Không commit thông tin merchant, SMTP password hoặc `JWT_SECRET`.

- **VNPay:** điền `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`; dùng `VNPAY_PAYMENT_URL` sandbox khi thử nghiệm. Cấu hình IPN trên merchant portal trỏ đến `https://<API_PUBLIC_URL>/api/payments/vnpay/ipn`. Return URL được tạo tự động; `PUBLIC_URL` và `API_PUBLIC_URL` phải truy cập được từ bên ngoài trong kiểm thử tích hợp.
- **MoMo:** điền `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, `MOMO_ENDPOINT`; endpoint IPN là `https://<API_PUBLIC_URL>/api/payments/momo/ipn`.
- **Email:** cấu hình `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Tài khoản khách cần email để nhận thông báo; email phải được xác minh để dùng khôi phục mật khẩu.
- **Tự vận chuyển:** đặt `SHIPPING_FEE` (VND, số nguyên không âm). Nhân viên nhập mã vận đơn trong quản lý đơn hàng. Tích hợp API hãng giao hàng chưa được bật.

Sandbox payment callbacks không thể gọi địa chỉ localhost. Dùng domain HTTPS/tunnel riêng trong môi trường thử nghiệm và cấu hình URL công khai chính xác trước khi bật cổng thanh toán.

## Kiểm thử

```bash
cd server
npm test
```
