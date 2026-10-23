"""Dò bản ẩn danh xem còn sót chuỗi định danh của bản gốc không.

Chỉ in số tệp/đường dẫn còn chứa giá trị gốc, không in bản thân giá trị.
Cách dùng: python scripts/dicom_leakcheck.py <thư mục gốc> <thư mục bản ẩn danh>
"""
import re
import sys
from pathlib import Path

import pydicom

ORIG, ANON = Path(sys.argv[1]), Path(sys.argv[2])
first = pydicom.dcmread(next(p for p in sorted(ORIG.rglob('*')) if p.is_file()), stop_before_pixels=True)

needles = {}
for kw in ['PatientName', 'PatientID', 'PatientBirthDate', 'InstitutionName', 'ReferringPhysicianName', 'AccessionNumber', 'StudyDate']:
    value = str(first.get(kw, '') or '').strip()
    if value:
        needles[kw] = value
for i, part in enumerate(str(first.get('PatientName', '')).replace('^', ' ').split()):
    if len(part) >= 3:
        needles[f'PatientName.part{i}'] = part
folder = re.sub(r'[_-]?\d{6,8}$', '', ORIG.name)
if len(folder) >= 3:
    needles['ten_thu_muc_goc'] = folder

hits = {k: 0 for k in needles}
for path in ANON.rglob('*'):
    relative = str(path.relative_to(ANON)).lower()
    data = path.read_bytes() if path.is_file() else b''
    for k, v in needles.items():
        if v.encode('latin-1', 'ignore') in data or v.upper().encode('latin-1', 'ignore') in data or v.lower() in relative:
            hits[k] += 1
for k, n in hits.items():
    print(f'{k}: {n} tệp/đường dẫn chứa giá trị gốc')
print('KẾT LUẬN:', 'KHÔNG còn chuỗi định danh gốc' if not any(hits.values()) else 'CÒN SÓT, không được dùng bản này')
