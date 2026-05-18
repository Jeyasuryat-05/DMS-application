import hashlib, traceback, logging, csv, io
from datetime import datetime, timedelta
from django.http import StreamingHttpResponse
from django.db import transaction
from django.db.models import Q
from rest_framework.decorators import api_view, parser_classes, authentication_classes, permission_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from api.models import (
    User, DocumentType, DocTypeFileFormat, WorkflowConfig, AlertConfig,
    NumberReservation, SystemConfig, Document, AuditLog, WorkflowLevel, CoverPageTemplate,
)
from api.authentication import hash_password, cfg, set_cfg

logger = logging.getLogger(__name__)

_IST = timedelta(hours=5, minutes=30)

_DELETION_ACTIONS = ['Deleted by Scheduled Job', 'Document Deleted', 'Flagged for Deletion', 'Deletion Flag Removed']
_CREATION_ACTIONS = ['Document Created']


def _require_admin(request):
    if request.user.role != 'System Admin':
        return False
    return True


def _iso(dt):
    return dt.isoformat() + 'Z' if dt else None


def _user_to_dict(user):
    return {
        'id': user.id,
        'sap_username': user.sap_username,
        'employee_id': user.employee_id,
        'name': user.name,
        'email': user.email,
        'department': user.department,
        'role': user.role,
        'dms_enabled': user.dms_enabled,
        'can_create': user.can_create,
        'can_edit': user.can_edit,
        'can_delete': user.can_delete,
        'can_read': user.can_read,
        'auth_codes': user.auth_codes,
        'is_active': user.is_active,
        'is_sso_user': user.is_sso_user,
        'last_login': _iso(user.last_login),
        'created_at': _iso(user.created_at),
        'profile_picture': user.profile_picture,
    }


def _dt_to_dict(dt):
    fmts = list(dt.doctypefileformat_set.values('id', 'extension', 'label', 'icon', 'mime_type'))
    return {
        'id': dt.id,
        'code': dt.code,
        'name': dt.name,
        'description': dt.description,
        'auth_required': dt.auth_required,
        'auth_code': dt.auth_code,
        'metadata_schema': dt.metadata_schema,
        'number_pattern': dt.number_pattern,
        'is_active': dt.is_active,
        'is_structure_folder': dt.is_structure_folder,
        'parent_id': dt.parent_id,
        'extra_parent_ids': list(dt.extra_parents.values_list('id', flat=True)),
        'created_at': _iso(dt.created_at),
        'allowed_formats': fmts,
    }


@api_view(['GET', 'PUT'])
@parser_classes([JSONParser])
def system_config(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)

    if request.method == 'GET':
        keys = ['auth_code_enabled', 'sap_sso_enabled', 'sap_sso_entity_id',
                'sap_sso_sso_url', 'sap_sso_slo_url', 'sap_sso_cert',
                'sap_sso_sp_entity_id', 'app_name', 'app_org', 'frontend_url',
                'prepare_locked_fields']
        result = {k: cfg(k, '') for k in keys}
        result['auth_code_enabled'] = result['auth_code_enabled'] == 'true'
        result['sap_sso_enabled'] = result['sap_sso_enabled'] == 'true'
        return Response(result)

    d = request.data
    if 'auth_code_enabled' in d:
        set_cfg('auth_code_enabled', 'true' if d['auth_code_enabled'] else 'false')
    if 'auth_code' in d and d['auth_code']:
        set_cfg('auth_code_hash', hashlib.sha256(d['auth_code'].strip().encode()).hexdigest())
    for key in ['sap_sso_enabled', 'sap_sso_entity_id', 'sap_sso_sso_url', 'sap_sso_slo_url',
                'sap_sso_cert', 'sap_sso_sp_entity_id', 'app_name', 'app_org', 'frontend_url',
                'prepare_locked_fields']:
        if key in d:
            val = ('true' if d[key] is True else 'false' if d[key] is False else str(d[key]))
            set_cfg(key, val)
    return Response({'message': 'Configuration saved'})


@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def users(request):
    if request.method == 'GET':
        if not _require_admin(request):
            return Response({'error': 'System Admin role required'}, status=403)
        q = request.query_params.get('q')
        department = request.query_params.get('department')
        role = request.query_params.get('role')
        is_active = request.query_params.get('is_active')
        skip = int(request.query_params.get('skip', 0))
        limit = int(request.query_params.get('limit', 500))
        qs = User.objects.all()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) | Q(email__icontains=q) |
                Q(sap_username__icontains=q) | Q(employee_id__icontains=q) |
                Q(department__icontains=q) | Q(role__icontains=q)
            )
        if department:
            qs = qs.filter(department=department)
        if role:
            qs = qs.filter(role=role)
        if is_active is not None:
            qs = qs.filter(is_active=(is_active.lower() == 'true'))
        return Response([_user_to_dict(u) for u in qs[skip:skip + limit]])

    # POST
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    data = request.data
    if User.objects.filter(email=data.get('email', '')).exists():
        return Response({'error': 'Email already registered'}, status=400)
    user = User(
        sap_username=data.get('sap_username') or data.get('employee_id'),
        employee_id=data.get('employee_id'),
        name=data.get('name', ''),
        email=data.get('email', ''),
        department=data.get('department'),
        role=data.get('role'),
        dms_enabled=data.get('dms_enabled', True),
        can_create=data.get('can_create', True),
        can_edit=data.get('can_edit', True),
        can_delete=data.get('can_delete', False),
        can_read=data.get('can_read', True),
        auth_codes=data.get('auth_codes', ''),
        hashed_password=hash_password(data['password']) if data.get('password') else None,
    )
    user.save()
    return Response(_user_to_dict(user), status=201)


@api_view(['PUT', 'DELETE'])
@parser_classes([JSONParser])
def user_detail(request, user_id):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    if request.method == 'PUT':
        data = request.data
        # Whitelist of fields an admin is permitted to edit on a user. Any
        # other key in the payload (`hashed_password`, `is_superuser`,
        # internal Django flags, `id`, etc.) is silently ignored to prevent
        # privilege escalation via mass-assignment.
        ALLOWED_FIELDS = {
            'name', 'email', 'department', 'role', 'sap_username',
            'employee_id', 'auth_codes',
            'dms_enabled', 'can_create', 'can_edit', 'can_delete', 'can_read',
            'is_active', 'profile_picture',
        }
        for k, v in data.items():
            if k == 'password' and v:
                user.hashed_password = hash_password(v)
                continue
            if k in ALLOWED_FIELDS and hasattr(user, k):
                setattr(user, k, v)
        user.save()
        return Response(_user_to_dict(user))
    else:
        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response(status=204)


@api_view(['POST'])
def activate_user(request, user_id):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)
    user.is_active = True
    user.save(update_fields=['is_active'])
    return Response({'message': 'Activated'})


@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def document_types(request):
    if request.method == 'GET':
        # Admin → Document Types lists real doc types only.
        # Structure folders (org / department containers) live under the Library,
        # not under the doc-types catalogue.
        include_structure = request.query_params.get('include_structure') == 'true'
        dts = DocumentType.objects.all()
        if not include_structure:
            dts = dts.filter(is_structure_folder=False)
        return Response([_dt_to_dict(dt) for dt in dts])

    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    data = request.data
    with transaction.atomic():
        dt = DocumentType.objects.create(
            code=data.get('code', ''),
            name=data.get('name', ''),
            description=data.get('description'),
            auth_required=data.get('auth_required', False),
            auth_code=data.get('auth_code', ''),
            metadata_schema=data.get('metadata_schema', {}),
            number_pattern=data.get('number_pattern', '{CODE}-{YEAR}-{SEQ}'),
            parent_id=data.get('parent_id') or None,
        )
        for f in (data.get('allowed_formats') or []):
            DocTypeFileFormat.objects.create(
                doc_type_id=dt.id,
                extension=(f.get('extension', '') if isinstance(f, dict) else '').lower(),
                label=f.get('label', '') if isinstance(f, dict) else '',
                icon=f.get('icon', '') if isinstance(f, dict) else '',
                mime_type=f.get('mime_type', '') if isinstance(f, dict) else '',
            )
        AlertConfig.objects.create(doc_type_id=dt.id, lead_days='30,15,7', enabled=True)
        WorkflowConfig.objects.create(doc_type_id=dt.id)
    return Response(_dt_to_dict(dt), status=201)


@api_view(['PUT'])
@parser_classes([JSONParser])
def document_type_detail(request, dt_id):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    try:
        dt = DocumentType.objects.get(id=dt_id)
    except DocumentType.DoesNotExist:
        return Response({'error': 'Not found'}, status=404)

    data = request.data
    with transaction.atomic():
        for k, v in data.items():
            if k == 'allowed_formats':
                DocTypeFileFormat.objects.filter(doc_type_id=dt_id).delete()
                for f in (v or []):
                    DocTypeFileFormat.objects.create(
                        doc_type_id=dt_id,
                        extension=(f.get('extension', '') if isinstance(f, dict) else '').lower(),
                        label=f.get('label', '') if isinstance(f, dict) else '',
                        icon=f.get('icon', '') if isinstance(f, dict) else '',
                        mime_type=f.get('mime_type', '') if isinstance(f, dict) else '',
                    )
            elif hasattr(dt, k):
                setattr(dt, k, v)
        dt.save()
    return Response(_dt_to_dict(dt))


@api_view(['GET'])
def workflow_configs(request):
    configs = WorkflowConfig.objects.select_related('doc_type').all()
    return Response([
        {
            'id': c.id, 'doc_type_id': c.doc_type_id,
            'doc_type_name': c.doc_type.name if c.doc_type else '',
            'levels': c.levels,
        }
        for c in configs
    ])


@api_view(['PUT'])
@parser_classes([JSONParser])
def workflow_config_detail(request, doc_type_id):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    cfg_obj, _ = WorkflowConfig.objects.get_or_create(doc_type_id=doc_type_id)
    cfg_obj.levels = request.data.get('levels', cfg_obj.levels)
    cfg_obj.save(update_fields=['levels'])
    return Response({'message': 'Workflow config updated'})


@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def roles(request):
    from api.models import Role
    if request.method == 'GET':
        return Response(list(Role.objects.values('id', 'name', 'permissions', 'description')))
    role = Role.objects.create(
        name=request.data.get('name', ''),
        permissions=request.data.get('permissions', {}),
        description=request.data.get('description'),
    )
    return Response({'id': role.id, 'name': role.name, 'permissions': role.permissions, 'description': role.description}, status=201)


@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def number_reservations(request):
    if request.method == 'GET':
        return Response(list(NumberReservation.objects.values(
            'id', 'doc_type_id', 'usi_kks', 'range_start', 'range_end', 'label', 'reserved_by_id', 'reserved_at'
        )))
    data = request.data
    nr = NumberReservation.objects.create(
        doc_type_id=data.get('doc_type_id'),
        usi_kks=data.get('usi_kks'),
        range_start=data.get('range_start'),
        range_end=data.get('range_end'),
        label=data.get('label', 'RESERVED'),
        reserved_by_id=request.user.id,
    )
    return Response({'message': f'Reserved {nr.range_start}-{nr.range_end} as \'{nr.label}\''}, status=201)


# ─── Master document types ────────────────────────────────────────────────────

MASTER_DOC_TYPES = [
    {'name': 'Addendum',                                     'code': 'ADDM', 'auth_required': False, 'auth_code': ''},
    {'name': 'AERB',                                         'code': 'AERB', 'auth_required': False, 'auth_code': ''},
    {'name': 'As Built Drawing',                             'code': 'ABD',  'auth_required': False, 'auth_code': ''},
    {'name': 'CDC',                                          'code': 'CDC',  'auth_required': False, 'auth_code': ''},
    {'name': 'DCN',                                          'code': 'DCN',  'auth_required': False, 'auth_code': ''},
    {'name': 'DCQ',                                          'code': 'DCQ',  'auth_required': False, 'auth_code': ''},
    {'name': 'Design Concession Request-DCR',                'code': 'DCR',  'auth_required': False, 'auth_code': ''},
    {'name': 'Digital I&C System',                           'code': 'DICS', 'auth_required': False, 'auth_code': ''},
    {'name': 'Directorate Procedures',                       'code': 'DPROC','auth_required': False, 'auth_code': ''},
    {'name': 'Document',                                     'code': 'DOC',  'auth_required': False, 'auth_code': ''},
    {'name': 'Drawing',                                      'code': 'DRW',  'auth_required': True,  'auth_code': 'A1111'},
    {'name': 'ECN',                                          'code': 'ECN',  'auth_required': True,  'auth_code': 'A1234'},
    {'name': 'ESSG',                                         'code': 'ESSG', 'auth_required': False, 'auth_code': ''},
    {'name': 'FCN',                                          'code': 'FCN',  'auth_required': True,  'auth_code': ''},
    {'name': 'Feedback',                                     'code': 'FBK',  'auth_required': False, 'auth_code': ''},
    {'name': 'Field Change Proposal or Field Change Request', 'code': 'FCR', 'auth_required': False, 'auth_code': ''},
    {'name': 'General',                                      'code': 'GEN',  'auth_required': False, 'auth_code': ''},
    {'name': 'HSE',                                          'code': 'HSE',  'auth_required': False, 'auth_code': ''},
    {'name': 'Indent-EB',                                    'code': 'INDEB','auth_required': False, 'auth_code': ''},
    {'name': 'Inspection Quality Plan',                      'code': 'IQP',  'auth_required': False, 'auth_code': ''},
    {'name': 'Inspection Testing of Equipment',              'code': 'ITE',  'auth_required': False, 'auth_code': ''},
    {'name': 'Knowledge Management',                         'code': 'KM',   'auth_required': False, 'auth_code': ''},
    {'name': 'Letter of Transmittal',                        'code': 'LOT',  'auth_required': False, 'auth_code': ''},
    {'name': 'Letter of Transmittal FI',                     'code': 'LOTFI','auth_required': False, 'auth_code': ''},
    {'name': 'Letter of Transmittal KAIGA5&6',               'code': 'LOTK', 'auth_required': False, 'auth_code': ''},
    {'name': 'Letter of Transmittal MBRAPP1TO4',             'code': 'LOTM', 'auth_required': False, 'auth_code': ''},
    {'name': 'Non-Conformance Report',                       'code': 'NCR',  'auth_required': False, 'auth_code': ''},
    {'name': 'PHWR Project Document',                        'code': 'PHWR', 'auth_required': False, 'auth_code': ''},
    {'name': 'Print Request for Drawing',                    'code': 'PRD',  'auth_required': False, 'auth_code': ''},
    {'name': 'Procurement',                                  'code': 'PROC', 'auth_required': False, 'auth_code': ''},
    {'name': 'Purchase Orders',                              'code': 'PO',   'auth_required': False, 'auth_code': ''},
    {'name': 'QA Document',                                  'code': 'QAD',  'auth_required': False, 'auth_code': ''},
    {'name': 'QS Requisition',                               'code': 'QSR',  'auth_required': False, 'auth_code': ''},
    {'name': 'R&DES',                                        'code': 'RDES', 'auth_required': False, 'auth_code': ''},
    {'name': 'Requisition',                                  'code': 'REQ',  'auth_required': False, 'auth_code': ''},
    {'name': 'RSA',                                          'code': 'RSA',  'auth_required': False, 'auth_code': ''},
    {'name': 'Safety Related Deficiency',                    'code': 'SRD',  'auth_required': False, 'auth_code': ''},
    {'name': 'Site Documents',                               'code': 'SITE', 'auth_required': False, 'auth_code': ''},
    {'name': 'SQA',                                          'code': 'SQA',  'auth_required': False, 'auth_code': ''},
    {'name': 'Technical',                                    'code': 'TECH', 'auth_required': False, 'auth_code': ''},
    {'name': 'Technical Authorization',                      'code': 'TA',   'auth_required': False, 'auth_code': ''},
    {'name': 'Technical Specification',                      'code': 'TSPEC','auth_required': False, 'auth_code': ''},
    {'name': 'TEMPLATEHOLDER',                               'code': 'TMPL', 'auth_required': False, 'auth_code': ''},
    {'name': 'Vendor Evaluation',                            'code': 'VE',   'auth_required': False, 'auth_code': ''},
    {'name': 'Work Authorization',                           'code': 'WA',   'auth_required': False, 'auth_code': ''},
]

FMT_MAP = {
    'DRW': [
        {'extension': 'dwg',  'label': 'AutoCAD Drawing', 'icon': '', 'mime_type': 'image/vnd.dwg'},
        {'extension': 'dxf',  'label': 'DXF Drawing',     'icon': '', 'mime_type': 'image/vnd.dxf'},
        {'extension': 'pdf',  'label': 'PDF Document',    'icon': '', 'mime_type': 'application/pdf'},
        {'extension': 'tiff', 'label': 'TIFF Image',      'icon': '', 'mime_type': 'image/tiff'},
        {'extension': 'dgn',  'label': 'MicroStation',    'icon': '', 'mime_type': 'application/octet-stream'},
    ],
    'ABD': [
        {'extension': 'dwg', 'label': 'AutoCAD Drawing', 'icon': '', 'mime_type': 'image/vnd.dwg'},
        {'extension': 'pdf', 'label': 'PDF Document',    'icon': '', 'mime_type': 'application/pdf'},
    ],
    '_default': [
        {'extension': 'pdf',  'label': 'PDF Document',      'icon': '', 'mime_type': 'application/pdf'},
        {'extension': 'docx', 'label': 'Word Document',     'icon': '', 'mime_type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
        {'extension': 'xlsx', 'label': 'Excel Spreadsheet', 'icon': '', 'mime_type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
        {'extension': 'jpeg', 'label': 'JPEG Image',        'icon': '', 'mime_type': 'image/jpeg'},
        {'extension': 'zip',  'label': 'ZIP Archive',       'icon': '', 'mime_type': 'application/zip'},
    ],
}

_METADATA_SCHEMAS = {}
try:
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.dirname(__file__))))
    from metadata_schemas_data import METADATA_SCHEMAS as _METADATA_SCHEMAS
    print(f'Metadata schemas loaded: {len(_METADATA_SCHEMAS)} doc types')
except Exception as _e:
    print(f'WARNING: Could not load metadata schemas: {_e}')


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([JSONParser])
def seed_data(request):
    force = str(request.query_params.get('force', 'false')).lower() == 'true'
    user_count = User.objects.count()
    if user_count > 0:
        from api.authentication import JWTAuthentication
        try:
            auth_result = JWTAuthentication().authenticate(request)
        except Exception:
            auth_result = None
        if not auth_result or getattr(auth_result[0], 'role', '') != 'System Admin':
            return Response({'error': 'System Admin role required'}, status=403)

    try:
        existing = DocumentType.objects.count()
        if existing > 0 and not force:
            return Response({
                'message': f'Already seeded ({existing} document types found). ',
                'tip': 'Call POST /api/admin/seed?force=true to re-seed.',
                'users': User.objects.count(),
            })
        with transaction.atomic():
            if force:
                DocTypeFileFormat.objects.all().delete()
                AlertConfig.objects.all().delete()
                WorkflowConfig.objects.all().delete()
                DocumentType.objects.all().delete()

            for dt_data in MASTER_DOC_TYPES:
                dt = DocumentType.objects.create(
                    code=dt_data['code'],
                    name=dt_data['name'],
                    auth_required=dt_data['auth_required'],
                    auth_code=dt_data['auth_code'],
                    number_pattern=f"{dt_data['code']}-{{YEAR}}-{{SEQ}}",
                    metadata_schema=_METADATA_SCHEMAS.get(dt_data['code'], []),
                )
                fmts = FMT_MAP.get(dt_data['code'], FMT_MAP['_default'])
                for f in fmts:
                    DocTypeFileFormat.objects.create(
                        doc_type_id=dt.id,
                        extension=f['extension'], label=f['label'],
                        icon='', mime_type=f['mime_type'],
                    )
                AlertConfig.objects.create(
                    doc_type_id=dt.id, enabled=True, lead_days='30,15,7',
                    notify_author=True, notify_roles='',
                )
                WorkflowConfig.objects.create(doc_type_id=dt.id)

            if not User.objects.filter(email='admin@npcil.gov.in').exists():
                User.objects.create(
                    sap_username='ADMIN', employee_id='EMP001', name='Admin User',
                    email='admin@npcil.gov.in', department='IT', role='System Admin',
                    dms_enabled=True, can_create=True, can_edit=True, can_delete=True, can_read=True,
                    auth_codes='A1111; A1234', hashed_password=hash_password('Admin@1234'), is_active=True,
                )
            if not User.objects.filter(email='jeyasurya@npcil.gov.in').exists():
                User.objects.create(
                    sap_username='JEYASURYAT', employee_id='EMP002', name='Jeyasurya T',
                    email='jeyasurya@npcil.gov.in', department='Engineering', role='Document Creator',
                    dms_enabled=True, can_create=True, can_edit=True, can_delete=True, can_read=True,
                    auth_codes='A1111; A1234', hashed_password=hash_password('User@1234'), is_active=True,
                )

            defaults = [
                ('app_name', 'DMS Portal'), ('app_org', 'NPCIL'),
                ('auth_code_enabled', 'false'), ('sap_sso_enabled', 'false'),
                ('frontend_url', 'http://localhost:3000'),
                ('prepare_locked_fields', 'description,usi_kks_code,drawing_type'),
            ]
            for key, val in defaults:
                SystemConfig.objects.get_or_create(key=key, defaults={'value': val})

        return Response({'message': f'Seeded {len(MASTER_DOC_TYPES)} document types successfully. Login: EMP001 / Admin@1234 or admin@npcil.gov.in / Admin@1234'})
    except Exception as e:
        error_detail = traceback.format_exc()
        logger.error(f'Seed failed:\n{error_detail}')
        return Response({'error': f'Seed failed: {str(e)}\n\n{error_detail}'}, status=500)


@api_view(['POST'])
def fix_checklist_required(request):
    updated = WorkflowLevel.objects.update(checklist_required=False)
    return Response({'message': f'Reset checklist_required=False on {updated} workflow levels'})


@api_view(['GET', 'POST'])
def seed_metadata_schemas(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    updated, not_found = 0, []
    for code, fields in _METADATA_SCHEMAS.items():
        try:
            dt = DocumentType.objects.get(code=code)
            dt.metadata_schema = fields
            dt.save(update_fields=['metadata_schema'])
            updated += 1
        except DocumentType.DoesNotExist:
            not_found.append(code)
    return Response({
        'message': f'Metadata schemas applied to {updated} document types',
        'updated': updated, 'not_found': not_found,
    })


def _run_deletion_job():
    flagged = Document.objects.filter(flagged_for_deletion=True, is_deleted=False)
    deleted_ids = []
    for doc in flagged:
        doc.is_deleted = True
        doc.flagged_for_deletion = False
        doc.save(update_fields=['is_deleted', 'flagged_for_deletion'])
        AuditLog.objects.create(
            document_id=doc.id, user_id=doc.flagged_by_id,
            action='Deleted by Scheduled Job',
            note=f'Flagged at {doc.flagged_at}',
        )
        deleted_ids.append(doc.id)
    return {'deleted': len(deleted_ids), 'document_ids': deleted_ids}


@api_view(['POST'])
def run_deletion_job(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    result = _run_deletion_job()
    return Response({'message': f'Deletion job completed. {result["deleted"]} document(s) deleted.', **result})


@api_view(['POST'])
def run_auto_archive_job(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    from api.management.commands.auto_archive_expired import auto_archive_run
    count, doc_numbers = auto_archive_run()
    return Response({
        'message': (
            f'Auto-archive job completed. {count} expired Released document(s) archived.'
            if count else 'Auto-archive job completed. No expired Released documents found.'
        ),
        'archived_count': count,
        'archived_documents': doc_numbers,
    })


@api_view(['GET'])
def flagged_documents(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    docs = Document.objects.filter(flagged_for_deletion=True, is_deleted=False)
    return Response([
        {
            'id': d.id, 'doc_number': d.doc_number, 'title': d.title,
            'status': d.status, 'flagged_at': _iso(d.flagged_at), 'flagged_by_id': d.flagged_by_id,
        }
        for d in docs
    ])


def _ist_offset():
    return timedelta(hours=5, minutes=30)


def _audit_rows(actions, date_from, date_to, doc_type_id, extra_like=None):
    q = AuditLog.objects.select_related('document__doc_type', 'user')
    filter_q = Q(action__in=actions)
    if extra_like:
        filter_q = filter_q | Q(action__istartswith='New Version v')
    q = q.filter(filter_q)
    if date_from:
        try:
            start_utc = datetime.strptime(date_from, '%Y-%m-%d') - _ist_offset()
            q = q.filter(timestamp__gte=start_utc)
        except ValueError:
            pass
    if date_to:
        try:
            end_utc = datetime.strptime(date_to, '%Y-%m-%d') - _ist_offset() + timedelta(days=1)
            q = q.filter(timestamp__lt=end_utc)
        except ValueError:
            pass
    if doc_type_id:
        q = q.filter(document__doc_type_id=int(doc_type_id))
    return q.order_by('-timestamp')


def _log_to_dict(l):
    doc = l.document
    user = l.user
    ist = (l.timestamp + _ist_offset()) if l.timestamp else None
    return {
        'id': l.id, 'action': l.action, 'note': l.note,
        'timestamp_ist': ist.strftime('%Y-%m-%d %H:%M:%S') if ist else None,
        'user_name': user.name if user else 'System',
        'user_email': user.email if user else '',
        'doc_id': doc.id if doc else None,
        'doc_number': doc.doc_number if doc else '',
        'doc_title': doc.title if doc else '',
        'doc_type': doc.doc_type.name if doc and doc.doc_type else '',
        'status': doc.status if doc else '',
        'project': doc.project if doc else '',
        'version': doc.current_version if doc else '',
    }


def _make_csv_response(rows, filename):
    def _stream():
        buf = io.StringIO()
        w = csv.writer(buf)
        if not rows:
            w.writerow(['No records found'])
        else:
            w.writerow(list(rows[0].keys()))
            for row in rows:
                w.writerow([str(row.get(h, '')) for h in rows[0].keys()])
        yield buf.getvalue()
    response = StreamingHttpResponse(_stream(), content_type='text/csv')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@api_view(['GET'])
def deletion_logs(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_DELETION_ACTIONS, date_from, date_to, doc_type_id)
    return Response([_log_to_dict(r) for r in rows_qs])


@api_view(['GET'])
def deletion_logs_download(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_DELETION_ACTIONS, date_from, date_to, doc_type_id)
    dicts = [_log_to_dict(r) for r in rows_qs]
    label = f'{date_from or "start"}_to_{date_to or "end"}'
    return _make_csv_response(dicts, f'deletion_log_{label}.csv')


@api_view(['GET'])
def creation_logs(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_CREATION_ACTIONS, date_from, date_to, doc_type_id, extra_like='New Version v%')
    return Response([_log_to_dict(r) for r in rows_qs])


@api_view(['GET'])
def creation_logs_download(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_CREATION_ACTIONS, date_from, date_to, doc_type_id, extra_like='New Version v%')
    dicts = [_log_to_dict(r) for r in rows_qs]
    label = f'{date_from or "start"}_to_{date_to or "end"}'
    return _make_csv_response(dicts, f'creation_log_{label}.csv')


@api_view(['GET'])
def logs_summary(request):
    if not _require_admin(request):
        return Response({'error': 'System Admin role required'}, status=403)
    cutoff = datetime.utcnow() - timedelta(days=30)
    rows = AuditLog.objects.filter(timestamp__gte=cutoff).filter(
        Q(action__in=_DELETION_ACTIONS + _CREATION_ACTIONS) | Q(action__istartswith='New Version v')
    ).values_list('action', 'timestamp')

    daily = {}
    for action, ts in rows:
        if not ts:
            continue
        ist_date = (ts + _ist_offset()).strftime('%Y-%m-%d')
        bucket = daily.setdefault(ist_date, {'date': ist_date, 'deletions': 0, 'creations': 0})
        if action in _DELETION_ACTIONS:
            bucket['deletions'] += 1
        else:
            bucket['creations'] += 1
    return Response(sorted(daily.values(), key=lambda x: x['date'], reverse=True))


@api_view(['GET', 'PUT'])
def cover_page_template(request):
    """Get or save the cover page template configuration."""
    if request.method == 'GET':
        try:
            template = CoverPageTemplate.objects.first()
            if not template:
                return Response({'fields': []})
            return Response({'fields': template.fields})
        except Exception as e:
            logger.error(f"Error getting cover page template: {str(e)}")
            return Response({'fields': []})

    elif request.method == 'PUT':
        if request.user.role not in ['System Admin', 'Sub-Admin']:
            return Response({'detail': 'Permission denied'}, status=403)

        try:
            fields = request.data.get('fields', [])
            template, _ = CoverPageTemplate.objects.get_or_create(id=1)
            template.fields = fields
            template.updated_by = request.user
            template.save()
            return Response({'detail': 'Cover page template saved', 'fields': template.fields})
        except Exception as e:
            logger.error(f"Error saving cover page template: {str(e)}")
            return Response({'detail': str(e)}, status=400)

