"""
Management command: update_doc_types
Updates DocumentType codes, names, metadata schemas and workflow configs
to match the new 42-doc-type schema from the Excel without deleting documents.

Usage:
    python manage.py update_doc_types
    python manage.py update_doc_types --dry-run
"""
from django.core.management.base import BaseCommand
from django.db import transaction


OLD_TO_NEW = {
    'ADDM': 'ZAD',
    'AERB': 'AER',
    'ABD':  'ZBD',
    'DICS': 'ZIC',
    'DPROC':'ZDP',
    'DOC':  'ZDO',
    'ESSG': 'ZES',
    'FBK':  'ZFB',
    'INDEB':'IEB',
    'KM':   'ZKM',
    'PHWR': 'PPD',
    'PROC': 'PRO',
    'PO':   'ZPO',
    'RDES': 'R&D',
    'SITE': 'ZSD',
    'TECH': 'ZTE',
    'TA':   'ZTA',
    'TSPEC':'ZTS',
    'TMPL': 'TEM',
    'VE':   'ZVE',
    'WA':   'ZWA',
    # LOT variants collapse to single LOT
    'LOTFI':'LOT',
    'LOTK': 'LOT',
    'LOTM': 'LOT',
    # codes that keep the same code
    'CDC':  'CDC',
    'DCN':  'DCN',
    'DCQ':  'DCQ',
    'DCR':  'DCR',
    'DRW':  'DRW',
    'ECN':  'ECN',
    'FCN':  'FCN',
    'FCR':  'FCR',
    'GEN':  'GEN',
    'HSE':  'HSE',
    'IQP':  'IQP',
    'ITE':  'ITE',
    'LOT':  'LOT',
    'NCR':  'NCR',
    'PRD':  'PRD',
    'QAD':  'QAD',
    'QSR':  'QSR',
    'REQ':  'REQ',
    'RSA':  'RSA',
    'SRD':  'SRD',
    'SQA':  'SQA',
}

NEW_NAMES = {
    'ZAD': 'Addendum',
    'AER': 'AERB',
    'ZBD': 'As Built Drawing',
    'CDC': 'CDC',
    'DCN': 'DCN',
    'DCQ': 'DCQ',
    'DCR': 'Design Concession Request-DCR',
    'ZIC': 'Digital I&C System',
    'ZDP': 'Directorate Procedures',
    'ZDO': 'Document',
    'DRW': 'Drawing',
    'ECN': 'ECN',
    'ZES': 'ESSG',
    'FCN': 'FCN',
    'ZFB': 'Feedback',
    'FCR': 'Field Change Proposal or Field Change Request',
    'GEN': 'General',
    'HSE': 'HSE',
    'IEB': 'Indent-EB',
    'IQP': 'Inspection Quality Plan',
    'ITE': 'Inspection Testing of Equipment',
    'ZKM': 'Knowledge Management',
    'LOT': 'Letter of Transmittal',
    'NCR': 'Non-Conformance Report',
    'PPD': 'PHWR Project Document',
    'PRD': 'Print Request for Drawing',
    'PRO': 'Procurement',
    'ZPO': 'Purchase Orders',
    'QAD': 'QA Document',
    'QSR': 'QS Requisition',
    'R&D': 'R&DES',
    'REQ': 'Requisition',
    'RSA': 'RSA',
    'SRD': 'Safety Related Deficiency',
    'ZSD': 'Site Documents',
    'SQA': 'SQA',
    'ZTE': 'Technical',
    'ZTA': 'Technical Authorization',
    'ZTS': 'Technical Specification',
    'TEM': 'TEMPLATEHOLDER',
    'ZVE': 'Vendor Evaluation',
    'ZWA': 'Work Authorization',
}


def _wf(*names):
    return [{'step': i, 'name': n, 'stage': n, 'checklist_required': False}
            for i, n in enumerate(names, 1)]

WORKFLOW_MAP = {
    'ZBD': _wf('Prepared', 'Design Check', 'Concur with Design', 'Review', 'Approve'),
    'DRW': _wf('Drawn', 'Drawing Check', 'Designed', 'Design Check', 'Review', 'Approve'),
    'DCN': _wf('Prepared', 'Design Check', 'Concurred with DC&CW Group', 'Concurred with Design', 'Review', 'Approve'),
    'ECN': _wf('Drawn', 'Design', 'Checked', 'Reviewed', 'IndReview', 'Approve'),
    'FCN': _wf('Prepared', 'Drawing Check', 'Drawing Review', 'Design Check', 'Design Review', 'Concurred with Design', 'Approve'),
    'CDC': _wf('Prepare', 'Check', 'Approve'),
    'ZTA': _wf('Prepare', 'Review', 'Approve by ED'),
    'ZSD': _wf('Prepare', 'Check', 'Approve'),
    'QSR': _wf('Prepare', 'Approve'),
    'ZTE': _wf('Prepare', 'Check', 'Review', 'Approve'),
    'ZTS': _wf('Prepare', 'Check', 'Review', 'Approve'),
    'HSE': _wf('Prepare', 'Check', 'Approve'),
}
DEFAULT_WF = _wf('Prepare', 'Check', 'Review', 'Approve')


class Command(BaseCommand):
    help = 'Update DocumentType codes/names/schemas to new 42-doc-type set'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Show what would change without writing')

    def handle(self, *args, **options):
        dry = options['dry_run']

        from api.models import DocumentType, WorkflowConfig, DocTypeFileFormat, AlertConfig
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
        try:
            from metadata_schemas_data import METADATA_SCHEMAS
        except Exception as e:
            self.stderr.write(f'ERROR loading metadata_schemas_data: {e}')
            return

        ZBD_FMTS = [
            {'extension': 'dwg', 'label': 'AutoCAD Drawing', 'icon': '', 'mime_type': 'image/vnd.dwg'},
            {'extension': 'pdf', 'label': 'PDF Document',    'icon': '', 'mime_type': 'application/pdf'},
        ]
        DRW_FMTS = [
            {'extension': 'dwg',  'label': 'AutoCAD Drawing', 'icon': '', 'mime_type': 'image/vnd.dwg'},
            {'extension': 'dxf',  'label': 'DXF Drawing',     'icon': '', 'mime_type': 'image/vnd.dxf'},
            {'extension': 'pdf',  'label': 'PDF Document',    'icon': '', 'mime_type': 'application/pdf'},
            {'extension': 'tiff', 'label': 'TIFF Image',      'icon': '', 'mime_type': 'image/tiff'},
            {'extension': 'dgn',  'label': 'MicroStation',    'icon': '', 'mime_type': 'application/octet-stream'},
        ]
        DEFAULT_FMTS = [
            {'extension': 'pdf',  'label': 'PDF Document',      'icon': '', 'mime_type': 'application/pdf'},
            {'extension': 'docx', 'label': 'Word Document',     'icon': '', 'mime_type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
            {'extension': 'xlsx', 'label': 'Excel Spreadsheet', 'icon': '', 'mime_type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
            {'extension': 'jpeg', 'label': 'JPEG Image',        'icon': '', 'mime_type': 'image/jpeg'},
            {'extension': 'zip',  'label': 'ZIP Archive',       'icon': '', 'mime_type': 'application/zip'},
        ]
        FMT_MAP = {'DRW': DRW_FMTS, 'ZBD': ZBD_FMTS}

        existing = {dt.code: dt for dt in DocumentType.objects.all()}
        self.stdout.write(f'Existing doc types in DB: {len(existing)} - {sorted(existing.keys())}')

        # Codes that need renaming old->new
        renames = {old: new for old, new in OLD_TO_NEW.items() if old != new and old in existing}
        # LOT variants: keep the first LOT encountered, delete duplicates
        lot_dupes = [c for c in ('LOTFI', 'LOTK', 'LOTM') if c in existing and 'LOT' in existing]

        if dry:
            self.stdout.write('\n[DRY RUN] Would rename:')
            for old, new in renames.items():
                self.stdout.write(f'  {old} -> {new}')
            self.stdout.write(f'\n[DRY RUN] Would delete LOT duplicates: {lot_dupes}')
            new_codes = set(NEW_NAMES.keys())
            existing_after = (set(existing.keys()) - set(renames.keys()) - set(lot_dupes)) | set(renames.values())
            missing = new_codes - existing_after
            self.stdout.write(f'\n[DRY RUN] Would create new doc types: {sorted(missing)}')
            return

        with transaction.atomic():
            # Step 1: rename old codes -> new codes (update code + name)
            for old_code, new_code in renames.items():
                if old_code not in existing:
                    continue
                if new_code in existing:
                    # new code already exists; re-point documents from old to new, then delete old
                    from api.models import Document
                    old_dt = existing[old_code]
                    new_dt = existing[new_code]
                    Document.objects.filter(doc_type=old_dt).update(doc_type=new_dt)
                    old_dt.delete()
                    self.stdout.write(f'  Merged {old_code} -> {new_code} (moved documents)')
                else:
                    dt = existing[old_code]
                    dt.code = new_code
                    dt.name = NEW_NAMES[new_code]
                    dt.number_pattern = f'{new_code}-{{YEAR}}-{{SEQ}}'
                    dt.save(update_fields=['code', 'name', 'number_pattern'])
                    self.stdout.write(f'  Renamed {old_code} -> {new_code}')

            # Step 2: delete LOT duplicates (LOTFI, LOTK, LOTM) - move docs to LOT first
            lot_dt = DocumentType.objects.filter(code='LOT').first()
            if lot_dt:
                for dupe_code in lot_dupes:
                    try:
                        dupe = DocumentType.objects.get(code=dupe_code)
                        from api.models import Document
                        moved = Document.objects.filter(doc_type=dupe).update(doc_type=lot_dt)
                        dupe.delete()
                        self.stdout.write(f'  Deleted duplicate {dupe_code}, moved {moved} documents to LOT')
                    except DocumentType.DoesNotExist:
                        pass

            # Re-fetch after renames
            existing = {dt.code: dt for dt in DocumentType.objects.all()}

            # Step 3: create any still-missing doc types
            for new_code, name in NEW_NAMES.items():
                if new_code not in existing:
                    dt = DocumentType.objects.create(
                        code=new_code,
                        name=name,
                        auth_required=(new_code in ('DRW', 'ECN')),
                        auth_code='A1111' if new_code == 'DRW' else 'A1234' if new_code == 'ECN' else '',
                        number_pattern=f'{new_code}-{{YEAR}}-{{SEQ}}',
                        metadata_schema=METADATA_SCHEMAS.get(new_code, []),
                    )
                    AlertConfig.objects.get_or_create(
                        doc_type=dt,
                        defaults={'enabled': True, 'lead_days': '30,15,7', 'notify_author': True, 'notify_roles': ''},
                    )
                    WorkflowConfig.objects.get_or_create(
                        doc_type=dt,
                        defaults={'levels': WORKFLOW_MAP.get(new_code, DEFAULT_WF)},
                    )
                    DocTypeFileFormat.objects.filter(doc_type=dt).delete()
                    for fmt in FMT_MAP.get(new_code, DEFAULT_FMTS):
                        DocTypeFileFormat.objects.create(doc_type=dt, **fmt)
                    self.stdout.write(f'  Created new doc type: {new_code}')
                    existing[new_code] = dt

            # Step 4: update metadata schemas and workflows for all 42 doc types
            for new_code, dt in existing.items():
                if new_code not in NEW_NAMES:
                    continue
                schema = METADATA_SCHEMAS.get(new_code, [])
                wf_levels = WORKFLOW_MAP.get(new_code, DEFAULT_WF)
                changed = []
                if dt.metadata_schema != schema:
                    dt.metadata_schema = schema
                    changed.append('metadata_schema')
                if dt.name != NEW_NAMES[new_code]:
                    dt.name = NEW_NAMES[new_code]
                    changed.append('name')
                if changed:
                    dt.save(update_fields=changed)
                wf, _ = WorkflowConfig.objects.get_or_create(doc_type=dt, defaults={'levels': wf_levels})
                if not _ and wf.levels != wf_levels:
                    wf.levels = wf_levels
                    wf.save(update_fields=['levels'])
                AlertConfig.objects.get_or_create(
                    doc_type=dt,
                    defaults={'enabled': True, 'lead_days': '30,15,7', 'notify_author': True, 'notify_roles': ''},
                )
                if not DocTypeFileFormat.objects.filter(doc_type=dt).exists():
                    for fmt in FMT_MAP.get(new_code, DEFAULT_FMTS):
                        DocTypeFileFormat.objects.create(doc_type=dt, **fmt)

            final = DocumentType.objects.count()
            self.stdout.write(self.style.SUCCESS(f'\nDone. {final} document types in DB.'))
            self.stdout.write(f'Final codes: {sorted(dt.code for dt in DocumentType.objects.all())}')

