from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from django.db.models import Q

from api.models import DocumentType, Document, UserFolder, UserFolderDocType
from api.authentication import _flag_check, require_read


def _is_admin(user):
    return getattr(user, 'role', '') == 'System Admin'


def _can_edit(user, folder):
    """A user can edit/delete a folder they own. Admins can edit templates (owner=NULL)."""
    if folder.owner_id == getattr(user, 'id', None):
        return True
    if folder.owner_id is None and _is_admin(user):
        return True
    return False


def _doc_type_summary(dt):
    return {
        'id': dt.id,
        'name': dt.name,
        'code': dt.code,
        'is_doc_type': True,
    }


def _folder_to_dict(uf, doc_type_summaries=None):
    return {
        'id': uf.id,
        'name': uf.name,
        'description': uf.description or '',
        'parent_id': uf.parent_id,
        'owner_id': uf.owner_id,
        'is_template': uf.owner_id is None,
        'is_structure_folder': True,  # All UserFolders are structure containers
        'doc_types': doc_type_summaries if doc_type_summaries is not None else [],
        'children': [],
    }


def _user_folders_visible_to(user):
    """Folders visible to a user: their own + admin templates."""
    return UserFolder.objects.filter(
        Q(owner=user) | Q(owner__isnull=True),
        is_active=True,
    )


def _build_tree_for(user):
    folders = list(_user_folders_visible_to(user).order_by('name'))
    folder_ids = [f.id for f in folders]

    # Pre-fetch pinned doc types per folder
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

    folder_map = {
        f.id: _folder_to_dict(f, doc_types_by_folder.get(f.id, []))
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


@api_view(['GET'])
@require_read
def folder_tree(request):
    return Response(_build_tree_for(request.user))


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

    # POST — create folder
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
        # Owner must be able to see the parent (theirs or template)
        if parent.owner_id and parent.owner_id != request.user.id:
            return Response({'error': 'You cannot nest under another user\'s folder'}, status=403)

    # Templates can only be created by admins
    is_template_request = bool(data.get('is_template'))
    if is_template_request and not _is_admin(request.user):
        return Response({'error': 'Only System Admins can create shared templates'}, status=403)

    folder = UserFolder.objects.create(
        name=name,
        description=data.get('description') or '',
        owner=None if is_template_request else request.user,
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
        folder = UserFolder.objects.get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    if request.method == 'GET':
        # Visibility check
        if folder.owner_id and folder.owner_id != request.user.id:
            return Response({'error': 'Not visible'}, status=403)
        return Response(_folder_to_dict(folder))

    # PUT/DELETE require edit rights
    if not _can_edit(request.user, folder):
        return Response({'error': 'You can only edit folders you own'}, status=403)

    if request.method == 'PUT':
        data = request.data
        if 'name' in data:
            folder.name = data['name'].strip()
        if 'description' in data:
            folder.description = data['description'] or ''
        if 'is_template' in data:
            # Only System Admins can publish/unpublish templates.
            if not _is_admin(request.user):
                return Response({'error': 'Only System Admins can publish templates'}, status=403)
            if data['is_template']:
                folder.owner = None  # template = no owner
            else:
                # Unpublishing: assign to admin so it doesn't disappear into limbo.
                folder.owner = request.user
        if 'parent_id' in data:
            pid = data['parent_id']
            if pid:
                try:
                    parent = UserFolder.objects.get(id=int(pid))
                except UserFolder.DoesNotExist:
                    return Response({'error': 'Parent not found'}, status=404)
                # Same-owner or template parent
                if parent.owner_id and parent.owner_id != request.user.id and not _is_admin(request.user):
                    return Response({'error': 'Cannot nest under another user\'s folder'}, status=403)
                # Prevent cycles
                ancestor = parent
                while ancestor:
                    if ancestor.id == folder.id:
                        return Response({'error': 'Cannot move folder under its own descendant'}, status=400)
                    ancestor = ancestor.parent
                folder.parent = parent
            else:
                folder.parent = None
        folder.save()

        # Pinned doc types
        if 'doc_type_ids' in data:
            ids = [int(i) for i in (data.get('doc_type_ids') or []) if i]
            UserFolderDocType.objects.filter(folder=folder).exclude(doc_type_id__in=ids).delete()
            existing = set(UserFolderDocType.objects.filter(folder=folder).values_list('doc_type_id', flat=True))
            for did in ids:
                if did not in existing:
                    UserFolderDocType.objects.create(folder=folder, doc_type_id=did)

        return Response(_folder_to_dict(folder))

    # DELETE
    if folder.children.filter(is_active=True).exists():
        return Response({'error': 'Cannot delete folder that contains sub-folders'}, status=400)
    folder.is_active = False
    folder.save(update_fields=['is_active'])
    return Response({'message': 'Folder deleted'})


@api_view(['GET'])
@require_read
def folder_documents(request, folder_id):
    """Folders are containers — they don't hold documents directly. Pinned doc types do."""
    try:
        folder = UserFolder.objects.get(id=folder_id, is_active=True)
    except UserFolder.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)
    if folder.owner_id and folder.owner_id != request.user.id:
        return Response({'error': 'Not visible'}, status=403)

    # Build doc type summary list for the folder
    pinned = list(
        UserFolderDocType.objects.filter(folder=folder)
        .select_related('doc_type')
    )
    doc_types = [_doc_type_summary(p.doc_type) for p in pinned if p.doc_type and p.doc_type.is_active]

    return Response({
        'folder': _folder_to_dict(folder, doc_types),
        'documents': [],
        'total': 0,
    })


@api_view(['GET'])
@require_read
def doc_type_documents(request, doc_type_id):
    """List documents for a single doc-type leaf (used when a doc-type card is opened)."""
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
