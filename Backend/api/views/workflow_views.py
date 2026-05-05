import os, uuid, traceback
from datetime import datetime
from django.http import FileResponse
from django.db import transaction
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from api.models import (
    Document, WorkflowInstance, WorkflowLevel, WorkflowTask,
    AuditLog, WorkflowHistorySnapshot, User,
)

STATUS_MAP = {
    'Prepare':  ('05', 'Draft'),
    'Check':    ('15', 'In Check'),
    'Review':   ('20', 'In Review'),
    'Approve':  ('25', 'In Approval'),
    'Released': ('30', 'Released'),
    'Rejected': ('05', 'Draft'),
}

DEFAULT_LEVELS = [
    {'step': 1, 'name': 'Prepare', 'stage': 'Prepare', 'checklist_required': False},
    {'step': 2, 'name': 'Check',   'stage': 'Check',   'checklist_required': False},
    {'step': 3, 'name': 'Review',  'stage': 'Review',  'checklist_required': False},
    {'step': 4, 'name': 'Approve', 'stage': 'Approve', 'checklist_required': False},
]


def _iso(dt):
    return dt.isoformat() + 'Z' if dt else None


def _log(user, doc, action, note=''):
    AuditLog.objects.create(document_id=doc.id, user_id=user.id, action=action, note=note)


def _save_wf_snapshot(doc, wf, outcome, rejection_note=''):
    try:
        levels_data = []
        for lv in wf.levels.all():
            tasks_data = []
            for t in lv.tasks.select_related('assignee').all():
                tasks_data.append({
                    'step': t.step,
                    'assignee_id': t.assignee_id,
                    'assignee_name': t.assignee.name if t.assignee else None,
                    'status': t.status,
                    'action_note': t.action_note,
                    'digital_sig_log': t.digital_sig_log,
                    'checklist_done': t.checklist_done,
                    'checklist_file_name': t.checklist_file_name,
                    'checklist_file_path': t.checklist_file_path,
                    'completed_at': _iso(t.completed_at),
                })
            levels_data.append({
                'step': lv.step, 'name': lv.name, 'stage': lv.stage,
                'status': lv.status, 'checklist_required': lv.checklist_required,
                'checklist_template_name': lv.checklist_template_name,
                'tasks': tasks_data,
            })
        WorkflowHistorySnapshot.objects.create(
            document_id=doc.id,
            outcome=outcome,
            rejected_at_stage=wf.stage if outcome == 'rejected' else None,
            rejection_note=rejection_note if outcome == 'rejected' else None,
            initiated_at=wf.started_at,
            mode=wf.mode,
            snapshot={'levels': levels_data},
        )
    except Exception:
        print('Snapshot save error:', traceback.format_exc())


@api_view(['GET'])
def my_inbox(request):
    task_wf_ids = WorkflowTask.objects.filter(
        assignee_id=request.user.id, status='Pending'
    ).values_list('workflow_id', flat=True)
    doc_ids = WorkflowInstance.objects.filter(
        id__in=task_wf_ids, completed=False
    ).values_list('document_id', flat=True)
    docs = Document.objects.filter(id__in=doc_ids).select_related('doc_type', 'workflow')
    from api.views.document_views import _doc_to_dict
    return Response([_doc_to_dict(d) for d in docs])


@api_view(['GET'])
def all_pending(request):
    doc_ids = WorkflowInstance.objects.filter(
        completed=False, stage__in=['Check', 'Review', 'Approve']
    ).values_list('document_id', flat=True)
    if not doc_ids:
        return Response([])
    docs = Document.objects.filter(id__in=doc_ids).select_related('doc_type', 'workflow')
    from api.views.document_views import _doc_to_dict
    return Response([_doc_to_dict(d) for d in docs])


@api_view(['POST'])
@parser_classes([JSONParser])
@transaction.atomic
def initiate_workflow(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    if doc.status not in ('Draft', 'Created'):
        return Response({'error': 'Only Draft or Created documents can start a workflow'}, status=400)

    try:
        old_wf = doc.workflow
        old_wf.tasks.all().delete()
        old_wf.levels.all().delete()
        old_wf.delete()
    except Exception:
        pass

    data = request.data
    mode = data.get('mode', 'Auto Populate')
    levels_input = data.get('levels', [])
    check_assignees = data.get('check_assignees', [])
    review_assignees = data.get('review_assignees', [])
    approve_assignees = data.get('approve_assignees', [])

    if mode == 'Auto Populate':
        try:
            wf_cfg = doc.doc_type.workflowconfig
            raw_levels = wf_cfg.levels if wf_cfg.levels else DEFAULT_LEVELS
        except Exception:
            raw_levels = DEFAULT_LEVELS
    else:
        if not levels_input:
            return Response({'error': 'User-defined workflow requires levels'}, status=400)
        if len(levels_input) > 7:
            return Response({'error': 'User-defined workflow supports up to 7 levels'}, status=400)
        raw_levels = levels_input

    wf = WorkflowInstance.objects.create(
        document_id=doc_id,
        mode=mode,
        stage='Check',
        current_step=2,
        total_steps=len(raw_levels),
        completed=False,
    )

    assignees_by_step = {}
    if mode == 'User Defined':
        for lv in levels_input:
            step = lv.get('step') if isinstance(lv, dict) else getattr(lv, 'step', None)
            ids = lv.get('assignee_ids', []) if isinstance(lv, dict) else getattr(lv, 'assignee_ids', [])
            if step:
                assignees_by_step[step] = ids

    for lv_data in raw_levels:
        step  = lv_data['step']  if isinstance(lv_data, dict) else lv_data.step
        name  = lv_data['name']  if isinstance(lv_data, dict) else lv_data.name
        stage = lv_data['stage'] if isinstance(lv_data, dict) else lv_data.stage
        cr    = lv_data.get('checklist_required', False) if isinstance(lv_data, dict) else getattr(lv_data, 'checklist_required', False)
        ci    = lv_data.get('checklist_items', []) if isinstance(lv_data, dict) else getattr(lv_data, 'checklist_items', [])

        lv_status = 'In Progress' if step == 2 else ('Done' if step == 1 else 'Pending')
        wf_level = WorkflowLevel.objects.create(
            workflow_id=wf.id, step=step, name=name, stage=stage,
            checklist_required=cr, checklist_items=ci or [], status=lv_status,
        )

        if step == 1:
            WorkflowTask.objects.create(
                workflow_id=wf.id, level_id=wf_level.id, step=step,
                assignee_id=request.user.id, status='Approved',
                digital_sig_log={
                    'user': request.user.name, 'action': 'Initiated',
                    'timestamp': datetime.utcnow().isoformat() + 'Z',
                },
                completed_at=datetime.utcnow(),
            )
            wf_level.status = 'Done'
            wf_level.save(update_fields=['status'])
        elif step == 2:
            ids = assignees_by_step.get(step, [])
            if mode == 'Auto Populate' and check_assignees:
                ids = check_assignees
            _create_tasks(wf, wf_level, step, ids, request.user)
        elif step == 3:
            ids = assignees_by_step.get(step, [])
            if mode == 'Auto Populate' and review_assignees:
                ids = review_assignees
            _create_tasks(wf, wf_level, step, ids, request.user)
        elif step >= 4:
            ids = assignees_by_step.get(step, [])
            if mode == 'Auto Populate' and step == 4 and approve_assignees:
                ids = approve_assignees
            _create_tasks(wf, wf_level, step, ids, request.user)

    doc.status = 'In Check'
    doc.status_code = '15'
    doc.save(update_fields=['status', 'status_code'])

    _log(request.user, doc, 'Workflow Initiated', f'Mode: {mode}, Steps: {len(raw_levels)}')
    return Response({'message': 'Workflow initiated', 'stage': 'Check', 'status_code': '15'})


def _create_tasks(wf, level, step, assignee_ids, initiator):
    seen = set()
    for uid in (assignee_ids or []):
        if uid in seen or uid == initiator.id:
            continue
        seen.add(uid)
        WorkflowTask.objects.create(
            workflow_id=wf.id, level_id=level.id, step=step,
            assignee_id=uid, status='Pending',
        )


@api_view(['POST'])
@parser_classes([JSONParser])
@transaction.atomic
def workflow_action(request, doc_id):
    try:
        doc = Document.objects.select_related('creator').get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Workflow not found'}, status=404)

    try:
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Workflow not found'}, status=404)

    if wf.completed:
        return Response({'error': 'Workflow already completed'}, status=400)

    task = WorkflowTask.objects.select_related('level', 'assignee').filter(
        workflow_id=wf.id,
        assignee_id=request.user.id,
        step=wf.current_step,
        status='Pending',
    ).first()
    if not task:
        return Response({'error': 'No pending task for you at this stage'}, status=403)

    level = task.level
    if level.checklist_required and level.checklist_template_path and not task.checklist_done:
        return Response({'error': 'Checklist must be completed before approving'}, status=400)

    data = request.data
    action = data.get('action')
    note = data.get('note', '')
    password = data.get('password', '')

    if action in ('approve', 'reject'):
        if not password:
            return Response({'error': 'Password is required to authenticate your approval/rejection (digital signature).'}, status=400)
        import bcrypt as _bcrypt
        stored_hash = (request.user.hashed_password or '').encode()
        try:
            valid = _bcrypt.checkpw(password.encode(), stored_hash)
        except Exception:
            valid = False
        if not valid:
            return Response({'error': 'Incorrect password. Please enter your login password to authenticate this action.'}, status=401)

    ip = request.META.get('REMOTE_ADDR', '')
    task.digital_sig_log = {
        'user': request.user.name, 'user_id': request.user.id,
        'action': action, 'timestamp': datetime.utcnow().isoformat() + 'Z',
        'ip': ip, 'note': note,
    }
    task.action_note = note
    task.completed_at = datetime.utcnow()

    if action == 'reject':
        rejection_level = level.name
        rejection_note = note

        _log(request.user, doc, f'Workflow Rejected at {rejection_level}', rejection_note)
        _save_wf_snapshot(doc, wf, 'rejected', rejection_note)

        wf.tasks.all().delete()
        wf.levels.all().delete()
        wf.delete()

        doc.status = 'Draft'
        doc.status_code = '05'
        doc.save(update_fields=['status', 'status_code'])

        return Response({'message': 'Document rejected and returned to Draft. Author can re-initiate workflow after corrections.', 'status_code': '05'})

    task.status = 'Approved'
    task.save()

    all_tasks = WorkflowTask.objects.filter(workflow_id=wf.id, step=wf.current_step)
    all_approved = all(t.status == 'Approved' for t in all_tasks)

    if not all_approved:
        _log(request.user, doc, f'Approved at {level.name} (waiting for peers)', '')
        return Response({'message': 'Approval recorded, waiting for other approvers at this level'})

    level.status = 'Done'
    level.save(update_fields=['status'])
    next_step = wf.current_step + 1

    if next_step > wf.total_steps:
        _save_wf_snapshot(doc, wf, 'released')
        wf.stage = 'Released'
        wf.completed = True
        wf.completed_at = datetime.utcnow()
        wf.save(update_fields=['stage', 'completed', 'completed_at'])
        doc.status = 'Released'
        doc.status_code = '30'
        doc.save(update_fields=['status', 'status_code'])
        _log(request.user, doc, 'Document Released (Workflow Complete)', 'Status: 30')
        return Response({'message': 'Document released', 'status_code': '30'})

    wf.current_step = next_step
    next_level = wf.levels.filter(step=next_step).first()
    if next_level:
        next_level.status = 'In Progress'
        next_level.save(update_fields=['status'])
        wf.stage = next_level.stage
        code, status_str = STATUS_MAP.get(wf.stage, ('15', 'In Check'))
        doc.status = status_str
        doc.status_code = code
        doc.save(update_fields=['status', 'status_code'])
    wf.save(update_fields=['current_step', 'stage'])

    _log(request.user, doc, f'Level {wf.current_step - 1} Approved — Advanced to Level {next_step}', '')
    return Response({'message': f'Advanced to {next_level.name if next_level else "next"}', 'status_code': doc.status_code})


@api_view(['POST'])
@parser_classes([JSONParser])
def complete_checklist(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Workflow not found'}, status=404)

    task = WorkflowTask.objects.filter(
        workflow_id=wf.id, assignee_id=request.user.id,
        step=wf.current_step, status='Pending',
    ).first()
    if not task:
        return Response({'error': 'No pending task'}, status=403)

    task.checklist_done = True
    task.save(update_fields=['checklist_done'])
    _log(request.user, doc, 'Checklist Completed', f'Step {wf.current_step}')
    return Response({'message': 'Checklist submitted'})


@api_view(['POST'])
@parser_classes([JSONParser])
@transaction.atomic
def return_document(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Not found'}, status=404)

    note = request.data.get('note', '')
    wf.tasks.all().delete()
    wf.levels.all().delete()
    wf.delete()

    doc.status = 'Created'
    doc.status_code = '10'
    doc.save(update_fields=['status', 'status_code'])
    _log(request.user, doc, 'Returned for Correction — Workflow Reset', note)
    return Response({'message': 'Workflow reset. Document returned to Created status. You can now re-initiate the workflow.'})


@api_view(['POST'])
@parser_classes([JSONParser])
def assign_user(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Workflow not found'}, status=404)

    step = request.data.get('step')
    assignee_id = request.data.get('assignee_id')
    level = wf.levels.filter(step=step).first()
    if not level:
        return Response({'error': f'Level {step} not found'}, status=404)

    existing = set(level.tasks.values_list('assignee_id', flat=True))
    if assignee_id in existing or assignee_id == request.user.id:
        return Response({'error': 'User already assigned or self-assign not allowed'}, status=400)

    WorkflowTask.objects.create(
        workflow_id=wf.id, level_id=level.id, step=step,
        assignee_id=assignee_id, status='Pending',
    )
    _log(request.user, doc, f'User Added to Level {step}', f'User ID {assignee_id}')
    return Response({'message': 'User assigned'})


@api_view(['GET'])
def workflow_status(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Workflow not found'}, status=404)

    return Response({
        'id': wf.id,
        'mode': wf.mode or 'Auto Populate',
        'stage': wf.stage or 'Prepare',
        'current_step': wf.current_step or 1,
        'total_steps': wf.total_steps or 4,
        'completed': bool(wf.completed),
        'rejected': bool(wf.rejected),
        'rejection_reason': wf.rejection_reason,
        'started_at': _iso(wf.started_at),
        'levels': [
            {
                'id': lv.id, 'step': lv.step, 'name': lv.name,
                'stage': lv.stage, 'status': lv.status,
                'checklist_required': bool(lv.checklist_required),
                'checklist_template_name': lv.checklist_template_name,
                'checklist_template_path': lv.checklist_template_path,
                'tasks': [
                    {
                        'id': t.id, 'step': t.step, 'status': t.status,
                        'checklist_done': bool(t.checklist_done),
                        'checklist_file_name': t.checklist_file_name,
                        'checklist_file_path': t.checklist_file_path,
                        'action_note': t.action_note,
                        'completed_at': _iso(t.completed_at),
                        'assignee': {
                            'id': t.assignee.id, 'name': t.assignee.name, 'email': t.assignee.email,
                        } if t.assignee else None,
                    }
                    for t in lv.tasks.select_related('assignee').all()
                ],
            }
            for lv in wf.levels.all()
        ],
        'tasks': [
            {
                'id': t.id, 'step': t.step, 'status': t.status,
                'checklist_done': bool(t.checklist_done),
                'checklist_file_name': t.checklist_file_name,
                'action_note': t.action_note,
                'completed_at': _iso(t.completed_at),
                'assignee': {'id': t.assignee.id, 'name': t.assignee.name} if t.assignee else None,
            }
            for t in wf.tasks.select_related('assignee').all()
        ],
    })


@api_view(['POST'])
def submit_document(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)
    if doc.status != 'Draft':
        return Response({'error': 'Only Draft documents can be submitted'}, status=400)
    doc.status = 'Created'
    doc.status_code = '10'
    doc.save(update_fields=['status', 'status_code'])
    _log(request.user, doc, 'Submitted (Created)', 'Ready for workflow initiation')
    return Response({'message': 'Document ready for workflow', 'status_code': '10'})


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def checklist_template(request, doc_id, level_id):
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Document not found'}, status=404)

    level = WorkflowLevel.objects.filter(id=level_id, workflow_id=wf.id).first()
    if not level:
        return Response({'error': 'Level not found'}, status=404)

    file = request.FILES.get('file')
    if not file:
        return Response({'error': 'No file provided'}, status=400)

    os.makedirs('uploads/checklists', exist_ok=True)
    ext = os.path.splitext(file.name)[1].lower()
    unique_name = f'tmpl_{uuid.uuid4()}{ext}'
    path = f'uploads/checklists/{unique_name}'
    content = file.read()
    with open(path, 'wb') as f:
        f.write(content)

    level.checklist_template_path = path
    level.checklist_template_name = file.name
    level.save(update_fields=['checklist_template_path', 'checklist_template_name'])

    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action=f'Checklist Template Uploaded — Level {level.step}',
        note=file.name,
    )
    return Response({'message': 'Template uploaded', 'filename': file.name, 'level_id': level_id})


@api_view(['GET'])
def download_checklist_template(request, doc_id, level_id):
    level = WorkflowLevel.objects.filter(id=level_id).first()
    if not level or not level.checklist_template_path:
        return Response({'error': 'No checklist template uploaded for this level'}, status=404)
    if not os.path.exists(level.checklist_template_path):
        return Response({'error': 'Template file not found on server'}, status=404)

    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action=f'Checklist Template Downloaded — Level {level.step}',
        note=level.checklist_template_name,
    )
    return FileResponse(
        open(level.checklist_template_path, 'rb'),
        as_attachment=True,
        filename=level.checklist_template_name or 'checklist_template',
    )


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def submit_completed_checklist(request, doc_id, task_id):
    task = WorkflowTask.objects.filter(id=task_id, assignee_id=request.user.id).first()
    if not task:
        return Response({'error': 'Task not found or not assigned to you'}, status=404)
    if task.status != 'Pending':
        return Response({'error': 'Task is already completed'}, status=400)

    file = request.FILES.get('file')
    if not file:
        return Response({'error': 'No file provided'}, status=400)

    os.makedirs('uploads/checklists', exist_ok=True)
    ext = os.path.splitext(file.name)[1].lower()
    unique_name = f'done_{uuid.uuid4()}{ext}'
    path = f'uploads/checklists/{unique_name}'
    content = file.read()
    with open(path, 'wb') as f:
        f.write(content)

    task.checklist_file_path = path
    task.checklist_file_name = file.name
    task.checklist_done = True
    task.save(update_fields=['checklist_file_path', 'checklist_file_name', 'checklist_done'])

    AuditLog.objects.create(
        document_id=doc_id, user_id=request.user.id,
        action=f'Completed Checklist Uploaded — Level {task.step}',
        note=file.name,
    )
    return Response({'message': 'Checklist submitted', 'task_id': task_id, 'filename': file.name, 'checklist_done': True})


@api_view(['GET'])
def download_completed_checklist(request, doc_id, task_id):
    task = WorkflowTask.objects.filter(id=task_id).first()
    if not task or not task.checklist_file_path:
        return Response({'error': 'No completed checklist uploaded for this task'}, status=404)
    if not os.path.exists(task.checklist_file_path):
        return Response({'error': 'File not found on server'}, status=404)
    return FileResponse(
        open(task.checklist_file_path, 'rb'),
        as_attachment=True,
        filename=task.checklist_file_name or 'completed_checklist',
    )


@api_view(['GET'])
def download_history_checklist(request, doc_id):
    path = request.query_params.get('path', '')
    import os as _os
    base = _os.path.abspath('uploads/checklists')
    target = _os.path.abspath(path)
    if not target.startswith(base):
        return Response({'error': 'Access denied'}, status=403)
    if not _os.path.exists(target):
        return Response({'error': 'Checklist file not found'}, status=404)
    filename = _os.path.basename(target)
    return FileResponse(open(target, 'rb'), as_attachment=True, filename=filename)
