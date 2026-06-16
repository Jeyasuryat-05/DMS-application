import os, uuid, traceback
from datetime import datetime
from django.utils import timezone as _tz
from django.db import models
from django.http import FileResponse
from django.db import transaction
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from api.models import (
    Document, WorkflowInstance, WorkflowLevel, WorkflowTask,
    AuditLog, WorkflowHistorySnapshot, User,
)
from api import email_utils
from api.authentication import require_read, require_edit

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
    # Only surface tasks whose step matches the workflow's CURRENT step.
    # Future steps (e.g. an Approver waiting on the Checker) must not appear yet.
    active_task_wf_ids = WorkflowTask.objects.filter(
        assignee_id=request.user.id,
        status='Pending',
        step=models.F('workflow__current_step'),
        workflow__completed=False,
    ).values_list('workflow_id', flat=True)
    doc_ids = WorkflowInstance.objects.filter(
        id__in=active_task_wf_ids
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
    if not request.user.can_edit:
        return Response({'error': 'You do not have edit access. Workflow initiation requires Edit permission.'}, status=403)

    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    data = request.data
    purpose = data.get('purpose', 'release')
    if purpose not in ('release', 'archive'):
        return Response({'error': f'Unknown workflow purpose {purpose!r}'}, status=400)



    if purpose == 'release':
        if doc.status != 'Draft':
            return Response({'error': 'Only Draft documents can start a release workflow'}, status=400)
        # Block initiation if expiry or revision date is today or earlier.
        # The author must move the dates into the future before re-initiating.
        from datetime import date as _date
        today = _date.today()
        stale = []
        if doc.expiry_date:
            d = doc.expiry_date.date() if hasattr(doc.expiry_date, 'date') else doc.expiry_date
            if d <= today:
                stale.append(f'expiry date ({d.strftime("%d %b %Y")})')
        if doc.revision_due:
            d = doc.revision_due.date() if hasattr(doc.revision_due, 'date') else doc.revision_due
            if d <= today:
                stale.append(f'revision due ({d.strftime("%d %b %Y")})')
        if stale:
            return Response({'error': (
                f'Cannot initiate workflow — {", and ".join(stale)} is today or has already passed. '
                'Update the date(s) on the document and try again.'
            )}, status=400)

        # Expiry must be strictly later than revision due.
        if doc.expiry_date and doc.revision_due:
            _e = doc.expiry_date.date() if hasattr(doc.expiry_date, 'date') else doc.expiry_date
            _r = doc.revision_due.date() if hasattr(doc.revision_due, 'date') else doc.revision_due
            if _e <= _r:
                return Response({'error': (
                    'Cannot initiate workflow — expiry date must be later than revision due date. '
                    'Update the dates on the document and try again.'
                )}, status=400)

        # USI (from custom_metadata or doc.usi_kks_code) must be exactly 5 digits.
        import re as _re
        cm = doc.custom_metadata or {}
        usi_val = (cm.get('usi') or cm.get('usi_kks_code') or doc.usi_kks_code or '').strip()
        if usi_val and not _re.fullmatch(r'\d{5}', usi_val):
            return Response({'error': (
                f'Cannot initiate workflow — USI "{usi_val}" must be exactly 5 numeric digits. '
                'Update the USI and try again.'
            )}, status=400)

        # Generic schema-driven char / numeric length validation.
        if doc.doc_type:
            for f in (doc.doc_type.metadata_schema or []):
                if not isinstance(f, dict): continue
                ftype = f.get('type')
                if ftype not in ('char', 'numeric'): continue
                v = cm.get(f.get('key'))
                if v in (None, ''): continue
                v = str(v)
                if ftype == 'numeric' and not _re.fullmatch(r'\d+', v):
                    return Response({'error': f'Cannot initiate workflow — "{f.get("label")}" must contain digits only.'}, status=400)
                if f.get('length') and len(v) != f['length']:
                    return Response({'error': f'Cannot initiate workflow — "{f.get("label")}" must be exactly {f["length"]} {"digits" if ftype=="numeric" else "characters"}.'}, status=400)
    else:  # archive
        if doc.status != 'Released':
            return Response({'error': 'Only Released documents can start an archive workflow'}, status=400)
        obsolete_reason = (data.get('obsolete_reason') or '').strip()
        if not obsolete_reason:
            return Response({'error': 'Obsolete reason is mandatory when archiving a document'}, status=400)
        # Stash on the document so the final approver can persist it.
        doc.obsolete_reason = obsolete_reason
        doc.save(update_fields=['obsolete_reason'])

    try:
        old_wf = doc.workflow
        old_wf.tasks.all().delete()
        old_wf.levels.all().delete()
        old_wf.delete()
    except Exception:
        pass

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
        if len(levels_input) < 2:
            return Response({'error': 'Workflow needs at least one approval level after Prepare'}, status=400)
        if len(levels_input) > 7:
            return Response({'error': 'User-defined workflow supports up to 7 levels'}, status=400)
        raw_levels = levels_input

    wf = WorkflowInstance.objects.create(
        document_id=doc_id,
        mode=mode,
        purpose=purpose,
        stage='Check',
        current_step=2,
        total_steps=len(raw_levels),
        completed=False,
    )

    # During an archive workflow, the doc is no longer simply "Released" —
    # show it as "In Archive" so the UI knows to lock it.
    if purpose == 'archive':
        doc.status = 'In Archive'
        doc.status_code = '35'
        doc.save(update_fields=['status', 'status_code'])

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
                    'timestamp': _tz.now().isoformat() + 'Z',
                },
                completed_at=_tz.now(),
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

    # Email: notify step-2 (Check) assignees
    try:
        step2_level = wf.levels.filter(step=2).first()
        if step2_level:
            step2_assignees = list(User.objects.filter(
                id__in=step2_level.tasks.values_list('assignee_id', flat=True)
            ))
            email_utils.notify_workflow_assigned(
                doc, step2_level.name, step2_assignees, request.user.name
            )
    except Exception:
        pass

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

    ip = request.META.get('REMOTE_ADDR', '')
    task.digital_sig_log = {
        'user': request.user.name, 'user_id': request.user.id,
        'action': action, 'timestamp': _tz.now().isoformat() + 'Z',
        'ip': ip, 'note': note,
    }
    task.action_note = note
    task.completed_at = _tz.now()

    if action == 'reject':
        rejection_level = level.name
        rejection_note = note
        was_archive = (wf.purpose == 'archive')

        _log(request.user, doc, f'Workflow Rejected at {rejection_level}', rejection_note)
        _save_wf_snapshot(doc, wf, 'rejected', rejection_note)

        wf.tasks.all().delete()
        wf.levels.all().delete()
        wf.delete()

        if was_archive:
            # Archive workflow rejected → return to Released state, clear obsolete reason.
            doc.status = 'Released'
            doc.status_code = '30'
            doc.obsolete_reason = None
            doc.save(update_fields=['status', 'status_code', 'obsolete_reason'])
            return Response({'message': 'Archive request rejected. Document remains Released.', 'status_code': '30'})

        doc.status = 'Draft'
        doc.status_code = '05'
        doc.save(update_fields=['status', 'status_code'])

        # Email: notify creator of rejection
        try:
            creator = doc.creator
            email_utils.notify_rejected(doc, request.user.name, rejection_level, rejection_note, creator)
        except Exception:
            pass

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
        # Block release if expiry / revision dates are today or already passed.
        # The approver must reject and ask the author to update the dates
        # before the document can be released.
        if wf.purpose == 'release':
            from datetime import date as _date
            today = _date.today()
            stale = []
            if doc.expiry_date:
                d = doc.expiry_date.date() if hasattr(doc.expiry_date, 'date') else doc.expiry_date
                if d <= today:
                    stale.append(f'expiry date ({d.strftime("%d %b %Y")})')
            if doc.revision_due:
                d = doc.revision_due.date() if hasattr(doc.revision_due, 'date') else doc.revision_due
                if d <= today:
                    stale.append(f'revision due ({d.strftime("%d %b %Y")})')
            if stale:
                return Response({'error': (
                    f'Cannot release the document — {", and ".join(stale)} is today or has already passed. '
                    'Please reject this workflow so the author can update the date(s) and re-initiate.'
                )}, status=400)

            # Expiry must be strictly later than revision due.
            if doc.expiry_date and doc.revision_due:
                _e = doc.expiry_date.date() if hasattr(doc.expiry_date, 'date') else doc.expiry_date
                _r = doc.revision_due.date() if hasattr(doc.revision_due, 'date') else doc.revision_due
                if _e <= _r:
                    return Response({'error': (
                        'Cannot release the document — expiry date must be later than revision due date. '
                        'Please reject this workflow so the author can correct the dates and re-initiate.'
                    )}, status=400)

            # USI must be exactly 5 digits.
            import re as _re
            cm = doc.custom_metadata or {}
            usi_val = (cm.get('usi') or cm.get('usi_kks_code') or doc.usi_kks_code or '').strip()
            if usi_val and not _re.fullmatch(r'\d{5}', usi_val):
                return Response({'error': (
                    f'Cannot release the document — USI "{usi_val}" must be exactly 5 numeric digits. '
                    'Please reject this workflow so the author can correct the USI and re-initiate.'
                )}, status=400)

            # Generic schema-driven char / numeric checks at release.
            if doc.doc_type:
                for f in (doc.doc_type.metadata_schema or []):
                    if not isinstance(f, dict): continue
                    ftype = f.get('type')
                    if ftype not in ('char', 'numeric'): continue
                    v = cm.get(f.get('key'))
                    if v in (None, ''): continue
                    v = str(v)
                    if ftype == 'numeric' and not _re.fullmatch(r'\d+', v):
                        return Response({'error': f'Cannot release the document — "{f.get("label")}" must contain digits only. Please reject so the author can correct it.'}, status=400)
                    if f.get('length') and len(v) != f['length']:
                        return Response({'error': f'Cannot release the document — "{f.get("label")}" must be exactly {f["length"]} {"digits" if ftype=="numeric" else "characters"}. Please reject so the author can correct it.'}, status=400)

        # Archive workflow path — final approval flips the doc to Archived
        # and persists the obsolete reason captured at initiation.
        if wf.purpose == 'archive':
            _save_wf_snapshot(doc, wf, 'archived')
            wf.stage = 'Archived'
            wf.completed = True
            wf.completed_at = _tz.now()
            wf.save(update_fields=['stage', 'completed', 'completed_at'])
            doc.status = 'Archived'
            doc.status_code = '90'
            doc.archived_at = _tz.now()
            doc.archived_by_id = request.user.id
            doc.save(update_fields=['status', 'status_code', 'archived_at', 'archived_by'])
            _log(request.user, doc, 'Document Archived (Obsolete) — Workflow Complete',
                 doc.obsolete_reason or '')
            return Response({
                'message': 'Document archived as obsolete.',
                'status_code': '90',
            })

        # Enforce version order: every earlier DocumentVersion must already
        # exist (i.e. be a known prior release) before this one can release.
        # Reject if a numerically earlier version is missing — that means a
        # higher version got created out-of-band and the system would skip
        # over the missing predecessor.
        from api.models import DocumentVersion
        def _ver_key(s):
            try:
                return tuple(int(p) for p in str(s).split('.'))
            except Exception:
                return (0,)
        current_key = _ver_key(doc.current_version)
        earlier_versions = [
            v for v in DocumentVersion.objects.filter(document_id=doc.id)
            if _ver_key(v.version_number) < current_key
        ]
        # Find the highest earlier version actually recorded
        if earlier_versions:
            highest_prior = max(earlier_versions, key=lambda v: _ver_key(v.version_number))
            # Build expected predecessor by decrementing the minor of current.
            # E.g. current=1.3 → expected predecessor is the highest version with key < (1,3).
            # If the highest prior is, say, 1.1 (because 1.2 was never created),
            # there is a gap — block the release.
            cur_major, cur_minor = current_key[0], (current_key[1] if len(current_key) > 1 else 0)
            prior_key = _ver_key(highest_prior.version_number)
            prior_major = prior_key[0]
            prior_minor = prior_key[1] if len(prior_key) > 1 else 0
            expected_ok = (
                # immediate minor predecessor: same major, minor diff = 1
                (prior_major == cur_major and prior_minor == cur_minor - 1)
                # or this is a major bump (e.g. 1.4 → 2.0): predecessor must be highest minor of prior major
                or (cur_minor == 0 and prior_major == cur_major - 1)
            )
            if not expected_ok:
                return Response({
                    'error': (
                        f'Cannot release v{doc.current_version}: an earlier version is missing. '
                        f'Last known prior version is v{highest_prior.version_number}. '
                        f'Release the predecessor first, or ask an admin to reset this workflow.'
                    )
                }, status=400)

        _save_wf_snapshot(doc, wf, 'released')
        wf.stage = 'Released'
        wf.completed = True
        wf.completed_at = _tz.now()
        wf.save(update_fields=['stage', 'completed', 'completed_at'])
        doc.status = 'Released'
        doc.status_code = '30'
        doc.save(update_fields=['status', 'status_code'])
        _log(request.user, doc, 'Document Released (Workflow Complete)', 'Status: 30')

        # Email: notify creator of release
        try:
            email_utils.notify_released(doc, request.user.name, doc.creator)
        except Exception:
            pass

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

    # Email: notify next-level assignees
    try:
        if next_level:
            next_assignees = list(User.objects.filter(
                id__in=next_level.tasks.values_list('assignee_id', flat=True)
            ))
            email_utils.notify_approved(doc, request.user.name, next_level.name, next_assignees)
    except Exception:
        pass

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
@require_edit
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

    doc.status = 'Draft'
    doc.status_code = '05'
    doc.save(update_fields=['status', 'status_code'])
    _log(request.user, doc, 'Returned for Correction — Workflow Reset', note)

    # Email: notify creator
    try:
        email_utils.notify_returned(doc, request.user.name, note, doc.creator)
    except Exception:
        pass

    return Response({'message': 'Workflow reset. Document returned to Draft status. You can now re-initiate the workflow.'})


@api_view(['POST'])
@parser_classes([JSONParser])
def assign_user(request, doc_id):
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Workflow not found'}, status=404)

    # Only System/Sub Admins or the document creator may add assignees
    if not _is_admin(request.user) and doc.creator_id != request.user.id:
        return Response({'error': 'Only admins or the document creator can assign workflow users'}, status=403)

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
    _log(request.user, doc, 'Submitted', 'Ready for workflow initiation')
    return Response({'message': 'Document ready for workflow', 'status_code': '05'})


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

    ext = os.path.splitext(file.name or '')[1].lower()
    _CHECKLIST_ALLOWED = {'.pdf', '.docx', '.xlsx', '.doc', '.xls'}
    if ext not in _CHECKLIST_ALLOWED:
        return Response({'error': f'Only PDF, Word, and Excel files are allowed for checklist templates. Got: {ext or "(no extension)"}'}, status=400)

    os.makedirs('uploads/checklists', exist_ok=True)
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

    ext = os.path.splitext(file.name or '')[1].lower()
    _CHECKLIST_ALLOWED = {'.pdf', '.docx', '.xlsx', '.doc', '.xls'}
    if ext not in _CHECKLIST_ALLOWED:
        return Response({'error': f'Only PDF, Word, and Excel files are allowed for checklist submissions. Got: {ext or "(no extension)"}'}, status=400)

    os.makedirs('uploads/checklists', exist_ok=True)
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


# ── Admin Workflow Recovery ────────────────────────────────────────────────────

def _is_admin(user):
    return (user.role or '') in ('System Admin', 'Sub Admin')


@api_view(['POST'])
@parser_classes([JSONParser])
@transaction.atomic
def admin_force_reset(request, doc_id):
    """Admin: completely reset a stuck workflow → document goes back to Created."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    note = request.data.get('note', 'Admin force-reset').strip() or 'Admin force-reset'

    try:
        wf = doc.workflow
        _save_wf_snapshot(doc, wf, 'force_reset', note)
        wf.tasks.all().delete()
        wf.levels.all().delete()
        wf.delete()
    except Exception:
        pass

    doc.status = 'Draft'
    doc.status_code = '05'
    doc.save(update_fields=['status', 'status_code'])
    _log(request.user, doc, 'Admin: Workflow Force-Reset', note)
    return Response({'message': 'Workflow reset. Document is now in Draft status and can be re-initiated.'})


@api_view(['POST'])
@parser_classes([JSONParser])
@transaction.atomic
def admin_reassign(request, doc_id):
    """Admin: replace all pending tasks at the current step with a new assignee."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    try:
        doc = Document.objects.get(id=doc_id)
        wf = doc.workflow
    except Exception:
        return Response({'error': 'Workflow not found'}, status=404)

    if wf.completed:
        return Response({'error': 'Workflow is already completed'}, status=400)

    new_assignee_id = request.data.get('assignee_id')
    if not new_assignee_id:
        return Response({'error': 'assignee_id is required'}, status=400)

    try:
        new_user = User.objects.get(id=int(new_assignee_id))
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    step = wf.current_step
    level = wf.levels.filter(step=step).first()
    if not level:
        return Response({'error': f'No level found for step {step}'}, status=400)

    old_assignees = list(
        wf.tasks.filter(step=step, status='Pending')
        .select_related('assignee')
        .values_list('assignee__name', flat=True)
    )
    wf.tasks.filter(step=step, status='Pending').delete()

    WorkflowTask.objects.create(
        workflow_id=wf.id, level_id=level.id,
        step=step, assignee_id=new_user.id, status='Pending',
    )
    old_str = ', '.join(filter(None, old_assignees)) or 'unassigned'
    _log(request.user, doc, f'Admin: Reassigned Step {step}',
         f'Replaced [{old_str}] → {new_user.name}')
    return Response({'message': f'Step {step} reassigned to {new_user.name}'})


@api_view(['POST'])
@parser_classes([JSONParser])
@transaction.atomic
def admin_fix_status(request, doc_id):
    """Admin: fix document status when it is out of sync with the workflow."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    try:
        doc = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)

    try:
        wf = doc.workflow
        if wf.completed:
            correct_status, correct_code = 'Released', '30'
        else:
            correct_status, correct_code = STATUS_MAP.get(wf.stage, ('05', 'Draft'))
    except Exception:
        correct_status, correct_code = 'Draft', '05'

    old_status = doc.status
    doc.status = correct_status
    doc.status_code = correct_code
    doc.save(update_fields=['status', 'status_code'])
    _log(request.user, doc, 'Admin: Status Fixed',
         f'{old_status} → {correct_status}')
    return Response({'message': f'Status corrected: {old_status} → {correct_status}'})
