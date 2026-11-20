# Sơ đồ ERD

Sơ đồ dưới đây mô tả cấu trúc PostgreSQL được định nghĩa trong `server/prisma/schema.prisma`.

```mermaid
erDiagram
    User ||--o| Customer : "tài khoản khách"
    User ||--o{ UserAddress : "địa chỉ"
    User ||--o{ Favorite : "yêu thích"
    User ||--o{ ProductReview : "đánh giá"
    User ||--o{ Order : "tạo hoặc sở hữu"
    User ||--o{ PasswordResetToken : "khôi phục"
    User ||--o{ EmailVerificationToken : "xác minh"
    User ||--o{ StockMovement : "thực hiện"
    User ||--o{ AuditLog : "ghi audit"
    User ||--o{ Expense : "ghi chi phí"
    User ||--o{ ReturnRequest : "yêu cầu"
    Category ||--o{ Product : "phân loại"
    Product ||--o{ OrderItem : "dòng đơn"
    Product ||--o{ ReceiptItem : "dòng nhập"
    Product ||--o{ StockMovement : "biến động"
    Product ||--o| LowStockAlert : "cảnh báo"
    Product ||--o{ Favorite : "được yêu thích"
    Product ||--o{ ProductReview : "được đánh giá"
    Customer ||--o{ Order : "đặt"
    Order ||--o{ OrderItem : "bao gồm"
    Order ||--o{ PaymentAttempt : "thử thanh toán"
    Order ||--o| ReturnRequest : "trả hàng"
    Supplier ||--o{ Receipt : "cung cấp"
    Receipt ||--o{ ReceiptItem : "bao gồm"

    User {
        int id PK
        string username UK
        string password
        string name
        string email UK
        datetime emailVerifiedAt
        string role "OWNER, SALES, WAREHOUSE, CUSTOMER"
    }
    Customer {
        int id PK
        string name
        string phone
        int userId UK_FK
    }
    Category {
        int id PK
        string name UK
    }
    Product {
        int id PK
        string barcode UK
        string name
        string description
        string imageUrl
        int price
        float cost
        int stock
        int minStock
        datetime expiryDate
        int categoryId FK
    }
    Order {
        int id PK
        int userId FK
        int customerId FK
        int total
        int discount
        int shippingFee
        string payment
        string paymentStatus
        string status
        string shippingAddress
        string shippingTrackingCode
        datetime createdAt
        datetime completedAt
    }
    OrderItem {
        int id PK
        int orderId FK
        int productId FK
        int qty
        int price
        float cost
    }
    PaymentAttempt {
        int id PK
        int orderId FK
        string provider
        string transactionRef UK
        string providerTxnId
        int amount
        string status
        datetime expiresAt
    }
    Promotion {
        int id PK
        string code UK
        string type "PERCENT, AMOUNT"
        int value
        datetime expiresAt
    }
    Supplier {
        int id PK
        string name
        string phone
        string address
    }
    Receipt {
        int id PK
        int supplierId FK
        string status "DRAFT, CONFIRMED"
        string note
        int total
    }
    ReceiptItem {
        int id PK
        int receiptId FK
        int productId FK
        int qty
        int cost
    }
    StockMovement {
        int id PK
        int productId FK
        int performedById FK
        string type "IN, OUT, ADJUST"
        int qty
        string ref
    }
    ReturnRequest {
        int id PK
        int orderId UK_FK
        int userId FK
        string reason
        string status
        string refundStatus
        int refundAmount
        string staffNote
        int receivedById FK
        int refundedById FK
    }
    Expense {
        int id PK
        string category
        string description
        int amount
        datetime occurredAt
        int createdById FK
    }
    AuditLog {
        int id PK
        int actorId FK
        string actorName
        string actorRole
        string method
        string path
        int statusCode
    }
    LowStockAlert {
        int id PK
        int productId UK_FK
        datetime lastAlertedAt
        datetime resolvedAt
    }
```

## Ràng buộc nghiệp vụ chính

- Tồn kho chỉ được trừ hoặc cộng khi thao tác bán/nhập/xuất được xác nhận trong transaction.
- Một `Receipt` chỉ cập nhật tồn kho khi chuyển từ `DRAFT` sang `CONFIRMED`.
- Khách hàng chỉ đánh giá được sản phẩm thuộc đơn đã hoàn tất; mỗi tài khoản chỉ có một đánh giá cho mỗi sản phẩm.
- Đơn online COD giữ tồn khi đặt hàng và hoàn tồn nếu hủy trước khi giao.
- Đơn thanh toán online không coi trang return của trình duyệt là nguồn xác nhận duy nhất; máy chủ chỉ cập nhật khi callback/IPN hợp lệ.
- `LowStockAlert` và `ProductReview` thể hiện quan hệ một-một hoặc một-nhiều theo khóa duy nhất trong schema.
