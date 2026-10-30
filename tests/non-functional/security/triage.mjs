// Mục đích: Phân loại cảnh báo ZAP theo pluginId sau khi đọc bằng chứng trong reports/security/zap-*.json
// và tái hiện thủ công: Đúng (true positive), Sai (false positive) hoặc Thông tin; nhóm OWASP Top 10 2021; lỗi tương ứng.
// byScan ghi đè cho từng lượt quét khi cùng một plugin mang ý nghĩa khác nhau ở backend và frontend.
export const TRIAGE = {
  40018: {
    verdict: 'Sai (false positive)',
    owasp: 'A03 Injection',
    bug: '-',
    note: 'page/perPage đi qua parseInt và truy vấn PostgREST có tham số; tái hiện "1 AND 1=1 --" và "1 AND 1=2 --" trên dữ liệu tĩnh cho phản hồi giống hệt. Khác biệt ZAP thấy do dữ liệu bị chính các request tấn công thay đổi trong lúc quét.',
  },
  30002: {
    verdict: 'Sai (false positive)',
    owasp: 'A03 Injection',
    bug: 'BUG-05 (cùng nguyên nhân)',
    note: 'JavaScript không có lỗ hổng chuỗi định dạng. Hành vi thật: multipart hỏng ("Malformed part header") làm errorHandler trả 500 thay vì 400, cùng nguyên nhân với BUG-05 (lỗi Multer/busboy không được ánh xạ sang 4xx).',
  },
  90024: {
    verdict: 'Sai (false positive)',
    owasp: 'A02 Cryptographic Failures',
    bug: 'Quan sát O-1',
    note: 'Không có mã hoá hay giải mã nào trên đường đi của reportId. ZAP thấy 500 vì PUT /studies/:id/report với reportId không tồn tại bị StudyController biến lỗi PGRST116 (0 dòng) thành 500 thay vì 404; hành vi này ghi thành quan sát O-1 kèm kiểm tra SEC-09.',
  },
  10037: { verdict: 'Đúng', owasp: 'A05 Security Misconfiguration', bug: 'BUG-31', note: 'Express mặc định gửi X-Powered-By: Express; backend không tắt (app.disable) và không dùng helmet.' },
  10021: {
    verdict: 'Đúng',
    owasp: 'A05 Security Misconfiguration',
    bug: 'BUG-32',
    note: 'Phản hồi JSON của backend thiếu X-Content-Type-Options: nosniff.',
    byScan: { 'frontend-baseline': { bug: 'BUG-35', note: 'Tài nguyên frontend thiếu nosniff; netlify.toml không khai báo [[headers]] nên bản triển khai cũng thiếu.' } },
  },
  10038: { verdict: 'Đúng', owasp: 'A05 Security Misconfiguration', bug: 'BUG-35', note: 'Trang HTML không có Content-Security-Policy; netlify.toml không khai báo [[headers]].' },
  10020: { verdict: 'Đúng', owasp: 'A05 Security Misconfiguration', bug: 'BUG-35', note: 'Không có X-Frame-Options hay frame-ancestors, trang đăng nhập có thể bị nhúng iframe (clickjacking).' },
  90003: {
    verdict: 'Đúng, chấp nhận rủi ro',
    owasp: 'A08 Software and Data Integrity Failures',
    bug: '-',
    note: 'Stylesheet Google Fonts tải từ CDN không có integrity; nội dung CSS của Google Fonts thay đổi theo trình duyệt nên SRI không áp dụng được. Khuyến nghị tự host font.',
  },
  40014: {
    verdict: 'Thông tin (điểm yếu)',
    owasp: 'A03 Injection',
    bug: 'BUG-32 (giảm thiểu)',
    note: 'Tên khoa chứa <script> được lưu và trả lại trong JSON (Content-Type application/json, ZAP độ tin cậy thấp). React tự escape khi hiển thị; nosniff (BUG-32) là lớp phòng thủ còn thiếu.',
  },
  90022: {
    verdict: 'Sai (artefact máy chủ giả)',
    owasp: 'A05 Security Misconfiguration',
    bug: '-',
    note: 'Các 500 ở DELETE /auth/users/:id, DELETE /hospitals/:id, POST .../reset-password xuất hiện trong lượt quét có xác thực khi fixture còn dùng id không phải UUID: auth-js ném "Expected parameter to be UUID". Supabase thật luôn dùng UUID; tái hiện với id UUID các endpoint trả 200/204, id sai định dạng trả 404. Thân phản hồi chỉ là "Internal server error" (production), không lộ stack.',
  },
  10023: { verdict: 'Sai (artefact máy chủ giả)', owasp: 'A05 Security Misconfiguration', bug: '-', note: 'Cùng các phản hồi 500 của 90022; bằng chứng là chuỗi chung "Internal server error", không phải thông tin gỡ lỗi.' },
  10111: { verdict: 'Thông tin', owasp: 'A07 Identification and Authentication Failures', bug: '-', note: 'ZAP nhận diện request đăng nhập; không phải lỗ hổng.' },
  10104: { verdict: 'Thông tin', owasp: '-', bug: '-', note: 'Phản hồi không đổi theo User-Agent.' },
  10109: { verdict: 'Thông tin', owasp: '-', bug: '-', note: 'Nhận diện ứng dụng web hiện đại (SPA), gợi ý dùng AJAX spider.' },
  10049: { verdict: 'Thông tin', owasp: 'A04 Insecure Design', bug: 'BUG-34', note: 'Phản hồi có thể bị lưu cache; dữ liệu cá nhân cần Cache-Control: no-store.' },
  10015: { verdict: 'Thông tin', owasp: 'A04 Insecure Design', bug: 'BUG-34', note: 'Cache-Control chưa phù hợp cho dữ liệu cá nhân.' },
  10027: { verdict: 'Thông tin', owasp: 'A05 Security Misconfiguration', bug: '-', note: 'Chú thích trong mã nguồn JS của dev server; bản build production đã rút gọn.' },
  10096: { verdict: 'Thông tin', owasp: '-', bug: '-', note: 'Giá trị giống timestamp trong phản hồi, không nhạy cảm.' },
  10110: { verdict: 'Thông tin', owasp: '-', bug: '-', note: 'Hàm JS có thể nguy hiểm trong mã của dev server/thư viện.' },
}
