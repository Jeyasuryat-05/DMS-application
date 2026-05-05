from django.db import models


class SystemConfig(models.Model):
    key        = models.CharField(max_length=100, unique=True)
    value      = models.TextField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'system_config'
        managed  = False


class Role(models.Model):
    name        = models.CharField(max_length=100, unique=True)
    permissions = models.JSONField(default=dict)
    description = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'roles'
        managed  = False


class User(models.Model):
    sap_username    = models.CharField(max_length=100, unique=True, null=True, blank=True)
    employee_id     = models.CharField(max_length=50, null=True, blank=True)
    name            = models.CharField(max_length=200)
    email           = models.CharField(max_length=200, unique=True)
    department      = models.CharField(max_length=100, null=True, blank=True)
    role            = models.CharField(max_length=100, null=True, blank=True)
    dms_enabled     = models.BooleanField(default=True)
    can_create      = models.BooleanField(default=True)
    can_edit        = models.BooleanField(default=True)
    can_delete      = models.BooleanField(default=False)
    can_read        = models.BooleanField(default=True)
    auth_codes      = models.CharField(max_length=500, default='', blank=True)
    hashed_password = models.CharField(max_length=200, null=True, blank=True)
    is_active       = models.BooleanField(default=True)
    is_sso_user     = models.BooleanField(default=False)
    sso_name_id     = models.CharField(max_length=300, null=True, blank=True)
    last_login      = models.DateTimeField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    profile_picture = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = 'users'
        managed  = False


class DocumentType(models.Model):
    code            = models.CharField(max_length=50, unique=True)
    name            = models.CharField(max_length=200)
    description     = models.TextField(null=True, blank=True)
    auth_required   = models.BooleanField(default=False)
    auth_code       = models.CharField(max_length=100, default='', blank=True)
    metadata_schema = models.JSONField(default=dict)
    number_pattern  = models.CharField(max_length=200, default='{CODE}-{YEAR}-{SEQ}')
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    parent          = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children', db_column='parent_id')

    class Meta:
        db_table = 'document_types'
        managed  = False


class DocTypeFileFormat(models.Model):
    doc_type  = models.ForeignKey(DocumentType, on_delete=models.CASCADE, db_column='doc_type_id')
    extension = models.CharField(max_length=20)
    label     = models.CharField(max_length=50, null=True, blank=True)
    icon      = models.CharField(max_length=10, null=True, blank=True)
    mime_type = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = 'doc_type_file_formats'
        managed  = False


class WorkflowConfig(models.Model):
    doc_type = models.OneToOneField(DocumentType, on_delete=models.CASCADE, db_column='doc_type_id')
    levels   = models.JSONField(default=list)

    class Meta:
        db_table = 'workflow_configs'
        managed  = False


class AlertConfig(models.Model):
    doc_type      = models.OneToOneField(DocumentType, on_delete=models.CASCADE, db_column='doc_type_id')
    enabled       = models.BooleanField(default=True)
    lead_days     = models.CharField(max_length=50, default='30,15,7')
    notify_author = models.BooleanField(default=True)
    notify_roles  = models.CharField(max_length=200, default='', blank=True)

    class Meta:
        db_table = 'alert_configs'
        managed  = False


class Document(models.Model):
    doc_number      = models.CharField(max_length=100, unique=True, null=True, blank=True)
    serial_no       = models.CharField(max_length=200, null=True, blank=True)
    title           = models.CharField(max_length=500)
    doc_type        = models.ForeignKey(DocumentType, on_delete=models.SET_NULL, null=True, db_column='doc_type_id')
    project         = models.CharField(max_length=200, null=True, blank=True)
    usi_kks_code    = models.CharField(max_length=100, null=True, blank=True)
    current_version = models.CharField(max_length=20, default='1.0')
    status          = models.CharField(max_length=30, default='Draft')
    status_code     = models.CharField(max_length=5, default='05')
    confidential    = models.BooleanField(default=False)
    is_deleted      = models.BooleanField(default=False)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)
    expiry_date     = models.DateTimeField(null=True, blank=True)
    renewal_date    = models.DateTimeField(null=True, blank=True)
    revision_due    = models.DateTimeField(null=True, blank=True)
    checked_out     = models.BooleanField(default=False)
    checked_out_by  = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                        related_name='checked_out_docs', db_column='checked_out_by')
    checked_out_at  = models.DateTimeField(null=True, blank=True)
    flagged_for_deletion = models.BooleanField(default=False)
    flagged_at      = models.DateTimeField(null=True, blank=True)
    flagged_by_id   = models.IntegerField(null=True, blank=True)
    creator         = models.ForeignKey(User, on_delete=models.SET_NULL, null=True,
                                        related_name='created_docs', db_column='creator_id')
    responsible_person = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                           related_name='responsible_docs', db_column='responsible_person_id')
    custom_metadata = models.JSONField(default=dict)
    tags            = models.JSONField(default=list)

    class Meta:
        db_table = 'documents'
        managed  = False


class DocumentVersion(models.Model):
    document       = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='versions')
    version_number = models.CharField(max_length=20)
    is_major       = models.BooleanField(default=False)
    change_reason  = models.TextField(null=True, blank=True)
    change_label   = models.CharField(max_length=200, null=True, blank=True)
    created_by     = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, db_column='created_by_id')
    created_at     = models.DateTimeField(auto_now_add=True)
    file_path      = models.CharField(max_length=500, null=True, blank=True)

    class Meta:
        db_table = 'document_versions'
        managed  = False


class DocumentFile(models.Model):
    document    = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='files')
    filename    = models.CharField(max_length=300)
    file_path   = models.CharField(max_length=500)
    file_size   = models.IntegerField(null=True, blank=True)
    mime_type   = models.CharField(max_length=100, null=True, blank=True)
    file_format = models.CharField(max_length=20, null=True, blank=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, db_column='uploaded_by')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'document_files'
        managed  = False


class DocumentReference(models.Model):
    source = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='references', db_column='source_id')
    target = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='referenced_by', db_column='target_id')
    note   = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'document_references'
        managed  = False


class DocumentFeedback(models.Model):
    document       = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='feedbacks')
    user           = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='feedbacks_given', db_column='user_id')
    tagged_user    = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='feedbacks_tagged', db_column='tagged_user_id')
    comment        = models.TextField()
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'document_feedback'
        managed  = False


class AuditLog(models.Model):
    document   = models.ForeignKey(Document, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs')
    user       = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_entries')
    action     = models.CharField(max_length=200)
    old_value  = models.JSONField(null=True, blank=True)
    new_value  = models.JSONField(null=True, blank=True)
    note       = models.TextField(null=True, blank=True)
    ip_address = models.CharField(max_length=50, null=True, blank=True)
    timestamp  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_logs'
        managed  = False


class FileAccessLog(models.Model):
    document    = models.ForeignKey(Document, on_delete=models.CASCADE, null=True)
    file        = models.ForeignKey(DocumentFile, on_delete=models.CASCADE, null=True, db_column='file_id')
    user        = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, db_column='user_id')
    action      = models.CharField(max_length=20)
    accessed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'file_access_logs'
        managed  = False


class WorkflowHistorySnapshot(models.Model):
    document          = models.ForeignKey(Document, on_delete=models.CASCADE, null=True)
    outcome           = models.CharField(max_length=20)
    rejected_at_stage = models.CharField(max_length=30, null=True, blank=True)
    rejection_note    = models.TextField(null=True, blank=True)
    snapshot_at       = models.DateTimeField(auto_now_add=True)
    initiated_at      = models.DateTimeField(null=True, blank=True)
    mode              = models.CharField(max_length=30, null=True, blank=True)
    snapshot          = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = 'workflow_history_snapshots'
        managed  = False


class WorkflowInstance(models.Model):
    document         = models.OneToOneField(Document, on_delete=models.CASCADE, related_name='workflow')
    mode             = models.CharField(max_length=30, default='Auto Populate')
    stage            = models.CharField(max_length=30, default='Prepare')
    current_step     = models.IntegerField(default=1)
    total_steps      = models.IntegerField(default=4)
    started_at       = models.DateTimeField(auto_now_add=True)
    completed        = models.BooleanField(default=False)
    completed_at     = models.DateTimeField(null=True, blank=True)
    rejected         = models.BooleanField(default=False)
    rejection_reason = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'workflow_instances'
        managed  = False


class WorkflowLevel(models.Model):
    workflow               = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name='levels')
    step                   = models.IntegerField()
    name                   = models.CharField(max_length=100)
    stage                  = models.CharField(max_length=30)
    checklist_required     = models.BooleanField(default=False)
    checklist_items        = models.JSONField(default=list)
    status                 = models.CharField(max_length=30, default='Pending')
    checklist_template_path = models.CharField(max_length=500, null=True, blank=True)
    checklist_template_name = models.CharField(max_length=300, null=True, blank=True)

    class Meta:
        db_table = 'workflow_levels'
        managed  = False
        ordering = ['step']


class WorkflowTask(models.Model):
    workflow            = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name='tasks')
    level               = models.ForeignKey(WorkflowLevel, on_delete=models.CASCADE, related_name='tasks', null=True, db_column='level_id')
    step                = models.IntegerField()
    assignee            = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='wf_tasks', db_column='assignee_id')
    status              = models.CharField(max_length=30, default='Pending')
    checklist_done      = models.BooleanField(default=False)
    checklist_file_path = models.CharField(max_length=500, null=True, blank=True)
    checklist_file_name = models.CharField(max_length=300, null=True, blank=True)
    digital_sig_log     = models.JSONField(null=True, blank=True)
    rationale           = models.TextField(null=True, blank=True)
    action_note         = models.TextField(null=True, blank=True)
    completed_at        = models.DateTimeField(null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'workflow_tasks'
        managed  = False
        ordering = ['step']


class AlertLog(models.Model):
    document   = models.ForeignKey(Document, on_delete=models.CASCADE, null=True)
    alert_type = models.CharField(max_length=50)
    status     = models.CharField(max_length=20, default='Pending')
    sent_at    = models.DateTimeField(auto_now_add=True)
    error_msg  = models.TextField(null=True, blank=True)

    class Meta:
        db_table = 'alert_logs'
        managed  = False


class AlertRecipient(models.Model):
    alert_log = models.ForeignKey(AlertLog, on_delete=models.CASCADE, related_name='recipients', db_column='alert_log_id')
    user      = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, db_column='user_id')
    email     = models.CharField(max_length=200)
    delivered = models.BooleanField(default=False)

    class Meta:
        db_table = 'alert_recipients'
        managed  = False


class NumberReservation(models.Model):
    doc_type    = models.ForeignKey(DocumentType, on_delete=models.CASCADE, db_column='doc_type_id')
    usi_kks     = models.CharField(max_length=100, null=True, blank=True)
    range_start = models.IntegerField()
    range_end   = models.IntegerField()
    label       = models.CharField(max_length=50, default='RESERVED')
    reserved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, db_column='reserved_by')
    reserved_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'number_reservations'
        managed  = False
