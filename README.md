# Hệ thống quản lý bán hàng – Nhóm 13

Bán hàng (POS) · Quản lý kho · Báo cáo & dự báo nhập hàng.
React + Vite + Tailwind · Node/Express + JWT · PostgreSQL + Prisma · FastAPI + statsmodels.

## Chạy bằng Docker (khuyên dùng)
```bash
docker compose up --build
```
Mở http://localhost:5173. Lần đầu hệ thống tự tạo bảng và sinh dữ liệu mẫu (120 ngày bán hàng).

| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| Chủ cửa hàng | owner | 123456 |
| Nhân viên bán hàng | sales | 123456 |
| Thủ kho | stock | 123456 |

Mã khuyến mãi mẫu: `GIAM10` (10%), `GIAM20K` (20.000đ), `HETHAN` (đã hết hạn, để thử lỗi).

## Chạy từng phần trong VS Code (không Docker)
1. PostgreSQL chạy sẵn; `cd server && cp .env.example .env && npm i && npx prisma db push && npm run seed && npm start`
2. `cd forecast && pip install -r requirements.txt && uvicorn main:app --port 8000`
3. `cd web && npm i && npm run dev`

## Cấu trúc nhánh Git gợi ý
`main` · `feature/sales` · `feature/inventory` · `feature/reports`. Mỗi người làm trên nhánh của mình rồi tạo pull request.

## Quy tắc nghiệp vụ đã cài
- Lưu đơn bằng một transaction; trừ kho bằng `UPDATE ... WHERE stock >= qty` nên không bán vượt tồn; lỗi thì hủy toàn bộ.
- Server tự tính lại giá, giảm giá, tổng tiền (không tin số từ giao diện); mỗi đơn một mã khuyến mãi.
- Tồn kho chỉ đổi khi phiếu nhập được xác nhận; mọi biến động ghi vào `stock_movements`; giá vốn bình quân gia quyền.
- Dự báo: Holt-Winters so với trung bình động 7 ngày (MAE/MAPE trên 14 ngày cuối); dưới 28 ngày dữ liệu thì dùng trung bình động, gắn nhãn độ tin cậy thấp.
- Đề xuất nhập = nhu cầu dự báo + tồn an toàn (min_stock) − tồn hiện tại, không nhỏ hơn 0.
