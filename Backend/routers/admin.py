"""
admin.py — Users, Doc Types, Roles, Number Reservations, System Config, Seed.
Seed loads all 45 doc types from Master_Data.xlsx with full error reporting.
"""
import hashlib
import traceback
import logging
import csv
import io
from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from typing import List, Optional

from database import get_db
from routers.auth import get_current_user, hash_password
import models, schemas

router  = APIRouter()
_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != "System Admin":
        raise HTTPException(status_code=403, detail="System Admin role required")
    return current_user


def _get_fmt_field(f, field, default=''):
    """Get field from either a Pydantic DocTypeFileFormatIn object or a plain dict."""
    if hasattr(f, field):
        return getattr(f, field) or default
    if isinstance(f, dict):
        return f.get(field, default) or default
    return default

logger  = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _cfg(db, key, default=None):
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    return row.value if row else default

def _set_cfg(db, key, value):
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    if row:
        row.value = str(value)
    else:
        db.add(models.SystemConfig(key=key, value=str(value)))
    db.commit()


# ─── System Config ─────────────────────────────────────────────────────────────

@router.get("/config")
def get_config(db: Session = Depends(get_db),
               current_user: models.User = Depends(require_admin)):
    keys = ["auth_code_enabled", "sap_sso_enabled", "sap_sso_entity_id",
            "sap_sso_sso_url", "sap_sso_slo_url", "sap_sso_cert",
            "sap_sso_sp_entity_id", "app_name", "app_org", "frontend_url",
            "prepare_locked_fields"]
    result = {k: _cfg(db, k, "") for k in keys}
    result["auth_code_enabled"] = result["auth_code_enabled"] == "true"
    result["sap_sso_enabled"]   = result["sap_sso_enabled"]   == "true"
    return result


@router.put("/config")
def save_config(data: schemas.SystemConfigUpdate,
                db: Session = Depends(get_db),
                current_user: models.User = Depends(require_admin)):
    d = data.model_dump(exclude_none=True)
    if "auth_code_enabled" in d:
        _set_cfg(db, "auth_code_enabled", "true" if d["auth_code_enabled"] else "false")
    if "auth_code" in d and d["auth_code"]:
        _set_cfg(db, "auth_code_hash",
                 hashlib.sha256(d["auth_code"].strip().encode()).hexdigest())
    for key in ["sap_sso_enabled", "sap_sso_entity_id", "sap_sso_sso_url",
                "sap_sso_slo_url", "sap_sso_cert", "sap_sso_sp_entity_id",
                "app_name", "app_org", "frontend_url", "prepare_locked_fields"]:
        if key in d:
            val = ("true" if d[key] is True
                   else "false" if d[key] is False
                   else str(d[key]))
            _set_cfg(db, key, val)
    return {"message": "Configuration saved"}


# ─── Users ────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=List[schemas.UserOut])
def list_users(q: Optional[str] = None, department: Optional[str] = None,
               role: Optional[str] = None, is_active: Optional[bool] = None,
               skip: int = 0, limit: int = 500,
               db: Session = Depends(get_db),
               current_user: models.User = Depends(require_admin)):
    query = db.query(models.User)
    if q:
        from sqlalchemy import or_, func
        query = query.filter(or_(
            models.User.name.ilike(f"%{q}%"),
            models.User.email.ilike(f"%{q}%"),
            func.coalesce(models.User.sap_username, "").ilike(f"%{q}%"),
            func.coalesce(models.User.employee_id, "").ilike(f"%{q}%"),
            func.coalesce(models.User.department, "").ilike(f"%{q}%"),
            func.coalesce(models.User.role, "").ilike(f"%{q}%"),
        ))
    if department:
        query = query.filter(models.User.department == department)
    if role:
        query = query.filter(models.User.role == role)
    if is_active is not None:
        query = query.filter(models.User.is_active == is_active)
    return query.offset(skip).limit(limit).all()


@router.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(data: schemas.UserCreate, db: Session = Depends(get_db),
                current_user: models.User = Depends(require_admin)):
    if db.query(models.User).filter(models.User.email == data.email).first():
        raise HTTPException(400, "Email already registered")
    user = models.User(
        sap_username=data.sap_username or data.employee_id,
        employee_id=data.employee_id, name=data.name, email=data.email,
        department=data.department, role=data.role,
        dms_enabled=data.dms_enabled, can_create=data.can_create,
        can_edit=data.can_edit, can_delete=data.can_delete, can_read=data.can_read,
        auth_codes=data.auth_codes or "",
        hashed_password=hash_password(data.password) if data.password else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: int, data: schemas.UserUpdate,
                db: Session = Depends(get_db),
                current_user: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    for k, v in data.model_dump(exclude_none=True).items():
        if k == "password" and v:
            user.hashed_password = hash_password(v)
        elif hasattr(user, k):
            setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def deactivate_user(user_id: int, db: Session = Depends(get_db),
                    current_user: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = False
    db.commit()


@router.post("/users/{user_id}/activate")
def activate_user(user_id: int, db: Session = Depends(get_db),
                  current_user: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = True
    db.commit()
    return {"message": "Activated"}


# ─── Document Types ────────────────────────────────────────────────────────────

@router.get("/document-types", response_model=List[schemas.DocumentTypeOut])
def list_doc_types(db: Session = Depends(get_db),
                   current_user: models.User = Depends(get_current_user)):
    return db.query(models.DocumentType).all()


@router.post("/document-types", response_model=schemas.DocumentTypeOut, status_code=201)
def create_doc_type(data: schemas.DocumentTypeCreate, db: Session = Depends(get_db),
                    current_user: models.User = Depends(require_admin)):
    dt = models.DocumentType(
        code=data.code, name=data.name, description=data.description,
        auth_required=data.auth_required or False, auth_code=data.auth_code or "",
        metadata_schema=data.metadata_schema or {}, number_pattern=data.number_pattern,
    )
    db.add(dt)
    db.flush()
    for f in (data.allowed_formats or []):
        db.add(models.DocTypeFileFormat(
            doc_type_id=dt.id,
            extension=_get_fmt_field(f, 'extension').lower(),
            label=_get_fmt_field(f, 'label'),
            icon=_get_fmt_field(f, 'icon'),
            mime_type=_get_fmt_field(f, 'mime_type'),
        ))
    db.add(models.AlertConfig(doc_type_id=dt.id, lead_days="30,15,7", enabled=True))
    db.add(models.WorkflowConfig(doc_type_id=dt.id))
    db.commit()
    db.refresh(dt)
    return dt


@router.put("/document-types/{dt_id}", response_model=schemas.DocumentTypeOut)
def update_doc_type(dt_id: int, data: schemas.DocumentTypeUpdate,
                    db: Session = Depends(get_db),
                    current_user: models.User = Depends(require_admin)):
    dt = db.query(models.DocumentType).filter(models.DocumentType.id == dt_id).first()
    if not dt:
        raise HTTPException(404, "Not found")
    from sqlalchemy.orm.attributes import flag_modified
    for k, v in data.model_dump(exclude_none=True).items():
        if k == "allowed_formats":
            db.query(models.DocTypeFileFormat).filter(
                models.DocTypeFileFormat.doc_type_id == dt_id
            ).delete()
            for f in (v or []):
                db.add(models.DocTypeFileFormat(
                    doc_type_id=dt_id,
                    extension=_get_fmt_field(f, 'extension').lower(),
                    label=_get_fmt_field(f, 'label'),
                    icon=_get_fmt_field(f, 'icon'),
                    mime_type=_get_fmt_field(f, 'mime_type'),
                ))
        elif hasattr(dt, k):
            setattr(dt, k, v)
            if k == "metadata_schema":
                flag_modified(dt, "metadata_schema")
    db.commit()
    db.refresh(dt)
    return dt


# ─── Workflow Config ───────────────────────────────────────────────────────────

@router.get("/workflow-configs")
def list_wf_configs(db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    return db.query(models.WorkflowConfig).all()


@router.put("/workflow-configs/{doc_type_id}")
def update_wf_config(doc_type_id: int, data: dict,
                     db: Session = Depends(get_db),
                     current_user: models.User = Depends(require_admin)):
    cfg = db.query(models.WorkflowConfig).filter(
        models.WorkflowConfig.doc_type_id == doc_type_id).first()
    if not cfg:
        cfg = models.WorkflowConfig(doc_type_id=doc_type_id)
        db.add(cfg)
        db.flush()
    cfg.levels = data.get("levels", cfg.levels)
    db.commit()
    return {"message": "Workflow config updated"}


# ─── Roles ────────────────────────────────────────────────────────────────────

@router.get("/roles")
def list_roles(db: Session = Depends(get_db),
               current_user: models.User = Depends(get_current_user)):
    return db.query(models.Role).all()


@router.post("/roles", status_code=201)
def create_role(data: dict, db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    role = models.Role(
        name=data.get("name"),
        permissions=data.get("permissions", {}),
        description=data.get("description"),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


# ─── Number Reservations ───────────────────────────────────────────────────────

@router.get("/number-reservations")
def list_reservations(db: Session = Depends(get_db),
                      current_user: models.User = Depends(get_current_user)):
    return db.query(models.NumberReservation).all()


@router.post("/number-reservations", status_code=201)
def reserve_numbers(data: schemas.ReserveNumbers,
                    db: Session = Depends(get_db),
                    current_user: models.User = Depends(get_current_user)):
    db.add(models.NumberReservation(
        doc_type_id=data.doc_type_id, usi_kks=data.usi_kks,
        range_start=data.range_start, range_end=data.range_end,
        label=data.label, reserved_by=current_user.id,
    ))
    db.commit()
    return {"message": f"Reserved {data.range_start}-{data.range_end} as '{data.label}'"}


# ─── Seed Data ─────────────────────────────────────────────────────────────────

# All 45 document types from Master_Data.xlsx Doc types sheet
MASTER_DOC_TYPES = [
    {"name": "Addendum",                                    "code": "ADDM", "auth_required": False, "auth_code": ""},
    {"name": "AERB",                                        "code": "AERB", "auth_required": False, "auth_code": ""},
    {"name": "As Built Drawing",                            "code": "ABD",  "auth_required": False, "auth_code": ""},
    {"name": "CDC",                                         "code": "CDC",  "auth_required": False, "auth_code": ""},
    {"name": "DCN",                                         "code": "DCN",  "auth_required": False, "auth_code": ""},
    {"name": "DCQ",                                         "code": "DCQ",  "auth_required": False, "auth_code": ""},
    {"name": "Design Concession Request-DCR",               "code": "DCR",  "auth_required": False, "auth_code": ""},
    {"name": "Digital I&C System",                          "code": "DICS", "auth_required": False, "auth_code": ""},
    {"name": "Directorate Procedures",                      "code": "DPROC","auth_required": False, "auth_code": ""},
    {"name": "Document",                                    "code": "DOC",  "auth_required": False, "auth_code": ""},
    {"name": "Drawing",                                     "code": "DRW",  "auth_required": True,  "auth_code": "A1111"},
    {"name": "ECN",                                         "code": "ECN",  "auth_required": True,  "auth_code": "A1234"},
    {"name": "ESSG",                                        "code": "ESSG", "auth_required": False, "auth_code": ""},
    {"name": "FCN",                                         "code": "FCN",  "auth_required": True,  "auth_code": ""},
    {"name": "Feedback",                                    "code": "FBK",  "auth_required": False, "auth_code": ""},
    {"name": "Field Change Proposal or Field Change Request","code": "FCR",  "auth_required": False, "auth_code": ""},
    {"name": "General",                                     "code": "GEN",  "auth_required": False, "auth_code": ""},
    {"name": "HSE",                                         "code": "HSE",  "auth_required": False, "auth_code": ""},
    {"name": "Indent-EB",                                   "code": "INDEB","auth_required": False, "auth_code": ""},
    {"name": "Inspection Quality Plan",                     "code": "IQP",  "auth_required": False, "auth_code": ""},
    {"name": "Inspection Testing of Equipment",             "code": "ITE",  "auth_required": False, "auth_code": ""},
    {"name": "Knowledge Management",                        "code": "KM",   "auth_required": False, "auth_code": ""},
    {"name": "Letter of Transmittal",                       "code": "LOT",  "auth_required": False, "auth_code": ""},
    {"name": "Letter of Transmittal FI",                    "code": "LOTFI","auth_required": False, "auth_code": ""},
    {"name": "Letter of Transmittal KAIGA5&6",              "code": "LOTK", "auth_required": False, "auth_code": ""},
    {"name": "Letter of Transmittal MBRAPP1TO4",            "code": "LOTM", "auth_required": False, "auth_code": ""},
    {"name": "Non-Conformance Report",                      "code": "NCR",  "auth_required": False, "auth_code": ""},
    {"name": "PHWR Project Document",                       "code": "PHWR", "auth_required": False, "auth_code": ""},
    {"name": "Print Request for Drawing",                   "code": "PRD",  "auth_required": False, "auth_code": ""},
    {"name": "Procurement",                                 "code": "PROC", "auth_required": False, "auth_code": ""},
    {"name": "Purchase Orders",                             "code": "PO",   "auth_required": False, "auth_code": ""},
    {"name": "QA Document",                                 "code": "QAD",  "auth_required": False, "auth_code": ""},
    {"name": "QS Requisition",                              "code": "QSR",  "auth_required": False, "auth_code": ""},
    {"name": "R&DES",                                       "code": "RDES", "auth_required": False, "auth_code": ""},
    {"name": "Requisition",                                 "code": "REQ",  "auth_required": False, "auth_code": ""},
    {"name": "RSA",                                         "code": "RSA",  "auth_required": False, "auth_code": ""},
    {"name": "Safety Related Deficiency",                   "code": "SRD",  "auth_required": False, "auth_code": ""},
    {"name": "Site Documents",                              "code": "SITE", "auth_required": False, "auth_code": ""},
    {"name": "SQA",                                         "code": "SQA",  "auth_required": False, "auth_code": ""},
    {"name": "Technical",                                   "code": "TECH", "auth_required": False, "auth_code": ""},
    {"name": "Technical Authorization",                     "code": "TA",   "auth_required": False, "auth_code": ""},
    {"name": "Technical Specification",                     "code": "TSPEC","auth_required": False, "auth_code": ""},
    {"name": "TEMPLATEHOLDER",                              "code": "TMPL", "auth_required": False, "auth_code": ""},
    {"name": "Vendor Evaluation",                           "code": "VE",   "auth_required": False, "auth_code": ""},
    {"name": "Work Authorization",                          "code": "WA",   "auth_required": False, "auth_code": ""},
]

# Default file formats per doc type code
FMT_MAP = {
    "DRW": [
        {"extension": "dwg",  "label": "AutoCAD Drawing",   "icon": "", "mime_type": "image/vnd.dwg"},
        {"extension": "dxf",  "label": "DXF Drawing",       "icon": "", "mime_type": "image/vnd.dxf"},
        {"extension": "pdf",  "label": "PDF Document",      "icon": "", "mime_type": "application/pdf"},
        {"extension": "tiff", "label": "TIFF Image",        "icon": "", "mime_type": "image/tiff"},
        {"extension": "dgn",  "label": "MicroStation",      "icon": "", "mime_type": "application/octet-stream"},
    ],
    "ABD": [
        {"extension": "dwg",  "label": "AutoCAD Drawing",   "icon": "", "mime_type": "image/vnd.dwg"},
        {"extension": "pdf",  "label": "PDF Document",      "icon": "", "mime_type": "application/pdf"},
    ],
    "_default": [
        {"extension": "pdf",  "label": "PDF Document",      "icon": "", "mime_type": "application/pdf"},
        {"extension": "docx", "label": "Word Document",     "icon": "", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        {"extension": "xlsx", "label": "Excel Spreadsheet", "icon": "", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        {"extension": "jpeg", "label": "JPEG Image",        "icon": "", "mime_type": "image/jpeg"},
        {"extension": "zip",  "label": "ZIP Archive",       "icon": "", "mime_type": "application/zip"},
    ],
}


@router.post("/seed", status_code=201)
def seed_data(db: Session = Depends(get_db), force: bool = False,
              token: Optional[str] = Depends(_oauth2)):
    """Seed all master data. Unauthenticated only when no users exist (first-time setup).
    Add ?force=true to re-seed even if data already exists (requires System Admin)."""
    user_count = db.query(models.User).count()
    if user_count > 0:
        if not token:
            raise HTTPException(401, "Authentication required")
        caller = get_current_user(token=token, db=db)
        if caller.role != "System Admin":
            raise HTTPException(403, "System Admin role required")
    try:
        existing = db.query(models.DocumentType).count()
        if existing > 0 and not force:
            return {
                "message": f"Already seeded ({existing} document types found). ",
                "tip": "Call POST /api/admin/seed?force=true to re-seed.",
                "users": db.query(models.User).count(),
            }
        if force:
            # Clear existing data for fresh re-seed
            db.query(models.DocTypeFileFormat).delete()
            db.query(models.AlertConfig).delete()
            db.query(models.WorkflowConfig).delete()
            db.query(models.DocumentType).delete()
            db.commit()

        # 1. Create document types
        for dt_data in MASTER_DOC_TYPES:
            dt = models.DocumentType(
                code=dt_data["code"],
                name=dt_data["name"],
                auth_required=dt_data["auth_required"],
                auth_code=dt_data["auth_code"],
                number_pattern=f"{dt_data['code']}-{{YEAR}}-{{SEQ}}",
                metadata_schema=_METADATA_SCHEMAS.get(dt_data["code"], []),
            )
            db.add(dt)
            db.flush()  # get dt.id

            # File formats (no emoji icons to avoid encoding issues)
            fmts = FMT_MAP.get(dt_data["code"], FMT_MAP["_default"])
            for f in fmts:
                db.add(models.DocTypeFileFormat(
                    doc_type_id=dt.id,
                    extension=f["extension"],
                    label=f["label"],
                    icon="",
                    mime_type=f["mime_type"],
                ))

            # Alert config
            db.add(models.AlertConfig(
                doc_type_id=dt.id,
                enabled=True,
                lead_days="30,15,7",
                notify_author=True,
                notify_roles="",
            ))

            # Workflow config
            db.add(models.WorkflowConfig(doc_type_id=dt.id))

        # 2. Admin user
        if not db.query(models.User).filter(models.User.email == "admin@npcil.gov.in").first():
            db.add(models.User(
                sap_username="ADMIN",
                employee_id="EMP001",
                name="Admin User",
                email="admin@npcil.gov.in",
                department="IT",
                role="System Admin",
                dms_enabled=True,
                can_create=True,
                can_edit=True,
                can_delete=True,
                can_read=True,
                auth_codes="A1111; A1234",
                hashed_password=hash_password("Admin@1234"),
                is_active=True,
            ))

        # 3. Demo user (Jeyasurya T from master data)
        if not db.query(models.User).filter(models.User.email == "jeyasurya@npcil.gov.in").first():
            db.add(models.User(
                sap_username="JEYASURYAT",
                employee_id="EMP002",
                name="Jeyasurya T",
                email="jeyasurya@npcil.gov.in",
                department="Engineering",
                role="Document Creator",
                dms_enabled=True,
                can_create=True,
                can_edit=True,
                can_delete=True,
                can_read=True,
                auth_codes="A1111; A1234",
                hashed_password=hash_password("User@1234"),
                is_active=True,
            ))

        # 4. System config defaults
        defaults = [
            ("app_name",              "DMS Portal"),
            ("app_org",               "NPCIL"),
            ("auth_code_enabled",     "false"),
            ("sap_sso_enabled",       "false"),
            ("frontend_url",          "http://localhost:3000"),
            ("prepare_locked_fields", "description,usi_kks_code,drawing_type"),
        ]
        for key, val in defaults:
            if not db.query(models.SystemConfig).filter(
                    models.SystemConfig.key == key).first():
                db.add(models.SystemConfig(key=key, value=val))

        db.commit()
        return {
            "message": (
                f"Seeded {len(MASTER_DOC_TYPES)} document types successfully. "
                "Login: admin@npcil.gov.in / Admin@1234"
            )
        }

    except Exception as e:
        db.rollback()
        error_detail = traceback.format_exc()
        logger.error(f"Seed failed:\n{error_detail}")
        raise HTTPException(
            status_code=500,
            detail=f"Seed failed: {str(e)}\n\nFull traceback:\n{error_detail}"
        )


# ─── Temp fix: reset all checklist_required ───────────────────────────────────

@router.post("/fix-checklist-required")
def fix_checklist_required(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """One-time fix: reset all workflow level checklist_required to False."""
    updated = db.query(models.WorkflowLevel).update({"checklist_required": False})
    db.commit()
    return {"message": f"Reset checklist_required=False on {updated} workflow levels"}



# ─── Seed metadata schemas from EM_DMS_KDS.xlsx ──────────────────────────────
# Codes match MASTER_DOC_TYPES exactly. Loaded from JSON file to keep admin.py lean.

try:
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(__file__)))
    from metadata_schemas_data import METADATA_SCHEMAS as _METADATA_SCHEMAS
    print(f"Metadata schemas loaded: {len(_METADATA_SCHEMAS)} doc types")
except Exception as _e:
    print(f"WARNING: Could not load metadata schemas: {_e}")
    _METADATA_SCHEMAS = {}

# ─── Flagged-for-Deletion Job ─────────────────────────────────────────────────

def run_deletion_job(db: Session) -> dict:
    """Hard-delete all documents flagged for deletion. Returns a summary."""
    flagged = db.query(models.Document).filter(
        models.Document.flagged_for_deletion == True,
        models.Document.is_deleted == False,
    ).all()
    deleted_ids = []
    for doc in flagged:
        doc.is_deleted = True
        doc.flagged_for_deletion = False
        db.add(models.AuditLog(
            document_id=doc.id,
            user_id=doc.flagged_by_id,
            action="Deleted by Scheduled Job",
            note=f"Flagged at {doc.flagged_at}",
            timestamp=datetime.utcnow(),
        ))
        deleted_ids.append(doc.id)
    db.commit()
    return {"deleted": len(deleted_ids), "document_ids": deleted_ids}


@router.post("/run-deletion-job")
def trigger_deletion_job(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Manually run the flagged-document deletion job (System Admin only)."""
    result = run_deletion_job(db)
    return {
        "message": f"Deletion job completed. {result['deleted']} document(s) deleted.",
        **result,
    }


@router.get("/flagged-documents")
def list_flagged_documents(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """List all documents currently flagged for deletion (System Admin only)."""
    docs = db.query(models.Document).filter(
        models.Document.flagged_for_deletion == True,
        models.Document.is_deleted == False,
    ).all()
    return [
        {
            "id": d.id,
            "doc_number": d.doc_number,
            "title": d.title,
            "status": d.status,
            "flagged_at": d.flagged_at.isoformat() if d.flagged_at else None,
            "flagged_by_id": d.flagged_by_id,
        }
        for d in docs
    ]


# ─── Daily Activity Logs ──────────────────────────────────────────────────────

def _ist_offset():
    return timedelta(hours=5, minutes=30)

def _audit_rows(db: Session, actions: list, date_from: Optional[str], date_to: Optional[str],
                doc_type_id: Optional[int], extra_like: Optional[str] = None):
    """Return AuditLog rows filtered by action, IST date range, and optional doc type."""
    from sqlalchemy import or_ as _or
    q = db.query(models.AuditLog).join(
        models.Document, models.AuditLog.document_id == models.Document.id, isouter=True
    )
    conditions = [models.AuditLog.action.in_(actions)]
    if extra_like:
        conditions.append(models.AuditLog.action.ilike(extra_like))
    q = q.filter(_or(*conditions))
    if date_from:
        try:
            # Start of date_from in IST → UTC
            start_utc = datetime.strptime(date_from, "%Y-%m-%d") - _ist_offset()
            q = q.filter(models.AuditLog.timestamp >= start_utc)
        except ValueError:
            pass
    if date_to:
        try:
            # End of date_to (inclusive) in IST → UTC
            end_utc = datetime.strptime(date_to, "%Y-%m-%d") - _ist_offset() + timedelta(days=1)
            q = q.filter(models.AuditLog.timestamp < end_utc)
        except ValueError:
            pass
    if doc_type_id:
        q = q.filter(models.Document.doc_type_id == doc_type_id)
    return q.order_by(models.AuditLog.timestamp.desc()).all()


def _log_to_dict(l):
    doc = l.document
    user = l.user
    ist = (l.timestamp + _ist_offset()) if l.timestamp else None
    return {
        "id":         l.id,
        "action":     l.action,
        "note":       l.note,
        "timestamp_ist": ist.strftime("%Y-%m-%d %H:%M:%S") if ist else None,
        "user_name":  user.name if user else "System",
        "user_email": user.email if user else "",
        "doc_id":     doc.id if doc else None,
        "doc_number": doc.doc_number if doc else "",
        "doc_title":  doc.title if doc else "",
        "doc_type":   doc.doc_type.name if doc and doc.doc_type else "",
        "status":     doc.status if doc else "",
        "project":    doc.project if doc else "",
        "version":    doc.current_version if doc else "",
    }


def _make_csv(rows: list, filename: str) -> StreamingResponse:
    if not rows:
        headers_row = ["No records found"]
        data_rows   = []
    else:
        headers_row = list(rows[0].keys())
        data_rows   = [[str(r.get(h, "")) for h in headers_row] for r in rows]
    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(headers_row)
    w.writerows(data_rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_DELETION_ACTIONS = ["Deleted by Scheduled Job", "Document Deleted", "Flagged for Deletion", "Deletion Flag Removed"]
_CREATION_ACTIONS = ["Document Created"]  # "New Version v{n}" matched separately below


@router.get("/logs/deletions")
def deletion_logs(
    date_from:   Optional[str] = Query(None, description="YYYY-MM-DD in IST (inclusive)"),
    date_to:     Optional[str] = Query(None, description="YYYY-MM-DD in IST (inclusive)"),
    doc_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    rows = _audit_rows(db, _DELETION_ACTIONS, date_from, date_to, doc_type_id)
    return [_log_to_dict(r) for r in rows]


@router.get("/logs/deletions/download")
def deletion_logs_download(
    date_from:   Optional[str] = Query(None),
    date_to:     Optional[str] = Query(None),
    doc_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    rows = _audit_rows(db, _DELETION_ACTIONS, date_from, date_to, doc_type_id)
    dicts = [_log_to_dict(r) for r in rows]
    label = f"{date_from or 'start'}_to_{date_to or 'end'}"
    return _make_csv(dicts, f"deletion_log_{label}.csv")


@router.get("/logs/creations")
def creation_logs(
    date_from:   Optional[str] = Query(None, description="YYYY-MM-DD in IST (inclusive)"),
    date_to:     Optional[str] = Query(None, description="YYYY-MM-DD in IST (inclusive)"),
    doc_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    rows = _audit_rows(db, _CREATION_ACTIONS, date_from, date_to, doc_type_id, extra_like="New Version v%")
    return [_log_to_dict(r) for r in rows]


@router.get("/logs/creations/download")
def creation_logs_download(
    date_from:   Optional[str] = Query(None),
    date_to:     Optional[str] = Query(None),
    doc_type_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    rows = _audit_rows(db, _CREATION_ACTIONS, date_from, date_to, doc_type_id, extra_like="New Version v%")
    dicts = [_log_to_dict(r) for r in rows]
    label = f"{date_from or 'start'}_to_{date_to or 'end'}"
    return _make_csv(dicts, f"creation_log_{label}.csv")


@router.get("/logs/summary")
def logs_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Daily counts for the last 30 days (IST dates) for deletions and creations."""
    cutoff = datetime.utcnow() - timedelta(days=30)
    from sqlalchemy import or_ as _or
    rows = (
        db.query(models.AuditLog.action, models.AuditLog.timestamp)
        .filter(models.AuditLog.timestamp >= cutoff)
        .filter(_or(
            models.AuditLog.action.in_(_DELETION_ACTIONS + _CREATION_ACTIONS),
            models.AuditLog.action.ilike("New Version v%"),
        ))
        .all()
    )
    # Bucket by IST date
    daily: dict = {}
    for action, ts in rows:
        if not ts:
            continue
        ist_date = (ts + _ist_offset()).strftime("%Y-%m-%d")
        bucket = daily.setdefault(ist_date, {"date": ist_date, "deletions": 0, "creations": 0})
        if action in _DELETION_ACTIONS:
            bucket["deletions"] += 1
        else:
            bucket["creations"] += 1  # Document Created + New Version v*
    return sorted(daily.values(), key=lambda x: x["date"], reverse=True)


@router.get("/seed-metadata-schemas")
@router.post("/seed-metadata-schemas")
def seed_metadata_schemas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Apply metadata field schemas to all doc types from KDS Excel. No DB wipe."""
    updated, not_found = 0, []
    for code, fields in _METADATA_SCHEMAS.items():
        dt = db.query(models.DocumentType).filter(models.DocumentType.code == code).first()
        if dt:
            dt.metadata_schema = fields
            updated += 1
        else:
            not_found.append(code)
    db.commit()
    return {
        "message": f"Metadata schemas applied to {updated} document types",
        "updated": updated,
        "not_found": not_found,
    }
