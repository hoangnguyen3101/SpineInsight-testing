"""Tạo bản sao ẩn danh của một ca DICOM (tập con hồ sơ cơ bản DICOM PS3.15 Annex E).

Bản gốc không bị sửa. Không in bất kỳ giá trị định danh nào ra màn hình.
Cách dùng: python deidentify.py <thư mục nguồn> <thư mục đích> <mã ca>
"""
import sys
from pathlib import Path

import pydicom
from pydicom.uid import generate_uid

SRC, DST, CASE = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
FIXED_DATE = '20250101'
STANDARD_UID_ROOT = '1.2.840.10008.'

# Trường cần xoá trắng (ngoài các trường PN và ngày tháng được xử lý theo VR).
BLANK = [
    'PatientID', 'OtherPatientIDs', 'OtherPatientIDsSequence', 'PatientAddress', 'PatientTelephoneNumbers',
    'PatientMotherBirthName', 'MilitaryRank', 'EthnicGroup', 'PatientComments', 'MedicalRecordLocator',
    'InstitutionName', 'InstitutionAddress', 'InstitutionalDepartmentName', 'StationName', 'DeviceSerialNumber',
    'AccessionNumber', 'StudyID', 'RequestingService', 'RequestedProcedureID', 'ScheduledProcedureStepID',
    'PerformedProcedureStepID', 'AdmissionID', 'IssuerOfPatientID', 'PatientInsurancePlanCodeSequence',
    'ReferencedPatientSequence', 'ReferencedStudySequence', 'RequestAttributesSequence',
    'ProtocolName', 'StudyDescription', 'ImageComments', 'AdditionalPatientHistory', 'Occupation',
]

uid_map = {}


def new_uid(old):
    if old not in uid_map:
        uid_map[old] = generate_uid()
    return uid_map[old]


def scrub(ds):
    ds.remove_private_tags()
    for group in range(0x6000, 0x6020, 2):  # overlay có thể chứa chữ in sẵn
        for tag in [t for t in ds.keys() if t.group == group]:
            del ds[tag]

    def visit(dataset, elem):
        if elem.VR == 'PN':
            elem.value = ''
        elif elem.VR == 'DA' and elem.value:
            elem.value = FIXED_DATE
        elif elem.VR == 'DT' and elem.value:
            elem.value = FIXED_DATE + '000000'
        elif elem.VR == 'UI' and elem.value:
            values = elem.value if elem.VM > 1 else [elem.value]
            mapped = [v if str(v).startswith(STANDARD_UID_ROOT) else new_uid(str(v)) for v in values]
            elem.value = mapped if elem.VM > 1 else mapped[0]

    ds.walk(visit)
    for keyword in BLANK:
        if keyword in ds:
            elem = ds.data_element(keyword)
            if elem.VR == 'SQ':
                del ds[elem.tag]
            else:
                elem.value = ''
    ds.PatientName = f'ANONYMOUS^{CASE}'
    ds.PatientID = CASE
    ds.PatientBirthDate = ''
    ds.PatientIdentityRemoved = 'YES'
    ds.DeidentificationMethod = 'DICOM PS3.15 Basic Profile (subset), coursework testing'


def main():
    files = sorted(p for p in SRC.rglob('*') if p.is_file())
    series_dirs = {}
    written = 0
    for path in files:
        ds = pydicom.dcmread(path)
        series_uid = str(ds.SeriesInstanceUID)
        if series_uid not in series_dirs:
            desc = ''.join(c if c.isalnum() else '_' for c in str(ds.get('SeriesDescription', 'series'))).strip('_')
            series_dirs[series_uid] = f'S{len(series_dirs) + 1}_{desc}'
        scrub(ds)
        ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
        number = int(ds.get('InstanceNumber', written + 1))
        out = DST / CASE / series_dirs[series_uid] / f'IM{number:04d}.dcm'
        out.parent.mkdir(parents=True, exist_ok=True)
        ds.save_as(out, enforce_file_format=True)
        written += 1
    print(f'Đã ghi {written} tệp vào {DST / CASE}; {len(series_dirs)} series; {len(uid_map)} UID được thay mới')
    for name in series_dirs.values():
        print('  ', name, len(list((DST / CASE / name).glob('*.dcm'))), 'ảnh')


if __name__ == '__main__':
    main()
