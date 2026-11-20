# Hướng dẫn demo và tài khoản mẫu

## Tài khoản seed

Tất cả tài khoản mẫu có mật khẩu `123456`. Chúng chỉ dành cho phát triển và demo.

| Vai trò | Tài khoản | Mật khẩu | Chức năng |
|---|---|---|---|
| Chủ cửa hàng | `owner` | `123456` | Nhân viên, chi phí, audit, báo cáo, dự báo |
| Nhân viên bán hàng | `sales` | `123456` | POS, đơn hàng, khách hàng |
| Thủ kho | `stock` | `123456` | Sản phẩm, nhà cung cấp, nhập/xuất/kiểm kê |
| Khách hàng | `customer` | `123456` | Cửa hàng, giỏ hàng, đơn hàng, đánh giá |

## Cài đặt bằng Docker

Yêu cầu: Docker Desktop hoặc Docker Engine hỗ trợ Compose.

```bash
docker compose up --build
```

Sau khi các container sẵn sàng:

- Giao diện: http://localhost:5173
- API: http://localhost:4000
- Dịch vụ dự báo: http://localhost:8000

Container `server` tự chạy `prisma db push` và seed dữ liệu khi khởi động. PostgreSQL lưu dữ liệu trong volume `pgdata`.

## Cài đặt từng phần

1. Tạo PostgreSQL và database `shop`.
2. Sao chép `server/.env.example` thành `server/.env`.
3. Thiết lập `DATABASE_URL`, ví dụ:

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shop
```

4. Khởi tạo server:

```bash
cd server
npm install
npx prisma db push
npm run seed
npm start
```

5. Khởi tạo dịch vụ dự báo:

```bash
cd forecast
pip install -r requirements.txt
uvicorn main:app --port 8000
```

6. Khởi tạo giao diện:

```bash
cd web
npm install
npm run dev
```

## Kiểm tra kết nối

- Server: mở `http://localhost:4000/api/health`.
- Giao diện: mở `http://localhost:5173`.
- Khi chạy Docker, kiểm tra trạng thái bằng:

```bash
docker compose ps
```

- Nếu frontend không kết nối API, kiểm tra proxy trong `web/vite.config.js` và service `server` trong `docker-compose.yml`.

## Kịch bản demo đề xuất

### 1. Khách hàng mua hàng

1. Mở cửa hàng ở chế độ chưa đăng nhập.
2. Tìm sản phẩm và thêm vào giỏ.
3. Đăng nhập `customer / 123456`.
4. Chọn địa chỉ hoặc nhập địa chỉ nhận hàng.
5. Áp dụng `GIAM10`.
6. Chọn COD và đặt hàng.
7. Mở mục đơn hàng của khách để xem trạng thái.

### 2. Nhân viên bán hàng xử lý POS

1. Đăng xuất khách hàng và đăng nhập `sales / 123456`.
2. Mở POS.
3. Chọn khách hàng và quét/nhập mã sản phẩm.
4. Áp dụng khuyến mãi nếu có.
5. Hoàn tất thanh toán.
6. Kiểm tra số lượng tồn giảm và giao dịch xuất hiện trong đơn hàng.

### 3. Thủ kho nhập hàng

1. Đăng nhập `stock / 123456`.
2. Chọn nhà cung cấp.
3. Tạo phiếu nhập ở trạng thái nháp.
4. Xác nhận phiếu.
5. Kiểm tra tồn kho và sổ biến động.

### 4. Chủ cửa hàng xem báo cáo

1. Đăng nhập `owner / 123456`.
2. Chọn khoảng thời gian.
3. Xem tổng quan, doanh thu theo nhân viên/danh mục/phương thức.
4. Xuất Excel.
5. Mở trợ lý/dự báo để xem cảnh báo tồn và kết quả dự báo.

## Sao lưu và phục hồi PostgreSQL

### Docker

Sao lưu:

```bash
docker compose exec db pg_dump -U postgres -d shop -F c -f /tmp/shop.dump
docker compose cp db:/tmp/shop.dump ./shop-backup.dump
```

Phục hồi vào database đang chạy:

```bash
docker compose cp ./shop-backup.dump db:/tmp/shop.dump
docker compose exec db pg_restore -U postgres -d shop --clean --if-exists /tmp/shop.dump
```

Không dùng `docker compose down -v` nếu cần giữ dữ liệu. Lệnh này xóa volume `pgdata`.

### PostgreSQL cài trực tiếp

Sao lưu:

```bash
pg_dump -U postgres -d shop -F c -f shop-backup.dump
```

Phục hồi:

```bash
pg_restore -U postgres -d shop --clean --if-exists shop-backup.dump
```
