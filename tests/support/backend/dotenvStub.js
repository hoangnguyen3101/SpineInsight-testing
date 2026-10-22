// Thay dotenv của SUT khi chạy test: Jest chạy với cwd là backend SUT, không được nạp .env thật (khoá, URL dịch vụ).
module.exports = { config: () => ({ parsed: {} }) }
