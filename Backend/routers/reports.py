from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, timedelta

from database import get_db
from routers.auth import get_current_user
import models

router = APIRouter()

# Use plain strings matching Document.status column values
STATUS_DRAFT      = "Draft"
STATUS_APPROVED   = "Approved"
STATUS_RELEASED   = "Released"
STATUS_IN_CHECK   = "In Check"
STATUS_IN_REVIEW  = "In Review"
STATUS_IN_APPROVAL= "In Approval"
STATUS_REJECTED   = "Rejected"
STATUS_ARCHIVED   = "Archived"
STATUS_EXPIRED    = "Expired"


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        total    = db.query(models.Document).filter(models.Document.is_deleted == False).count()
        approved = db.query(models.Document).filter(
            models.Document.status.in_([STATUS_APPROVED, STATUS_RELEASED]),
            models.Document.is_deleted == False
        ).count()
        in_review = db.query(models.Document).filter(
            models.Document.status.in_([STATUS_IN_CHECK, STATUS_IN_REVIEW, STATUS_IN_APPROVAL]),
            models.Document.is_deleted == False
        ).count()
        draft    = db.query(models.Document).filter(
            models.Document.status == STATUS_DRAFT,
            models.Document.is_deleted == False
        ).count()
        rejected = db.query(models.Document).filter(
            models.Document.status == STATUS_REJECTED,
            models.Document.is_deleted == False
        ).count()

        cutoff   = datetime.utcnow() + timedelta(days=90)
        expiring = db.query(models.Document).filter(
            models.Document.expiry_date != None,
            models.Document.expiry_date <= cutoff,
            models.Document.expiry_date >= datetime.utcnow(),
            models.Document.is_deleted == False,
        ).count()

        pending_wf = db.query(models.WorkflowInstance).filter(
            models.WorkflowInstance.completed == False
        ).count()

        return {
            "total_documents": total,
            "approved":        approved,
            "under_review":    in_review,
            "draft":           draft,
            "rejected":        rejected,
            "expiring_90_days": expiring,
            "pending_workflow": pending_wf,
        }
    except Exception as e:
        return {
            "total_documents": 0, "approved": 0, "under_review": 0,
            "draft": 0, "rejected": 0, "expiring_90_days": 0, "pending_workflow": 0,
        }


@router.get("/by-status")
def by_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        rows = db.query(models.Document.status, func.count(models.Document.id)).filter(
            models.Document.is_deleted == False
        ).group_by(models.Document.status).all()
        return [{"status": r[0], "count": r[1]} for r in rows]
    except Exception:
        return []


@router.get("/by-type")
def by_type(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        rows = db.query(models.DocumentType.name, func.count(models.Document.id)).join(
            models.Document, models.Document.doc_type_id == models.DocumentType.id, isouter=True
        ).filter(models.Document.is_deleted == False).group_by(models.DocumentType.name).all()
        return [{"type": r[0], "count": r[1]} for r in rows]
    except Exception:
        return []


@router.get("/by-type-status")
def by_type_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Returns document count grouped by doc-type × status for stacked/grouped charts."""
    try:
        rows = (
            db.query(
                models.DocumentType.name,
                models.Document.status,
                func.count(models.Document.id),
            )
            .join(models.Document, models.Document.doc_type_id == models.DocumentType.id)
            .filter(models.Document.is_deleted == False)
            .group_by(models.DocumentType.name, models.Document.status)
            .all()
        )
        # Pivot into [{type, Status1: n, Status2: n, ...}, ...]
        pivot = {}
        statuses = set()
        for doc_type, status, count in rows:
            statuses.add(status)
            if doc_type not in pivot:
                pivot[doc_type] = {"type": doc_type}
            pivot[doc_type][status] = count
        return {
            "data":     list(pivot.values()),
            "statuses": sorted(statuses),
        }
    except Exception:
        return {"data": [], "statuses": []}


@router.get("/expiring")
def expiring_documents(
    days: int = Query(90),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        cutoff = datetime.utcnow() + timedelta(days=days)
        docs   = db.query(models.Document).filter(
            models.Document.expiry_date != None,
            models.Document.expiry_date <= cutoff,
            models.Document.expiry_date >= datetime.utcnow(),
            models.Document.is_deleted == False,
        ).all()
        return [
            {
                "id": d.id, "doc_number": d.doc_number, "title": d.title,
                "expiry_date": d.expiry_date, "status": d.status,
                "project": d.project,
            }
            for d in docs
        ]
    except Exception:
        return []


@router.get("/audit")
def audit_report(
    doc_id: Optional[int] = None,
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    doc_type_id: Optional[int] = None,
    doc_number: Optional[str] = None,
    user_name: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        q = db.query(models.AuditLog)
        if doc_id:    q = q.filter(models.AuditLog.document_id == doc_id)
        if user_id:   q = q.filter(models.AuditLog.user_id == user_id)
        if action:    q = q.filter(models.AuditLog.action.ilike(f"%{action}%"))
        if date_from: q = q.filter(models.AuditLog.timestamp >= datetime.fromisoformat(date_from))
        if date_to:   q = q.filter(models.AuditLog.timestamp <= datetime.fromisoformat(date_to))
        if doc_type_id or doc_number:
            q = q.join(models.Document, models.AuditLog.document_id == models.Document.id, isouter=True)
            if doc_type_id:
                q = q.filter(models.Document.doc_type_id == doc_type_id)
            if doc_number:
                q = q.filter(models.Document.doc_number.ilike(f"%{doc_number}%"))
        if user_name:
            q = q.join(models.User, models.AuditLog.user_id == models.User.id, isouter=True)
            q = q.filter(models.User.name.ilike(f"%{user_name}%"))

        logs = q.order_by(models.AuditLog.timestamp.desc()).offset(skip).limit(limit).all()
        return [
            {
                "id": l.id, "action": l.action, "note": l.note,
                "timestamp": l.timestamp,
                "user": {"id": l.user.id, "name": l.user.name} if l.user else None,
                "document": {
                    "id": l.document.id,
                    "doc_number": l.document.doc_number,
                    "title": l.document.title
                } if l.document else None,
            }
            for l in logs
        ]
    except Exception:
        return []
