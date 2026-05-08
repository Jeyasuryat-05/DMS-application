"""
Management command: send_expiry_notifications
Checks all active documents and sends email reminders for expiry_date and revision_due.

Reminder schedule: 30 / 15 / 7 / 3 days before, and on the day itself.

Usage:
    python manage.py send_expiry_notifications
"""
import logging
from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.conf import settings

from api.models import Document, User
from api import email_utils

# Send synchronously — daemon threads are killed when the process exits
email_utils.SYNC_MODE = True

logger = logging.getLogger('api')

REMINDER_DAYS = [30, 15, 7, 3]  # days before the date to send reminders

FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')


def _doc_url(doc_id):
    return f'{FRONTEND_URL}/documents/{doc_id}'


def _send_reminder(doc, field_label, target_date, days_left):
    """Build and send one expiry/revision reminder email."""
    creator = doc.creator
    to_emails = []
    if creator and creator.email:
        to_emails.append(creator.email)

    if not to_emails:
        return

    if days_left == 0:
        urgency_color = '#A32D2D'
        urgency_label = 'TODAY'
        subject_prefix = f'[DMS] EXPIRED — {field_label}: {doc.doc_number}'
        headline = f'Document {field_label} — TODAY'
        message = (
            f'The <strong>{field_label}</strong> for this document is <strong>today ({target_date.strftime("%d %b %Y")})</strong>. '
            f'Immediate action may be required.'
        )
    elif days_left <= 3:
        urgency_color = '#A32D2D'
        urgency_label = f'{days_left} day{"s" if days_left > 1 else ""} left'
        subject_prefix = f'[DMS] URGENT — {field_label} in {days_left} day(s): {doc.doc_number}'
        headline = f'Document {field_label} in {days_left} Day{"s" if days_left > 1 else ""}'
        message = (
            f'The <strong>{field_label}</strong> for this document is in '
            f'<strong>{days_left} day{"s" if days_left > 1 else ""}</strong> '
            f'({target_date.strftime("%d %b %Y")}). Immediate action required.'
        )
    elif days_left <= 7:
        urgency_color = '#854F0B'
        urgency_label = f'{days_left} days left'
        subject_prefix = f'[DMS] Reminder — {field_label} in {days_left} days: {doc.doc_number}'
        headline = f'Document {field_label} in {days_left} Days'
        message = (
            f'The <strong>{field_label}</strong> for this document is in '
            f'<strong>{days_left} days</strong> ({target_date.strftime("%d %b %Y")}). '
            f'Please review and take the necessary action.'
        )
    else:
        urgency_color = '#185FA5'
        urgency_label = f'{days_left} days left'
        subject_prefix = f'[DMS] Reminder — {field_label} in {days_left} days: {doc.doc_number}'
        headline = f'Document {field_label} in {days_left} Days'
        message = (
            f'The <strong>{field_label}</strong> for this document is in '
            f'<strong>{days_left} days</strong> ({target_date.strftime("%d %b %Y")}). '
            f'Please plan accordingly.'
        )

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">Hello,<br><br>{message}</p>

    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;
         padding:16px 20px;margin:18px 0;">
      <table style="font-size:13px;color:#374151;width:100%;">
        <tr>
          <td style="padding:5px 0;color:#6b7280;width:140px;">{field_label}:</td>
          <td><strong style="color:{urgency_color};">
            {target_date.strftime("%d %b %Y")}
          </strong></td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#6b7280;">Days Remaining:</td>
          <td><strong style="color:{urgency_color};">{urgency_label}</strong></td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#6b7280;">Status:</td>
          <td>{doc.status}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#6b7280;">Document Type:</td>
          <td>{doc.doc_type.name if doc.doc_type else '—'}</td>
        </tr>
      </table>
    </div>

    <div style="text-align:center;margin:24px 0 8px;">
      <a href="{_doc_url(doc.id)}"
         style="background:#0C447C;color:#fff;padding:12px 32px;border-radius:8px;
                text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">
        Open Document
      </a>
    </div>"""

    # Build the full HTML using the same base shell as other notifications
    html = email_utils._html(
        title=headline,
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
    )
    # Override the action button that _html would add (already embedded above)
    email_utils._send(to_emails, subject_prefix, html)
    logger.info('Expiry reminder sent: doc=%s field=%s days=%s to=%s',
                doc.doc_number, field_label, days_left, to_emails)


class Command(BaseCommand):
    help = 'Send expiry and revision-due reminder emails for all active documents'

    def handle(self, *args, **options):
        today = date.today()
        check_days = set(REMINDER_DAYS + [0])  # 0 = on the day itself

        docs = Document.objects.filter(
            is_deleted=False
        ).exclude(
            status__in=['Released', 'Archived']
        ).select_related('creator', 'doc_type')

        sent = 0
        for doc in docs:
            for field_label, field_value in [
                ('Expiry Date',    doc.expiry_date),
                ('Revision Due',   doc.revision_due),
            ]:
                if not field_value:
                    continue
                target = field_value.date() if hasattr(field_value, 'date') else field_value
                days_left = (target - today).days
                if days_left in check_days:
                    _send_reminder(doc, field_label, target, days_left)
                    sent += 1

        self.stdout.write(self.style.SUCCESS(
            f'send_expiry_notifications: {sent} reminder(s) sent for {today}'
        ))
        logger.info('send_expiry_notifications complete: %d reminders sent', sent)
