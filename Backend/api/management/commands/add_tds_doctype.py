"""
Management command: add_tds_doctype

Adds the TDS (Technical Data Sheet) document type to an existing database
without needing a full re-seed.

Usage:
    python manage.py add_tds_doctype
"""

from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = 'Add TDS (Technical Data Sheet) document type if it does not exist'

    def handle(self, *args, **options):
        from api.models import DocumentType, DocTypeFileFormat, AlertConfig, WorkflowConfig

        if DocumentType.objects.filter(code='TDS').exists():
            self.stdout.write(self.style.WARNING('TDS document type already exists — nothing to do.'))
            return

        with transaction.atomic():
            dt = DocumentType.objects.create(
                code='TDS',
                name='Technical Data Sheet',
                auth_required=False,
                auth_code='',
                number_pattern='TDS-{YEAR}-{SEQ}',
                metadata_schema=[],
            )

            default_formats = [
                {'extension': 'pdf',  'label': 'PDF Document',      'mime_type': 'application/pdf'},
                {'extension': 'docx', 'label': 'Word Document',
                 'mime_type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
                {'extension': 'xlsx', 'label': 'Excel Spreadsheet',
                 'mime_type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
                {'extension': 'jpeg', 'label': 'JPEG Image',        'mime_type': 'image/jpeg'},
                {'extension': 'zip',  'label': 'ZIP Archive',        'mime_type': 'application/zip'},
            ]
            for f in default_formats:
                DocTypeFileFormat.objects.create(
                    doc_type=dt,
                    extension=f['extension'],
                    label=f['label'],
                    icon='',
                    mime_type=f['mime_type'],
                )

            AlertConfig.objects.create(
                doc_type=dt, enabled=True, lead_days='30,15,7',
                notify_author=True, notify_roles='',
            )

            WorkflowConfig.objects.create(
                doc_type=dt,
                levels=[
                    {'step': 1, 'name': 'Prepare', 'stage': 'Prepare', 'checklist_required': False},
                    {'step': 2, 'name': 'Check',   'stage': 'Check',   'checklist_required': False},
                    {'step': 3, 'name': 'Review',  'stage': 'Review',  'checklist_required': False},
                    {'step': 4, 'name': 'Approve', 'stage': 'Approve', 'checklist_required': False},
                ],
            )

        self.stdout.write(self.style.SUCCESS(
            f'TDS document type created (id={dt.id}) with 4-step workflow.'
        ))
