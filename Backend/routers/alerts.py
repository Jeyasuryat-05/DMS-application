"""
alerts.py — FS E_EM_DMS_03: Alert on Expiry of Document

Background job logic + manual trigger endpoints.
Job: runs daily, checks all active docs with expiry_date set.
For each doc, calculates remaining days.
If remaining days match configured lead_days (30/15/7 by default), fires alert.
Alerts also fire on actual expiry (0 days).
Renewed/revised docs stop receiving alerts.

Recipients:
  - Document Author (creator)
  - Responsible Person
  - Role-based users (configurable per doc type)
  Duplicates filtered, inactive users excluded.
"""

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime, timedelta
from typing import List

from database import get_db, SessionLocal
from routers.auth import get_current_user
import models, schemas

router = APIRouter()


# ─── Core alert engine ────────────────────────────────────────────────────────

def _get_lead_days(doc: models.Document, db: Session) -> List[int]:
    """Return configured lead days for the doc's type."""
    cfg = doc.doc_type.alert_config if doc.doc_type else None
    if cfg and cfg.enabled:
        try:
            return [int(d.strip()) for d in cfg.lead_days.split(",") if d.strip()]
        except:
            pass
    return [30, 15, 7]


def _collect_recipients(doc: models.Document, db: Session) -> List[models.User]:
    """Collect unique, active recipients for a document's alert."""
    seen_ids = set()
    recipients = []

    def add(user):
        if user and user.is_active and user.id not in seen_ids:
            seen_ids.add(user.id)
            recipients.append(user)

    cfg = doc.doc_type.alert_config if doc.doc_type else None

    # Author
    if not cfg or cfg.notify_author:
        add(doc.creator)

    # Responsible person
    add(doc.responsible_person)

    # Role-based
    if cfg and cfg.notify_roles:
        for role in [r.strip() for r in cfg.notify_roles.split(",") if r.strip()]:
            role_users = db.query(models.User).filter(
                models.User.role == role,
                models.User.is_active == True,
            ).all()
            for u in role_users:
                add(u)

    return recipients


def _already_alerted_today(doc_id: int, alert_type: str, db: Session) -> bool:
    today = datetime.utcnow().date()
    exists = db.query(models.AlertLog).filter(
        models.AlertLog.document_id == doc_id,
        models.AlertLog.alert_type == alert_type,
        models.AlertLog.status == "Sent",
        models.AlertLog.sent_at >= datetime(today.year, today.month, today.day),
    ).first()
    return exists is not None


def _send_alert(doc: models.Document, alert_type: str, days_left: int,
                recipients: List[models.User], db: Session):
    """Create AlertLog entry + send notifications."""
    if _already_alerted_today(doc.id, alert_type, db):
        return

    log = models.AlertLog(
        document_id=doc.id,
        alert_type=alert_type,
        status="Pending",
    )
    db.add(log); db.flush()

    subject = f"[DMS Alert] Document Expiring in {days_left} days: {doc.doc_number}" \
        if days_left > 0 else f"[DMS Alert] Document EXPIRED: {doc.doc_number}"

    body = f"""
Document Number : {doc.doc_number}
Title           : {doc.title}
Document Type   : {doc.doc_type.name if doc.doc_type else '—'}
Version         : {doc.current_version}
Expiry Date     : {doc.expiry_date.strftime('%d-%b-%Y') if doc.expiry_date else '—'}
Days Remaining  : {days_left if days_left > 0 else 'EXPIRED'}

Please take necessary action (renew/revise the document) to avoid compliance issues.
"""
    for user in recipients:
        db.add(models.AlertRecipient(
            alert_log_id=log.id,
            user_id=user.id,
            email=user.email or "",
            delivered=True,   # TODO: actual email integration
        ))
        # TODO: send email via SMTP / SAP Inbox
        # send_email(user.email, subject, body)

    log.status = "Sent"
    db.commit()


def run_expiry_alert_job():
    """
    Daily background job. Call from scheduler (APScheduler / Celery).
    Checks all active, non-renewed, non-expired docs with expiry_date set.
    """
    db = SessionLocal()
    try:
        today = datetime.utcnow()
        docs = db.query(models.Document).filter(
            models.Document.expiry_date != None,
            models.Document.is_deleted == False,
            models.Document.status != "Archived",
        ).all()

        for doc in docs:
            # Skip if document has been renewed
            if doc.renewal_date and doc.renewal_date > today:
                continue
            if not doc.expiry_date:
                continue

            days_left = (doc.expiry_date.date() - today.date()).days
            lead_days = _get_lead_days(doc, db)
            recipients = _collect_recipients(doc, db)

            if days_left in lead_days:
                _send_alert(doc, f"{days_left}_DAYS", days_left, recipients, db)
            elif days_left == 0:
                _send_alert(doc, "EXPIRED", 0, recipients, db)
                # Mark document as Expired
                if doc.status != "Expired":
                    doc.status = "Expired"
                    db.commit()
            elif days_left < 0:
                # Already expired
                if doc.status != "Expired":
                    doc.status = "Expired"
                    db.add(models.AuditLog(
                        document_id=doc.id, user_id=None,
                        action="Auto-Expired by System", note=f"Expiry date was {doc.expiry_date.date()}"
                    ))
                    db.commit()
    finally:
        db.close()


# ─── API endpoints ────────────────────────────────────────────────────────────

@router.post("/run-job")
def trigger_alert_job(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Manually trigger the daily expiry alert job (admin use)."""
    background_tasks.add_task(run_expiry_alert_job)
    return {"message": "Alert job triggered in background"}


@router.get("/logs", response_model=List[schemas.AlertLogOut])
def get_alert_logs(
    doc_id: int = None,
    skip: int = 0, limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.AlertLog)
    if doc_id:
        q = q.filter(models.AlertLog.document_id == doc_id)
    return q.order_by(models.AlertLog.sent_at.desc()).offset(skip).limit(limit).all()


@router.get("/config", response_model=List[schemas.AlertConfigOut])
def get_alert_configs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.AlertConfig).all()


@router.put("/config/{doc_type_id}")
def update_alert_config(
    doc_type_id: int,
    data: schemas.AlertConfigUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    cfg = db.query(models.AlertConfig).filter(
        models.AlertConfig.doc_type_id == doc_type_id
    ).first()
    if not cfg:
        cfg = models.AlertConfig(doc_type_id=doc_type_id)
        db.add(cfg); db.flush()
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(cfg, k, v)
    db.commit()
    return {"message": "Alert config updated"}


@router.get("/upcoming")
def upcoming_expirations(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Returns docs expiring within `days` days, with alert config thresholds."""
    cutoff = datetime.utcnow() + timedelta(days=days)
    docs = db.query(models.Document).filter(
        models.Document.expiry_date != None,
        models.Document.expiry_date <= cutoff,
        models.Document.expiry_date >= datetime.utcnow(),
        models.Document.is_deleted == False,
    ).order_by(models.Document.expiry_date).all()

    result = []
    for doc in docs:
        days_left = (doc.expiry_date.date() - datetime.utcnow().date()).days
        lead_days = _get_lead_days(doc, db)
        result.append({
            "id": doc.id, "doc_number": doc.doc_number,
            "title": doc.title, "project": doc.project,
            "doc_type": doc.doc_type.name if doc.doc_type else "—",
            "status": doc.status, "expiry_date": doc.expiry_date,
            "days_left": days_left,
            "alert_thresholds": lead_days,
            "alert_level": "critical" if days_left <= 7 else "warning" if days_left <= 30 else "info",
        })
    return result
