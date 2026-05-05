from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from django.db.models import Count, Q

from api.models import DocumentType, Document


def _folder_to_dict(dt, include_children=False):
    d = {
        'id': dt.id,
        'name': dt.name,
        'code': dt.code,
        'description': dt.description or '',
        'parent_id': dt.parent_id,
        'is_active': dt.is_active,
        'metadata_schema': dt.metadata_schema or [],
        'number_pattern': dt.number_pattern,
    }
    if include_children:
        d['children'] = [_folder_to_dict(c) for c in dt.children.filter(is_active=True).order_by('name')]
    return d


def _build_tree(folders):
    folder_map = {f.id: _folder_to_dict(f) for f in folders}
    for f in folder_map.values():
        f['children'] = []
    roots = []
    for f in folders:
        d = folder_map[f.id]
        if f.parent_id and f.parent_id in folder_map:
            folder_map[f.parent_id]['children'].append(d)
        else:
            roots.append(d)
    return sorted(roots, key=lambda x: x['name'])


@api_view(['GET'])
def folder_tree(request):
    folders = DocumentType.objects.filter(is_active=True).order_by('name')
    tree = _build_tree(list(folders))
    return Response(tree)


@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def folders(request):
    if request.method == 'GET':
        parent_id = request.query_params.get('parent_id')
        qs = DocumentType.objects.filter(is_active=True)
        if parent_id == 'root':
            qs = qs.filter(parent_id__isnull=True)
        elif parent_id:
            qs = qs.filter(parent_id=int(parent_id))
        return Response([_folder_to_dict(f) for f in qs.order_by('name')])

    # POST — create new folder
    data = request.data
    name = data.get('name', '').strip()
    if not name:
        return Response({'error': 'Folder name is required'}, status=400)

    code = data.get('code', '').strip().upper() or name[:8].upper().replace(' ', '_')
    if DocumentType.objects.filter(code=code).exists():
        import random, string
        code = code[:6] + ''.join(random.choices(string.digits, k=2))

    parent_id = data.get('parent_id')
    parent = None
    if parent_id:
        try:
            parent = DocumentType.objects.get(id=int(parent_id))
        except DocumentType.DoesNotExist:
            return Response({'error': 'Parent folder not found'}, status=404)

    folder = DocumentType(
        name=name,
        code=code,
        description=data.get('description', ''),
        parent=parent,
        metadata_schema=data.get('metadata_schema', []),
        number_pattern=data.get('number_pattern', '{CODE}-{YEAR}-{SEQ}'),
        is_active=True,
    )
    folder.save()
    return Response(_folder_to_dict(folder), status=201)


@api_view(['GET', 'PUT', 'DELETE'])
@parser_classes([JSONParser])
def folder_detail(request, folder_id):
    try:
        folder = DocumentType.objects.get(id=folder_id)
    except DocumentType.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    if request.method == 'GET':
        return Response(_folder_to_dict(folder, include_children=True))

    if request.method == 'PUT':
        data = request.data
        if 'name' in data:
            folder.name = data['name'].strip()
        if 'description' in data:
            folder.description = data['description']
        if 'parent_id' in data:
            pid = data['parent_id']
            if pid:
                try:
                    folder.parent = DocumentType.objects.get(id=int(pid))
                except DocumentType.DoesNotExist:
                    return Response({'error': 'Parent not found'}, status=404)
            else:
                folder.parent = None
        folder.save()
        return Response(_folder_to_dict(folder))

    # DELETE
    has_docs = Document.objects.filter(doc_type_id=folder_id, is_deleted=False).exists()
    has_children = DocumentType.objects.filter(parent_id=folder_id, is_active=True).exists()
    if has_docs or has_children:
        return Response({'error': 'Cannot delete folder that contains documents or sub-folders'}, status=400)
    folder.is_active = False
    folder.save(update_fields=['is_active'])
    return Response({'message': 'Folder deleted'})


@api_view(['GET'])
def folder_documents(request, folder_id):
    try:
        folder = DocumentType.objects.get(id=folder_id)
    except DocumentType.DoesNotExist:
        return Response({'error': 'Folder not found'}, status=404)

    docs = Document.objects.filter(
        doc_type_id=folder_id, is_deleted=False
    ).select_related('creator', 'doc_type').order_by('-created_at')

    result = []
    for d in docs:
        files = list(d.files.values('id', 'filename', 'file_path', 'uploaded_at'))
        result.append({
            'id': d.id,
            'doc_number': d.doc_number,
            'title': d.title,
            'status': d.status,
            'project': d.project or '',
            'creator': {'id': d.creator.id, 'name': d.creator.name} if d.creator else None,
            'created_at': d.created_at.isoformat() + 'Z' if d.created_at else None,
            'updated_at': d.updated_at.isoformat() + 'Z' if d.updated_at else None,
            'file_count': len(files),
            'files': files,
            'metadata': d.custom_metadata or {},
        })
    return Response({
        'folder': _folder_to_dict(folder),
        'documents': result,
        'total': len(result),
    })
