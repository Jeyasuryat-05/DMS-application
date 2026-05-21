import os, uuid, json, traceback, mimetypes
from datetime import datetime, timedelta
from django.conf import settings
from django.utils import timezone
from django.http import FileResponse, HttpResponse
from django.db import transaction
from django.db.models import Q
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from api.models import (
    Document, DocumentType, DocumentVersion, DocumentFile,
    DocumentReference, DocumentFeedback, AuditLog, FileAccessLog,
    WorkflowInstance, WorkflowHistorySnapshot, User, EditAccessRequest,
)
from api import email_utils
from api.authentication import (
    require_read, require_create, require_edit, require_delete, _flag_check,
)

UPLOAD_DIR = 'uploads'
ALLOWED_FORMATS = {
    '.pdf', '.dwg', '.dxf', '.cad', '.doc', '.docx', '.xls', '.xlsx',
    '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.tiff', '.bmp', '.gif',
    '.zip', '.rar', '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.svg',
    '.txt', '.rtf', '.csv', '.xml', '.json', '.eml', '.msg', '.vsd',
    '.step', '.stp', '.iges', '.stl', '.dgn',
}

_GLOBAL_META_KEY = 'directorate_group_sub_group'
_GLOBAL_META_FIELD = None
try:
    import sys as _sys
    _parent = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if _parent not in _sys.path:
        _sys.path.insert(0, _parent)
    from metadata_schemas_data import METADATA_SCHEMAS as _MS
    for _schema in _MS.values():
        for _f in _schema:
            if isinstance(_f, dict) and _f.get('key') == _GLOBAL_META_KEY:
                _GLOBAL_META_FIELD = dict(_f)
                break
        if _GLOBAL_META_FIELD:
            break
except Exception:
    pass


def _iso(dt):
    if not dt:
        return None
    s = dt.isoformat()
    # USE_TZ=True makes isoformat() return "+00:00" suffix; replace with Z for JS compatibility
    if s.endswith('+00:00'):
        return s[:-6] + 'Z'
    if not s.endswith('Z'):
        s += 'Z'
    return s


def _doc_to_dict(d):
    try:
        try:
            wf = d.workflow
        except Exception:
            wf = None
        workflow_dict = None
        if wf:
            workflow_dict = {
                'id': wf.id,
                'mode': str(wf.mode or 'Auto Populate'),
                'purpose': str(getattr(wf, 'purpose', 'release') or 'release'),
                'stage': str(wf.stage or 'Prepare'),
                'current_step': int(wf.current_step or 1),
                'total_steps': int(wf.total_steps or 4),
                'completed': bool(wf.completed),
                'rejected': bool(wf.rejected),
                'rejection_reason': wf.rejection_reason,
                'started_at': _iso(wf.started_at),
                'levels': [],
            }

        doc_type_dict = None
        if d.doc_type_id:
            dt = d.doc_type
            raw_schema = list(dt.metadata_schema or [])
            if _GLOBAL_META_FIELD and isinstance(raw_schema, list):
                _idx = next(
                    (i for i, f in enumerate(raw_schema)
                     if isinstance(f, dict) and f.get('key') == _GLOBAL_META_KEY),
                    None
                )
                if _idx is not None:
                    raw_schema[_idx] = _GLOBAL_META_FIELD
                else:
                    _ins = min(2, len(raw_schema))
                    raw_schema = raw_schema[:_ins] + [_GLOBAL_META_FIELD] + raw_schema[_ins:]
            doc_type_dict = {
                'id': dt.id,
                'code': dt.code or '',
                'name': dt.name or '',
                'auth_required': bool(dt.auth_required),
                'auth_code': dt.auth_code or '',
                'is_active': bool(dt.is_active),
                'allowed_formats': [],
                'number_pattern': dt.number_pattern or '',
                'metadata_schema': raw_schema,
                'description': dt.description,
            }

        return {
            'id': d.id,
            'doc_number': d.doc_number or '',
            'serial_no': d.serial_no,
            'title': d.title or '',
            'project': d.project,
            'usi_kks_code': d.usi_kks_code,
            'current_version': d.current_version or '1.0',
            'status': d.status or 'Draft',
            'status_code': d.status_code or '05',
            'confidential': bool(d.confidential),
            'checked_out': bool(d.checked_out),
            'checked_out_by_id': d.checked_out_by_id,
            'checked_out_at': _iso(d.checked_out_at),
            'created_at': _iso(d.created_at),
            'updated_at': _iso(d.updated_at),
            'expiry_date': _iso(d.expiry_date),
            'renewal_date': _iso(d.renewal_date),
            'revision_due': _iso(d.revision_due),
            'tags': d.tags or [],
            'custom_metadata': d.custom_metadata or {},
            'flagged_for_deletion': bool(d.flagged_for_deletion),
            'flagged_at': _iso(d.flagged_at),
            'flagged_by_id': d.flagged_by_id,
            'doc_type': doc_type_dict,
            'workflow': workflow_dict,
        }
    except Exception:
        return {'id': d.id, 'title': d.title or '', 'status': 'Draft', 'doc_number': '', 'current_version': '1.0'}


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def list_create_documents(request):
    if request.method == 'GET':
        ok, resp = _flag_check(request.user, 'can_read', 'Read')
        if not ok: return resp
        return _list_documents(request)
    ok, resp = _flag_check(request.user, 'can_create', 'Create')
    if not ok: return resp
    return _create_document(request)


def _list_documents(request):
    try:
        q = request.query_params.get('q')
        doc_number = request.query_params.get('doc_number')
        serial_no = request.query_params.get('serial_no')
        version = request.query_params.get('version')
        version_mode = request.query_params.get('version_mode', 'all')
        doc_type_id = request.query_params.get('doc_type_id')
        status_filter = request.query_params.get('status')
        confidential = request.query_params.get('confidential')
        flagged_for_deletion = request.query_params.get('flagged_for_deletion')
        expiring_days = request.query_params.get('expiring_days')
        skip = int(request.query_params.get('skip', 0))
        limit = int(request.query_params.get('limit', 100))

        qs = Document.objects.filter(is_deleted=False).select_related('doc_type', 'workflow')
        if q:
            qs = qs.filter(
                Q(title__icontains=q) | Q(doc_number__icontains=q) |
                Q(project__icontains=q) | Q(usi_kks_code__icontains=q)
            )
        if doc_number:
            qs = qs.filter(doc_number__icontains=doc_number)
        if serial_no:
            qs = qs.filter(serial_no__icontains=serial_no)
        if doc_type_id:
            qs = qs.filter(doc_type_id=int(doc_type_id))
        if status_filter:
            qs = qs.filter(status=status_filter)
        if confidential is not None:
            qs = qs.filter(confidential=(confidential.lower() == 'true'))
        if flagged_for_deletion is not None:
            qs = qs.filter(flagged_for_deletion=(flagged_for_deletion.lower() == 'true'))
        if expiring_days:
            cutoff = datetime.utcnow() + timedelta(days=int(expiring_days))
            qs = qs.filter(
                expiry_date__isnull=False,
                expiry_date__lte=cutoff,
                expiry_date__gte=datetime.utcnow(),
            )
        docs = qs.order_by('-created_at')[skip:skip + limit]
        out = []
        for d in docs:
            base = _doc_to_dict(d)
            versions = list(
                DocumentVersion.objects.filter(document_id=d.id).order_by('-created_at')
            )
            if not versions:
                # No version history recorded — emit a single row from the document.
                out.append(base)
                continue

            # Identify the "main Released" version. Only one version is officially
            # released at any time; older released versions become Superseded.
            #   - If the doc itself is Released → the current version is the main.
            #   - Otherwise (Draft / In workflow) → the most recent prior version is
            #     the main (since a new version can only be created from a Released
            #     parent, all earlier versions were Released at some point).
            if d.status == 'Released':
                main_version = d.current_version
            else:
                non_current = [v for v in versions if v.version_number != d.current_version]
                main_version = non_current[0].version_number if non_current else None

            for v in versions:
                row = dict(base)
                row['version_id']      = v.id
                row['current_version'] = v.version_number
                row['version_change_reason'] = v.change_reason or ''
                row['version_change_label']  = v.change_label or ''
                row['is_current_version'] = v.version_number == d.current_version
                if v.version_number == d.current_version:
                    # Current version row keeps the document's live status / workflow.
                    pass
                elif v.version_number == main_version:
                    row['status']      = 'Released'
                    row['status_code'] = '30'
                    row['workflow']    = None
                else:
                    row['status']      = 'Superseded'
                    row['status_code'] = '40'
                    row['workflow']    = None
                if v.created_at:
                    row['created_at'] = _iso(v.created_at)
                out.append(row)
        # If a status filter is in effect, drop expanded rows whose effective
        # status no longer matches (e.g. user filtered to Draft but historic
        # versions were marked Released).
        if status_filter:
            out = [r for r in out if r.get('status') == status_filter]
        if version:
            out = [r for r in out if r.get('current_version') == version]
        if version_mode == 'latest':
            out = [r for r in out if r.get('is_current_version')]
        elif version_mode == 'released':
            out = [r for r in out if r.get('status') == 'Released']
        return Response(out)
    except Exception:
        print('list_documents error:', traceback.format_exc())
        return Response([])


@transaction.atomic
def _create_document(request):
    try:
        title = request.data.get('title', '')
        doc_type_id = int(request.data.get('doc_type_id', 0))
        project = request.data.get('project')
        usi_kks_code = request.data.get('usi_kks_code')
        serial_no = request.data.get('serial_no')
        confidential = str(request.data.get('confidential', 'false')).lower() == 'true'
        expiry_date = request.data.get('expiry_date')
        revision_due = request.data.get('revision_due')
        custom_metadata = request.data.get('custom_metadata', '{}')
        tags = request.data.get('tags', '[]')
        change_reason = request.data.get('change_reason', 'Initial upload')
        files = request.FILES.getlist('files')

        try:
            doc_type = DocumentType.objects.get(id=doc_type_id)
        except DocumentType.DoesNotExist:
            return Response({'error': 'Document type not found'}, status=404)

        parsed_meta = json.loads(custom_metadata or '{}')
        usi_from_meta = (parsed_meta.get('usi') or parsed_meta.get('usi_kks_code') or usi_kks_code or '').strip() or None
        # USI must be a numeric 5-digit string (UI enforces this; this is the
        # backend defence-in-depth so a hand-crafted request can't bypass it).
        import re as _re
        if usi_from_meta and not _re.fullmatch(r'\d{5}', usi_from_meta):
            return Response({'error': 'USI must be exactly 5 numeric digits.'}, status=400)

        # Generic char / numeric metadata field validation (driven by the
        # doc-type schema). Applies on top of the USI special-case above.
        for f in (doc_type.metadata_schema or []):
            if not isinstance(f, dict):
                continue
            ftype = f.get('type')
            if ftype not in ('char', 'numeric'):
                continue
            v = parsed_meta.get(f.get('key'))
            if v in (None, ''):
                continue
            v = str(v)
            if ftype == 'numeric' and not _re.fullmatch(r'\d+', v):
                return Response({'error': f'"{f.get("label")}" must contain digits only.'}, status=400)
            fixed = f.get('length')
            if fixed and len(v) != fixed:
                return Response({'error': f'"{f.get("label")}" must be exactly {fixed} {"digits" if ftype=="numeric" else "characters"}.'}, status=400)
            if not fixed:
                if f.get('min_length') and len(v) < f['min_length']:
                    return Response({'error': f'"{f.get("label")}" must be at least {f["min_length"]} characters.'}, status=400)
                if f.get('max_length') and len(v) > f['max_length']:
                    return Response({'error': f'"{f.get("label")}" must be at most {f["max_length"]} characters.'}, status=400)

        # Expiry date must be strictly later than revision due date.
        if expiry_date and revision_due:
            try:
                _exp = datetime.fromisoformat(expiry_date)
                _rev = datetime.fromisoformat(revision_due)
                if _exp <= _rev:
                    return Response({'error': 'Expiry date must be later than revision due date.'}, status=400)
            except (ValueError, TypeError):
                pass
        # project_station_unit is the primary key; fall back to 'project' key or the top-level project field
        project_from_meta = (
            parsed_meta.get('project_station_unit') or
            parsed_meta.get('project') or
            project or ''
        ).strip() or None

        # Generate doc number: DocType/ProjectCode/USI/SerialNumber
        type_code = (doc_type.code or 'DOC').strip()
        proj_code = (project_from_meta or 'PROJ').strip()
        usi_code  = (usi_from_meta or 'USI').strip()
        seq = Document.objects.filter(doc_type_id=doc_type_id, project=proj_code, usi_kks_code=usi_code).count() + 1
        doc_number = f'{type_code}/{proj_code}/{usi_code}/{str(seq).zfill(4)}'
        while Document.objects.filter(doc_number=doc_number).exists():
            seq += 1
            doc_number = f'{type_code}/{proj_code}/{usi_code}/{str(seq).zfill(4)}'

        doc = Document(
            doc_number=doc_number,
            serial_no=doc_number,
            title=title,
            doc_type_id=doc_type_id,
            project=project_from_meta,
            usi_kks_code=usi_from_meta,
            confidential=confidential,
            creator_id=request.user.id,
            expiry_date=datetime.fromisoformat(expiry_date) if expiry_date else None,
            revision_due=datetime.fromisoformat(revision_due) if revision_due else None,
            custom_metadata=parsed_meta,
            tags=json.loads(tags or '[]'),
            status='Draft',
            status_code='05',
            current_version='1.0',
        )
        doc.save()

        version = DocumentVersion(
            document_id=doc.id,
            version_number='1.0',
            is_major=True,
            change_reason=change_reason or 'Initial upload',
            created_by_id=request.user.id,
        )
        version.save()

        os.makedirs(UPLOAD_DIR, exist_ok=True)
        for upload in files:
            if upload.name:
                ext = os.path.splitext(upload.name)[1].lower()
                if ext not in ALLOWED_FORMATS:
                    continue
                unique_name = f'{uuid.uuid4()}{ext}'
                path = os.path.join(UPLOAD_DIR, unique_name)
                content = upload.read()
                with open(path, 'wb') as f:
                    f.write(content)
                DocumentFile.objects.create(
                    document_id=doc.id,
                    filename=upload.name,
                    file_path=path,
                    file_size=len(content),
                    mime_type=upload.content_type,
                    file_format=ext.lstrip('.').upper(),
                    uploaded_by_id=request.user.id,
                )
                version.file_path = path
                version.save(update_fields=['file_path'])

        WorkflowInstance.objects.create(
            document_id=doc.id,
            stage='Prepare',
            mode='Auto Populate',
        )

        AuditLog.objects.create(
            document_id=doc.id, user_id=request.user.id,
            action='Document Created', note=f'Type: {doc_type.name}',
        )

        return Response({'id': doc.id, 'doc_number': doc.doc_number, 'message': 'Document created'}, status=201)
    except Exception:
        print('create_document error:', traceback.format_exc())
        raise


@api_view(['GET', 'PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def get_update_delete_document(request, doc_id):
    if request.method == 'GET':
        ok, resp = _flag_check(request.user, 'can_read', 'Read')
        if not ok: return resp
        return _get_document(request, doc_id)
    elif request.method == 'PATCH':
        ok, resp = _flag_check(request.user, 'can_edit', 'Edit')
        if not ok: return resp
        return _update_document(request, doc_id)
    ok, resp = _flag_check(request.user, 'can_delete', 'Delete')
    if not ok: return resp
    return _delete_document(request, doc_id)


def _get_document(request, doc_id):
    try:
        try:
            doc = Document.objects.select_related(
                'doc_type', 'creator', 'checked_out_by', 'responsible_person'
            ).get(id=doc_id, is_deleted=False)
        except Document.DoesNotExist:
            return Response({'error': 'Document not found'}, status=404)

        try:
            cooldown = timezone.now() - timedelta(minutes=5)
            already_logged = AuditLog.objects.filter(
                document_id=doc.id,
                user_id=request.user.id,
                action='Document Viewed',
                timestamp__gte=cooldown,
            ).exists()
            if not already_logged:
                AuditLog.objects.create(
                    document_id=doc.id, user_id=request.user.id,
                    action='Document Viewed', note='',
                )
        except Exception:
            pass

        base = _doc_to_dict(doc)
        base['creator'] = (
            {'id': doc.creator.id, 'name': doc.creator.name, 'email': doc.creator.email}
            if doc.creator else None
        )
        base['checked_out_by'] = (
            {'id': doc.checked_out_by.id, 'name': doc.checked_out_by.name}
            if doc.checked_out_by_id else None
        )
        base['obsolete_reason'] = getattr(doc, 'obsolete_reason', None)
        base['archived_at'] = _iso(getattr(doc, 'archived_at', None))
        base['archived_by'] = (
            {'id': doc.archived_by.id, 'name': doc.archived_by.name}
            if getattr(doc, 'archived_by_id', None) else None
        )
        try:
            base['editors'] = [
                {'id': u.id, 'name': u.name, 'email': u.email}
                for u in doc.editors.all()
            ]
        except Exception:
            base['editors'] = []
        base['versions'] = [
            {
                'id': v.id, 'version_number': v.version_number,
                'is_major': bool(v.is_major), 'change_reason': v.change_reason,
                'change_label': v.change_label,
                'created_at': _iso(v.created_at),
                'created_by': {'id': v.created_by.id, 'name': v.created_by.name} if v.created_by else None,
            }
            for v in doc.versions.select_related('created_by').all()
        ]
        base['files'] = [
            {
                'id': f.id, 'filename': f.filename, 'file_size': f.file_size,
                'mime_type': f.mime_type, 'file_format': f.file_format,
                'uploaded_at': _iso(f.uploaded_at),
            }
            for f in doc.files.all()
        ]
        base['feedbacks'] = [
            {
                'id': fb.id, 'comment': fb.comment,
                'created_at': _iso(fb.created_at),
                'user': {'id': fb.user.id, 'name': fb.user.name} if fb.user else None,
                'tagged_user': {'id': fb.tagged_user.id, 'name': fb.tagged_user.name} if fb.tagged_user else None,
            }
            for fb in doc.feedbacks.select_related('user', 'tagged_user').all()
        ]
        base['audit_logs'] = [
            {
                'id': al.id, 'action': al.action, 'note': al.note,
                'old_value': al.old_value, 'new_value': al.new_value,
                'timestamp': _iso(al.timestamp),
                'user': {'id': al.user.id, 'name': al.user.name} if al.user else None,
            }
            for al in doc.audit_logs.select_related('user').all()
        ]
        base['references'] = [
            {
                'id': r.id, 'note': r.note,
                'target': {
                    'id': r.target.id, 'doc_number': r.target.doc_number, 'title': r.target.title
                } if r.target else None,
            }
            for r in doc.references.select_related('target').all()
        ]

        snapshots = WorkflowHistorySnapshot.objects.filter(
            document_id=doc.id
        ).order_by('snapshot_at')
        base['workflow_history'] = [
            {
                'id': s.id, 'outcome': s.outcome,
                'rejected_at_stage': s.rejected_at_stage,
                'rejection_note': s.rejection_note,
                'snapshot_at': _iso(s.snapshot_at),
                'initiated_at': _iso(s.initiated_at),
                'mode': s.mode, 'snapshot': s.snapshot,
            }
            for s in snapshots
        ]

        try:
            wf = doc.workflow
            level_map = {lv.id: lv for lv in wf.levels.all()}
            base['workflow']['tasks'] = [
                {
                    'id': t.id, 'step': t.step, 'status': t.status,
                    'checklist_done': bool(t.checklist_done),
                    'checklist_file_name': t.checklist_file_name,
                    'action_note': t.action_note,
                    'completed_at': _iso(t.completed_at),
                    'assignee': {'id': t.assignee.id, 'name': t.assignee.name} if t.assignee else None,
                    'level': {
                        'id': level_map[t.level_id].id,
                        'checklist_required': bool(level_map[t.level_id].checklist_required),
                        'checklist_template_name': level_map[t.level_id].checklist_template_name,
                    } if t.level_id and t.level_id in level_map else None,
                }
                for t in wf.tasks.select_related('assignee').all()
            ]
            base['workflow']['levels'] = [
                {
                    'id': lv.id, 'step': lv.step, 'name': lv.name,
                    'stage': lv.stage, 'status': lv.status,
                    'checklist_required': bool(lv.checklist_required),
                    'checklist_template_name': lv.checklist_template_name,
                    'tasks': [
                        {
                            'id': t.id, 'step': t.step, 'status': t.status,
                            'checklist_done': bool(t.checklist_done),
                            'checklist_file_name': t.checklist_file_name,
                            'action_note': t.action_note,
                            'completed_at': _iso(t.completed_at),
                            'assignee': {'id': t.assignee.id, 'name': t.assignee.name} if t.assignee else None,
                        }
                        for t in lv.tasks.select_related('assignee').all()
                    ],
                }
                for lv in wf.levels.all()
            ]
        except Exception:
            pass

        return Response(base)
    except Exception:
        print('get_document error:', traceback.format_exc())
        return Response({'error': 'Error loading document'}, status=500)


@transaction.atomic
def _update_document(request, doc_id):
    try:
        try:
            doc = Document.objects.get(id=doc_id)
        except Document.DoesNotExist:
            return Response({'error': 'Document not found'}, status=404)

        if not _can_edit_doc(request.user, doc):
            return Response({'error': 'You do not have permission to edit this document. Only the creator, designated editors, or an admin can make changes.'}, status=403)

        if doc.status in ('Approved', 'Released', 'Archived'):
            return Response({'error': 'Cannot modify Approved, Released or Archived documents.'}, status=403)
        if doc.status in ('In Check', 'In Review', 'In Approval'):
            return Response({'error': f'Document is locked for editing — currently under review (status: {doc.status}). Return the workflow to make changes.'}, status=403)
        if doc.checked_out and doc.checked_out_by_id != request.user.id:
            try:
                owner = User.objects.get(id=doc.checked_out_by_id)
                owner_name = owner.name
            except Exception:
                owner_name = f'user {doc.checked_out_by_id}'
            return Response({'error': f'Document is checked out by {owner_name}. Only they can make changes while it is checked out.'}, status=403)

        data = request.data
        DATE_FIELDS = {'expiry_date', 'renewal_date', 'revision_due'}
        # project and usi_kks_code are locked — they form part of the doc number
        SKIP_FIELDS = {'id', 'doc_number', 'serial_no', 'creator_id', 'status', 'current_version',
                       'project', 'usi_kks_code'}

        old_cm = dict(doc.custom_metadata or {})

        # Snapshot core fields that can be set via metadata keys, BEFORE any modifications
        old_core_values = {
            'usi':          doc.usi_kks_code,
            'usi_kks_code': doc.usi_kks_code,
            'project':      doc.project,
            'expiry_date':  doc.expiry_date,
            'revision_due': doc.revision_due,
        }

        _raw_cm = data.get('custom_metadata') or {}
        if isinstance(_raw_cm, str):
            try:
                incoming_cm = json.loads(_raw_cm)
            except Exception:
                incoming_cm = {}
        else:
            incoming_cm = dict(_raw_cm)

        # USI must be exactly 5 numeric digits (mirrors create-time guard).
        import re as _re
        for _usi_key in ('usi', 'usi_kks_code'):
            _v = incoming_cm.get(_usi_key)
            if _v not in (None, ''):
                _v = str(_v).strip()
                if not _re.fullmatch(r'\d{5}', _v):
                    return Response({'error': 'USI must be exactly 5 numeric digits.'}, status=400)
                incoming_cm[_usi_key] = _v

        # Generic char / numeric schema validation.
        for f in (doc.doc_type.metadata_schema or []) if doc.doc_type else []:
            if not isinstance(f, dict):
                continue
            ftype = f.get('type')
            if ftype not in ('char', 'numeric'):
                continue
            v = incoming_cm.get(f.get('key'))
            if v in (None, ''):
                continue
            v = str(v)
            if ftype == 'numeric' and not _re.fullmatch(r'\d+', v):
                return Response({'error': f'"{f.get("label")}" must contain digits only.'}, status=400)
            fixed = f.get('length')
            if fixed and len(v) != fixed:
                return Response({'error': f'"{f.get("label")}" must be exactly {fixed} {"digits" if ftype=="numeric" else "characters"}.'}, status=400)
            if not fixed:
                if f.get('min_length') and len(v) < f['min_length']:
                    return Response({'error': f'"{f.get("label")}" must be at least {f["min_length"]} characters.'}, status=400)
                if f.get('max_length') and len(v) > f['max_length']:
                    return Response({'error': f'"{f.get("label")}" must be at most {f["max_length"]} characters.'}, status=400)

        def _s(v):
            if v is None or v == '':
                return None
            if hasattr(v, 'isoformat'):
                return v.isoformat().split('T')[0]
            return str(v)

        changes_old, changes_new = {}, {}
        update_fields = []

        for k, v in data.items():
            if k in SKIP_FIELDS or not hasattr(doc, k):
                continue
            if k == 'custom_metadata':
                continue
            old_raw = getattr(doc, k)
            if k in DATE_FIELDS:
                if v:
                    try:
                        v = datetime.fromisoformat(str(v).split('T')[0])
                    except (ValueError, TypeError):
                        v = None
                else:
                    v = None
            setattr(doc, k, v)
            update_fields.append(k)
            o, n = _s(old_raw), _s(v)
            if o != n:
                changes_old[k.replace('_', ' ').title()] = o
                changes_new[k.replace('_', ' ').title()] = n

        _exp = incoming_cm.get('expiry_date') or (doc.expiry_date.isoformat() if doc.expiry_date else None)
        _rev = incoming_cm.get('revision_due') or (doc.revision_due.isoformat() if doc.revision_due else None)
        if _exp and _rev:
            try:
                _e = datetime.fromisoformat(str(_exp).split('T')[0])
                _r = datetime.fromisoformat(str(_rev).split('T')[0])
                if _e <= _r:
                    return Response({'error': 'Expiry date must be later than revision due date.'}, status=400)
            except Exception:
                pass

        for meta_key, core_attr in [('expiry_date', 'expiry_date'), ('revision_due', 'revision_due')]:
            if meta_key in incoming_cm:
                raw = incoming_cm[meta_key]
                if raw:
                    try:
                        setattr(doc, core_attr, datetime.fromisoformat(str(raw).split('T')[0]))
                        if core_attr not in update_fields:
                            update_fields.append(core_attr)
                    except (ValueError, TypeError):
                        pass
                else:
                    setattr(doc, core_attr, None)
                    if core_attr not in update_fields:
                        update_fields.append(core_attr)

        # project/station and usi are locked — silently drop from incoming metadata
        for locked_key in ('usi', 'usi_kks_code', 'project', 'project_station_unit'):
            incoming_cm.pop(locked_key, None)

        if 'custom_metadata' in data:
            merged_cm = {**old_cm, **incoming_cm}
            doc.custom_metadata = merged_cm
            update_fields.append('custom_metadata')

        for mk, new_v in incoming_cm.items():
            # For keys that map to core fields, use the pre-change core value, not custom_metadata
            if mk in old_core_values:
                old_v = old_core_values[mk]
            else:
                old_v = old_cm.get(mk)
            o, n = _s(old_v), _s(new_v)
            if o != n:
                label = mk.replace('_', ' ').title()
                changes_old[label] = o
                changes_new[label] = n

        doc.save(update_fields=update_fields if update_fields else None)

        AuditLog.objects.create(
            document_id=doc.id, user_id=request.user.id,
            action='Metadata Updated',
            old_value=changes_old if changes_old else None,
            new_value=changes_new if changes_new else None,
        )
        return Response({'message': 'Updated'})
    except Exception:
        print('update_document error:', traceback.format_exc())
        return Response({'error': 'Error updating document'}, status=500)


def _delete_document(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    if doc.status in ('Approved', 'Released'):
        return Response({'error': 'Cannot delete Approved or Released documents.'}, status=403)
    try:
        wf = doc.workflow
        if not wf.completed:
            return Response({'error': 'Cannot delete this document — the approval workflow is currently in progress. Return or reject the workflow first, then delete.'}, status=403)
    except Exception:
        pass
    if doc.status in ('In Check', 'In Review', 'In Approval'):
        return Response({'error': f'Cannot delete a document that is under workflow review (status: {doc.status}). Return the workflow to Draft first.'}, status=403)

    doc.is_deleted = True
    doc.save(update_fields=['is_deleted'])
    AuditLog.objects.create(document_id=doc.id, user_id=request.user.id, action='Document Deleted')
    return Response(status=204)


@api_view(['POST'])
@parser_classes([JSONParser])
@require_edit
def checkout(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    action = request.data.get('action', 'checkout')
    if action == 'checkout':
        if doc.checked_out:
            return Response({'error': f'Already checked out by user {doc.checked_out_by_id}'}, status=400)
        doc.checked_out = True
        doc.checked_out_by_id = request.user.id
        doc.checked_out_at = datetime.utcnow()
        doc.save(update_fields=['checked_out', 'checked_out_by_id', 'checked_out_at'])
        AuditLog.objects.create(document_id=doc.id, user_id=request.user.id, action='Checked Out')
    else:
        doc.checked_out = False
        doc.checked_out_by_id = None
        doc.checked_out_at = None
        doc.save(update_fields=['checked_out', 'checked_out_by_id', 'checked_out_at'])
        AuditLog.objects.create(document_id=doc.id, user_id=request.user.id, action='Checked In')
    return Response({'message': f'{action} successful'})


@api_view(['POST'])
@parser_classes([JSONParser])
@require_edit
def add_feedback(request, doc_id):
    try:
        tagged_user_id = request.data.get('tagged_user_id')
        fb = DocumentFeedback.objects.create(
            document_id=doc_id,
            user_id=request.user.id,
            comment=request.data.get('comment', ''),
            tagged_user_id=int(tagged_user_id) if tagged_user_id else None,
        )
        if tagged_user_id:
            try:
                tagged = User.objects.get(id=int(tagged_user_id))
                tagged_name = tagged.name
            except User.DoesNotExist:
                tagged_name = str(tagged_user_id)
            AuditLog.objects.create(
                document_id=doc_id, user_id=request.user.id,
                action='Feedback Requested',
                note=f'Feedback requested from {tagged_name}',
            )
        tagged = None
        if fb.tagged_user_id:
            try:
                tagged = User.objects.get(id=fb.tagged_user_id)
            except User.DoesNotExist:
                pass

        doc = Document.objects.select_related('creator').get(id=doc_id)

        # Email: feedback requested (tagged user)
        if tagged:
            try:
                email_utils.notify_feedback_requested(doc, request.user.name, fb.comment, tagged)
            except Exception:
                pass

        # Email: feedback added (notify creator, unless creator is the one commenting)
        try:
            if doc.creator and doc.creator.id != request.user.id:
                email_utils.notify_feedback_added(doc, request.user.name, fb.comment, doc.creator)
        except Exception:
            pass

        return Response({
            'id': fb.id, 'comment': fb.comment,
            'tagged_user': {'id': tagged.id, 'name': tagged.name} if tagged else None,
        })
    except Exception:
        return Response({'error': 'Error adding feedback'}, status=500)


@api_view(['POST'])
@parser_classes([JSONParser])
@require_edit
def add_reference(request, doc_id):
    try:
        DocumentReference.objects.create(
            source_id=doc_id,
            target_id=request.data.get('target_doc_id'),
            note=request.data.get('note'),
        )
        return Response({'message': 'Reference added'})
    except Exception:
        return Response({'error': 'Error adding reference'}, status=500)


@api_view(['GET'])
@require_read
def share_link(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)
    version = request.query_params.get('version')
    frontend_base = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
    link = f'{frontend_base}/documents/{doc_id}' + (f'?v={version}' if version else '')
    return Response({'link': link, 'doc_number': doc.doc_number, 'version': version or 'latest'})


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
@require_create
@transaction.atomic
def upload_version(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    if not _can_edit_doc(request.user, doc):
        return Response({'error': 'You do not have permission to create a new version of this document.'}, status=403)

    if doc.status != 'Released':
        return Response({'error': f'Cannot create a new version — the current version (v{doc.current_version}) has not been Released yet. Status is \'{doc.status}\'. The document must complete the approval workflow and reach Released status before a new version can be created.'}, status=403)

    change_reason = request.data.get('change_reason', '')
    if not change_reason or not change_reason.strip():
        return Response({'error': 'Change reason is mandatory when creating a new version. Please describe what has changed in this revision.'}, status=400)

    try:
        wf = doc.workflow
        if not wf.completed:
            return Response({'error': 'Cannot create a new version while the approval workflow is in progress. Wait for the current workflow to complete or be rejected first.'}, status=403)
    except Exception:
        pass

    is_major = str(request.data.get('is_major', 'false')).lower() == 'true'
    change_label = request.data.get('change_label')
    file = request.FILES.get('file')

    parts = (doc.current_version or '1.0').split('.')
    if is_major:
        new_ver = f'{int(parts[0]) + 1}.0'
    else:
        new_ver = f'{parts[0]}.{int(parts[1] if len(parts) > 1 else 0) + 1}'

    file_path = None
    if file:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        ext = os.path.splitext(file.name)[1].lower()
        file_path = os.path.join(UPLOAD_DIR, f'{uuid.uuid4()}{ext}')
        content = file.read()
        with open(file_path, 'wb') as f:
            f.write(content)
        DocumentFile.objects.create(
            document_id=doc.id, filename=file.name, file_path=file_path,
            file_size=len(content), mime_type=file.content_type,
            file_format=ext.lstrip('.').upper(), uploaded_by_id=request.user.id,
        )

    DocumentVersion.objects.create(
        document_id=doc.id, version_number=new_ver,
        is_major=is_major, change_reason=change_reason,
        change_label=change_label, created_by_id=request.user.id,
        file_path=file_path,
    )

    # Move the document back to Draft and clear the previous workflow so the
    # initiator can launch a fresh approval workflow for the new version.
    doc.current_version = new_ver
    doc.status = 'Draft'
    doc.save(update_fields=['current_version', 'status'])

    try:
        old_wf = doc.workflow
        old_wf.tasks.all().delete()
        old_wf.levels.all().delete()
        old_wf.delete()
    except Exception:
        pass

    AuditLog.objects.create(
        document_id=doc.id, user_id=request.user.id,
        action=f'New Version v{new_ver}', note=change_reason,
    )
    return Response({'message': f'Version {new_ver} uploaded — status reset to Draft. Initiate the approval workflow when ready.'})


@api_view(['GET', 'PUT'])
@parser_classes([JSONParser])
def document_editors(request, doc_id):
    """List or replace the editors granted edit access to this document.
    Only the document creator (or an admin) can manage the editor list."""
    if request.method == 'GET':
        ok, resp = _flag_check(request.user, 'can_read', 'Read')
        if not ok: return resp
    else:
        ok, resp = _flag_check(request.user, 'can_edit', 'Edit')
        if not ok: return resp
    try:
        doc = Document.objects.get(id=doc_id, is_deleted=False)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    role = getattr(request.user, 'role', '') or ''
    is_admin = role in ('System Admin', 'Sub Admin')
    is_creator = (doc.creator_id == request.user.id)
    if not (is_creator or is_admin):
        return Response({'error': 'Only the document creator can manage editors.'}, status=403)

    if request.method == 'GET':
        return Response([
            {'id': u.id, 'name': u.name, 'email': u.email,
             'department': u.department, 'role': u.role}
            for u in doc.editors.all()
        ])

    # PUT — replace the editor set
    ids = request.data.get('editor_ids') or []
    try:
        ids = [int(i) for i in ids if i]
    except Exception:
        return Response({'error': 'editor_ids must be a list of integers'}, status=400)
    # The creator should never appear in editors (they already have rights).
    ids = [i for i in ids if i != doc.creator_id]
    users_qs = User.objects.filter(id__in=ids, is_active=True)
    doc.editors.set(users_qs)
    AuditLog.objects.create(
        document_id=doc.id, user_id=request.user.id,
        action='Editors Updated',
        note=f'{users_qs.count()} editor(s) granted edit access',
    )
    return Response([
        {'id': u.id, 'name': u.name, 'email': u.email}
        for u in users_qs
    ])


@api_view(['POST'])
@parser_classes([JSONParser])
@require_edit
def request_edit_access(request, doc_id):
    """A non-editor authenticated user requests edit access on this document.
    Logged in the audit trail; an email is sent to the creator if SMTP is set
    up. The creator can then add the requester via the Editors modal."""
    try:
        doc = Document.objects.select_related('creator').get(id=doc_id, is_deleted=False)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    role = getattr(request.user, 'role', '') or ''
    is_admin = role in ('System Admin', 'Sub Admin')
    is_creator = (doc.creator_id == request.user.id)
    if is_creator or is_admin:
        return Response({'error': 'You already have edit access to this document.'}, status=400)
    if doc.editors.filter(id=request.user.id).exists():
        return Response({'error': 'You are already a designated editor.'}, status=400)

    message = (request.data.get('message') or '').strip()

    # Avoid duplicate pending requests from the same user
    existing = EditAccessRequest.objects.filter(
        document=doc, requester=request.user, status='pending'
    ).first()
    if existing:
        return Response({'message': 'You already have a pending request for this document. The owner has been re-notified.'})

    EditAccessRequest.objects.create(
        document=doc, requester=request.user, message=message, status='pending',
    )

    AuditLog.objects.create(
        document_id=doc.id, user_id=request.user.id,
        action='Edit Access Requested',
        note=message or '(no message)',
    )

    # Best-effort email to the owner. Don't fail the request if SMTP is down.
    try:
        if doc.creator and doc.creator.email:
            email_utils._send(
                [doc.creator.email],
                f'[DMS] Edit access request — {doc.doc_number or doc.title}',
                email_utils._html(
                    title='Edit Access Request',
                    body_html=(
                        f'<p>{request.user.name} ({request.user.email}) is requesting edit access to '
                        f'<strong>{doc.doc_number or doc.title}</strong>.</p>'
                        + (f'<p><em>Message:</em> {message}</p>' if message else '')
                        + '<p>Open the document and use the <strong>Editors</strong> button to grant access.</p>'
                    ),
                    doc_number=doc.doc_number or '',
                    doc_title=doc.title or '',
                ),
            )
    except Exception:
        pass

    return Response({
        'message': f'Request sent to {doc.creator.name if doc.creator else "the document owner"}. '
                   f'They will be notified and can grant access via the Editors panel.',
    })


@api_view(['GET'])
def incoming_access_requests(request):
    """Pending edit-access requests on documents the current user owns."""
    qs = (EditAccessRequest.objects
          .filter(status='pending', document__creator=request.user, document__is_deleted=False)
          .select_related('document', 'requester'))
    return Response([
        {
            'id': r.id,
            'document': {
                'id': r.document.id,
                'doc_number': r.document.doc_number,
                'title': r.document.title,
            },
            'requester': {
                'id': r.requester.id,
                'name': r.requester.name,
                'email': r.requester.email,
                'department': r.requester.department,
                'role': r.requester.role,
            },
            'message': r.message,
            'created_at': _iso(r.created_at),
        }
        for r in qs
    ])


@api_view(['POST'])
@parser_classes([JSONParser])
@require_edit
def decide_access_request(request, request_id):
    """Owner approves or denies an edit-access request.
    POST body: { action: 'approve' | 'deny' }. Approve adds the requester
    to the document's editors list; both actions mark the request decided."""
    try:
        ar = EditAccessRequest.objects.select_related('document', 'requester').get(id=request_id)
    except EditAccessRequest.DoesNotExist:
        return Response({'error': 'Request not found'}, status=404)

    role = getattr(request.user, 'role', '') or ''
    is_admin = role in ('System Admin', 'Sub Admin')
    if ar.document.creator_id != request.user.id and not is_admin:
        return Response({'error': 'Only the document owner can decide this request.'}, status=403)
    if ar.status != 'pending':
        return Response({'error': f'Request already {ar.status}.'}, status=400)

    action = (request.data.get('action') or '').lower()
    if action not in ('approve', 'deny'):
        return Response({'error': 'action must be "approve" or "deny"'}, status=400)

    if action == 'approve':
        ar.document.editors.add(ar.requester)
        ar.status = 'approved'
        AuditLog.objects.create(
            document_id=ar.document_id, user_id=request.user.id,
            action='Edit Access Granted',
            note=f'Granted to {ar.requester.name} ({ar.requester.email})',
        )
    else:
        ar.status = 'denied'
        AuditLog.objects.create(
            document_id=ar.document_id, user_id=request.user.id,
            action='Edit Access Denied',
            note=f'Denied for {ar.requester.name} ({ar.requester.email})',
        )

    ar.decided_at = datetime.utcnow()
    ar.decided_by_id = request.user.id
    ar.save(update_fields=['status', 'decided_at', 'decided_by'])

    # Best-effort email back to the requester
    try:
        if ar.requester.email:
            email_utils._send(
                [ar.requester.email],
                f'[DMS] Edit access {ar.status} — {ar.document.doc_number or ar.document.title}',
                email_utils._html(
                    title=f'Edit Access {ar.status.title()}',
                    body_html=(
                        f'<p>Your request for edit access to '
                        f'<strong>{ar.document.doc_number or ar.document.title}</strong> '
                        f'was <strong>{ar.status}</strong> by {request.user.name}.</p>'
                    ),
                    doc_number=ar.document.doc_number or '',
                    doc_title=ar.document.title or '',
                ),
            )
    except Exception:
        pass

    return Response({'status': ar.status})


@api_view(['POST'])
@require_edit
def reassign_doc_number(request, doc_id):
    """Admin-only: update project/USI and regenerate the doc number."""
    if getattr(request.user, 'role', '') != 'System Admin':
        return Response({'error': 'System Admin role required'}, status=403)
    try:
        doc = Document.objects.select_related('doc_type').get(id=doc_id, is_deleted=False)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    new_project = (request.data.get('project') or '').strip() or (doc.project or 'PROJ').strip()
    new_usi     = (request.data.get('usi_kks_code') or '').strip() or (doc.usi_kks_code or 'USI').strip()
    type_code   = (doc.doc_type.code if doc.doc_type else 'DOC').strip()

    seq = Document.objects.filter(
        doc_type_id=doc.doc_type_id, project=new_project, usi_kks_code=new_usi
    ).exclude(id=doc_id).count() + 1
    new_number = f'{type_code}/{new_project}/{new_usi}/{str(seq).zfill(4)}'
    while Document.objects.filter(doc_number=new_number).exclude(id=doc_id).exists():
        seq += 1
        new_number = f'{type_code}/{new_project}/{new_usi}/{str(seq).zfill(4)}'

    old_number  = doc.doc_number
    old_project = doc.project
    old_usi     = doc.usi_kks_code

    doc.project      = new_project
    doc.usi_kks_code = new_usi
    doc.doc_number   = new_number
    doc.serial_no    = new_number
    # keep custom_metadata in sync
    cm = dict(doc.custom_metadata or {})
    for k in ('project',):
        if k in cm:
            cm[k] = new_project
    for k in ('usi', 'usi_kks_code'):
        if k in cm:
            cm[k] = new_usi
    doc.custom_metadata = cm
    doc.save(update_fields=['project', 'usi_kks_code', 'doc_number', 'serial_no', 'custom_metadata'])

    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action='Doc Number Reassigned',
        note=f'Admin reassigned: {old_number} → {new_number}',
        old_value=f'Project:{old_project}, USI:{old_usi}',
        new_value=f'Project:{new_project}, USI:{new_usi}',
    )
    return Response({'doc_number': new_number, 'message': 'Document number reassigned successfully'})


def _can_access_doc(user, doc):
    """Authorization gate for reading document content (files / view).
    System Admins and Sub Admins always pass. The doc creator always passes.
    Confidential docs are otherwise restricted; non-confidential docs are
    visible to all active authenticated users (existing behaviour)."""
    role = getattr(user, 'role', '') or ''
    if role in ('System Admin', 'Sub Admin'):
        return True
    if doc.creator_id == getattr(user, 'id', None):
        return True
    if getattr(doc, 'confidential', False):
        return False
    return True


def _can_edit_doc(user, doc):
    """Authorization gate for modifying a document.
    Creator and explicitly granted editors can edit. System Admin / Sub Admin
    always can. Everyone else is rejected."""
    role = getattr(user, 'role', '') or ''
    if role in ('System Admin', 'Sub Admin'):
        return True
    uid = getattr(user, 'id', None)
    if doc.creator_id == uid:
        return True
    try:
        if doc.editors.filter(id=uid).exists():
            return True
    except Exception:
        pass
    return False


@api_view(['GET'])
@require_read
def download_file(request, doc_id, file_id):
    try:
        f = DocumentFile.objects.select_related('document').get(id=file_id, document_id=doc_id)
    except DocumentFile.DoesNotExist:
        return Response({'error': 'File not found'}, status=404)
    if f.document and f.document.is_deleted:
        return Response({'error': 'File not found'}, status=404)
    if not _can_access_doc(request.user, f.document):
        return Response({'error': 'You do not have access to this document'}, status=403)
    if not os.path.exists(f.file_path):
        return Response({'error': 'File not found on disk'}, status=404)

    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action='File Downloaded', note=f.filename,
    )
    FileAccessLog.objects.create(
        document_id=doc_id, file_id=file_id,
        user_id=request.user.id, action='download',
    )
    response = FileResponse(open(f.file_path, 'rb'), as_attachment=True, filename=f.filename)
    return response


@api_view(['GET'])
@require_read
def view_file(request, doc_id, file_id):
    try:
        f = DocumentFile.objects.select_related('document').get(id=file_id, document_id=doc_id)
    except DocumentFile.DoesNotExist:
        return Response({'error': 'File not found'}, status=404)
    if f.document and f.document.is_deleted:
        return Response({'error': 'File not found'}, status=404)
    if not _can_access_doc(request.user, f.document):
        return Response({'error': 'You do not have access to this document'}, status=403)
    if not os.path.exists(f.file_path):
        return Response({'error': 'File not found on disk'}, status=404)

    mime, _ = mimetypes.guess_type(f.filename or f.file_path)
    if not mime:
        ext = (f.file_format or '').lower()
        mime_map = {
            'pdf': 'application/pdf', 'png': 'image/png', 'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg', 'gif': 'image/gif', 'tiff': 'image/tiff',
            'tif': 'image/tiff', 'bmp': 'image/bmp', 'webp': 'image/webp',
            'svg': 'image/svg+xml', 'txt': 'text/plain', 'csv': 'text/csv',
            'xml': 'text/xml', 'json': 'application/json',
            'mp4': 'video/mp4', 'webm': 'video/webm', 'mp3': 'audio/mpeg',
        }
        mime = mime_map.get(ext, 'application/octet-stream')

    range_header = request.META.get('HTTP_RANGE', '')
    is_initial_request = (not range_header) or range_header.replace(' ', '').startswith('bytes=0-')
    if is_initial_request:
        AuditLog.objects.create(
            document_id=doc_id, user_id=request.user.id,
            action='File Viewed Online', note=f.filename,
        )
        FileAccessLog.objects.create(
            document_id=doc_id, file_id=file_id,
            user_id=request.user.id, action='view',
        )

    response = FileResponse(open(f.file_path, 'rb'), content_type=mime)
    response['Content-Disposition'] = f'inline; filename="{f.filename}"'
    return response


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
@require_create
def add_file(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    if not _can_edit_doc(request.user, doc):
        return Response({'error': 'You do not have permission to upload files to this document.'}, status=403)

    if doc.status != 'Draft':
        return Response({'error': f'Files can only be added when the document is in Draft status. Current status is \'{doc.status}\'.'}, status=403)

    if doc.checked_out and doc.checked_out_by_id != request.user.id:
        try:
            owner = User.objects.get(id=doc.checked_out_by_id)
            owner_name = owner.name
        except Exception:
            owner_name = f'user {doc.checked_out_by_id}'
        return Response({'error': f'Document is checked out by {owner_name}. Only they can upload files while it is checked out.'}, status=403)

    try:
        wf = doc.workflow
        if not wf.completed and wf.stage in ('Check', 'Review', 'Approve'):
            return Response({'error': 'Cannot add files while the approval workflow is in progress.'}, status=403)
    except Exception:
        pass

    file = request.FILES.get('file')
    if not file:
        return Response({'error': 'No file provided'}, status=400)

    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in ALLOWED_FORMATS:
        return Response({'error': f'File type \'{ext}\' is not allowed.'}, status=400)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f'{uuid.uuid4()}{ext}')
    content = file.read()
    with open(path, 'wb') as f:
        f.write(content)

    file_format = ext.lstrip('.').upper()
    size_kb = round(len(content) / 1024, 1)

    DocumentFile.objects.create(
        document_id=doc_id, filename=file.name, file_path=path,
        file_size=len(content), mime_type=file.content_type,
        file_format=file_format, uploaded_by_id=request.user.id,
    )
    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action='File Added', note=f'{file.name} ({file_format}, {size_kb} KB)',
    )
    return Response({'message': 'File added'})


@api_view(['DELETE'])
@require_delete
def delete_file(request, doc_id, file_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    if not _can_edit_doc(request.user, doc):
        return Response({'error': 'You do not have permission to delete files from this document.'}, status=403)

    if doc.status != 'Draft':
        return Response({'error': f'Files can only be deleted when the document is in Draft status. Current status is \'{doc.status}\'.'}, status=403)

    if doc.checked_out and doc.checked_out_by_id != request.user.id:
        try:
            owner = User.objects.get(id=doc.checked_out_by_id)
            owner_name = owner.name
        except Exception:
            owner_name = f'user {doc.checked_out_by_id}'
        return Response({'error': f'Document is checked out by {owner_name}. Only they can delete files while it is checked out.'}, status=403)

    try:
        wf = doc.workflow
        if not wf.completed and wf.stage in ('Check', 'Review', 'Approve'):
            return Response({'error': 'Cannot delete files while the approval workflow is in progress.'}, status=403)
    except Exception:
        pass

    try:
        f = DocumentFile.objects.get(id=file_id, document_id=doc_id)
    except DocumentFile.DoesNotExist:
        return Response({'error': 'File not found'}, status=404)

    try:
        if f.file_path and os.path.exists(f.file_path):
            os.remove(f.file_path)
    except Exception:
        pass

    size_kb = round((f.file_size or 0) / 1024, 1)
    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action='File Removed',
        note=f'{f.filename} ({f.file_format or "FILE"}, {size_kb} KB)',
    )
    f.delete()
    return Response(status=204)


@api_view(['POST'])
@require_delete
def flag_deletion(request, doc_id):
    if request.method == 'POST':
        try:
            doc = Document.objects.get(id=doc_id, is_deleted=False)
        except Document.DoesNotExist:
            return Response({'error': 'Not found'}, status=404)

        if doc.status == 'Released':
            return Response({'error': 'Released documents are part of the official record and cannot be flagged for deletion.'}, status=403)

        try:
            wf = doc.workflow
            if not wf.completed and wf.stage in ('Check', 'Review', 'Approve'):
                return Response({'error': f'Cannot flag for deletion while the document is in the {wf.stage} stage. Return the workflow to Prepare first.'}, status=403)
        except Exception:
            pass

        doc.flagged_for_deletion = True
        doc.flagged_at = timezone.now()
        doc.flagged_by_id = request.user.id
        doc.save(update_fields=['flagged_for_deletion', 'flagged_at', 'flagged_by_id'])
        AuditLog.objects.create(document_id=doc.id, user_id=request.user.id, action='Flagged for Deletion')
        return Response({'detail': 'Document flagged for deletion. It will be removed in the next scheduled cleanup.'})


@api_view(['DELETE'])
@require_delete
def unflag_deletion(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id, is_deleted=False)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)
    doc.flagged_for_deletion = False
    doc.flagged_at = None
    doc.flagged_by_id = None
    doc.save(update_fields=['flagged_for_deletion', 'flagged_at', 'flagged_by_id'])
    AuditLog.objects.create(document_id=doc.id, user_id=request.user.id, action='Deletion Flag Removed')
    return Response({'detail': 'Deletion flag removed.'})


@api_view(['GET'])
@require_read
def file_access_stats(request, doc_id):
    try:
        Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    logs = FileAccessLog.objects.filter(
        document_id=doc_id
    ).select_related('file', 'user')

    stats = {}
    for entry in logs:
        fid = entry.file_id
        if fid not in stats:
            stats[fid] = {'file_id': fid, 'filename': None, 'view_count': 0, 'download_count': 0, 'viewers': {}, 'downloaders': {}}
        if entry.file:
            stats[fid]['filename'] = entry.file.filename
        uid = entry.user_id
        uname = entry.user.name if entry.user else 'Unknown'
        if entry.action == 'view':
            stats[fid]['view_count'] += 1
            prev = stats[fid]['viewers'].get(uid, {}).get('count', 0)
            stats[fid]['viewers'][uid] = {'id': uid, 'name': uname, 'count': prev + 1}
        elif entry.action == 'download':
            stats[fid]['download_count'] += 1
            prev = stats[fid]['downloaders'].get(uid, {}).get('count', 0)
            stats[fid]['downloaders'][uid] = {'id': uid, 'name': uname, 'count': prev + 1}

    for fid, s in stats.items():
        s['viewers'] = sorted(s['viewers'].values(), key=lambda x: -x['count'])
        s['downloaders'] = sorted(s['downloaders'].values(), key=lambda x: -x['count'])

    return Response({
        'by_file': list(stats.values()),
        'total_views': sum(s['view_count'] for s in stats.values()),
        'total_downloads': sum(s['download_count'] for s in stats.values()),
    })


@api_view(['GET'])
def search_users(request):
    """Public user search — available to all authenticated users for tagging in feedback."""
    q = request.query_params.get('q', '').strip()
    if not q:
        return Response([])
    qs = User.objects.filter(
        is_active=True, dms_enabled=True
    ).filter(
        Q(name__icontains=q) | Q(sap_username__icontains=q) |
        Q(employee_id__icontains=q) | Q(email__icontains=q) |
        Q(department__icontains=q)
    ).exclude(id=request.user.id)[:20]
    return Response([
        {
            'id': u.id,
            'name': u.name,
            'email': u.email,
            'department': u.department,
            'role': u.role,
            'sap_username': u.sap_username,
        }
        for u in qs
    ])
