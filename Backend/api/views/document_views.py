import os, uuid, json, traceback, mimetypes
from datetime import datetime, timedelta
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
    WorkflowInstance, WorkflowHistorySnapshot, User,
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
        return _list_documents(request)
    return _create_document(request)


def _list_documents(request):
    try:
        q = request.query_params.get('q')
        doc_type_id = request.query_params.get('doc_type_id')
        status_filter = request.query_params.get('status')
        confidential = request.query_params.get('confidential')
        expiring_days = request.query_params.get('expiring_days')
        skip = int(request.query_params.get('skip', 0))
        limit = int(request.query_params.get('limit', 100))

        qs = Document.objects.filter(is_deleted=False).select_related('doc_type', 'workflow')
        if q:
            qs = qs.filter(
                Q(title__icontains=q) | Q(doc_number__icontains=q) |
                Q(project__icontains=q) | Q(usi_kks_code__icontains=q)
            )
        if doc_type_id:
            qs = qs.filter(doc_type_id=int(doc_type_id))
        if status_filter:
            qs = qs.filter(status=status_filter)
        if confidential is not None:
            qs = qs.filter(confidential=(confidential.lower() == 'true'))
        if expiring_days:
            cutoff = datetime.utcnow() + timedelta(days=int(expiring_days))
            qs = qs.filter(
                expiry_date__isnull=False,
                expiry_date__lte=cutoff,
                expiry_date__gte=datetime.utcnow(),
            )
        docs = qs.order_by('-created_at')[skip:skip + limit]
        return Response([_doc_to_dict(d) for d in docs])
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

        count = Document.objects.filter(doc_type_id=doc_type_id).count() + 1
        pattern = doc_type.number_pattern or '{CODE}-{YEAR}-{SEQ}'
        seq_str = str(count).zfill(4)
        doc_number = (pattern
                      .replace('{CODE}', doc_type.code or 'DOC')
                      .replace('{TYPE}', doc_type.code or 'DOC')
                      .replace('{YEAR}', str(datetime.now().year))
                      .replace('{SEQ}', seq_str))

        parsed_meta = json.loads(custom_metadata or '{}')
        usi_from_meta = parsed_meta.pop('usi', None) or parsed_meta.pop('usi_kks_code', None) or usi_kks_code
        project_from_meta = parsed_meta.pop('project', None) or project

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
        return _get_document(request, doc_id)
    elif request.method == 'PATCH':
        return _update_document(request, doc_id)
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
        SKIP_FIELDS = {'id', 'doc_number', 'creator_id', 'status', 'current_version'}

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
                if datetime.fromisoformat(str(_rev).split('T')[0]) > datetime.fromisoformat(str(_exp).split('T')[0]):
                    return Response({'error': 'Revision Due date cannot be later than the Expiry Date.'}, status=400)
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

        for meta_key, core_attr in [('usi', 'usi_kks_code'), ('usi_kks_code', 'usi_kks_code'), ('project', 'project')]:
            if meta_key in incoming_cm:
                val = incoming_cm[meta_key]
                setattr(doc, core_attr, val if val else None)
                if core_attr not in update_fields:
                    update_fields.append(core_attr)

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
        return Response({
            'id': fb.id, 'comment': fb.comment,
            'tagged_user': {'id': tagged.id, 'name': tagged.name} if tagged else None,
        })
    except Exception:
        return Response({'error': 'Error adding feedback'}, status=500)


@api_view(['POST'])
@parser_classes([JSONParser])
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
def share_link(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)
    version = request.query_params.get('version')
    link = f'/documents/{doc_id}' + (f'?v={version}' if version else '')
    return Response({'link': link, 'doc_number': doc.doc_number, 'version': version or 'latest'})


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
@transaction.atomic
def upload_version(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

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
    if not file:
        return Response({'error': 'No file provided'}, status=400)

    parts = (doc.current_version or '1.0').split('.')
    if is_major:
        new_ver = f'{int(parts[0]) + 1}.0'
    else:
        new_ver = f'{parts[0]}.{int(parts[1] if len(parts) > 1 else 0) + 1}'

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.name)[1].lower()
    path = os.path.join(UPLOAD_DIR, f'{uuid.uuid4()}{ext}')
    content = file.read()
    with open(path, 'wb') as f:
        f.write(content)

    DocumentVersion.objects.create(
        document_id=doc.id, version_number=new_ver,
        is_major=is_major, change_reason=change_reason,
        change_label=change_label, created_by_id=request.user.id,
        file_path=path,
    )
    DocumentFile.objects.create(
        document_id=doc.id, filename=file.name, file_path=path,
        file_size=len(content), mime_type=file.content_type,
        file_format=ext.lstrip('.').upper(), uploaded_by_id=request.user.id,
    )
    doc.current_version = new_ver
    doc.save(update_fields=['current_version'])
    AuditLog.objects.create(
        document_id=doc.id, user_id=request.user.id,
        action=f'New Version v{new_ver}', note=change_reason,
    )
    return Response({'message': f'Version {new_ver} uploaded'})


@api_view(['GET'])
def download_file(request, doc_id, file_id):
    try:
        f = DocumentFile.objects.get(id=file_id, document_id=doc_id)
    except DocumentFile.DoesNotExist:
        return Response({'error': 'File not found'}, status=404)
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
def view_file(request, doc_id, file_id):
    try:
        f = DocumentFile.objects.get(id=file_id, document_id=doc_id)
    except DocumentFile.DoesNotExist:
        return Response({'error': 'File not found'}, status=404)
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

    if not request.META.get('HTTP_RANGE'):
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
def add_file(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    if doc.status not in ('Draft', 'Created'):
        return Response({'error': f'Files can only be added when the document is in Draft or Created status. Current status is \'{doc.status}\'.'}, status=403)

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
def delete_file(request, doc_id, file_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    if doc.status not in ('Draft', 'Created'):
        return Response({'error': f'Files can only be deleted when the document is in Draft or Created status. Current status is \'{doc.status}\'.'}, status=403)

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
def flag_deletion(request, doc_id):
    if request.method == 'POST':
        try:
            doc = Document.objects.get(id=doc_id, is_deleted=False)
        except Document.DoesNotExist:
            return Response({'error': 'Not found'}, status=404)

        try:
            wf = doc.workflow
            if not wf.completed and wf.stage in ('Check', 'Review', 'Approve'):
                return Response({'error': f'Cannot flag for deletion while the document is in the {wf.stage} stage. Return the workflow to Prepare first.'}, status=403)
        except Exception:
            pass

        doc.flagged_for_deletion = True
        doc.flagged_at = datetime.utcnow()
        doc.flagged_by_id = request.user.id
        doc.save(update_fields=['flagged_for_deletion', 'flagged_at', 'flagged_by_id'])
        AuditLog.objects.create(document_id=doc.id, user_id=request.user.id, action='Flagged for Deletion')
        return Response({'detail': 'Document flagged for deletion. It will be removed in the next scheduled cleanup.'})


@api_view(['DELETE'])
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
