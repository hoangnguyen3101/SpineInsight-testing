# SpineInsight-testing

Bộ kiểm thử và đánh giá chất lượng cho hệ thống **SpineInsight AI — Web-based MRI Annotation Tool for Lumbar Spine**.

| | |
|---|---|
| Môn học | Đánh giá và Kiểm định chất lượng phần mềm (CSE703010) |
| Học kỳ | HK I, năm học 2026–2027 |
| Đơn vị | Đại học Phenikaa — Phenikaa Applied AI Lab |
| Hệ thống được kiểm thử (SUT) | [phenikaa-a2i-lab/SPINEINSIGHT_AI](https://github.com/phenikaa-a2i-lab/SPINEINSIGHT_AI), commit `38ee7f1` (nhánh `vietvq`) |
| Trạng thái | Đã thực thi (22–23/10/2026): 639 test, 26 lỗi được ghi nhận |

---

## 1. Mục tiêu

SpineInsight AI là hệ thống web hỗ trợ bác sĩ xem, đo đạc và chú giải ảnh MRI cột sống thắt lưng, tích hợp mô hình AI phân loại tổn thương theo chuẩn RSNA 2024 và tự động sinh báo cáo (P2VG). Kho này chứa toàn bộ mã kiểm thử tự động cho hệ thống, tách riêng khỏi mã nguồn: SUT chỉ được đọc, không bị sửa.

Mục tiêu:

1. Xác minh tính đúng đắn của backend (xác thực, phân quyền, proxy AI, ca chụp, DICOM) và các hàm tính toán của frontend (đo đạc, toạ độ DICOM, xử lý ảnh).
2. Kiểm tra các REST endpoint về chức năng, xác thực, phân quyền và xử lý lỗi.
3. Kiểm thử luồng đăng nhập và điều hướng theo vai trò từ góc nhìn người dùng.
4. Đo độ bao phủ và điểm kiểm thử đột biến; ghi nhận lỗi thực tế kèm bằng chứng tái hiện.

---

## 2. Kết quả đợt 1

| Tầng | Công cụ | Test | Kết quả |
|---|---|---|---|
| Unit backend | Jest | 249 | Đạt; 5 test ghi nhận lỗi |
| API / tích hợp | Jest + Supertest | 189 | Đạt; 14 test ghi nhận lỗi; ma trận phân quyền 52/52 ô đúng |
| Unit frontend | Vitest + fast-check | 153 | Đạt; 8 test ghi nhận lỗi |
| E2E | Selenium WebDriver (POM) | 48 | Đạt; 12 test ghi nhận lỗi (9 kịch bản đăng nhập + 39 kịch bản trình xem ảnh trên một ca MRI thật đã ẩn danh) |

| Chỉ số | Ngưỡng | Thực tế |
|---|---|---|
| Độ bao phủ dòng backend | ≥ 80% | 99,77% |
| Độ bao phủ nhánh backend | ≥ 70% | 97,33% |
| Độ bao phủ frontend (7 module trong phạm vi) | — | 99,61% dòng, 97,80% nhánh |
| Mutation score (utils, mappers, middlewares) | ≥ 60% | 99,00% |

Test ghi nhận lỗi được viết với kết quả mong đợi theo đặc tả và đánh dấu `test.failing` (Jest) / `test.fails` (Vitest) / `knownBug` (E2E): bộ test vẫn xanh khi lỗi còn, và sẽ **chuyển đỏ khi lỗi được sửa** để nhắc bỏ đánh dấu. Danh sách lỗi BUG-01…BUG-26 nằm trong báo cáo BTL (Chương 6, nhật ký lỗi); mã lỗi xuất hiện trong tên test tương ứng.

---

## 3. Chiến lược kiểm thử

| Tầng | Kỹ thuật | Công cụ |
|---|---|---|
| Unit | Phân vùng tương đương, giá trị biên, bảng quyết định, chuyển trạng thái; bao phủ câu lệnh/nhánh; kiểm thử đột biến | Jest (backend), Vitest (frontend), Istanbul, StrykerJS |
| Property-based | Tính chất bất biến với dữ liệu sinh ngẫu nhiên | fast-check |
| API / tích hợp | Bảng quyết định vai trò × endpoint, kiểm thử tiêu cực, bảo mật route | Supertest; Supabase và máy chủ AI được giả lập |
| E2E | Chuyển trạng thái, Page Object Model, chờ tường minh | Selenium WebDriver + Chrome headless, máy chủ giả Supabase/backend |
| CI | Chạy lại toàn bộ khi push | GitHub Actions (`.github/workflows/test.yml`) |

Không dùng dữ liệu bệnh nhân thật: tài khoản, phản hồi AI và tệp DICOM trong test đều là dữ liệu giả. Khi chạy backend test, `dotenv` của SUT được thay bằng hàm rỗng nên tệp `.env` thật không bao giờ được nạp.

---

## 4. Cấu trúc thư mục

```
SpineInsight-testing/
├── sut.config.cjs            Xác định vị trí SUT từ biến SUT_DIR (.env)
├── jest.config.js            Jest cho backend (rootDir = backend của SUT)
├── jest.stryker.config.js    Jest rút gọn cho StrykerJS (chỉ unit backend)
├── vitest.config.mjs         Vitest cho các hàm thuần của frontend
├── stryker.config.mjs        Kiểm thử đột biến
├── scripts/                  run-jest.cjs, run-stryker.cjs
├── tests/
│   ├── support/backend/      setupEnv, giả lập query builder Supabase, dotenv rỗng
│   ├── unit/backend/         Unit test backend (utils, mappers, middlewares, services)
│   ├── unit/frontend/        Điều hướng sau đăng nhập, xử lý ảnh (âm bản, cửa sổ, xoay, lật)
│   ├── unit/spatial/         Đo đạc, toạ độ DICOM, property test
│   ├── api/supertest/        Test API theo nhóm route, ma trận phân quyền
│   ├── api/mocks/            Token giả theo vai trò
│   └── e2e/                  run.mjs, pages/ (Page Object), specs/, fixtures/ (tài khoản, máy chủ giả)
├── reports/                  Báo cáo sinh khi chạy (không commit): coverage/, mutation/, e2e/
└── .github/workflows/        CI
```

---

## 5. Cách chạy

Chạy trong **Command Prompt (cmd)**. PowerShell có thể chặn `npm.ps1` do chính sách thực thi script.

1. Chuẩn bị SUT: clone `SPINEINSIGHT_AI`, checkout commit `38ee7f1`, chạy `npm install` trong `backend` và `frontend` của SUT.
2. Tạo tệp `.env` từ `.env.example` và đặt `SUT_DIR` trỏ tới thư mục SUT (chứa `backend/` và `frontend/`).
3. Cài công cụ kiểm thử và chạy:

```bat
cd /d F:\2026-2027\HKI\SpineInsight-testing
npm install
npm run test:backend:cov
npm run test:frontend:cov
npm run test:mutation
npm run test:e2e
```

| Lệnh | Nội dung | Báo cáo |
|---|---|---|
| `npm run test:backend:cov` | Unit test + API test backend, độ bao phủ Istanbul | `reports/coverage/backend` |
| `npm run test:frontend:cov` | Unit test + property test frontend | `reports/coverage/frontend` |
| `npm run test:mutation` | StrykerJS trên utils, mappers, middlewares (sửa tệp tại chỗ rồi khôi phục) | `reports/mutation` |
| `npm run test:e2e` | Tự khởi động Vite của SUT và máy chủ giả, chạy Selenium | `reports/e2e/screenshots` |

Trên GitHub Actions, workflow clone SUT từ bản trên GitLab (`lumbar-spine/spineinsight_ai`) về `./sut` rồi checkout đúng commit `38ee7f1`. Nếu dự án GitLab ở chế độ private, khai báo hai secret `SUT_GITLAB_USER` và `SUT_GITLAB_TOKEN` (deploy token, scope `read_repository`).

---

## 6. Quy ước

| Loại | Định dạng | Ví dụ |
|---|---|---|
| Unit backend | `UT-<module>-<số>`; bảng quyết định requireAuth dùng `R1`…`R6` | `UT-REQ-09`, `UT-AS-21` |
| API | `IT-<nhóm>-<số>` | `IT-RBAC-15`, `IT-SPINE-17` |
| Frontend | `FE-UT-<số>`, `FE-PBT-<số>` | `FE-UT-55` |
| E2E | `E2E-<số>` | `E2E-09` |
| Lỗi | `BUG-<số>` | `BUG-09` |

Mức độ nghiêm trọng của lỗi: **Critical** (lộ dữ liệu bệnh nhân, khoá hệ thống), **Major** (chức năng chính sai hoặc vi phạm phân quyền), **Minor** (chức năng phụ sai, có cách vòng tránh), **Trivial** (lỗi tiềm ẩn, chưa gây ảnh hưởng).

---

## 7. Lưu ý về dữ liệu y tế

Không commit ảnh DICOM vào repo, kể cả bản đã ẩn danh. E2E của trình xem ảnh đọc một ca MRI đã ẩn danh nằm **ngoài repo**, trỏ tới bằng `DICOM_TEST_DIR` trong `.env` (mỗi series một thư mục con); để trống thì các kịch bản viewer tự bỏ qua. Quy trình chuẩn bị:

```bat
python scripts\deidentify.py <thư mục ca gốc> F:\2026-2027\HKI\dicom-test-data CASE01
python scripts\dicom_leakcheck.py <thư mục ca gốc> F:\2026-2027\HKI\dicom-test-data
```

`deidentify.py` áp dụng tập con hồ sơ cơ bản DICOM PS3.15 (xoá tên, mã, ngày sinh, cơ sở y tế, bác sĩ, accession; thay UID; bỏ thẻ riêng của hãng; đưa ngày về giá trị cố định; giữ giới tính và tuổi). `dicom_leakcheck.py` dò từng byte của bản sao và chỉ in số lần còn sót, không in giá trị. Cần kiểm tra thêm bằng mắt rằng ảnh không có chữ in sẵn trên pixel. Chỉ dùng dữ liệu đã được phép sử dụng. Nếu cần ảnh công khai, dùng ca mẫu đã ẩn danh từ bộ [RSNA 2024 Lumbar Spine Degenerative Classification](https://www.kaggle.com/competitions/rsna-2024-lumbar-spine-degenerative-classification) theo giấy phép phi thương mại. Tệp `.env` không được commit; chỉ commit `.env.example`.

---

## 8. Người thực hiện

| Thành viên | Phụ trách |
|---|---|
| Nguyễn Văn Hoàng (23010101) | Toàn bộ: đặc tả, kế hoạch, thiết kế và thực thi kiểm thử, báo cáo |

Giảng viên hướng dẫn: TS. Trịnh Thanh Bình.

---

## 9. Tài liệu tham chiếu

- ISTQB Foundation Level Syllabus
- ISO/IEC/IEEE 29119 — Software Testing
- ISO/IEC 25010 — Systems and software Quality Requirements and Evaluation (SQuaRE)
- DICOM PS3.3 C.7.6.2.1.1 (Image Position/Orientation) và C.11.2 (VOI LUT)
- Tài liệu chính thức của Jest, Supertest, Vitest, fast-check, StrykerJS, Selenium WebDriver
