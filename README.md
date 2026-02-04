# Slack Expense Tracker Bot (Deno)

Bot Slack giúp nhập chi tiêu vào Google Sheets một cách nhanh chóng, chạy trên Deno.

## Tính năng
- Nhận tin nhắn dạng: `ăn tối 157k` hoặc `mua sắm 200000`.
- Tự động định dạng tiền tệ (VD: `157.000 ₫`).
- Tự động thêm dòng tiêu đề ngày tháng (VD: `04/02/2026`) nếu là ngày mới.
- Sử dụng Google Sheets API và Service Account.

## Cài đặt

### 1. Chuẩn bị Google Sheet
- Tạo một file Google Sheet mới.
- Lấy `Spreadsheet ID` từ URL (phần nằm giữa `/d/` và `/edit`).
- Tạo Service Account trên [Google Cloud Console](https://console.cloud.google.com/).
- Cấp quyền `Editor` cho email của Service Account vào file Google Sheet đó.
- Tải file JSON của Service Account để lấy `Client Email` và `Private Key`.

### 2. Chuẩn bị Slack Bot
- Tạo App trên [Slack API](https://api.slack.com/apps).
- Kích hoạt **Socket Mode**.
- Cấp quyền `chat:write` và `messages:read` (**Subscribe to events** -> `message.channels`).
- Lấy `Bot User OAuth Token`, `Signing Secret`, và `App-Level Token`.

### 3. Cài đặt Source Code
```bash
# Clone hoặc tải code về
cd tiubot
```

### 4. Cấu hình .env
Tạo file `.env` và điền các thông tin sau:
- `SLACK_BOT_TOKEN`: Token của bot (xoxb-...).
- `SLACK_SIGNING_SECRET`: Signing secret của app.
- `SLACK_APP_TOKEN`: App-level token (xapp-...).
- `GOOGLE_SHEET_ID`: ID của file Google Sheet.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Email của Service Account.
- `GOOGLE_PRIVATE_KEY`: Private Key (nhớ giữ nguyên các ký tự `\n`).

### 5. Chạy Bot với Deno
```bash
# Chế độ phát triển (tự động reload)
deno task dev

# Chạy bản production
deno task start
```

## Cách sử dụng
Gửi tin nhắn trong channel mà bot được mời vào theo cú pháp: `[Tên chi tiêu] [Số tiền]`
- Ví dụ 1: `ăn trưa 45k`
- Ví dụ 2: `siêu thị 1.2tr`
- Ví dụ 3: `xăng xe 50000`
