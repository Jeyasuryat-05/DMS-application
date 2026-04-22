from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, timedelta
import os, uuid, json, traceback

from database import get_db
from routers.auth import get_current_user
import models

router = APIRouter()

UPLOAD_DIR = "uploads"
ALLOWED_FORMATS = {
    ".pdf",".dwg",".dxf",".cad",".doc",".docx",".xls",".xlsx",
    ".ppt",".pptx",".jpg",".jpeg",".png",".tiff",".bmp",".gif",
    ".zip",".rar",".mp4",".avi",".mov",".mkv",".wmv",".svg",
    ".txt",".rtf",".csv",".xml",".json",".eml",".msg",".vsd",
    ".step",".stp",".iges",".stl",".dgn",
}


def _doc_to_dict(d):
    """Convert Document model to plain dict safely."""
    try:
        wf = d.workflow
        workflow_dict = None
        if wf:
            workflow_dict = {
                "id": wf.id,
                "mode": str(wf.mode or "Auto Populate"),
                "stage": str(wf.stage or "Prepare"),
                "current_step": int(wf.current_step or 1),
                "total_steps": int(wf.total_steps or 4),
                "completed": bool(wf.completed),
                "rejected": bool(wf.rejected),
                "rejection_reason": wf.rejection_reason,
                "started_at": wf.started_at.isoformat() if wf.started_at else None,
                "levels": [],
            }

        doc_type_dict = None
        if d.doc_type:
            doc_type_dict = {
                "id": d.doc_type.id,
                "code": d.doc_type.code or "",
                "name": d.doc_type.name or "",
                "auth_required": bool(d.doc_type.auth_required),
                "auth_code": d.doc_type.auth_code or "",
                "is_active": bool(d.doc_type.is_active),
                "allowed_formats": [],
                "number_pattern": d.doc_type.number_pattern or "",
                "metadata_schema": d.doc_type.metadata_schema if d.doc_type else [],
                "description": d.doc_type.description,
            }

        return {
            "id": d.id,
            "doc_number": d.doc_number or "",
            "serial_no": d.serial_no,
            "title": d.title or "",
            "project": d.project,
            "usi_kks_code": d.usi_kks_code,
            "current_version": d.current_version or "1.0",
            "status": d.status or "Draft",
            "status_code": d.status_code or "05",
            "confidential": bool(d.confidential),
            "checked_out": bool(d.checked_out),
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
            "expiry_date": d.expiry_date.isoformat() if d.expiry_date else None,
            "renewal_date": d.renewal_date.isoformat() if d.renewal_date else None,
            "revision_due": d.revision_due.isoformat() if d.revision_due else None,
            "tags": d.tags or [],
            "custom_metadata": d.custom_metadata or {},
            "doc_type": doc_type_dict,
            "workflow": workflow_dict,
        }
    except Exception:
        return {"id": d.id, "title": d.title or "", "status": "Draft", "doc_number": "", "current_version": "1.0"}


# ─── List / Search ─────────────────────────────────────────────────────────────

@router.get("/")
def list_documents(
    q: Optional[str] = Query(None),
    doc_type_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    confidential: Optional[bool] = Query(None),
    expiring_days: Optional[int] = Query(None),
    skip: int = Query(0),
    limit: int = Query(100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        query = db.query(models.Document).filter(models.Document.is_deleted == False)
        if q:
            query = query.filter(or_(
                models.Document.title.ilike(f"%{q}%"),
                models.Document.doc_number.ilike(f"%{q}%"),
                models.Document.project.ilike(f"%{q}%"),
                models.Document.usi_kks_code.ilike(f"%{q}%"),
            ))
        if doc_type_id:
            query = query.filter(models.Document.doc_type_id == doc_type_id)
        if status:
            query = query.filter(models.Document.status == status)
        if project:
            query = query.filter(models.Document.project.ilike(f"%{project}%"))
        if confidential is not None:
            query = query.filter(models.Document.confidential == confidential)
        if expiring_days:
            cutoff = datetime.utcnow() + timedelta(days=expiring_days)
            query = query.filter(
                models.Document.expiry_date != None,
                models.Document.expiry_date <= cutoff,
                models.Document.expiry_date >= datetime.utcnow(),
            )
        docs = query.order_by(models.Document.created_at.desc()).offset(skip).limit(limit).all()
        return [_doc_to_dict(d) for d in docs]
    except Exception:
        print("list_documents error:", traceback.format_exc())
        return []


# ─── Get single document ───────────────────────────────────────────────────────

@router.get("/{doc_id}")
def get_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        doc = db.query(models.Document).filter(
            models.Document.id == doc_id,
            models.Document.is_deleted == False
        ).first()
        if not doc:
            raise HTTPException(404, "Document not found")

        # Log view
        try:
            db.add(models.AuditLog(
                document_id=doc.id, user_id=current_user.id,
                action="Document Viewed", note=""
            ))
            db.commit()
        except Exception:
            db.rollback()

        # Build full detail
        base = _doc_to_dict(doc)
        base["creator"] = {"id": doc.creator.id, "name": doc.creator.name, "email": doc.creator.email} if doc.creator else None
        base["versions"] = [
            {
                "id": v.id, "version_number": v.version_number,
                "is_major": bool(v.is_major), "change_reason": v.change_reason,
                "change_label": v.change_label,
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "created_by": {"id": v.created_by.id, "name": v.created_by.name} if v.created_by else None,
            }
            for v in (doc.versions or [])
        ]
        base["files"] = [
            {
                "id": f.id, "filename": f.filename, "file_size": f.file_size,
                "mime_type": f.mime_type, "file_format": f.file_format,
                "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
            }
            for f in (doc.files or [])
        ]
        base["feedbacks"] = [
            {
                "id": fb.id, "comment": fb.comment,
                "created_at": fb.created_at.isoformat() if fb.created_at else None,
                "user": {"id": fb.user.id, "name": fb.user.name} if fb.user else None,
                "tagged_user": {"id": fb.tagged_user.id, "name": fb.tagged_user.name} if fb.tagged_user else None,
            }
            for fb in (doc.feedbacks or [])
        ]
        base["audit_logs"] = [
            {
                "id": al.id, "action": al.action, "note": al.note,
                "timestamp": al.timestamp.isoformat() if al.timestamp else None,
                "user": {"id": al.user.id, "name": al.user.name} if al.user else None,
            }
            for al in (doc.audit_logs or [])
        ]
        base["references"] = [
            {
                "id": r.id, "note": r.note,
                "target": {"id": r.target.id, "doc_number": r.target.doc_number, "title": r.target.title} if r.target else None,
            }
            for r in (doc.references or [])
        ]
        if doc.workflow:
            wf = doc.workflow
            # Build level lookup for task enrichment
            level_map = {lv.id: lv for lv in (wf.levels or [])}
            base["workflow"]["tasks"] = [
                {
                    "id": t.id, "step": t.step, "status": t.status,
                    "checklist_done": bool(t.checklist_done),
                    "checklist_file_name": t.checklist_file_name,
                    "action_note": t.action_note,
                    "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                    "assignee": {"id": t.assignee.id, "name": t.assignee.name} if t.assignee else None,
                    "level": {
                        "id": level_map[t.level_id].id,
                        "checklist_required": bool(level_map[t.level_id].checklist_required),
                        "checklist_template_name": level_map[t.level_id].checklist_template_name,
                    } if t.level_id and t.level_id in level_map else None,
                }
                for t in (wf.tasks or [])
            ]
            base["workflow"]["levels"] = [
                {
                    "id": lv.id, "step": lv.step, "name": lv.name,
                    "stage": lv.stage, "status": lv.status,
                    "checklist_required": bool(lv.checklist_required),
                    "checklist_template_name": lv.checklist_template_name,
                    "tasks": [
                        {
                            "id": t.id, "step": t.step, "status": t.status,
                            "checklist_done": bool(t.checklist_done),
                            "checklist_file_name": t.checklist_file_name,
                            "action_note": t.action_note,
                            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                            "assignee": {"id": t.assignee.id, "name": t.assignee.name} if t.assignee else None,
                        }
                        for t in (lv.tasks or [])
                    ],
                }
                for lv in (wf.levels or [])
            ]
        return base
    except HTTPException:
        raise
    except Exception:
        print("get_document error:", traceback.format_exc())
        raise HTTPException(500, "Error loading document")


# ─── Create document ───────────────────────────────────────────────────────────

@router.post("/", status_code=201)
def create_document(
    title: str = Form(...),
    doc_type_id: int = Form(...),
    project: Optional[str] = Form(None),
    usi_kks_code: Optional[str] = Form(None),
    serial_no: Optional[str] = Form(None),
    confidential: bool = Form(False),
    expiry_date: Optional[str] = Form(None),
    revision_due: Optional[str] = Form(None),
    custom_metadata: Optional[str] = Form("{}"),
    tags: Optional[str] = Form("[]"),
    change_reason: Optional[str] = Form("Initial upload"),
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        doc_type = db.query(models.DocumentType).filter(models.DocumentType.id == doc_type_id).first()
        if not doc_type:
            raise HTTPException(404, "Document type not found")

        # Generate doc number — sequential per doc type
        count      = db.query(models.Document).filter(models.Document.doc_type_id == doc_type_id).count() + 1
        pattern    = doc_type.number_pattern or "{CODE}-{YEAR}-{SEQ}"
        seq_str    = str(count).zfill(4)
        doc_number = (pattern
                      .replace("{CODE}", doc_type.code or "DOC")
                      .replace("{TYPE}", doc_type.code or "DOC")
                      .replace("{YEAR}", str(datetime.now().year))
                      .replace("{SEQ}", seq_str))

        # Serial number = auto-generated (same as doc number, always system-controlled)
        auto_serial_no = doc_number

        # Pull project / usi_kks_code from custom_metadata if provided there
        parsed_meta = json.loads(custom_metadata or "{}")
        usi_from_meta     = parsed_meta.pop("usi", None) or parsed_meta.pop("usi_kks_code", None) or usi_kks_code
        project_from_meta = parsed_meta.pop("project", None) or project

        doc = models.Document(
            doc_number=doc_number,
            serial_no=auto_serial_no,
            title=title,
            doc_type_id=doc_type_id,
            project=project_from_meta,
            usi_kks_code=usi_from_meta,
            confidential=confidential,
            creator_id=current_user.id,
            expiry_date=datetime.fromisoformat(expiry_date) if expiry_date else None,
            revision_due=datetime.fromisoformat(revision_due) if revision_due else None,
            custom_metadata=parsed_meta,
            tags=json.loads(tags or "[]"),
            status="Draft",
            status_code="05",
            current_version="1.0",
        )
        db.add(doc)
        db.flush()

        # Initial version
        version = models.DocumentVersion(
            document_id=doc.id,
            version_number="1.0",
            is_major=True,
            change_reason=change_reason or "Initial upload",
            created_by_id=current_user.id,
        )
        db.add(version)

        # Save files
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        for upload in files:
            if upload.filename:
                ext = os.path.splitext(upload.filename)[1].lower()
                if ext not in ALLOWED_FORMATS:
                    continue
                unique_name = f"{uuid.uuid4()}{ext}"
                path = os.path.join(UPLOAD_DIR, unique_name)
                content = upload.file.read()
                with open(path, "wb") as f:
                    f.write(content)
                db.add(models.DocumentFile(
                    document_id=doc.id,
                    filename=upload.filename,
                    file_path=path,
                    file_size=len(content),
                    mime_type=upload.content_type,
                    file_format=ext.lstrip(".").upper(),
                    uploaded_by=current_user.id,
                ))
                version.file_path = path

        # Workflow
        wf = models.WorkflowInstance(
            document_id=doc.id,
            stage="Prepare",
            mode="Auto Populate",
        )
        db.add(wf)

        # Audit
        db.add(models.AuditLog(
            document_id=doc.id, user_id=current_user.id,
            action="Document Created", note=f"Type: {doc_type.name}",
        ))

        db.commit()
        return {"id": doc.id, "doc_number": doc.doc_number, "message": "Document created"}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        print("create_document error:", traceback.format_exc())
        raise HTTPException(500, "Error creating document")


# ─── Update metadata ───────────────────────────────────────────────────────────

@router.patch("/{doc_id}")
def update_document(
    doc_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        from sqlalchemy.orm.attributes import flag_modified

        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(404, "Document not found")
        if doc.status in ("Approved", "Released", "Archived"):
            raise HTTPException(403, "Cannot modify Approved, Released or Archived documents.")
        if doc.status in ("In Check", "In Review", "In Approval"):
            raise HTTPException(403,
                f"Document is locked for editing — currently under review (status: {doc.status}). "
                "Return the workflow to make changes."
            )

        DATE_FIELDS = {"expiry_date", "renewal_date", "revision_due"}
        SKIP_FIELDS = {"id", "doc_number", "creator_id", "status", "current_version"}

        for k, v in data.items():
            if k in SKIP_FIELDS or not hasattr(doc, k):
                continue
            if k in DATE_FIELDS:
                if v:
                    try:
                        v = datetime.fromisoformat(str(v).split("T")[0])
                    except (ValueError, TypeError):
                        v = None
                else:
                    v = None
            setattr(doc, k, v)

        # Validate: revision_due must not be later than expiry_date
        incoming_cm = data.get("custom_metadata") or {}
        if isinstance(incoming_cm, str):
            try: incoming_cm = json.loads(incoming_cm)
            except Exception: incoming_cm = {}

        _exp = incoming_cm.get("expiry_date") or (doc.expiry_date.isoformat() if doc.expiry_date else None)
        _rev = incoming_cm.get("revision_due") or (doc.revision_due.isoformat() if doc.revision_due else None)
        if _exp and _rev:
            try:
                if datetime.fromisoformat(str(_rev).split("T")[0]) > datetime.fromisoformat(str(_exp).split("T")[0]):
                    raise HTTPException(400, "Revision Due date cannot be later than the Expiry Date.")
            except HTTPException:
                raise
            except Exception:
                pass

        # Sync core fields from custom_metadata payload (incoming_cm already parsed above)
        # Date fields
        for meta_key, core_attr in [("expiry_date", "expiry_date"), ("revision_due", "revision_due")]:
            if meta_key in incoming_cm:
                raw = incoming_cm[meta_key]
                if raw:
                    try:
                        setattr(doc, core_attr, datetime.fromisoformat(str(raw).split("T")[0]))
                    except (ValueError, TypeError):
                        pass
                else:
                    setattr(doc, core_attr, None)

        # Text core fields — usi_kks_code can be stored under "usi" or "usi_kks_code" in schema
        for meta_key, core_attr in [("usi", "usi_kks_code"), ("usi_kks_code", "usi_kks_code"), ("project", "project")]:
            if meta_key in incoming_cm:
                val = incoming_cm[meta_key]
                setattr(doc, core_attr, val if val else None)

        # Ensure SQLAlchemy detects mutation of the JSON column
        flag_modified(doc, "custom_metadata")
        doc.updated_at = datetime.utcnow()

        db.add(models.AuditLog(document_id=doc.id, user_id=current_user.id, action="Metadata Updated"))
        db.commit()
        return {"message": "Updated"}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        print("update_document error:", traceback.format_exc())
        raise HTTPException(500, "Error updating document")


# ─── Checkout ─────────────────────────────────────────────────────────────────

@router.post("/{doc_id}/checkout")
def checkout(
    doc_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(404, "Not found")
        action = data.get("action", "checkout")
        if action == "checkout":
            if doc.checked_out:
                raise HTTPException(400, f"Already checked out by user {doc.checked_out_by}")
            doc.checked_out = True
            doc.checked_out_by = current_user.id
            doc.checked_out_at = datetime.utcnow()
            db.add(models.AuditLog(document_id=doc.id, user_id=current_user.id, action="Checked Out"))
        else:
            doc.checked_out = False
            doc.checked_out_by = None
            doc.checked_out_at = None
            db.add(models.AuditLog(document_id=doc.id, user_id=current_user.id, action="Checked In"))
        db.commit()
        return {"message": f"{action} successful"}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(500, "Checkout error")


# ─── Add feedback ──────────────────────────────────────────────────────────────

@router.post("/{doc_id}/feedback")
def add_feedback(
    doc_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        tagged_user_id = data.get("tagged_user_id")
        fb = models.DocumentFeedback(
            document_id=doc_id,
            user_id=current_user.id,
            comment=data.get("comment", ""),
            tagged_user_id=int(tagged_user_id) if tagged_user_id else None,
        )
        db.add(fb)
        # Audit log for tagged user
        if tagged_user_id:
            tagged = db.query(models.User).filter(models.User.id == int(tagged_user_id)).first()
            db.add(models.AuditLog(
                document_id=doc_id, user_id=current_user.id,
                action="Feedback Requested",
                note=f"Feedback requested from {tagged.name if tagged else tagged_user_id}",
            ))
        db.commit()
        db.refresh(fb)
        tagged = db.query(models.User).filter(models.User.id == fb.tagged_user_id).first() if fb.tagged_user_id else None
        return {
            "id": fb.id, "comment": fb.comment,
            "tagged_user": {"id": tagged.id, "name": tagged.name} if tagged else None,
        }
    except Exception:
        db.rollback()
        raise HTTPException(500, "Error adding feedback")


# ─── Add reference ─────────────────────────────────────────────────────────────

@router.post("/{doc_id}/references")
def add_reference(
    doc_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        ref = models.DocumentReference(
            source_id=doc_id,
            target_id=data.get("target_doc_id"),
            note=data.get("note"),
        )
        db.add(ref)
        db.commit()
        return {"message": "Reference added"}
    except Exception:
        db.rollback()
        raise HTTPException(500, "Error adding reference")


# ─── Share link ────────────────────────────────────────────────────────────────

@router.get("/{doc_id}/share-link")
def share_link(
    doc_id: int,
    version: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Not found")
    link = f"/documents/{doc_id}" + (f"?v={version}" if version else "")
    return {"link": link, "doc_number": doc.doc_number, "version": version or "latest"}


# ─── Upload new version ────────────────────────────────────────────────────────

@router.post("/{doc_id}/versions")
def upload_version(
    doc_id: int,
    is_major: bool = Form(False),
    change_reason: str = Form(...),
    change_label: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
        if not doc:
            raise HTTPException(404, "Not found")

        # Rule 1: New version only allowed if current version is Released
        if doc.status != "Released":
            raise HTTPException(403,
                f"Cannot create a new version — the current version (v{doc.current_version}) "
                f"has not been Released yet. Status is '{doc.status}'. "
                f"The document must complete the approval workflow and reach Released status "
                f"before a new version can be created."
            )

        # Rule 2: Change reason is mandatory
        if not change_reason or not change_reason.strip():
            raise HTTPException(400,
                "Change reason is mandatory when creating a new version. "
                "Please describe what has changed in this revision."
            )

        # Rule 3: Block if workflow is active (in progress)
        if doc.workflow and not doc.workflow.completed:
            raise HTTPException(403,
                "Cannot create a new version while the approval workflow is in progress. "
                "Wait for the current workflow to complete or be rejected first."
            )

        parts = (doc.current_version or "1.0").split(".")
        if is_major:
            new_ver = f"{int(parts[0]) + 1}.0"
        else:
            new_ver = f"{parts[0]}.{int(parts[1] if len(parts) > 1 else 0) + 1}"

        os.makedirs(UPLOAD_DIR, exist_ok=True)
        ext = os.path.splitext(file.filename)[1].lower()
        path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}{ext}")
        content = file.file.read()
        with open(path, "wb") as f:
            f.write(content)

        db.add(models.DocumentVersion(
            document_id=doc.id, version_number=new_ver,
            is_major=is_major, change_reason=change_reason,
            change_label=change_label, created_by_id=current_user.id,
            file_path=path,
        ))
        db.add(models.DocumentFile(
            document_id=doc.id, filename=file.filename, file_path=path,
            file_size=len(content), mime_type=file.content_type,
            file_format=ext.lstrip(".").upper(), uploaded_by=current_user.id,
        ))
        doc.current_version = new_ver
        db.add(models.AuditLog(document_id=doc.id, user_id=current_user.id,
                               action=f"New Version v{new_ver}", note=change_reason))
        db.commit()
        return {"message": f"Version {new_ver} uploaded"}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(500, "Version upload error")


# ─── Download file ─────────────────────────────────────────────────────────────

@router.get("/{doc_id}/files/{file_id}/download")
def download_file(
    doc_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    from fastapi.responses import FileResponse
    f = db.query(models.DocumentFile).filter(
        models.DocumentFile.id == file_id,
        models.DocumentFile.document_id == doc_id,
    ).first()
    if not f or not os.path.exists(f.file_path):
        raise HTTPException(404, "File not found")
    db.add(models.AuditLog(document_id=doc_id, user_id=current_user.id,
                           action="File Downloaded", note=f.filename))
    db.commit()
    return FileResponse(f.file_path, filename=f.filename)


# ─── View file inline (for browser preview) ───────────────────────────────────

@router.get("/{doc_id}/files/{file_id}/view")
def view_file(
    doc_id: int,
    file_id: int,
    token: str = None,              # Accept token as query param for iframe/img src
    db: Session = Depends(get_db),
):
    """Serve file inline for browser viewing. Token passed as query param
    because browsers cannot set Authorization headers for iframe/img/embed src."""
    from fastapi.responses import FileResponse, Response
    import mimetypes

    # Validate token manually (same logic as get_current_user)
    user = None
    if token:
        try:
            from jose import jwt, JWTError
            import os as _os
            SECRET_KEY = _os.getenv("SECRET_KEY", "dms-npcil-secret-key-change-in-production")
            payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            user_id  = payload.get("sub")
            if user_id:
                user = db.query(models.User).filter(
                    models.User.id == int(user_id),
                    models.User.is_active == True,
                ).first()
        except Exception:
            pass

    if not user:
        raise HTTPException(401, "Unauthorized")

    f = db.query(models.DocumentFile).filter(
        models.DocumentFile.id == file_id,
        models.DocumentFile.document_id == doc_id,
    ).first()
    if not f or not os.path.exists(f.file_path):
        raise HTTPException(404, "File not found")

    # Detect MIME type
    mime, _ = mimetypes.guess_type(f.filename or f.file_path)
    if not mime:
        ext = (f.file_format or "").lower()
        mime_map = {
            "pdf":  "application/pdf",
            "png":  "image/png",
            "jpg":  "image/jpeg",
            "jpeg": "image/jpeg",
            "gif":  "image/gif",
            "tiff": "image/tiff",
            "tif":  "image/tiff",
            "bmp":  "image/bmp",
            "webp": "image/webp",
            "svg":  "image/svg+xml",
            "txt":  "text/plain",
            "csv":  "text/csv",
            "xml":  "text/xml",
            "json": "application/json",
            "mp4":  "video/mp4",
            "webm": "video/webm",
            "mp3":  "audio/mpeg",
        }
        mime = mime_map.get(ext, "application/octet-stream")

    db.add(models.AuditLog(document_id=doc_id, user_id=user.id,
                           action="File Viewed Online", note=f.filename))
    db.commit()

    # Serve inline — browser renders it directly
    return FileResponse(
        f.file_path,
        media_type=mime,
        headers={"Content-Disposition": f"inline; filename={f.filename}"},
    )


# ─── Soft delete ──────────────────────────────────────────────────────────────

@router.delete("/{doc_id}", status_code=204)
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.status in ("Approved", "Released"):
        raise HTTPException(403, "Cannot delete Approved or Released documents.")
    if doc.workflow and not doc.workflow.completed:
        raise HTTPException(403,
            "Cannot delete this document — the approval workflow is currently in progress. "
            "Return or reject the workflow first, then delete."
        )
    if doc.status in ("In Check", "In Review", "In Approval"):
        raise HTTPException(403,
            f"Cannot delete a document that is under workflow review (status: {doc.status}). "
            "Return the workflow to Draft first."
        )
    doc.is_deleted = True
    db.add(models.AuditLog(document_id=doc.id, user_id=current_user.id, action="Document Deleted"))
    db.commit()


# ─── Delete attached file ──────────────────────────────────────────────────────

@router.delete("/{doc_id}/files/{file_id}", status_code=204)
def delete_file(
    doc_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Delete an attached file from a document. Only allowed in Draft or Created status."""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.status not in ("Draft", "Created"):
        raise HTTPException(403,
            f"Files can only be deleted when the document is in Draft or Created status. "
            f"Current status is '{doc.status}'."
        )
    if doc.workflow and not doc.workflow.completed:
        raise HTTPException(403,
            "Cannot delete files while the approval workflow is in progress."
        )

    f = db.query(models.DocumentFile).filter(
        models.DocumentFile.id == file_id,
        models.DocumentFile.document_id == doc_id,
    ).first()
    if not f:
        raise HTTPException(404, "File not found")

    # Remove physical file if it exists
    try:
        if f.file_path and os.path.exists(f.file_path):
            os.remove(f.file_path)
    except Exception:
        pass  # Don't block deletion if file is already missing

    db.add(models.AuditLog(
        document_id=doc_id,
        user_id=current_user.id,
        action="File Deleted",
        note=f.filename,
    ))
    db.delete(f)
    db.commit()
