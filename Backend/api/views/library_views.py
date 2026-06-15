from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from django.db.models import Q
from django.utils import timezone

from api.models import (
    DocumentType, Document, UserFolder, UserFolderDocType,
    FolderPermission, FolderAccessRequest, User,
)
from api.authentication import _flag_check, require_read


def _is_admin(user):
    return getattr(user, 'role', '') == 'System Admin'


def _can_edit(user, folder):
    if folder.owner_id == getattr(user, 'id', None):
        return True
    if folder.owner_id is None and _is_admin(user):
        return True
    return False


def _user_permission_on(user, folder):
    """Return 'UPLOAD', 'VIEW', or None for the user on this folder."""
    if _is_admin(user):
        return 'UPLOAD'
    if folder.owner_id == user.id:
        return 'UPLOAD'
    perm = FolderPermission.objects.filter(folder=folder, user=user).first()
    return perm.permission if perm else None


def _has_access(user, folder, level='VIEW'):
    p = _user_permission_on(user, folder)
    if p is None:
        return False
    if level == 'VIEW':
        return True  # both VIEW and UPLOAD satisfy VIEW
    return p == 'UPLOAD'


def _doc_type_summary(dt):
    return {
        'id': dt.id,
        'name': dt.name,
        'code': dt.code,
        'is_doc_type': True,
    }


def _folder_to_dict(uf, doc_type_summaries=None, user_permission=None):
    return {
        'id': uf.id,
        'name': uf.name,
        'description': uf.description or '',
        'parent_id': uf.parent_id,
        'owner_id': uf.owner_id,
        'folder_manager_id': uf.folder_manager_id,
        'folder_manager_name': uf.folder_manager.name if uf.folder_manager else None,
        'is_template': uf.owner_id is None,
        'is_structure_folder': True,
        'doc_types': doc_type_summaries if doc_type_summaries is not None else [],
        'children': [],
        'user_permission': user_permission,  # 'VIEW', 'UPLOAD', or None
    }


def _user_folders_visible_to(user):
    """Folders the user can see: admin sees all; others see own + permitted + all templates (for browsing)."""
    if _is_admin(user):
        return UserFolder.objects.filter(is_active=True)
    permitted_ids = FolderPermission.objects.filter(user=user).values_list('folder_id', flat=True)
    # Templates (owner=NULL) are always visible so users can browse and request access
    return UserFolder.objects.filter(
        Q(owner=user) | Q(id__in=permitted_ids) | Q(owner__isnull=True),
        is_active=True,
    )


def _build_tree_for(user):
    folders = list(_user_folders_visible_to(user).select_related('folder_manager').order_by('name'))
    folder_ids = [f.id for f in folders]

    # Pre-fetch pinned doc types
    links = (
        UserFolderDocType.objects
        .filter(folder_id__in=folder_ids)
        .select_related('doc_type')
    )
    doc_types_by_folder = {}
    for link in links:
        if link.doc_type and not link.doc_type.is_active:
            continue
        doc_types_by_folder.setdefault(link.folder_id, []).append(_doc_type_summary(link.doc_type))

    # Pre-fetch user permissions
    if _is_admin(user):
        perms_map = {f.id: 'UPLOAD' for f in folders}
    else:
        perms_map = {}
        for f in folders:
            if f.owner_id == user.id:
                perms_map[f.id] = 'UPLOAD'
        for fp in FolderPermission.objects.filter(user=user, folder_id__in=folder_ids):
            perms_map[fp.folder_id] = fp.permission
        # Templates with no explicit permission → user can see them but not access contents

    folder_map = {
        f.id: _folder_to_dict(f, doc_types_by_folder.get(f.id, []), perms_map.get(f.id))
        for f in folders
    }
    roots = []
    for f in folders:
        d = folder_map[f.id]
        if f.parent_id and f.parent_id in folder_map:
            folder_map[f.parent_id]['children'].append(d)
        else:
            roots.append(d)
    return sorted(roots, key=lambda x: x['name'])


# ── Folder Tree ────────────────────────────────────────────────────────────────

@api_view(['GET'])
@require_read
def folder_tree(request):
    return Response(_build_tree_for(request.user))


# ── Folders CRUD ───────────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def folders(request):
    if request.method == 'GET':
        ok, resp = _flag_check(request.user, 'can_read', 'Read')
        if not ok: return resp
        qs = _user_folders_visible_to(request.user)
        parent_id = request.query_params.get('parent_id')
        if parent_id == 'root':
            qs = qs.filter(parent_id__isnull=True)
        elif parent_id:
            qs = qs.filter(parent_id=int(parent_id))
        return Response([_folder_to_dict(f) for f in qs.order_by('name')])

    ok, resp = _flag_check(request.user, 'can_create', 'Create')
    if not ok: return resp
    data = request.data
    name = (data.get('name') or '').strip()
    if not name:
        return Response({'error': 'Folder name is required'}, status=400)

    parent = None
    parent_id = data.get('parent_id')
    if parent_id:
        try:
            parent = UserFolder.objects.get(id=int(parent_id))
        except UserFolder.DoesNotExist:
            return Response({'error': 'Parent folder not found'}, status=404)
        if parent.owner_id and parent.owner_id != request.user.id:
            return Response({'error': 'You cannot nest under another user\'s folder'}, status=403)

    is_template_request = bool(data.get('is_template'))
    if is_template_request and not _is_admin(request.user):
        return Response({'error': 'Only System Admins can create shared folders'}, status=403)

    manager_id = data.get('folder_manager_id')
    manager = None
    if manager_id:
        try:
            manager = User.objects.get(id=int(manager_id))
        except User.DoesNotExist:
            return Response({'error': 'Folder manager user not found'}, status=404)

    folder = UserFolder.objects.create(
        name=name,
        description=data.get('description') or '',
        owner=None if is_template_request else request.user,
        folder_manager=manager,
        parent=parent,
        is_active=True,
    )
    return Response(_folder_to_dict(folder), status=201)


@api_view(['GET', 'PUT', 'DELETE'])
@parser_classes([JSONParser])
def folder_detail(request, folder_id):
    if request.method == 'GET':
        ok, resp = _flag_check(request.user, 'can_read', 'Read')
        if not ok: return resp
    elif request.method == 'PUT':
        ok, resp = _flag_check(request.user, 'can_edit', 'Edit')
        if not ok: return resp
    elif request.method == 'DELETE':
        ok, resp = _flag_check(request.user, 'can_delete', 'Delete')
        if not ok: return resp

    try:
        folder = UserFolder.objects.select_related('folder_manager').get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    if request.method == 'GET':
        if not _has_access(request.user, folder, 'VIEW'):
            return Response({'error': 'You do not have access to this folder'}, status=403)
        return Response(_folder_to_dict(folder, user_permission=_user_permission_on(request.user, folder)))

    if not _can_edit(request.user, folder):
        return Response({'error': 'You can only edit folders you own'}, status=403)

    if request.method == 'PUT':
        data = request.data
        if 'name' in data:
            folder.name = data['name'].strip()
        if 'description' in data:
            folder.description = data['description'] or ''
        if 'folder_manager_id' in data:
            mid = data['folder_manager_id']
            if mid:
                try:
                    folder.folder_manager = User.objects.get(id=int(mid))
                except User.DoesNotExist:
                    return Response({'error': 'Folder manager not found'}, status=404)
            else:
                folder.folder_manager = None
        if 'is_template' in data:
            if not _is_admin(request.user):
                return Response({'error': 'Only System Admins can publish templates'}, status=403)
            folder.owner = None if data['is_template'] else request.user
        if 'parent_id' in data:
            pid = data['parent_id']
            if pid:
                try:
                    parent = UserFolder.objects.get(id=int(pid))
                except UserFolder.DoesNotExist:
                    return Response({'error': 'Parent not found'}, status=404)
                if parent.owner_id and parent.owner_id != request.user.id and not _is_admin(request.user):
                    return Response({'error': 'Cannot nest under another user\'s folder'}, status=403)
                ancestor = parent
                while ancestor:
                    if ancestor.id == folder.id:
                        return Response({'error': 'Cannot move folder under its own descendant'}, status=400)
                    ancestor = ancestor.parent
                folder.parent = parent
            else:
                folder.parent = None
        folder.save()

        if 'doc_type_ids' in data:
            ids = [int(i) for i in (data.get('doc_type_ids') or []) if i]
            UserFolderDocType.objects.filter(folder=folder).exclude(doc_type_id__in=ids).delete()
            existing = set(UserFolderDocType.objects.filter(folder=folder).values_list('doc_type_id', flat=True))
            for did in ids:
                if did not in existing:
                    UserFolderDocType.objects.create(folder=folder, doc_type_id=did)

        return Response(_folder_to_dict(folder, user_permission=_user_permission_on(request.user, folder)))

    # DELETE
    if folder.children.filter(is_active=True).exists():
        return Response({'error': 'Cannot delete folder that contains sub-folders'}, status=400)
    folder.is_active = False
    folder.save(update_fields=['is_active'])
    return Response({'message': 'Folder deleted'})


@api_view(['GET'])
@require_read
def folder_documents(request, folder_id):
    try:
        folder = UserFolder.objects.select_related('folder_manager').get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)
    if not _has_access(request.user, folder, 'VIEW'):
        return Response({'error': 'You do not have access to this folder'}, status=403)

    pinned = list(UserFolderDocType.objects.filter(folder=folder).select_related('doc_type'))
    doc_types = [_doc_type_summary(p.doc_type) for p in pinned if p.doc_type and p.doc_type.is_active]

    return Response({
        'folder': _folder_to_dict(folder, doc_types, _user_permission_on(request.user, folder)),
        'documents': [],
        'total': 0,
    })


@api_view(['GET'])
@require_read
def doc_type_documents(request, doc_type_id):
    try:
        dt = DocumentType.objects.get(id=doc_type_id, is_active=True)
    except DocumentType.DoesNotExist:
        return Response({'error': 'Document type not found'}, status=404)

    docs = (
        Document.objects.filter(doc_type_id=dt.id, is_deleted=False)
        .select_related('creator', 'doc_type').order_by('-created_at')
    )
    result = []
    for d in docs:
        files = list(d.files.values('id', 'filename', 'file_path', 'uploaded_at'))
        result.append({
            'id': d.id,
            'doc_number': d.doc_number,
            'title': d.title,
            'status': d.status,
            'project': d.project or '',
            'doc_type': dt.name,
            'creator': {'id': d.creator.id, 'name': d.creator.name} if d.creator else None,
            'created_at': d.created_at.isoformat() + 'Z' if d.created_at else None,
            'updated_at': d.updated_at.isoformat() + 'Z' if d.updated_at else None,
            'file_count': len(files),
            'files': files,
            'metadata': d.custom_metadata or {},
        })

    return Response({
        'doc_type': {'id': dt.id, 'name': dt.name, 'code': dt.code, 'is_doc_type': True},
        'documents': result,
        'total': len(result),
    })


# ── Folder Permissions (admin/manager direct grant) ────────────────────────────

@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def folder_permissions(request, folder_id):
    try:
        folder = UserFolder.objects.get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    is_manager = (folder.folder_manager_id == request.user.id)
    if not _is_admin(request.user) and not is_manager:
        return Response({'error': 'Only admin or folder manager can manage permissions'}, status=403)

    if request.method == 'GET':
        perms = FolderPermission.objects.filter(folder=folder).select_related('user', 'granted_by')
        return Response([{
            'id': p.id,
            'user_id': p.user_id,
            'user_name': p.user.name,
            'user_email': p.user.email,
            'permission': p.permission,
            'granted_by': p.granted_by.name if p.granted_by else None,
            'granted_at': p.granted_at.isoformat() + 'Z',
        } for p in perms])

    # POST — grant permission
    data = request.data
    user_id = data.get('user_id')
    permission = data.get('permission', 'VIEW')
    if permission not in ('VIEW', 'UPLOAD'):
        return Response({'error': 'permission must be VIEW or UPLOAD'}, status=400)
    try:
        target_user = User.objects.get(id=int(user_id))
    except (User.DoesNotExist, TypeError, ValueError):
        return Response({'error': 'User not found'}, status=404)

    perm, created = FolderPermission.objects.update_or_create(
        folder=folder, user=target_user,
        defaults={'permission': permission, 'granted_by': request.user},
    )
    return Response({
        'id': perm.id,
        'user_id': perm.user_id,
        'user_name': target_user.name,
        'permission': perm.permission,
        'granted_at': perm.granted_at.isoformat() + 'Z',
    }, status=201 if created else 200)


@api_view(['DELETE'])
def folder_permission_detail(request, folder_id, user_id):
    try:
        folder = UserFolder.objects.get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    is_manager = (folder.folder_manager_id == request.user.id)
    if not _is_admin(request.user) and not is_manager:
        return Response({'error': 'Only admin or folder manager can revoke permissions'}, status=403)

    deleted, _ = FolderPermission.objects.filter(folder=folder, user_id=user_id).delete()
    if not deleted:
        return Response({'error': 'Permission not found'}, status=404)
    return Response({'message': 'Permission revoked'})


# ── Access Requests ────────────────────────────────────────────────────────────

@api_view(['POST'])
@parser_classes([JSONParser])
def request_folder_access(request, folder_id):
    """User submits an access request for a folder."""
    try:
        folder = UserFolder.objects.select_related('folder_manager').get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    if _has_access(request.user, folder, 'VIEW'):
        return Response({'error': 'You already have access to this folder'}, status=400)

    data = request.data
    permission = data.get('permission', 'VIEW')
    if permission not in ('VIEW', 'UPLOAD'):
        return Response({'error': 'permission must be VIEW or UPLOAD'}, status=400)

    # Check for existing pending request
    existing = FolderAccessRequest.objects.filter(
        folder=folder, requester=request.user, status='pending'
    ).first()
    if existing:
        return Response({'error': 'You already have a pending request for this folder'}, status=400)

    req = FolderAccessRequest.objects.create(
        folder=folder,
        requester=request.user,
        permission=permission,
        reason=data.get('reason', '').strip(),
    )
    return Response({
        'id': req.id,
        'folder_id': folder.id,
        'folder_name': folder.name,
        'permission': req.permission,
        'status': req.status,
        'created_at': req.created_at.isoformat() + 'Z',
        'manager': folder.folder_manager.name if folder.folder_manager else None,
    }, status=201)


@api_view(['GET'])
@require_read
def my_access_requests(request):
    """User sees their own access requests."""
    reqs = FolderAccessRequest.objects.filter(requester=request.user).select_related('folder', 'reviewed_by')
    return Response([{
        'id': r.id,
        'folder_id': r.folder_id,
        'folder_name': r.folder.name,
        'permission': r.permission,
        'reason': r.reason,
        'status': r.status,
        'review_note': r.review_note,
        'reviewed_by': r.reviewed_by.name if r.reviewed_by else None,
        'reviewed_at': r.reviewed_at.isoformat() + 'Z' if r.reviewed_at else None,
        'created_at': r.created_at.isoformat() + 'Z',
    } for r in reqs])


@api_view(['GET'])
@require_read
def access_requests_inbox(request):
    """Folder manager / admin sees all pending requests for folders they manage."""
    if _is_admin(request.user):
        reqs = FolderAccessRequest.objects.filter(status='pending').select_related('folder', 'requester', 'folder__folder_manager')
    else:
        managed_folder_ids = UserFolder.objects.filter(folder_manager=request.user, is_active=True).values_list('id', flat=True)
        reqs = FolderAccessRequest.objects.filter(
            folder_id__in=managed_folder_ids, status='pending'
        ).select_related('folder', 'requester', 'folder__folder_manager')

    return Response([{
        'id': r.id,
        'folder_id': r.folder_id,
        'folder_name': r.folder.name,
        'requester_id': r.requester_id,
        'requester_name': r.requester.name,
        'requester_email': r.requester.email,
        'permission': r.permission,
        'reason': r.reason,
        'status': r.status,
        'created_at': r.created_at.isoformat() + 'Z',
    } for r in reqs])


@api_view(['POST'])
@parser_classes([JSONParser])
def decide_access_request(request, request_id):
    """Folder manager or admin approves or rejects an access request."""
    try:
        req = FolderAccessRequest.objects.select_related('folder', 'requester').get(id=request_id)
    except FolderAccessRequest.DoesNotExist:
        return Response({'error': 'Request not found'}, status=404)

    folder = req.folder
    is_manager = (folder.folder_manager_id == request.user.id)
    if not _is_admin(request.user) and not is_manager:
        return Response({'error': 'Only admin or folder manager can decide this request'}, status=403)

    if req.status != 'pending':
        return Response({'error': 'This request has already been decided'}, status=400)

    action = request.data.get('action')
    if action not in ('approve', 'reject'):
        return Response({'error': 'action must be approve or reject'}, status=400)

    req.status = 'approved' if action == 'approve' else 'rejected'
    req.reviewed_by = request.user
    req.reviewed_at = timezone.now()
    req.review_note = request.data.get('note', '').strip()
    req.save()

    if action == 'approve':
        FolderPermission.objects.update_or_create(
            folder=folder, user=req.requester,
            defaults={'permission': req.permission, 'granted_by': request.user},
        )

    return Response({
        'id': req.id,
        'status': req.status,
        'folder_name': folder.name,
        'requester_name': req.requester.name,
        'permission': req.permission,
    })


@api_view(['GET'])
@require_read
def my_upload_doc_types(request):
    """Return doc type IDs the current user can upload via folder UPLOAD permissions.
    Admins get all doc types (unrestricted=True).
    Regular users get only doc types pinned in folders where they have UPLOAD access.
    Doc types not pinned in any folder are always allowed (unrestricted).
    """
    from api.models import DocumentType
    if _is_admin(request.user):
        ids = list(DocumentType.objects.filter(is_active=True, is_structure_folder=False).values_list('id', flat=True))
        return Response({'doc_type_ids': ids, 'unrestricted': True})

    # Folders where user has UPLOAD (explicit grant + own folders)
    upload_folder_ids = set(
        FolderPermission.objects.filter(user=request.user, permission='UPLOAD')
        .values_list('folder_id', flat=True)
    )
    owned_ids = set(
        UserFolder.objects.filter(owner=request.user, is_active=True)
        .values_list('id', flat=True)
    )
    all_upload_ids = upload_folder_ids | owned_ids

    # Doc types pinned in those folders
    permitted_ids = set(
        UserFolderDocType.objects.filter(folder_id__in=all_upload_ids)
        .values_list('doc_type_id', flat=True)
    )

    # Doc types pinned anywhere (used to decide what's "folder-restricted")
    all_pinned_ids = set(
        UserFolderDocType.objects.all().values_list('doc_type_id', flat=True)
    )

    # Unfiled doc types (not pinned in any folder) are freely uploadable
    all_active_ids = set(
        DocumentType.objects.filter(is_active=True, is_structure_folder=False)
        .values_list('id', flat=True)
    )
    unfiled_ids = all_active_ids - all_pinned_ids

    final_ids = list(permitted_ids | unfiled_ids)
    return Response({'doc_type_ids': final_ids, 'unrestricted': False})


@api_view(['GET'])
@require_read
def all_access_requests(request):
    """Admin-only: view all access requests with any status."""
    if not _is_admin(request.user):
        return Response({'error': 'Admin only'}, status=403)
    reqs = FolderAccessRequest.objects.select_related('folder', 'requester', 'reviewed_by').order_by('-created_at')
    return Response([{
        'id': r.id,
        'folder_id': r.folder_id,
        'folder_name': r.folder.name,
        'requester_id': r.requester_id,
        'requester_name': r.requester.name,
        'requester_email': r.requester.email,
        'permission': r.permission,
        'reason': r.reason,
        'status': r.status,
        'review_note': r.review_note,
        'reviewed_by': r.reviewed_by.name if r.reviewed_by else None,
        'reviewed_at': r.reviewed_at.isoformat() + 'Z' if r.reviewed_at else None,
        'created_at': r.created_at.isoformat() + 'Z',
    } for r in reqs])
