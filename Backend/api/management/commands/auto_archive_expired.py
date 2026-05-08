"""
Management command: auto_archive_expired
Moves any Released document past its expiry_date into Archived (Obsolete).

Run daily (cron / Windows Task Scheduler):
    python manage.py auto_archive_expired
"""
import logging
from datetime import date, datetime

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Document, AuditLog

logger = logging.getLogger('api')


def auto_archive_run():
    """Archive every Released doc whose expiry_date is strictly before today.
    Returns (archived_count, processed_doc_numbers)."""
    today = date.today()
    qs = Document.objects.filter(
        is_deleted=False,
        status='Released',
        expiry_date__isnull=False,
    )
    archived = []
    for doc in qs:
        target = doc.expiry_date.date() if hasattr(doc.expiry_date, 'date') else doc.expiry_date
        if target >= today:
            continue
        with transaction.atomic():
            reason = (
                f'Auto-archived: expiry date {target.strftime("%d %b %Y")} '
                f'reached on {today.strftime("%d %b %Y")}.'
            )
            doc.status = 'Archived'
            doc.status_code = '90'
            doc.obsolete_reason = reason
            doc.archived_at = datetime.utcnow()
            doc.archived_by_id = None  # system-archived
            doc.save(update_fields=[
                'status', 'status_code', 'obsolete_reason',
                'archived_at', 'archived_by',
            ])
            AuditLog.objects.create(
                document_id=doc.id,
                user_id=None,
                action='Auto-Archived (Expired)',
                note=reason,
            )
            archived.append(doc.doc_number or str(doc.id))
            logger.info('Auto-archived expired doc %s', doc.doc_number)
    return len(archived), archived


class Command(BaseCommand):
    help = 'Archive Released documents that have passed their expiry date'

    def handle(self, *args, **options):
        count, numbers = auto_archive_run()
        if count:
            self.stdout.write(self.style.SUCCESS(
                f'auto_archive_expired: {count} document(s) archived: {", ".join(numbers)}'
            ))
        else:
            self.stdout.write('auto_archive_expired: no documents needed archiving today.')
        logger.info('auto_archive_expired complete: %d archived', count)
