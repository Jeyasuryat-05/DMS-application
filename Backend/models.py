from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text,
    ForeignKey, Enum, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


# ─── Enumerations ─────────────────────────────────────────────────────────────

class DocumentStatus(str, enum.Enum):
    DRAFT        = "Draft"
    CREATED      = "Created"
    IN_CHECK     = "In Check"
    IN_REVIEW    = "In Review"
    IN_APPROVAL  = "In Approval"
    UNDER_REVIEW = "In Review"   # alias kept for backward compat
    APPROVED     = "Approved"
    RELEASED     = "Released"
    REJECTED     = "Rejected"
    ARCHIVED     = "Archived"
    EXPIRED      = "Expired"


class WorkflowStage(str, enum.Enum):
    PREPARE  = "Prepare"
    CHECK    = "Check"
    REVIEW   = "Review"
    APPROVE  = "Approve"
    RELEASED = "Released"
    REJECTED = "Rejected"


class WorkflowMode(str, enum.Enum):
    AUTO         = "Auto Populate"
    USER_DEFINED = "User Defined"


class AlertStatus(str, enum.Enum):
    PENDING = "Pending"
    SENT    = "Sent"
    FAILED  = "Failed"


# ─── JSON default factories ────────────────────────────────────────────────────
def _default_wf_levels():
    return [
        {"step": 1, "name": "Prepare", "stage": "Prepare", "checklist_required": False},
        {"step": 2, "name": "Check",   "stage": "Check",   "checklist_required": True},
        {"step": 3, "name": "Review",  "stage": "Review",  "checklist_required": True},
        {"step": 4, "name": "Approve", "stage": "Approve", "checklist_required": False},
    ]
def _empty_dict(): return {}
def _empty_list(): return []


# ─── System Config ─────────────────────────────────────────────────────────────
class SystemConfig(Base):
    __tablename__ = "system_config"
    id         = Column(Integer, primary_key=True)
    key        = Column(String(100), unique=True, nullable=False, index=True)
    value      = Column(Text)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())


# ─── User ─────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id              = Column(Integer, primary_key=True, index=True)
    sap_username    = Column(String(100), unique=True, index=True, nullable=True)
    employee_id     = Column(String(50), nullable=True)
    name            = Column(String(200), nullable=False)
    email           = Column(String(200), unique=True, index=True)
    department      = Column(String(100), nullable=True)
    role            = Column(String(100), nullable=True)
    dms_enabled     = Column(Boolean, default=True)
    can_create      = Column(Boolean, default=True)
    can_edit        = Column(Boolean, default=True)
    can_delete      = Column(Boolean, default=False)
    can_read        = Column(Boolean, default=True)
    auth_codes      = Column(String(500), default="")
    hashed_password  = Column(String(200), nullable=True)
    is_active        = Column(Boolean, default=True)
    is_sso_user      = Column(Boolean, default=False)
    sso_name_id      = Column(String(300), nullable=True)
    last_login       = Column(DateTime(timezone=True), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    profile_picture  = Column(String(500), nullable=True)

    documents_created = relationship("Document", back_populates="creator", foreign_keys="Document.creator_id")
    audit_entries     = relationship("AuditLog", back_populates="user")
    workflow_tasks    = relationship("WorkflowTask", back_populates="assignee")
    # feedbacks accessed via DocumentFeedback.user relationship (child-defined)
    alert_recipients  = relationship("AlertRecipient", back_populates="user")


class Role(Base):
    __tablename__ = "roles"
    id          = Column(Integer, primary_key=True)
    name        = Column(String(100), unique=True)
    permissions = Column(JSON, default=_empty_dict)
    description = Column(Text, nullable=True)


# ─── Document Type ─────────────────────────────────────────────────────────────
class DocumentType(Base):
    __tablename__ = "document_types"
    id              = Column(Integer, primary_key=True)
    code            = Column(String(50), unique=True, nullable=False)
    name            = Column(String(200), nullable=False)
    description     = Column(Text, nullable=True)
    auth_required   = Column(Boolean, default=False)
    auth_code       = Column(String(100), default="")
    metadata_schema = Column(JSON, default=_empty_dict)
    number_pattern  = Column(String(200), default="{CODE}-{YEAR}-{SEQ}")
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    documents       = relationship("Document", back_populates="doc_type")
    allowed_formats = relationship("DocTypeFileFormat", back_populates="doc_type", cascade="all, delete-orphan")
    workflow_config = relationship("WorkflowConfig", back_populates="doc_type", uselist=False, cascade="all, delete-orphan")
    alert_config    = relationship("AlertConfig", back_populates="doc_type", uselist=False, cascade="all, delete-orphan")


class DocTypeFileFormat(Base):
    __tablename__ = "doc_type_file_formats"
    __table_args__ = (UniqueConstraint("doc_type_id", "extension"),)
    id          = Column(Integer, primary_key=True)
    doc_type_id = Column(Integer, ForeignKey("document_types.id", ondelete="CASCADE"))
    extension   = Column(String(20), nullable=False)
    label       = Column(String(50), nullable=True)
    icon        = Column(String(10), nullable=True)
    mime_type   = Column(String(100), nullable=True)
    doc_type    = relationship("DocumentType", back_populates="allowed_formats")


class WorkflowConfig(Base):
    __tablename__ = "workflow_configs"
    id          = Column(Integer, primary_key=True)
    doc_type_id = Column(Integer, ForeignKey("document_types.id", ondelete="CASCADE"), unique=True)
    levels      = Column(JSON, default=_default_wf_levels)
    doc_type    = relationship("DocumentType", back_populates="workflow_config")


class AlertConfig(Base):
    __tablename__ = "alert_configs"
    id            = Column(Integer, primary_key=True)
    doc_type_id   = Column(Integer, ForeignKey("document_types.id", ondelete="CASCADE"), unique=True)
    enabled       = Column(Boolean, default=True)
    lead_days     = Column(String(50), default="30,15,7")
    notify_author = Column(Boolean, default=True)
    notify_roles  = Column(String(200), default="")
    doc_type      = relationship("DocumentType", back_populates="alert_config")


class AlertLog(Base):
    __tablename__ = "alert_logs"
    id          = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    alert_type  = Column(String(50))
    status      = Column(Enum(AlertStatus), default=AlertStatus.PENDING)
    sent_at     = Column(DateTime(timezone=True), server_default=func.now())
    error_msg   = Column(Text, nullable=True)
    document    = relationship("Document")
    recipients  = relationship("AlertRecipient", back_populates="alert_log", cascade="all, delete-orphan")


class AlertRecipient(Base):
    __tablename__ = "alert_recipients"
    id           = Column(Integer, primary_key=True)
    alert_log_id = Column(Integer, ForeignKey("alert_logs.id", ondelete="CASCADE"))
    user_id      = Column(Integer, ForeignKey("users.id"))
    email        = Column(String(200))
    delivered    = Column(Boolean, default=False)
    alert_log    = relationship("AlertLog", back_populates="recipients")
    user         = relationship("User", back_populates="alert_recipients")


# ─── Document ─────────────────────────────────────────────────────────────────
class Document(Base):
    __tablename__ = "documents"
    id              = Column(Integer, primary_key=True, index=True)
    doc_number      = Column(String(100), unique=True, index=True)
    serial_no       = Column(String(200), index=True, nullable=True)
    title           = Column(String(500), nullable=False)
    doc_type_id     = Column(Integer, ForeignKey("document_types.id"))
    project         = Column(String(200), nullable=True)
    usi_kks_code    = Column(String(100), nullable=True)
    current_version = Column(String(20), default="1.0")
    status          = Column(String(30), default="Draft")   # store as plain string — no enum column
    status_code     = Column(String(5), default="05")
    confidential    = Column(Boolean, default=False)
    is_deleted      = Column(Boolean, default=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())
    expiry_date     = Column(DateTime, nullable=True)
    renewal_date    = Column(DateTime, nullable=True)
    revision_due    = Column(DateTime, nullable=True)
    checked_out     = Column(Boolean, default=False)
    checked_out_by  = Column(Integer, ForeignKey("users.id"), nullable=True)
    checked_out_at  = Column(DateTime, nullable=True)
    flagged_for_deletion = Column(Boolean, default=False)
    flagged_at           = Column(DateTime, nullable=True)
    flagged_by_id        = Column(Integer, ForeignKey("users.id"), nullable=True)
    creator_id             = Column(Integer, ForeignKey("users.id"))
    responsible_person_id  = Column(Integer, ForeignKey("users.id"), nullable=True)
    custom_metadata = Column(JSON, default=_empty_dict)
    tags            = Column(JSON, default=_empty_list)

    doc_type           = relationship("DocumentType", back_populates="documents")
    creator            = relationship("User", back_populates="documents_created", foreign_keys=[creator_id])
    responsible_person = relationship("User", foreign_keys=[responsible_person_id])
    versions           = relationship("DocumentVersion", back_populates="document", order_by="DocumentVersion.version_number")
    files              = relationship("DocumentFile", back_populates="document")
    audit_logs         = relationship("AuditLog", back_populates="document", order_by="AuditLog.timestamp")
    workflow           = relationship("WorkflowInstance", back_populates="document", uselist=False)
    feedbacks          = relationship("DocumentFeedback", back_populates="document")
    references         = relationship("DocumentReference", foreign_keys="DocumentReference.source_id", back_populates="source")


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id             = Column(Integer, primary_key=True)
    document_id    = Column(Integer, ForeignKey("documents.id"))
    version_number = Column(String(20))
    is_major       = Column(Boolean, default=False)
    change_reason  = Column(Text, nullable=True)
    change_label   = Column(String(200), nullable=True)
    created_by_id  = Column(Integer, ForeignKey("users.id"))
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    file_path      = Column(String(500), nullable=True)
    document       = relationship("Document", back_populates="versions")
    created_by     = relationship("User")


class DocumentFile(Base):
    __tablename__ = "document_files"
    id          = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    filename    = Column(String(300))
    file_path   = Column(String(500))
    file_size   = Column(Integer, nullable=True)
    mime_type   = Column(String(100), nullable=True)
    file_format = Column(String(20), nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    document    = relationship("Document", back_populates="files")


class DocumentReference(Base):
    __tablename__ = "document_references"
    id        = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("documents.id"))
    target_id = Column(Integer, ForeignKey("documents.id"))
    note      = Column(Text, nullable=True)
    source    = relationship("Document", foreign_keys=[source_id], back_populates="references")
    target    = relationship("Document", foreign_keys=[target_id])


class DocumentFeedback(Base):
    __tablename__ = "document_feedback"
    id             = Column(Integer, primary_key=True)
    document_id    = Column(Integer, ForeignKey("documents.id"))
    user_id        = Column(Integer, ForeignKey("users.id"))
    tagged_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    comment        = Column(Text, nullable=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    document       = relationship("Document", back_populates="feedbacks")
    user           = relationship("User", foreign_keys=[user_id], overlaps="feedbacks")
    tagged_user    = relationship("User", foreign_keys=[tagged_user_id], overlaps="feedbacks")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id          = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=True)
    action      = Column(String(200))
    old_value   = Column(JSON, nullable=True)
    new_value   = Column(JSON, nullable=True)
    note        = Column(Text, nullable=True)
    ip_address  = Column(String(50), nullable=True)
    timestamp   = Column(DateTime(timezone=True), server_default=func.now())
    document    = relationship("Document", back_populates="audit_logs")
    user        = relationship("User", back_populates="audit_entries")


class FileAccessLog(Base):
    __tablename__ = "file_access_logs"
    id          = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"))
    file_id     = Column(Integer, ForeignKey("document_files.id"))
    user_id     = Column(Integer, ForeignKey("users.id"))
    action      = Column(String(20))   # "view" or "download"
    accessed_at = Column(DateTime(timezone=True), server_default=func.now())
    file        = relationship("DocumentFile")
    user        = relationship("User")


class WorkflowHistorySnapshot(Base):
    __tablename__ = "workflow_history_snapshots"
    id           = Column(Integer, primary_key=True)
    document_id  = Column(Integer, ForeignKey("documents.id"))
    outcome      = Column(String(20))  # "rejected" or "released"
    rejected_at_stage = Column(String(30), nullable=True)
    rejection_note    = Column(Text, nullable=True)
    snapshot_at  = Column(DateTime(timezone=True), server_default=func.now())
    initiated_at = Column(DateTime(timezone=True), nullable=True)
    mode         = Column(String(30), nullable=True)
    snapshot     = Column(JSON, nullable=True)  # full JSON: levels + tasks with sigs/checklists
    document     = relationship("Document")


class WorkflowInstance(Base):
    __tablename__ = "workflow_instances"
    id               = Column(Integer, primary_key=True)
    document_id      = Column(Integer, ForeignKey("documents.id"), unique=True)
    mode             = Column(String(30), default="Auto Populate")
    stage            = Column(String(30), default="Prepare")
    current_step     = Column(Integer, default=1)
    total_steps      = Column(Integer, default=4)
    started_at       = Column(DateTime(timezone=True), server_default=func.now())
    completed        = Column(Boolean, default=False)
    completed_at     = Column(DateTime, nullable=True)
    rejected         = Column(Boolean, default=False)
    rejection_reason = Column(Text, nullable=True)
    document         = relationship("Document", back_populates="workflow")
    tasks            = relationship("WorkflowTask", back_populates="workflow", order_by="WorkflowTask.step")
    levels           = relationship("WorkflowLevel", back_populates="workflow", order_by="WorkflowLevel.step", cascade="all, delete-orphan")


class WorkflowLevel(Base):
    __tablename__ = "workflow_levels"
    id                       = Column(Integer, primary_key=True)
    workflow_id              = Column(Integer, ForeignKey("workflow_instances.id", ondelete="CASCADE"))
    step                     = Column(Integer)
    name                     = Column(String(100))
    stage                    = Column(String(30))
    checklist_required       = Column(Boolean, default=False)
    checklist_items          = Column(JSON, default=_empty_list)
    status                   = Column(String(30), default="Pending")
    # Template uploaded by initiator
    checklist_template_path  = Column(String(500), nullable=True)
    checklist_template_name  = Column(String(300), nullable=True)
    workflow                 = relationship("WorkflowInstance", back_populates="levels")
    tasks                    = relationship("WorkflowTask", back_populates="level", cascade="all, delete-orphan")


class WorkflowTask(Base):
    __tablename__ = "workflow_tasks"
    id                      = Column(Integer, primary_key=True)
    workflow_id             = Column(Integer, ForeignKey("workflow_instances.id"))
    level_id                = Column(Integer, ForeignKey("workflow_levels.id", ondelete="CASCADE"))
    step                    = Column(Integer)
    assignee_id             = Column(Integer, ForeignKey("users.id"))
    status                  = Column(String(30), default="Pending")
    checklist_done          = Column(Boolean, default=False)
    # Completed checklist uploaded by assignee
    checklist_file_path     = Column(String(500), nullable=True)
    checklist_file_name     = Column(String(300), nullable=True)
    digital_sig_log         = Column(JSON, nullable=True)
    rationale               = Column(Text, nullable=True)
    action_note             = Column(Text, nullable=True)
    completed_at            = Column(DateTime, nullable=True)
    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    workflow                = relationship("WorkflowInstance", back_populates="tasks")
    level                   = relationship("WorkflowLevel", back_populates="tasks")
    assignee                = relationship("User", back_populates="workflow_tasks")


class NumberReservation(Base):
    __tablename__ = "number_reservations"
    id          = Column(Integer, primary_key=True)
    doc_type_id = Column(Integer, ForeignKey("document_types.id"))
    usi_kks     = Column(String(100), nullable=True)
    range_start = Column(Integer)
    range_end   = Column(Integer)
    label       = Column(String(50), default="RESERVED")
    reserved_by = Column(Integer, ForeignKey("users.id"))
    reserved_at = Column(DateTime(timezone=True), server_default=func.now())
