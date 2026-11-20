# Bộ test case

Test case dưới đây phản ánh các quy tắc đang triển khai trong server và giao diện. Khi thực hiện kiểm thử thủ công, ghi kết quả **Pass/Fail** và đính kèm ảnh chụp màn hình.

## Tài khoản và phân quyền

| ID | Điều kiện/Tác vụ | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| AUTH-01 | Đăng nhập chủ cửa hàng | `owner / 123456` | Đăng nhập thành công, truy cập được chức năng quản trị |
| AUTH-02 | Đăng nhập nhân viên bán hàng | `sales / 123456` | Đăng nhập thành công, truy cập POS và đơn hàng |
| AUTH-03 | Đăng nhập thủ kho | `stock / 123456` | Đăng nhập thành công, truy cập kho |
| AUTH-04 | Đăng nhập khách hàng | `customer / 123456` | Đăng nhập thành công, truy cập giỏ và đơn cá nhân |
| AUTH-05 | Sai mật khẩu | tài khoản hợp lệ, mật khẩu sai | Không cấp token, hiển thị thông báo lỗi |
| AUTH-06 | Nhân viên truy cập API chủ cửa hàng | token role `SALES` gọi `/api/staff` | API từ chối truy cập |
| AUTH-07 | Đăng ký mật khẩu ngắn | mật khẩu dưới 8 ký tự | Không tạo tài khoản |

## Cửa hàng và giỏ hàng

| ID | Điều kiện/Tác vụ | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| STORE-01 | Mở cửa hàng khi chưa đăng nhập | không token | Xem được danh mục và sản phẩm |
| STORE-02 | Tìm sản phẩm | từ khóa “Coca” | Chỉ hiển thị hoặc xếp đúng sản phẩm phù hợp |
| STORE-03 | Lọc theo danh mục | “Đồ uống” | Danh sách thuộc danh mục đã chọn |
| STORE-04 | Thêm sản phẩm vào giỏ | số lượng 2 | Giỏ tăng đúng số lượng và tổng tiền |
| STORE-05 | Giảm số lượng về 0 | nút trừ | Dòng sản phẩm được xóa khỏi giỏ |
| STORE-06 | Áp dụng `GIAM10` | giỏ có giá trị dương | Giảm 10% và tổng thay đổi đúng |
| STORE-07 | Áp dụng `HETHAN` | mã hết hạn | Từ chối mã |

## Đơn hàng

| ID | Điều kiện/Tác vụ | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| ORDER-01 | POS bán hợp lệ | 2 sản phẩm, tồn đủ | Tạo đơn, trừ tồn, ghi giao dịch |
| ORDER-02 | POS bán vượt tồn | số lượng lớn hơn tồn | Từ chối; không trừ tồn |
| ORDER-03 | Sản phẩm quá hạn | expiryDate đã qua | Không cho bán |
| ORDER-04 | Đặt COD | địa chỉ hợp lệ | Tạo đơn PENDING, giữ tồn |
| ORDER-05 | Hủy đơn COD trước giao | đơn PENDING/CONFIRMED | Hoàn tồn và ghi sổ |
| ORDER-06 | Duyệt đơn online | nhân viên đổi sang CONFIRMED | Trạng thái thay đổi hợp lệ |
| ORDER-07 | Cập nhật mã vận đơn | mã chuỗi hợp lệ | Mã vận đơn được lưu |
| ORDER-08 | Hoàn tất đơn COD | nhân viên đổi sang PAID | Ghi completedAt và hoàn thành đơn |

## Kho

| ID | Điều kiện/Tác vụ | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| STOCK-01 | Tạo phiếu nhập DRAFT | nhà cung cấp, 5 sản phẩm A | Phiếu được lưu, tồn chưa thay đổi |
| STOCK-02 | Xác nhận phiếu nhập | phiếu DRAFT hợp lệ | Cộng đúng tồn và ghi StockMovement |
| STOCK-03 | Xác nhận phiếu nhập lần hai | cùng phiếu | Từ chối cập nhật trùng |
| STOCK-04 | Phiếu xuất | số lượng <= tồn | Trừ đúng tồn |
| STOCK-05 | Phiếu xuất vượt tồn | số lượng > tồn | Từ chối, không tạo tồn âm |
| STOCK-06 | Kiểm kê điều chỉnh | tồn cũ 20, tồn thực 15 | Điều chỉnh đúng và ghi ADJUST |

## Trả hàng

| ID | Điều kiện/Tác vụ | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| RETURN-01 | Tạo yêu cầu trả | đơn hoàn tất trong 7 ngày | Tạo yêu cầu PENDING |
| RETURN-02 | Tạo yêu cầu quá hạn | đơn hoàn tất hơn 7 ngày | Từ chối |
| RETURN-03 | Nhân viên duyệt | yêu cầu PENDING | Chuyển APPROVED |
| RETURN-04 | Nhân viên xác nhận nhận hàng | yêu cầu APPROVED | Nhập lại kho, chuyển RECEIVED |
| RETURN-05 | Xác nhận hoàn tiền thủ công | yêu cầu RECEIVED | Cập nhật refund COMPLETED, không tự gọi API hoàn tiền |

## Báo cáo

| ID | Điều kiện/Tác vụ | Dữ liệu | Kết quả mong đợi |
|---|---|---|---|
| REPORT-01 | Xem tổng quan | khoảng thời gian hợp lệ | Doanh thu, giá vốn, chi phí và lợi nhuận tạm tính khớp |
| REPORT-02 | Lọc theo nhân viên | chọn tài khoản sales | Chỉ dữ liệu thuộc nhân viên được chọn |
| REPORT-03 | Xuất Excel | có dữ liệu | Tải file, có sheet đơn hàng/mặt hàng/khoản chi phù hợp |
| REPORT-04 | Xem dự báo | ít nhất dữ liệu lịch sử được seed | Trả kết quả và MAE theo phương pháp |

## Kiểm thử tự động hiện có

Chạy trong thư mục `server`:

```bash
npm test
```

Các file kiểm thử hiện có:

- `src/calc.test.js`
- `src/insights.test.js`
- `src/order-status.test.js`
- `src/payment.test.js`
- `src/product-expiry.test.js`
- `src/reports.test.js`
