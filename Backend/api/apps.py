import logging
from django.apps import AppConfig

logger = logging.getLogger('api')


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        import os, sys
        # Only start scheduler when running the dev server (main process) or gunicorn
        argv = sys.argv
        cmd = argv[1] if len(argv) > 1 else ''
        is_runserver = cmd == 'runserver'
        is_gunicorn  = 'gunicorn' in sys.argv[0]
        in_reloader  = os.environ.get('RUN_MAIN') == 'true'

        if (is_runserver and in_reloader) or is_gunicorn:
            _start_scheduler()


def _start_scheduler():
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from django.core.management import call_command

        scheduler = BackgroundScheduler(timezone='Asia/Kolkata')

        def run_expiry_check():
            try:
                call_command('send_expiry_notifications')
            except Exception as exc:
                logger.error('send_expiry_notifications failed: %s', exc)

        # Run every day at 08:00 IST
        scheduler.add_job(
            run_expiry_check,
            trigger=CronTrigger(hour=8, minute=0),
            id='expiry_notifications',
            replace_existing=True,
        )
        scheduler.start()
        logger.info('APScheduler started — expiry notifications scheduled daily at 08:00')
    except Exception as exc:
        logger.warning('APScheduler could not start: %s', exc)
