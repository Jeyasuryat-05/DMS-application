"""
Test command for all DMS email notifications.
Usage:
    python manage.py test_notifications --email your@email.com
    python manage.py test_notifications --email your@email.com --type expiry
    python manage.py test_notifications --email your@email.com --type workflow
    python manage.py test_notifications --email your@email.com --type feedback
    python manage.py test_notifications --email your@email.com --type all
"""
from datetime import date, timedelta
from django.core.management.base import BaseCommand, CommandError
from api import email_utils

# Send synchronously — daemon threads are killed when the process exits
email_utils.SYNC_MODE = True


class FakeDoc:
    """Minimal doc object for testing."""
    def __init__(self):
        self.id          = 1
        self.doc_number  = 'DRW/180000/12345/0001'
        self.title       = 'Test Drawing — Pump Assembly'
        self.status      = 'In Check'
        self.expiry_date = date.today() + timedelta(days=7)
        self.revision_due = date.today() + timedelta(days=30)

        class DocType:
            name = 'Drawing'
        self.doc_type = DocType()

        class Creator:
            id    = 0
            name  = 'Test Creator'
            email = None  # set at runtime
        self.creator = Creator()


class FakeUser:
    def __init__(self, name, email):
        self.id    = 99
        self.name  = name
        self.email = email


class Command(BaseCommand):
    help = 'Send test emails for all notification types to a given address'

    def add_arguments(self, parser):
        parser.add_argument('--email', required=True, help='Recipient email address for test')
        parser.add_argument(
            '--type',
            default='all',
            choices=['all', 'expiry', 'workflow', 'feedback'],
            help='Which notification type to test',
        )

    def handle(self, *args, **options):
        to_email = options['email']
        ntype    = options['type']

        doc = FakeDoc()
        doc.creator.email = to_email
        user = FakeUser('Test User', to_email)

        self.stdout.write(f'Sending test notifications to: {to_email}')

        if ntype in ('all', 'expiry'):
            self.stdout.write('  -> Expiry reminder (7 days)')
            from api.management.commands.send_expiry_notifications import _send_reminder
            _send_reminder(doc, 'Expiry Date',  date.today() + timedelta(days=7),  7)
            _send_reminder(doc, 'Expiry Date',  date.today() + timedelta(days=3),  3)
            _send_reminder(doc, 'Expiry Date',  date.today(),                       0)
            _send_reminder(doc, 'Revision Due', date.today() + timedelta(days=15), 15)
            _send_reminder(doc, 'Revision Due', date.today() + timedelta(days=30), 30)
            self.stdout.write(self.style.SUCCESS('  OK Expiry reminders sent (7d / 3d / 0d / 15d / 30d)'))

        if ntype in ('all', 'workflow'):
            self.stdout.write('  -> Workflow assigned')
            email_utils.notify_workflow_assigned(doc, 'Check', [user], 'Admin User')

            self.stdout.write('  -> Level approved, next assignee')
            email_utils.notify_approved(doc, 'Admin User', 'Review', [user])

            self.stdout.write('  -> Document released')
            email_utils.notify_released(doc, 'Admin User', doc.creator)

            self.stdout.write('  -> Document rejected')
            email_utils.notify_rejected(doc, 'Admin User', 'Check', 'Missing reference drawings', doc.creator)

            self.stdout.write('  -> Document returned for correction')
            email_utils.notify_returned(doc, 'Admin User', 'Please fix the title block', doc.creator)

            self.stdout.write(self.style.SUCCESS('  OK Workflow notifications sent'))

        if ntype in ('all', 'feedback'):
            self.stdout.write('  -> Feedback requested')
            email_utils.notify_feedback_requested(doc, 'Admin User', 'Please review section 3.2', user)

            self.stdout.write('  -> Feedback added')
            email_utils.notify_feedback_added(doc, 'Reviewer Name', 'The dimension on page 4 looks incorrect', doc.creator)

            self.stdout.write(self.style.SUCCESS('  OK Feedback notifications sent'))

        self.stdout.write(self.style.SUCCESS(f'\nDone. Check {to_email} (or console output if EMAIL_BACKEND=console).'))
