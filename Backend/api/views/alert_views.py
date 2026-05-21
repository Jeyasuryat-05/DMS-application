import threading, traceback
from datetime import datetime, timedelta, date as _date
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.response import Response

from api.models import Document, AlertLog, AlertRecipient, AlertConfig, AuditLog, User
from api.authentication import require_read, require_edit

_IST = timedelta(hours=5, minutes=30)


def _now_ist():
    return datetime.utcnow() + _IST


def _today_ist():
    return _now_ist().date()


def _ist_day_utc_start(d: _date):
    return datetime(d.year, d.month, d.day) - _IST


def _get_lead_days(doc):
    try:
        cfg = doc.doc_type.alertconfig
        if cfg and cfg.enabled:
            return [int(x.strip()) for x in cfg.lead_days.split(',') if x.strip()]
    except Exception:
        pass
    return [30, 15, 7]


def _collect_recipients(doc):
    seen_ids = set()
    recipients = []

    def add(user):
        if user and user.is_active and user.id not in seen_ids:
            seen_ids.add(user.id)
            recipients.append(user)

    try:
        cfg = doc.doc_type.alertconfig
    except Exception:
        cfg = None

    if not cfg or cfg.notify_author:
        add(doc.creator)
    add(doc.responsible_person)

    if cfg and cfg.notify_roles:
        for role in [r.strip() for r in cfg.notify_roles.split(',') if r.strip()]:
            for u in User.objects.filter(role=role, is_active=True):
                add(u)

    return recipients


def _already_alerted_today(doc_id, alert_type):
    today_ist = _today_ist()
    utc_start = _ist_day_utc_start(today_ist)
    return AlertLog.objects.filter(
        document_id=doc_id,
        alert_type=alert_type,
        status='Sent',
        sent_at__gte=utc_start,
    ).exists()


def _send_alert(doc, alert_type, days_left, recipients):
    if _already_alerted_today(doc.id, alert_type):
        return
    log = AlertLog.objects.create(
        document_id=doc.id,
        alert_type=alert_type,
        status='Pending',
    )
    for user in recipients:
        AlertRecipient.objects.create(
            alert_log_id=log.id,
            user_id=user.id,
            email=user.email or '',
            delivered=True,
        )
    log.status = 'Sent'
    log.save(update_fields=['status'])


def run_expiry_alert_job():
    try:
        now_ist = _now_ist()
        docs = Document.objects.filter(
            expiry_date__isnull=False,
            is_deleted=False,
        ).exclude(status='Archived').select_related('doc_type', 'creator', 'responsible_person')

        for doc in docs:
            if doc.renewal_date and doc.renewal_date > now_ist:
                continue
            if not doc.expiry_date:
                continue
            days_left = (doc.expiry_date.date() - now_ist.date()).days
            lead_days = _get_lead_days(doc)
            recipients = _collect_recipients(doc)

            if days_left in lead_days:
                _send_alert(doc, f'{days_left}_DAYS', days_left, recipients)
            elif days_left == 0:
                _send_alert(doc, 'EXPIRED', 0, recipients)
                if doc.status != 'Expired':
                    doc.status = 'Expired'
                    doc.save(update_fields=['status'])
            elif days_left < 0:
                if doc.status != 'Expired':
                    doc.status = 'Expired'
                    doc.save(update_fields=['status'])
                    AuditLog.objects.create(
                        document_id=doc.id, user_id=None,
                        action='Auto-Expired by System',
                        note=f'Expiry date was {doc.expiry_date.date()}',
                    )
    except Exception:
        print('Alert job error:', traceback.format_exc())


@api_view(['POST'])
def trigger_alert_job(request):
    t = threading.Thread(target=run_expiry_alert_job, daemon=True)
    t.start()
    return Response({'message': 'Alert job triggered in background'})


@api_view(['GET'])
@require_read
def get_alert_logs(request):
    doc_id = request.query_params.get('doc_id')
    skip = int(request.query_params.get('skip', 0))
    limit = int(request.query_params.get('limit', 100))
    q = AlertLog.objects.all()
    if doc_id:
        q = q.filter(document_id=int(doc_id))
    logs = q.order_by('-sent_at')[skip:skip + limit]
    return Response([
        {
            'id': l.id, 'document_id': l.document_id, 'alert_type': l.alert_type,
            'status': l.status, 'sent_at': l.sent_at.isoformat() + 'Z' if l.sent_at else None,
            'error_msg': l.error_msg,
        }
        for l in logs
    ])


@api_view(['GET'])
@require_read
def get_alert_configs(request):
    configs = AlertConfig.objects.select_related('doc_type').all()
    return Response([
        {
            'id': c.id, 'doc_type_id': c.doc_type_id,
            'doc_type_name': c.doc_type.name if c.doc_type else '',
            'enabled': c.enabled, 'lead_days': c.lead_days,
            'notify_author': c.notify_author, 'notify_roles': c.notify_roles,
        }
        for c in configs
    ])


@api_view(['PUT'])
@parser_classes([JSONParser])
@require_edit
def update_alert_config(request, doc_type_id):
    cfg, _ = AlertConfig.objects.get_or_create(doc_type_id=doc_type_id)
    data = request.data
    for k, v in data.items():
        if hasattr(cfg, k):
            setattr(cfg, k, v)
    cfg.save()
    return Response({'message': 'Alert config updated'})


@api_view(['GET'])
@require_read
def upcoming_expirations(request):
    days = int(request.query_params.get('days', 90))
    now_ist = _now_ist()
    cutoff = now_ist + timedelta(days=days)
    docs = Document.objects.filter(
        expiry_date__isnull=False,
        expiry_date__lte=cutoff,
        expiry_date__gte=now_ist,
        is_deleted=False,
    ).select_related('doc_type').order_by('expiry_date')

    result = []
    for doc in docs:
        days_left = (doc.expiry_date.date() - now_ist.date()).days
        lead_days = _get_lead_days(doc)
        result.append({
            'id': doc.id, 'doc_number': doc.doc_number,
            'title': doc.title, 'project': doc.project,
            'doc_type': doc.doc_type.name if doc.doc_type else '—',
            'status': doc.status,
            'expiry_date': doc.expiry_date.isoformat() + 'Z' if doc.expiry_date else None,
            'days_left': days_left,
            'alert_thresholds': lead_days,
            'alert_level': 'critical' if days_left <= 7 else 'warning' if days_left <= 30 else 'info',
        })
    return Response(result)
