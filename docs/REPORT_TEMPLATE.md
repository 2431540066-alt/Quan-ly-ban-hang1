# Cấu trúc tài liệu báo cáo đồ án

Tài liệu báo cáo nên theo thứ tự sau để bám sát phạm vi dự án đã triển khai.

1. Trang bìa
2. Lời cảm ơn
3. Mục lục
4. Danh mục hình, bảng và từ viết tắt
5. Giới thiệu đề tài
6. Phân tích yêu cầu
   - Mô tả bối cảnh cửa hàng
   - Các tác nhân
   - Use Case tổng quát
   - Use Case chi tiết
7. Phân tích và thiết kế
   - Kiến trúc React + Express + PostgreSQL + Forecast
   - Sơ đồ ERD
   - Thiết kế dữ liệu theo `server/prisma/schema.prisma`
   - Thiết kế API
   - Thiết kế giao diện theo vai trò
8. Triển khai
   - Cài đặt Docker/PostgreSQL
   - Đăng nhập và phân quyền
   - Cửa hàng, POS và khuyến mãi
   - Nhập/xuất/kiểm kê kho
   - Trả hàng
   - Báo cáo và dự báo
9. Kiểm thử
   - Môi trường kiểm thử
   - Test case chức năng
   - Test case phân quyền
   - Test case tồn kho và transaction
   - Kết quả tự động `npm test`
10. Hướng dẫn cài đặt và demo
11. Kết quả và hạn chế
12. Hướng phát triển
13. Phụ lục
    - Danh sách tài khoản mẫu
    - ERD
    - Use Case
    - Test case
    - Hình ảnh demo
    - Mẫu sao lưu/khôi phục

## Nội dung không nên khẳng định

- Không mô tả hệ thống là tích hợp thật với VNPay/MoMo khi chỉ đang dùng sandbox hoặc chưa cấu hình merchant.
- Không mô tả hoàn tiền là tự động; hệ thống hiện ghi nhận xác nhận hoàn tiền thủ công.
- Không mô tả đã triển khai phân tách chi nhánh nếu mã nguồn vẫn quản lý một cửa hàng.
- Không mô tả dịch vụ forecast là chatbot AI hoặc mô hình ngôn ngữ lớn.
- Không mô tả mã seed có dữ liệu bán hàng thực tế; seed tạo dữ liệu bán hàng mô phỏng trong 120 ngày.
