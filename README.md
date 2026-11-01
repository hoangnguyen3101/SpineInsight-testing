# SpineInsight-testing

[![test](https://github.com/hoangnguyen3101/SpineInsight-testing/actions/workflows/test.yml/badge.svg)](https://github.com/hoangnguyen3101/SpineInsight-testing/actions/workflows/test.yml)

Automated test suite and quality assessment for **SpineInsight AI**, a web-based MRI viewing and annotation tool for the lumbar spine. The application integrates an AI model that grades degenerative findings (RSNA 2024 scheme) and generates draft radiology reports (P2VG).

This repository contains **only test code**. The system under test (SUT) is read, never modified, and is located through the `SUT_DIR` setting.

| | |
|---|---|
| Course | Software Quality Assurance and Testing (CSE703010-1-1-26, COUR01.LT1) |
| University | Phenikaa University, Phenikaa School of Computing |
| Student | Nguyễn Văn Hoàng (23010101), K17-KHMT (AI & Data Science) |
| Supervisor | Dr. Trịnh Thanh Bình |
| System under test | `phenikaa-a2i-lab/SPINEINSIGHT_AI` (private), commit `38ee7f1`, branch `vietvq` |
| Demo video | [Google Drive folder](https://drive.google.com/drive/folders/1jQQZfZSiXzS4HJvhOs6qms0OhPHkywj_?usp=sharing) |
| Status | Completed (October 2026): 814 automated tests, 41 defects reported |

---

## Contents

1. [Demo video](#1-demo-video)
2. [Results at a glance](#2-results-at-a-glance)
3. [Test strategy](#3-test-strategy)
4. [Key findings](#4-key-findings)
5. [Repository layout](#5-repository-layout)
6. [Getting started](#6-getting-started)
7. [Continuous integration](#7-continuous-integration)
8. [Conventions](#8-conventions)
9. [Medical data policy](#9-medical-data-policy)
10. [References](#10-references)

---

## 1. Demo video

The recorded walkthrough of the test suite (running each layer, reading the coverage, mutation and security reports) is available here:

**https://drive.google.com/drive/folders/1jQQZfZSiXzS4HJvhOs6qms0OhPHkywj_?usp=sharing**

---

## 2. Results at a glance

| Layer | Tooling | Test cases | Executed tests | Known-bug tests |
|---|---|---:|---:|---:|
| Backend unit | Jest | 187 | 249 | 5 |
| API / integration | Jest + Supertest | 106 | 190 | 14 |
| Frontend unit and property-based | Vitest + fast-check | 137 | 290 | 15 |
| End-to-end | Selenium WebDriver (Page Object Model) | 68 | 68 | 17 |
| Non-functional | k6 (performance), OWASP ZAP + checks (security) | 17 | 17 | 8 |
| **Total** | | **515** | **814** | **59** |

| Metric | Target | Result |
|---|---|---|
| Backend line / branch coverage | ≥ 80% / ≥ 70% | **99.77% / 97.33%** |
| Frontend line / branch coverage (10 in-scope modules) | — | 99.47% / 97.42% |
| Mutation score, backend (utils, mappers, middlewares) | ≥ 60% | **99.00%** |
| Mutation score, frontend (DICOM geometry, rendering, domain logic) | ≥ 60% | **94.44%** |
| API endpoints exercised | — | **39 / 39** |
| Functional requirements with at least one test | 100% | **13 / 13** |
| API p95 latency at 50 concurrent users | < 300 ms, < 1% errors | ≤ 274 ms, 0% errors |
| Open critical / high-severity defects | 0 | **Not met** (testing only; the SUT was not modified) |

All 814 tests pass. Tests that document a confirmed defect assert the **specified** behaviour and are marked as known bugs (`test.failing` in Jest, `test.fails` in Vitest, `knownBug` in the E2E and security suites). The suite stays green while the defect exists and **turns red as soon as it is fixed**, signalling that the marker can be removed.

---

## 3. Test strategy

| Layer | Techniques | Tools |
|---|---|---|
| Unit | Equivalence partitioning, boundary value analysis, decision tables, state transitions; statement and branch coverage; mutation testing | Jest, Vitest, Istanbul, StrykerJS |
| Property-based | Invariants checked on randomly generated inputs (e.g. distance symmetry, pixel ↔ world round trip, invert twice = identity) | fast-check |
| API / integration | Role × endpoint decision table, negative testing, upstream failures (502/503/504), route security | Supertest with mocked Supabase and AI server |
| End-to-end | State transitions, Page Object Model, explicit waits; canvas pixels compared with values computed from the DICOM files; metamorphic relations | Selenium WebDriver, headless Chrome, mock Supabase/backend/AI server |
| Performance | Smoke, load and stress profiles; image upload with backend memory sampling | k6 against the real backend with mocked Supabase and AI (127.0.0.1 only) |
| Security | OpenAPI-driven API scans (anonymous and authenticated), frontend baseline scan, manual triage; every confirmed finding has a reproducible check | OWASP ZAP, `node:test` |

Test design follows ISO/IEC/IEEE 29119-4: black-box techniques first, then coverage reports and surviving mutants guide additional cases.

---

## 4. Key findings

41 defects were found (3 critical, 16 major, 17 minor, 5 trivial), each reproduced by an automated test. The full defect log with reproduction steps and suggested fixes is part of the course report.

**Security and privacy**
- Study routes (`/studies`) and the AI proxy routes accept requests without authentication (BUG-01, BUG-06).
- `/spine/config` and `/p2vg/config` return the AI service API key to anonymous callers (BUG-02).
- The DICOM file route allows path traversal against the AI server (BUG-09).
- Opening a study folder immediately uploads the whole study, headers included, to the AI report service without any user action (BUG-26).
- Image uploads are held entirely in memory with a 2000 × 100 MB limit, enabling unauthenticated memory exhaustion (BUG-36).
- Hard-coded personal sample data is printed on every result sheet (BUG-41). The report names only the affected fields, never the values.
- Missing security headers and permissive CORS defaults (BUG-31 to BUG-35).

**Report workflow**
- Edited reports are never persisted despite the "Auto-save" label (BUG-40).
- AI failures are not surfaced to the user (BUG-37, BUG-38).
- The report request omits the RSNA results it is supposed to use (BUG-39).

**Viewer**
- After cine playback the image shown no longer matches the slice number in the title (BUG-22).
- Wide grid cells crop the image, e.g. only 55% visible in a 2 × 1 layout (BUG-24).
- AI findings can be matched to the wrong series and drawn on it (BUG-28).
- Series are grouped by folder name instead of SeriesInstanceUID, and DICOM files without a `.dcm` extension are skipped (BUG-27, BUG-29).

**Working as specified:** the admin authorization matrix (52 of 52 cells), all geometry and measurement calculations, invert / rotate / flip in all 16 combinations, hospital, department and account management flows, and backend handling of upstream errors.

---

## 5. Repository layout

```
SpineInsight-testing/
├── sut.config.cjs                Resolves the SUT location from SUT_DIR (.env)
├── jest.config.js                Backend tests (rootDir = SUT backend, so Istanbul can instrument it)
├── jest.stryker.config.js        Reduced Jest config for backend mutation testing
├── vitest.config.mjs             Frontend unit tests (alias @ = SUT frontend/src)
├── vitest.stryker.config.mjs     Reduced Vitest config for frontend mutation testing
├── stryker.config.mjs            Backend mutation testing
├── stryker.frontend.config.mjs   Frontend mutation testing
├── scripts/
│   ├── run-jest.cjs, run-stryker.cjs, run-stryker-frontend.cjs
│   └── deidentify.py, dicom_leakcheck.py     DICOM de-identification and leak check
├── tests/
│   ├── support/backend/          Environment setup, Supabase query-builder mock, dotenv stub
│   ├── unit/backend/             Utils, mappers, middlewares, services, property tests
│   ├── unit/frontend/            Login redirect, image rendering, AI domain logic, DICOM folder loading
│   ├── unit/spatial/             Measurements and DICOM coordinates (incl. oblique planes), property tests
│   ├── api/supertest/            Route groups and the authorization matrix
│   ├── api/mocks/                Role-based fake tokens
│   ├── e2e/                      Runner, Page Objects, specs (login, viewer, workflow, admin), mock servers
│   └── non-functional/
│       ├── support/              Real backend + mock Supabase/AI harness, k6/ZAP download helpers
│       ├── performance/          k6 scripts (API load, uploads) and runner
│       └── security/             ZAP plans, OpenAPI spec (39 endpoints), triage, SEC-01…09 checks
├── .github/workflows/test.yml    CI
├── reports/                      Generated reports (git-ignored)
└── .tools/                       Downloaded k6 / ZAP (git-ignored)
```

---

## 6. Getting started

### Prerequisites

- Node.js 22 or newer and npm
- Google Chrome (end-to-end tests)
- Java 17 or newer (OWASP ZAP)
- Python 3 with `pydicom`, only if you need to de-identify a DICOM study
- A local checkout of the SUT at commit `38ee7f1`, with `npm install` run in its `backend` and `frontend` folders

### Setup

Commands are written for **Windows Command Prompt**. PowerShell may block `npm.ps1` because of its script execution policy.

```bat
cd /d F:\2026-2027\HKI\SpineInsight-testing
copy .env.example .env
rem edit .env: SUT_DIR=<path to the SUT checkout>, DICOM_TEST_DIR=<de-identified study, optional>
npm install
```

### Running the suites

| Command | What it does | Duration | Output |
|---|---|---|---|
| `npm run test:backend:cov` | Backend unit + API tests with Istanbul coverage | seconds | `reports/coverage/backend` |
| `npm run test:frontend:cov` | Frontend unit + property tests with coverage | < 1 s | `reports/coverage/frontend` |
| `npm run test:mutation` | StrykerJS on backend utils, mappers, middlewares | ~15 s | `reports/mutation` |
| `npm run test:mutation:frontend` | StrykerJS + Vitest on frontend geometry, rendering and domain modules | ~6 min | `reports/mutation-frontend` |
| `npm run test:e2e` | Starts the SUT frontend (Vite) and mock servers, runs Selenium | ~10 min | `reports/e2e/screenshots` |
| `npm run test:perf` | Real backend + mocks on 127.0.0.1, k6 load and upload scenarios | ~4.5 min | `reports/performance` |
| `npm run test:security` | Three OWASP ZAP scans + reproducible security checks | ~20 min | `reports/security` |

Mutation testing runs StrykerJS in place: SUT files are mutated during the run and restored afterwards. Check `git status` in the SUT if a run is interrupted.

### Optional environment variables

Set them in `.env` or inline, e.g. `set E2E_SPEC=viewer&& npm run test:e2e` (no space before `&&`).

| Variable | Purpose |
|---|---|
| `SUT_DIR` | Path to the SUT checkout (required locally; defaults to `./sut`) |
| `DICOM_TEST_DIR` | De-identified study for the viewer and workflow E2E suites; if empty those suites are skipped |
| `E2E_SPEC` | Run one E2E group: `login`, `viewer`, `workflow` or `admin` |
| `E2E_GREP` | Run only scenarios whose name matches, e.g. `E2E-30` |
| `E2E_HEADED` | `1` to watch the browser instead of running headless |
| `SECURITY_SKIP_ZAP` | `1` to skip the ZAP scans and run only the reproducible checks |
| `K6_BIN`, `ZAP_DIR` | Use an existing k6 binary or ZAP installation instead of downloading into `.tools/` |

---

## 7. Continuous integration

[`.github/workflows/test.yml`](.github/workflows/test.yml) runs on every push and pull request:

- clones the SUT from its GitLab mirror (`lumbar-spine/spineinsight_ai`) into `./sut` and checks out commit `38ee7f1`;
- runs the backend and frontend suites with coverage on Ubuntu with Node.js 22 and uploads the reports as artifacts;
- runs backend mutation testing on manual dispatch (`mutation = true`).

If the GitLab project is private, define the secrets `SUT_GITLAB_USER` and `SUT_GITLAB_TOKEN` (a deploy token with the `read_repository` scope). End-to-end, performance and security suites run locally only: they need the de-identified study, which never leaves the local machine, and long-running external tools.

---

## 8. Conventions

| Type | Format | Example |
|---|---|---|
| Backend unit test | `UT-<module>-<n>`; `R1`…`R6` for the `requireAuth` decision table | `UT-REQ-09`, `UT-AS-21` |
| API test | `IT-<group>-<n>` | `IT-RBAC-15` |
| Frontend test | `FE-UT-<n>`, `FE-PBT-<n>` | `FE-UT-55` |
| End-to-end scenario | `E2E-<n>` | `E2E-45` |
| Performance scenario | `PERF-<n>` | `PERF-05` |
| Security check | `SEC-<n>` | `SEC-08` |
| Defect | `BUG-<n>` | `BUG-09` |

Defect severity: **Critical** (patient data exposure, system unusable), **Major** (main function wrong or authorization violated), **Minor** (secondary function wrong, workaround exists), **Trivial** (latent, no current impact).

---

## 9. Medical data policy

- No identifiable patient data is stored in this repository. Unit and API tests use synthetic accounts, AI responses and DICOM bytes.
- The viewer and workflow E2E suites use one real lumbar spine MRI study that was **de-identified** before use (DICOM PS3.15 basic profile subset: names, IDs, birth date, institution, physicians and accession number removed; all UIDs replaced; private tags dropped; dates fixed). Use was permitted for coursework.
- The de-identified study lives **outside** the repository and is referenced through `DICOM_TEST_DIR`. Neither DICOM files nor `.env` files are ever committed.
- To prepare another study:

```bat
python scripts\deidentify.py <original study folder> <output folder> CASE01
python scripts\dicom_leakcheck.py <original study folder> <output folder>
```

`dicom_leakcheck.py` scans every byte of the copy for the original identifiers and prints only counts, never values. Also check visually that no text is burned into the pixels.

---

## 10. References

- ISTQB, *Certified Tester Foundation Level Syllabus*, v4.0, 2023.
- ISO/IEC/IEEE 29119-3:2021 and 29119-4:2021, *Software testing: test documentation; test techniques*.
- ISO/IEC 25010:2011, *Systems and software quality models*.
- NEMA, *Digital Imaging and Communications in Medicine (DICOM)*, PS3.3 and PS3.15.
- Official documentation of Jest, Supertest, Vitest, fast-check, StrykerJS, Selenium WebDriver, k6 and OWASP ZAP.
