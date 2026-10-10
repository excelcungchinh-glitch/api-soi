# API Soi

Bóc tách · sửa · chạy thử · so sánh API copy từ DevTools ("Copy as fetch" / "Copy as cURL").

- **Bản web:** https://excelcungchinh-glitch.github.io/api-soi/ — kéo nút **📌 API Soi** lên thanh dấu trang, mở hệ thống rồi bấm nút đó để chạy API ngay trên trang hệ thống.
  - Tự bắt các API trang hệ thống gọi (không cần F12), tự lấy token mới khi gặp 401.
  - `bridge.js` là phần chạy trên trang hệ thống; bookmark chỉ tải file này nên cập nhật tool không cần kéo lại bookmark.
- **Bản chạy trên máy:** bấm đúp `Chay_API_Soi.bat` (cần Node.js).

Không lưu token trên server nào; token chỉ nằm trong trình duyệt của người dùng.
