"""
schemas.py — All Pydantic request/response models for NPCIL DMS
Consolidated single source of truth.
"""
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime


# ─── Auth ─────────────────────────────────────────────────────────────────────

class AuthCodeVerify(BaseModel):
    code: str

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"

class UserOut(BaseModel):
    id: int
    sap_username: Optional[str] = None
    employee_id: Optional[str] = None
    name: str
    email: str
    department: Optional[str] = None
    role: Optional[str] = None
    dms_enabled: bool = True
    can_create: bool = True
    can_edit: bool = True
    can_delete: bool = False
    can_read: bool = True
    auth_codes: Optional[str] = ""
    is_active: bool = True
    is_sso_user: bool = False
    last_login: Optional[Any] = None
    profile_picture: Optional[str] = None
    model_config = {"from_attributes": True}

class UserCreate(BaseModel):
    sap_username: Optional[str] = None
    employee_id: Optional[str] = None
    name: str
    email: str
    department: Optional[str] = None
    role: Optional[str] = None
    dms_enabled: bool = True
    can_create: bool = True
    can_edit: bool = True
    can_delete: bool = False
    can_read: bool = True
    auth_codes: Optional[str] = ""
    password: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    sap_username: Optional[str] = None
    employee_id: Optional[str] = None
    department: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    dms_enabled: Optional[bool] = None
    can_create: Optional[bool] = None
    can_edit: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_read: Optional[bool] = None
    auth_codes: Optional[str] = None
    password: Optional[str] = None


# ─── System Config ────────────────────────────────────────────────────────────

class SystemConfigUpdate(BaseModel):
    auth_code_enabled: Optional[bool] = None
    auth_code: Optional[str] = None
    sap_sso_enabled: Optional[bool] = None
    sap_sso_entity_id: Optional[str] = None
    sap_sso_sso_url: Optional[str] = None
    sap_sso_slo_url: Optional[str] = None
    sap_sso_cert: Optional[str] = None
    sap_sso_sp_entity_id: Optional[str] = None
    app_name: Optional[str] = None
    app_org: Optional[str] = None
    frontend_url: Optional[str] = None
    prepare_locked_fields: Optional[str] = None


# ─── Document Types ───────────────────────────────────────────────────────────

class DocTypeFileFormatOut(BaseModel):
    id: int
    extension: str
    label: Optional[str] = None
    icon: Optional[str] = None
    mime_type: Optional[str] = None
    model_config = {"from_attributes": True}

class DocTypeFileFormatIn(BaseModel):
    extension: str
    label: Optional[str] = ""
    icon: Optional[str] = ""
    mime_type: Optional[str] = ""

class DocumentTypeOut(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    auth_required: bool = False
    auth_code: Optional[str] = ""
    metadata_schema: Optional[Any] = None
    number_pattern: Optional[str] = None
    is_active: bool = True
    allowed_formats: List[DocTypeFileFormatOut] = []
    model_config = {"from_attributes": True}

class DocumentTypeCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    auth_required: bool = False
    auth_code: Optional[str] = ""
    metadata_schema: Optional[Any] = None
    number_pattern: Optional[str] = None
    allowed_formats: Optional[List[DocTypeFileFormatIn]] = []

class DocumentTypeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    auth_required: Optional[bool] = None
    auth_code: Optional[str] = None
    metadata_schema: Optional[Any] = None
    number_pattern: Optional[str] = None
    is_active: Optional[bool] = None
    allowed_formats: Optional[List[DocTypeFileFormatIn]] = None


# ─── Documents ────────────────────────────────────────────────────────────────

class DocumentVersionOut(BaseModel):
    id: int
    version_number: str
    is_major: bool = False
    change_reason: Optional[str] = None
    change_label: Optional[str] = None
    created_at: Any
    created_by: Optional[UserOut] = None
    model_config = {"from_attributes": True}

class DocumentFileOut(BaseModel):
    id: int
    filename: str
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    file_format: Optional[str] = None
    uploaded_at: Any
    model_config = {"from_attributes": True}

class DocumentFeedbackOut(BaseModel):
    id: int
    comment: str
    created_at: Any
    user: Optional[UserOut] = None
    model_config = {"from_attributes": True}

class FeedbackCreate(BaseModel):
    comment: str

class AuditLogOut(BaseModel):
    id: int
    action: str
    note: Optional[str] = None
    old_value: Optional[Dict] = None
    new_value: Optional[Dict] = None
    timestamp: Any
    user: Optional[UserOut] = None
    model_config = {"from_attributes": True}

class CheckoutAction(BaseModel):
    action: str  # "checkout" | "checkin"

class ReferenceCreate(BaseModel):
    target_doc_id: int
    note: Optional[str] = None

class DocumentCreate(BaseModel):
    title: str
    doc_type_id: int
    project: Optional[str] = None
    usi_kks_code: Optional[str] = None
    serial_no: Optional[str] = None
    confidential: bool = False
    expiry_date: Optional[datetime] = None
    renewal_date: Optional[datetime] = None
    revision_due: Optional[datetime] = None
    custom_metadata: Optional[Dict] = {}
    tags: Optional[List[str]] = []
    change_reason: Optional[str] = "Initial upload"

class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    project: Optional[str] = None
    usi_kks_code: Optional[str] = None
    confidential: Optional[bool] = None
    expiry_date: Optional[datetime] = None
    renewal_date: Optional[datetime] = None
    revision_due: Optional[datetime] = None
    custom_metadata: Optional[Dict] = None
    tags: Optional[List[str]] = None


# ─── Workflow Level & Instance ─────────────────────────────────────────────────

class WorkflowTaskOut(BaseModel):
    id: int
    step: int
    status: str
    checklist_done: bool = False
    digital_sig_log: Optional[Dict] = None
    action_note: Optional[str] = None
    completed_at: Optional[Any] = None
    assignee: Optional[UserOut] = None
    model_config = {"from_attributes": True}

class WorkflowLevelOut(BaseModel):
    id: int
    step: int
    name: str
    stage: str
    checklist_required: bool = False
    checklist_items: Optional[List] = []
    status: str = "Pending"
    tasks: List[WorkflowTaskOut] = []
    model_config = {"from_attributes": True}

class WorkflowInstanceOut(BaseModel):
    id: int
    mode: str
    stage: str
    current_step: int = 1
    total_steps: int = 4
    completed: bool = False
    rejected: bool = False
    rejection_reason: Optional[str] = None
    started_at: Any
    levels: List[WorkflowLevelOut] = []
    model_config = {"from_attributes": True}

class WorkflowLevelIn(BaseModel):
    step: int
    name: str
    stage: str
    checklist_required: bool = False
    checklist_items: Optional[List] = []
    assignee_ids: Optional[List[int]] = []

class WorkflowInitiate(BaseModel):
    mode: str = "Auto Populate"
    levels: Optional[List[WorkflowLevelIn]] = None
    check_assignees: Optional[List[int]] = []
    review_assignees: Optional[List[int]] = []
    approve_assignees: Optional[List[int]] = []

class WorkflowTaskAction(BaseModel):
    action: str              # "approve" | "reject" | "return"
    note: Optional[str] = None
    password: Optional[str] = None  # For digital signature re-authentication

class WorkflowAssign(BaseModel):
    step: int
    assignee_id: int

class ChecklistSubmit(BaseModel):
    items_done: Optional[List] = []

# Legacy alias kept for backward compatibility
class WorkflowAction(BaseModel):
    action: str
    note: Optional[str] = None
    rationale: Optional[str] = None


# ─── Document list / detail ────────────────────────────────────────────────────

class DocumentListItem(BaseModel):
    id: int
    doc_number: str
    serial_no: Optional[str] = None
    title: str
    project: Optional[str] = None
    usi_kks_code: Optional[str] = None
    current_version: str = "1.0"
    status: str
    status_code: Optional[str] = "05"
    confidential: bool = False
    checked_out: bool = False
    created_at: Any
    expiry_date: Optional[Any] = None
    doc_type: Optional[DocumentTypeOut] = None
    workflow: Optional[WorkflowInstanceOut] = None
    model_config = {"from_attributes": True}

class DocumentOut(BaseModel):
    id: int
    doc_number: str
    serial_no: Optional[str] = None
    title: str
    project: Optional[str] = None
    usi_kks_code: Optional[str] = None
    current_version: str = "1.0"
    status: str
    status_code: Optional[str] = "05"
    confidential: bool = False
    created_at: Any
    updated_at: Optional[Any] = None
    expiry_date: Optional[Any] = None
    renewal_date: Optional[Any] = None
    revision_due: Optional[Any] = None
    checked_out: bool = False
    checked_out_by: Optional[int] = None
    custom_metadata: Optional[Dict] = {}
    tags: Optional[List[str]] = []
    doc_type: Optional[DocumentTypeOut] = None
    creator: Optional[UserOut] = None
    responsible_person: Optional[UserOut] = None
    versions: List[DocumentVersionOut] = []
    files: List[DocumentFileOut] = []
    feedbacks: List[DocumentFeedbackOut] = []
    audit_logs: List[AuditLogOut] = []
    workflow: Optional[WorkflowInstanceOut] = None
    model_config = {"from_attributes": True}


# ─── Alerts ───────────────────────────────────────────────────────────────────

class AlertConfigOut(BaseModel):
    id: int
    doc_type_id: int
    enabled: bool = True
    lead_days: str = "30,15,7"
    notify_author: bool = True
    notify_roles: str = ""
    model_config = {"from_attributes": True}

class AlertConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    lead_days: Optional[str] = None
    notify_author: Optional[bool] = None
    notify_roles: Optional[str] = None

class AlertLogOut(BaseModel):
    id: int
    alert_type: str
    status: str
    sent_at: Any
    document: Optional[Any] = None
    recipients: List = []
    model_config = {"from_attributes": True}


# ─── Reports ──────────────────────────────────────────────────────────────────

class ReportQuery(BaseModel):
    doc_type_id: Optional[int] = None
    status: Optional[str] = None
    project: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


# ─── Number Reservations ──────────────────────────────────────────────────────

class ReserveNumbers(BaseModel):
    doc_type_id: int
    usi_kks: Optional[str] = None
    range_start: int
    range_end: int
    label: str = "RESERVED"
