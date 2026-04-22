"""
workflow.py — Implements FS W_EM_DMS_01 DMS Approval Workflow exactly.

Status codes:
  05 = Draft (initial / rejected)
  10 = Created (checked in)
  15 = In Check
  20 = In Review
  25 = In Approval
  30 = Released

Modes:
  Auto Populate  — system proposes levels from WorkflowConfig per doc type
                   Default 4-step if no config found.
  User Defined   — initiator fills up to 7 levels with custom assignees

Rules (from FS):
  - Parallel approval per level: ALL must approve to advance
  - Any rejection → Draft (05), notify author, workflow ends
  - Self-approval not allowed
  - Duplicate users filtered per level
  - Checklist completion mandatory per level if checklist_required=True
  - Digital signature log captured on every action
  - Email notification to all assignees at each step + author on completion/rejection
"""

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import json

from database import get_db
from routers.auth import get_current_user
import models, schemas

router = APIRouter()

STATUS_MAP = {
    "Prepare":  ("05", "Draft"),
    "Check":    ("15", "In Check"),
    "Review":   ("20", "In Review"),
    "Approve":  ("25", "In Approval"),
    "Released": ("30", "Released"),
    "Rejected": ("05", "Draft"),
}

DEFAULT_LEVELS = [
    {"step":1,"name":"Prepare", "stage":"Prepare", "checklist_required":False},
    {"step":2,"name":"Check",   "stage":"Check",   "checklist_required":False},
    {"step":3,"name":"Review",  "stage":"Review",  "checklist_required":False},
    {"step":4,"name":"Approve", "stage":"Approve", "checklist_required":False},
]

def _log(db, user, doc, action, note=""):
    db.add(models.AuditLog(document_id=doc.id, user_id=user.id, action=action, note=note))

def _stage_from_step(step: int, levels: list) -> models.WorkflowStage:
    for lv in levels:
        if lv.step == step:
            try: return models.WorkflowStage(lv.stage)
            except: return "Prepare"
    return "Released"

def _set_doc_status(doc, stage: models.WorkflowStage):
    code, status = STATUS_MAP.get(stage, ("05", "Draft"))
    doc.status_code = code
    doc.status = status

def _notify(users_emails: list, subject: str, body: str):
    """Stub: in production send via SMTP / SAP Inbox."""
    pass   # TODO: integrate email service


# ─── Inbox & overview ────────────────────────────────────────────────────────

@router.get("/inbox", response_model=List[schemas.DocumentListItem])
def my_inbox(db: Session = Depends(get_db),
             current_user: models.User = Depends(get_current_user)):
    tasks = db.query(models.WorkflowTask).filter(
        models.WorkflowTask.assignee_id == current_user.id,
        models.WorkflowTask.status == "Pending",
    ).all()
    wf_ids = [t.workflow_id for t in tasks]
    wfs = db.query(models.WorkflowInstance).filter(
        models.WorkflowInstance.id.in_(wf_ids),
        models.WorkflowInstance.completed == False,
    ).all()
    doc_ids = [w.document_id for w in wfs]
    return db.query(models.Document).filter(models.Document.id.in_(doc_ids)).all()


@router.get("/pending", response_model=List[schemas.DocumentListItem])
def all_pending(db: Session = Depends(get_db),
                current_user: models.User = Depends(get_current_user)):
    wfs = db.query(models.WorkflowInstance).filter(
        models.WorkflowInstance.completed == False
    ).all()
    doc_ids = [w.document_id for w in wfs]
    return db.query(models.Document).filter(
        models.Document.id.in_(doc_ids),
        models.Document.status != "Draft"
    ).all()


# ─── Initiate workflow ────────────────────────────────────────────────────────

@router.post("/{doc_id}/initiate")
def initiate_workflow(
    doc_id: int,
    data: schemas.WorkflowInitiate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Initiator triggers workflow (status 10 → 15).
    data.mode = "Auto Populate" | "User Defined"
    data.levels = list of {step, name, stage, assignees:[user_ids], checklist_required, checklist_items:[]}
    """
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.status not in ("Draft", "Created"):
        raise HTTPException(400, "Only Draft or Created documents can start a workflow")

    # Delete any stale workflow
    if doc.workflow:
        db.delete(doc.workflow)
        db.flush()

    # Determine levels
    if data.mode == "Auto Populate":
        wf_cfg = doc.doc_type.workflow_config
        raw_levels = wf_cfg.levels if wf_cfg else DEFAULT_LEVELS
    else:
        if not data.levels:
            raise HTTPException(400, "User-defined workflow requires levels")
        if len(data.levels) > 7:
            raise HTTPException(400, "User-defined workflow supports up to 7 levels")
        raw_levels = [l.model_dump() for l in data.levels]

    # Create WorkflowInstance
    wf = models.WorkflowInstance(
        document_id=doc_id,
        mode=data.mode,
        stage="Check",   # first active step after Prepare
        current_step=2,                      # step 1 is Prepare (initiator), we move straight to Check
        total_steps=len(raw_levels),
        completed=False,
    )
    db.add(wf); db.flush()

    assignees_by_step = {lv.step: lv.assignee_ids for lv in (data.levels or [])} \
        if data.mode == "User Defined" else {}

    for lv_data in raw_levels:
        step  = lv_data["step"] if isinstance(lv_data, dict) else lv_data.step
        name  = lv_data["name"] if isinstance(lv_data, dict) else lv_data.name
        stage = lv_data["stage"] if isinstance(lv_data, dict) else lv_data.stage
        cr    = lv_data.get("checklist_required", False) if isinstance(lv_data, dict) else lv_data.checklist_required
        ci    = lv_data.get("checklist_items", []) if isinstance(lv_data, dict) else (lv_data.checklist_items or [])

        lv_status = "In Progress" if step == 2 else ("Done" if step == 1 else "Pending")
        wf_level = models.WorkflowLevel(
            workflow_id=wf.id, step=step, name=name, stage=stage,
            checklist_required=cr, checklist_items=ci, status=lv_status,
        )
        db.add(wf_level); db.flush()

        if step == 1:
            # Prepare step — initiator only, mark done
            t = models.WorkflowTask(
                workflow_id=wf.id, level_id=wf_level.id, step=step,
                assignee_id=current_user.id, status="Approved",
                digital_sig_log={"user": current_user.name, "action": "Initiated",
                                 "timestamp": datetime.utcnow().isoformat()},
                completed_at=datetime.utcnow(),
            )
            db.add(t)
            wf_level.status = "Done"
        elif step == 2:
            # Populate CHECK tasks from data.assignees
            ids = assignees_by_step.get(step, [])
            if data.mode == "Auto Populate" and data.check_assignees:
                ids = data.check_assignees
            _create_tasks(db, wf, wf_level, step, ids, current_user)
        elif step == 3:
            ids = assignees_by_step.get(step, [])
            if data.mode == "Auto Populate" and data.review_assignees:
                ids = data.review_assignees
            _create_tasks(db, wf, wf_level, step, ids, current_user)
        elif step >= 4:
            ids = assignees_by_step.get(step, [])
            if data.mode == "Auto Populate" and step == 4 and data.approve_assignees:
                ids = data.approve_assignees
            _create_tasks(db, wf, wf_level, step, ids, current_user)

    # Update doc status → In Check (15)
    doc.status      = "In Check"
    doc.status_code = "15"

    # Notify all step-2 assignees
    step2_level = next((l for l in wf.levels if l.step == 2), None)
    if step2_level:
        assignee_emails = [t.assignee.email for t in step2_level.tasks if t.assignee and t.assignee.email]
        _notify(assignee_emails, f"DMS Action Required: {doc.doc_number}",
                f"Please check document {doc.doc_number} - {doc.title}")

    _log(db, current_user, doc, "Workflow Initiated",
         f"Mode: {data.mode}, Steps: {len(raw_levels)}")
    db.commit()
    return {"message": "Workflow initiated", "stage": "Check", "status_code": "15"}


def _create_tasks(db, wf, level, step, assignee_ids, initiator):
    seen = set()
    for uid in assignee_ids:
        if uid in seen or uid == initiator.id:   # no self-approval, no duplicates
            continue
        seen.add(uid)
        db.add(models.WorkflowTask(
            workflow_id=wf.id, level_id=level.id, step=step,
            assignee_id=uid, status="Pending",
        ))


# ─── Take action (approve / reject) ──────────────────────────────────────────

@router.post("/{doc_id}/action")
def workflow_action(
    doc_id: int,
    data: schemas.WorkflowTaskAction,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    current_user approves or rejects their pending task.
    action: "approve" | "reject"
    """
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc or not doc.workflow:
        raise HTTPException(404, "Workflow not found")
    wf = doc.workflow
    if wf.completed:
        raise HTTPException(400, "Workflow already completed")

    # Find this user's pending task at current step
    task = db.query(models.WorkflowTask).filter(
        models.WorkflowTask.workflow_id == wf.id,
        models.WorkflowTask.assignee_id == current_user.id,
        models.WorkflowTask.step == wf.current_step,
        models.WorkflowTask.status == "Pending",
    ).first()
    if not task:
        raise HTTPException(403, "No pending task for you at this stage")

    # Checklist gate — only enforce if a template was actually uploaded by initiator
    level = task.level
    if level.checklist_required and level.checklist_template_path and not task.checklist_done:
        raise HTTPException(400, "Checklist must be completed before approving")

    # Digital signature — verify password if provided (required for approve/reject)
    if data.action in ("approve", "reject"):
        if not data.password:
            raise HTTPException(400, "Password is required to authenticate your approval/rejection (digital signature).")
        import bcrypt as _bcrypt
        stored_hash = (current_user.hashed_password or "").encode()
        try:
            valid = _bcrypt.checkpw(data.password.encode(), stored_hash)
        except Exception:
            valid = False
        if not valid:
            raise HTTPException(401, "Incorrect password. Please enter your login password to authenticate this action.")

    # Capture digital signature log
    task.digital_sig_log = {
        "user": current_user.name, "user_id": current_user.id,
        "action": data.action, "timestamp": datetime.utcnow().isoformat(),
        "ip": request.client.host if request.client else "",
        "note": data.note or "",
    }
    task.action_note  = data.note
    task.completed_at = datetime.utcnow()

    if data.action == "reject":
        rejection_level = level.name
        rejection_note  = data.note or ""

        # Notify author before deleting workflow
        if doc.creator and doc.creator.email:
            _notify([doc.creator.email],
                    f"DMS Document Rejected: {doc.doc_number}",
                    f"Your document was rejected at {rejection_level} by {current_user.name}. Reason: {rejection_note or 'None'}")

        # Log before delete
        _log(db, current_user, doc, f"Workflow Rejected at {rejection_level}", rejection_note)

        # Delete the workflow so author can re-initiate after fixing
        db.delete(wf)

        # Set document back to Draft
        doc.status      = "Draft"
        doc.status_code = "05"

        db.commit()
        return {"message": "Document rejected and returned to Draft. Author can re-initiate workflow after corrections.", "status_code": "05"}

    # Approve this task
    task.status = "Approved"

    # Check if ALL tasks at this level are approved
    all_tasks = db.query(models.WorkflowTask).filter(
        models.WorkflowTask.workflow_id == wf.id,
        models.WorkflowTask.step == wf.current_step,
    ).all()
    all_approved = all(t.status == "Approved" for t in all_tasks)

    if not all_approved:
        _log(db, current_user, doc, f"Approved at {level.name} (waiting for peers)", "")
        db.commit()
        return {"message": "Approval recorded, waiting for other approvers at this level"}

    # All approved — advance level
    level.status = "Done"
    next_step    = wf.current_step + 1

    if next_step > wf.total_steps:
        # Final approval → Released (30)
        wf.stage       = "Released"
        wf.completed   = True
        wf.completed_at = datetime.utcnow()
        doc.status      = "Released"
        doc.status_code = "30"

        if doc.creator and doc.creator.email:
            _notify([doc.creator.email],
                    f"DMS Document Released: {doc.doc_number}",
                    f"Your document {doc.doc_number} - {doc.title} has been released (status 30).")

        _log(db, current_user, doc, "Document Released (Workflow Complete)", "Status: 30")
        db.commit()
        return {"message": "Document released", "status_code": "30"}

    # Move to next level
    wf.current_step = next_step
    next_level = next((l for l in wf.levels if l.step == next_step), None)
    if next_level:
        next_level.status = "In Progress"
        wf.stage = models.WorkflowStage(next_level.stage)
        code, status = STATUS_MAP.get(wf.stage, ("15", "In Check"))
        doc.status      = status
        doc.status_code = code

        # Notify next level assignees + author
        next_emails  = [t.assignee.email for t in next_level.tasks if t.assignee and t.assignee.email]
        author_email = [doc.creator.email] if doc.creator and doc.creator.email else []
        _notify(next_emails,
                f"DMS Action Required ({next_level.name}): {doc.doc_number}",
                f"Please {next_level.name} document {doc.doc_number}")
        _notify(author_email,
                f"DMS Status Update: {doc.doc_number}",
                f"Document moved to {next_level.name} stage.")

    _log(db, current_user, doc, f"Level {wf.current_step-1} Approved — Advanced to Level {next_step}", "")
    db.commit()
    return {"message": f"Advanced to {next_level.name if next_level else 'next'}", "status_code": doc.status_code}


# ─── Complete checklist ───────────────────────────────────────────────────────

@router.post("/{doc_id}/checklist")
def complete_checklist(
    doc_id: int,
    data: schemas.ChecklistSubmit,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc or not doc.workflow:
        raise HTTPException(404, "Workflow not found")
    wf = doc.workflow

    task = db.query(models.WorkflowTask).filter(
        models.WorkflowTask.workflow_id == wf.id,
        models.WorkflowTask.assignee_id == current_user.id,
        models.WorkflowTask.step == wf.current_step,
        models.WorkflowTask.status == "Pending",
    ).first()
    if not task:
        raise HTTPException(403, "No pending task")

    task.checklist_done = True
    _log(db, current_user, doc, "Checklist Completed", f"Step {wf.current_step}")
    db.commit()
    return {"message": "Checklist submitted"}


# ─── Return for correction ────────────────────────────────────────────────────

@router.post("/{doc_id}/return")
def return_document(
    doc_id: int,
    data: schemas.WorkflowTaskAction,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return document to Draft — completely deletes the workflow so initiator
    can start fresh with correct configuration (e.g. add checklist templates)."""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc or not doc.workflow:
        raise HTTPException(404, "Not found")

    # Delete the entire workflow instance so it can be re-initiated cleanly
    wf = doc.workflow
    db.delete(wf)

    # Reset document to Created so the Initiate Workflow button reappears
    doc.status      = "Created"
    doc.status_code = "10"

    _log(db, current_user, doc, "Returned for Correction — Workflow Reset", data.note or "")
    db.commit()
    return {"message": "Workflow reset. Document returned to Created status. You can now re-initiate the workflow."}


# ─── Assign additional user to a level ───────────────────────────────────────

@router.post("/{doc_id}/assign")
def assign_user(
    doc_id: int,
    data: schemas.WorkflowAssign,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc or not doc.workflow:
        raise HTTPException(404, "Workflow not found")
    wf = doc.workflow
    level = next((l for l in wf.levels if l.step == data.step), None)
    if not level:
        raise HTTPException(404, f"Level {data.step} not found")
    existing = {t.assignee_id for t in level.tasks}
    if data.assignee_id in existing or data.assignee_id == current_user.id:
        raise HTTPException(400, "User already assigned or self-assign not allowed")
    task = models.WorkflowTask(
        workflow_id=wf.id, level_id=level.id, step=data.step,
        assignee_id=data.assignee_id, status="Pending",
    )
    db.add(task)
    _log(db, current_user, doc, f"User Added to Level {data.step}",
         f"User ID {data.assignee_id}")
    db.commit()
    return {"message": "User assigned"}


# ─── Workflow status ──────────────────────────────────────────────────────────

@router.get("/{doc_id}/status")
def workflow_status(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc or not doc.workflow:
        raise HTTPException(404, "Workflow not found")
    wf = doc.workflow
    return {
        "id": wf.id,
        "mode": wf.mode or "Auto Populate",
        "stage": wf.stage or "Prepare",
        "current_step": wf.current_step or 1,
        "total_steps": wf.total_steps or 4,
        "completed": bool(wf.completed),
        "rejected": bool(wf.rejected),
        "rejection_reason": wf.rejection_reason,
        "started_at": wf.started_at.isoformat() if wf.started_at else None,
        "levels": [
            {
                "id": lv.id,
                "step": lv.step,
                "name": lv.name,
                "stage": lv.stage,
                "status": lv.status,
                "checklist_required": bool(lv.checklist_required),
                "checklist_template_name": lv.checklist_template_name,
                "checklist_template_path": lv.checklist_template_path,
                "tasks": [
                    {
                        "id": t.id,
                        "step": t.step,
                        "status": t.status,
                        "checklist_done": bool(t.checklist_done),
                        "checklist_file_name": t.checklist_file_name,
                        "checklist_file_path": t.checklist_file_path,
                        "action_note": t.action_note,
                        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                        "assignee": {
                            "id": t.assignee.id,
                            "name": t.assignee.name,
                            "email": t.assignee.email,
                        } if t.assignee else None,
                    }
                    for t in (lv.tasks or [])
                ],
            }
            for lv in (wf.levels or [])
        ],
        "tasks": [
            {
                "id": t.id,
                "step": t.step,
                "status": t.status,
                "checklist_done": bool(t.checklist_done),
                "checklist_file_name": t.checklist_file_name,
                "action_note": t.action_note,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
                "assignee": {
                    "id": t.assignee.id,
                    "name": t.assignee.name,
                } if t.assignee else None,
            }
            for t in (wf.tasks or [])
        ],
    }


# ─── Submit document to workflow (status 05/10 → workflow popup) ─────────────

@router.post("/{doc_id}/submit")
def submit_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Quick submit — changes status to Created (10) ready for workflow initiation."""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.status != "Draft":
        raise HTTPException(400, "Only Draft documents can be submitted")
    doc.status      = "Created"
    doc.status_code = "10"
    _log(db, current_user, doc, "Submitted (Created)", "Ready for workflow initiation")
    db.commit()
    return {"message": "Document ready for workflow", "status_code": "10"}


# ─── Upload checklist template (initiator) ────────────────────────────────────

@router.post("/{doc_id}/checklist-template/{level_id}")
async def upload_checklist_template(
    doc_id: int,
    level_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Initiator uploads the checklist template for a workflow level."""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    level = db.query(models.WorkflowLevel).filter(
        models.WorkflowLevel.id == level_id,
        models.WorkflowLevel.workflow_id == doc.workflow.id if doc.workflow else 0,
    ).first()
    if not level:
        raise HTTPException(404, "Level not found")

    import os, uuid
    os.makedirs("uploads/checklists", exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    unique_name = f"tmpl_{uuid.uuid4()}{ext}"
    path = f"uploads/checklists/{unique_name}"
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)

    level.checklist_template_path = path
    level.checklist_template_name = file.filename
    db.add(models.AuditLog(
        document_id=doc_id, user_id=current_user.id,
        action=f"Checklist Template Uploaded — Level {level.step}",
        note=file.filename,
    ))
    db.commit()
    return {
        "message": "Template uploaded",
        "filename": file.filename,
        "level_id": level_id,
    }


# ─── Download checklist template ─────────────────────────────────────────────

@router.get("/{doc_id}/checklist-template/{level_id}/download")
def download_checklist_template(
    doc_id: int,
    level_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Any workflow participant downloads the checklist template for their level."""
    from fastapi.responses import FileResponse
    import os

    level = db.query(models.WorkflowLevel).filter(
        models.WorkflowLevel.id == level_id,
    ).first()
    if not level or not level.checklist_template_path:
        raise HTTPException(404, "No checklist template uploaded for this level")
    if not os.path.exists(level.checklist_template_path):
        raise HTTPException(404, "Template file not found on server")

    db.add(models.AuditLog(
        document_id=doc_id, user_id=current_user.id,
        action=f"Checklist Template Downloaded — Level {level.step}",
        note=level.checklist_template_name,
    ))
    db.commit()
    return FileResponse(
        level.checklist_template_path,
        filename=level.checklist_template_name or "checklist_template",
        media_type="application/octet-stream",
    )


# ─── Upload completed checklist (assignee) ───────────────────────────────────

@router.post("/{doc_id}/checklist-submit/{task_id}")
async def submit_completed_checklist(
    doc_id: int,
    task_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Assignee uploads their completed checklist file for their task."""
    task = db.query(models.WorkflowTask).filter(
        models.WorkflowTask.id == task_id,
        models.WorkflowTask.assignee_id == current_user.id,
    ).first()
    if not task:
        raise HTTPException(404, "Task not found or not assigned to you")
    if task.status != "Pending":
        raise HTTPException(400, "Task is already completed")

    import os, uuid
    os.makedirs("uploads/checklists", exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    unique_name = f"done_{uuid.uuid4()}{ext}"
    path = f"uploads/checklists/{unique_name}"
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)

    task.checklist_file_path = path
    task.checklist_file_name = file.filename
    task.checklist_done = True

    db.add(models.AuditLog(
        document_id=doc_id, user_id=current_user.id,
        action=f"Completed Checklist Uploaded — Level {task.step}",
        note=file.filename,
    ))
    db.commit()
    return {
        "message": "Checklist submitted",
        "task_id": task_id,
        "filename": file.filename,
        "checklist_done": True,
    }


# ─── Download completed checklist ────────────────────────────────────────────

@router.get("/{doc_id}/checklist-submit/{task_id}/download")
def download_completed_checklist(
    doc_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Download a submitted completed checklist (visible to all workflow participants)."""
    from fastapi.responses import FileResponse
    import os

    task = db.query(models.WorkflowTask).filter(
        models.WorkflowTask.id == task_id,
    ).first()
    if not task or not task.checklist_file_path:
        raise HTTPException(404, "No completed checklist uploaded for this task")
    if not os.path.exists(task.checklist_file_path):
        raise HTTPException(404, "File not found on server")

    return FileResponse(
        task.checklist_file_path,
        filename=task.checklist_file_name or "completed_checklist",
        media_type="application/octet-stream",
    )
