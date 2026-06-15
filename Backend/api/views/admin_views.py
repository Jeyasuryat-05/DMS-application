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
    ApproverConfig,
)
from api.authentication import hash_password, cfg, set_cfg

logger = logging.getLogger(__name__)

_IST = timedelta(hours=5, minutes=30)

_DELETION_ACTIONS = ['Deleted by Scheduled Job', 'Document Deleted', 'Flagged for Deletion', 'Deletion Flag Removed']
_CREATION_ACTIONS = ['Document Created']


def _require_admin(request):
    """Return a 403 Response if the user is not System Admin, else None."""
    if getattr(request.user, 'role', '') != 'System Admin':
        return Response({'error': 'System Admin role required'}, status=403)
    return None


def _iso(dt):
    return dt.isoformat() + 'Z' if dt else None


SAP_FIELDS = [
    'personnel_number', 'employee_title', 'employee_title_text', 'employee_full_name',
    'employment_status', 'employment_status_text',
    'personnel_area_code', 'personnel_area_text',
    'personnel_sub_area_code', 'personnel_sub_area_text',
    'employee_group_code', 'employee_group_text',
    'employee_sub_group_code', 'employee_sub_group_text',
    'department_code', 'department_text',
    'pay_level', 'cadre_code', 'cadre_description',
    'executive_category', 'executive_category_text',
    'gazetted_category', 'gazetted_category_text',
    'employee_type_code', 'employee_type_text',
    'union_membership_code', 'union_membership_text',
    'position_id', 'position_text',
    'functional_designation_1', 'functional_designation_text_1',
    'functional_designation_2', 'functional_designation_text_2',
    'functional_designation_3', 'functional_designation_text_3',
    'functional_designation_4', 'functional_designation_text_4',
    'cost_center_code', 'work_schedule_rule', 'work_schedule_rule_text',
    'date_of_joining', 'date_of_retirement', 'years_of_service', 'date_of_birth',
    'gender_code', 'gender_description', 'employee_name_in_hindi',
    'system_user_id', 'pan_number', 'mobile_number', 'email_address', 'extension',
] + [f'reporting_officer_id_{i}' for i in range(1, 21)] \
  + [f'reporting_user_id_{i}'    for i in range(1, 21)] \
  + ['cmd_id', 'om_attribute_code', 'om_attribute_desc',
     'last_changed_date', 'last_changed_by', 'sap_updated_at']


def _serialize_sap(user):
    out = {}
    for f in SAP_FIELDS:
        v = getattr(user, f, None)
        if hasattr(v, 'isoformat'):
            v = v.isoformat()
        elif v is not None and f == 'sap_updated_at':
            v = str(v)
        out[f] = v
    return out


def _user_to_dict(user):
    base = {
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
    base.update(_serialize_sap(user))
    return base


def _dt_to_dict(dt, include_auth_code=False):
    fmts = list(dt.doctypefileformat_set.values('id', 'extension', 'label', 'icon', 'mime_type'))
    return {
        'id': dt.id,
        'code': dt.code,
        'name': dt.name,
        'description': dt.description,
        'auth_required': dt.auth_required,
        # auth_code is only returned to System Admins — it would otherwise let
        # any DMS user bypass the restricted document-type gate.
        'auth_code': dt.auth_code if include_auth_code else None,
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
    err = _require_admin(request)
    if err: return err

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
        err = _require_admin(request)
        if err:
            return err
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
                Q(department__icontains=q) | Q(role__icontains=q) |
                Q(personnel_number__icontains=q) | Q(employee_full_name__icontains=q) |
                Q(position_text__icontains=q) | Q(department_text__icontains=q)
            )
        if department:
            qs = qs.filter(department=department)
        if role:
            qs = qs.filter(role=role)
        if is_active is not None:
            qs = qs.filter(is_active=(is_active.lower() == 'true'))

        ordering = request.query_params.get('ordering')
        if ordering:
            field = ordering.lstrip('-')
            sortable = {
                'employee_id', 'sap_username', 'name', 'email', 'department', 'role',
                'is_active', 'created_at', 'last_login',
            } | set(SAP_FIELDS)
            if field in sortable:
                qs = qs.order_by(ordering)

        return Response([_user_to_dict(u) for u in qs[skip:skip + limit]])

    # POST
    err = _require_admin(request)
    if err: return err
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
    for f in SAP_FIELDS:
        if f in data:
            setattr(user, f, data[f] or None)
    user.save()
    return Response(_user_to_dict(user), status=201)


@api_view(['PUT', 'DELETE'])
@parser_classes([JSONParser])
def user_detail(request, user_id):
    err = _require_admin(request)
    if err: return err
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
        } | set(SAP_FIELDS)
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
    err = _require_admin(request)
    if err: return err
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
        dts = DocumentType.objects.all().order_by('code')
        if not include_structure:
            dts = dts.filter(is_structure_folder=False)
        resp = Response([_dt_to_dict(dt) for dt in dts])
        resp['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        resp['Pragma'] = 'no-cache'
        return resp

    err = _require_admin(request)
    if err: return err
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
    return Response(_dt_to_dict(dt, include_auth_code=True), status=201)


@api_view(['PUT'])
@parser_classes([JSONParser])
def document_type_detail(request, dt_id):
    err = _require_admin(request)
    if err: return err
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
    return Response(_dt_to_dict(dt, include_auth_code=True))


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
    err = _require_admin(request)
    if err: return err
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
    {'name': 'Addendum',                                      'code': 'ZAD', 'auth_required': False, 'auth_code': ''},
    {'name': 'AERB',                                          'code': 'AER', 'auth_required': False, 'auth_code': ''},
    {'name': 'As Built Drawing',                              'code': 'ZBD', 'auth_required': False, 'auth_code': ''},
    {'name': 'CDC',                                           'code': 'CDC', 'auth_required': False, 'auth_code': ''},
    {'name': 'DCN',                                           'code': 'DCN', 'auth_required': False, 'auth_code': ''},
    {'name': 'DCQ',                                           'code': 'DCQ', 'auth_required': False, 'auth_code': ''},
    {'name': 'Design Concession Request-DCR',                 'code': 'DCR', 'auth_required': False, 'auth_code': ''},
    {'name': 'Digital I&C System',                            'code': 'ZIC', 'auth_required': False, 'auth_code': ''},
    {'name': 'Directorate Procedures',                        'code': 'ZDP', 'auth_required': False, 'auth_code': ''},
    {'name': 'Document',                                      'code': 'ZDO', 'auth_required': False, 'auth_code': ''},
    {'name': 'Drawing',                                       'code': 'DRW', 'auth_required': True,  'auth_code': 'A1111'},
    {'name': 'ECN',                                           'code': 'ECN', 'auth_required': True,  'auth_code': 'A1234'},
    {'name': 'ESSG',                                          'code': 'ZES', 'auth_required': False, 'auth_code': ''},
    {'name': 'FCN',                                           'code': 'FCN', 'auth_required': True,  'auth_code': ''},
    {'name': 'Feedback',                                      'code': 'ZFB', 'auth_required': False, 'auth_code': ''},
    {'name': 'Field Change Proposal or Field Change Request',  'code': 'FCR', 'auth_required': False, 'auth_code': ''},
    {'name': 'General',                                       'code': 'GEN', 'auth_required': False, 'auth_code': ''},
    {'name': 'HSE',                                           'code': 'HSE', 'auth_required': False, 'auth_code': ''},
    {'name': 'Indent-EB',                                     'code': 'IEB', 'auth_required': False, 'auth_code': ''},
    {'name': 'Inspection Quality Plan',                       'code': 'IQP', 'auth_required': False, 'auth_code': ''},
    {'name': 'Inspection Testing of Equipment',               'code': 'ITE', 'auth_required': False, 'auth_code': ''},
    {'name': 'Knowledge Management',                          'code': 'ZKM', 'auth_required': False, 'auth_code': ''},
    {'name': 'Letter of Transmittal',                         'code': 'LOT', 'auth_required': False, 'auth_code': ''},
    {'name': 'Non-Conformance Report',                        'code': 'NCR', 'auth_required': False, 'auth_code': ''},
    {'name': 'PHWR Project Document',                         'code': 'PPD', 'auth_required': False, 'auth_code': ''},
    {'name': 'Print Request for Drawing',                     'code': 'PRD', 'auth_required': False, 'auth_code': ''},
    {'name': 'Procurement',                                   'code': 'PRO', 'auth_required': False, 'auth_code': ''},
    {'name': 'Purchase Orders',                               'code': 'ZPO', 'auth_required': False, 'auth_code': ''},
    {'name': 'QA Document',                                   'code': 'QAD', 'auth_required': False, 'auth_code': ''},
    {'name': 'QS Requisition',                                'code': 'QSR', 'auth_required': False, 'auth_code': ''},
    {'name': 'R&DES',                                         'code': 'R&D', 'auth_required': False, 'auth_code': ''},
    {'name': 'Requisition',                                   'code': 'REQ', 'auth_required': False, 'auth_code': ''},
    {'name': 'RSA',                                           'code': 'RSA', 'auth_required': False, 'auth_code': ''},
    {'name': 'Safety Related Deficiency',                     'code': 'SRD', 'auth_required': False, 'auth_code': ''},
    {'name': 'Site Documents',                                'code': 'ZSD', 'auth_required': False, 'auth_code': ''},
    {'name': 'SQA',                                           'code': 'SQA', 'auth_required': False, 'auth_code': ''},
    {'name': 'Technical',                                     'code': 'ZTE', 'auth_required': False, 'auth_code': ''},
    {'name': 'Technical Authorization',                       'code': 'ZTA', 'auth_required': False, 'auth_code': ''},
    {'name': 'Technical Specification',                       'code': 'ZTS', 'auth_required': False, 'auth_code': ''},
    {'name': 'TEMPLATEHOLDER',                                'code': 'TEM', 'auth_required': False, 'auth_code': ''},
    {'name': 'Vendor Evaluation',                             'code': 'ZVE', 'auth_required': False, 'auth_code': ''},
    {'name': 'Work Authorization',                            'code': 'ZWA', 'auth_required': False, 'auth_code': ''},
]

FMT_MAP = {
    'DRW': [
        {'extension': 'dwg',  'label': 'AutoCAD Drawing', 'icon': '', 'mime_type': 'image/vnd.dwg'},
        {'extension': 'dxf',  'label': 'DXF Drawing',     'icon': '', 'mime_type': 'image/vnd.dxf'},
        {'extension': 'pdf',  'label': 'PDF Document',    'icon': '', 'mime_type': 'application/pdf'},
        {'extension': 'tiff', 'label': 'TIFF Image',      'icon': '', 'mime_type': 'image/tiff'},
        {'extension': 'dgn',  'label': 'MicroStation',    'icon': '', 'mime_type': 'application/octet-stream'},
    ],
    'ZBD': [
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

def _wf(*names):
    stages = ['Prepare', 'Check', 'Review', 'Approve', 'Concur',
              'Design Check', 'Drawing Check', 'Drawing Review',
              'Design Review', 'IndReview', 'Drawn', 'Designed',
              'Prepared', 'Concurred with Design', 'Concurred with DC&CW Group',
              'Approve by ED', 'Review by ED']
    steps = []
    for i, n in enumerate(names, 1):
        stage = n if n in stages else 'Prepare' if i == 1 else 'Check' if i == 2 else 'Review' if i == len(names) - 1 else 'Approve'
        steps.append({'step': i, 'name': n, 'stage': n, 'checklist_required': False})
    return steps

WORKFLOW_MAP = {
    # As Built Drawing — 5 step
    'ZBD': _wf('Prepared', 'Design Check', 'Concur with Design', 'Review', 'Approve'),
    # Drawing — 6 step inhouse default
    'DRW': _wf('Drawn', 'Drawing Check', 'Designed', 'Design Check', 'Review', 'Approve'),
    # DCN — 6 step
    'DCN': _wf('Prepared', 'Design Check', 'Concurred with DC&CW Group', 'Concurred with Design', 'Review', 'Approve'),
    # ECN — 6 step
    'ECN': _wf('Drawn', 'Design', 'Checked', 'Reviewed', 'IndReview', 'Approve'),
    # FCN — 7 step
    'FCN': _wf('Prepared', 'Drawing Check', 'Drawing Review', 'Design Check', 'Design Review', 'Concurred with Design', 'Approve'),
    # CDC — 3 step
    'CDC': _wf('Prepare', 'Check', 'Approve'),
    # Technical Authorization — 3 step
    'ZTA': _wf('Prepare', 'Review', 'Approve by ED'),
    # Site Documents — 3 step default
    'ZSD': _wf('Prepare', 'Check', 'Approve'),
    # QSR — 2 step (one step bulk)
    'QSR': _wf('Prepare', 'Approve'),
    # ZTE Technical — 4 step
    'ZTE': _wf('Prepare', 'Check', 'Review', 'Approve'),
    # ZTS Technical Specification — 4 step
    'ZTS': _wf('Prepare', 'Check', 'Review', 'Approve'),
    # HSE — 3 step
    'HSE': _wf('Prepare', 'Check', 'Approve'),
    # Common/General/default — 4 step
}
_DEFAULT_WF = _wf('Prepare', 'Check', 'Review', 'Approve')

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
                WorkflowConfig.objects.create(
                    doc_type_id=dt.id,
                    levels=WORKFLOW_MAP.get(dt_data['code'], _DEFAULT_WF),
                )

            import secrets as _secrets
            admin_created = False
            admin_temp_pw = None
            if not User.objects.filter(email='admin@npcil.gov.in').exists():
                # Generate a random password on first seed — printed to server
                # stdout once. Never returned in the API response.
                admin_temp_pw = _secrets.token_urlsafe(16)
                User.objects.create(
                    sap_username='ADMIN', employee_id='EMP001', name='Admin User',
                    email='admin@npcil.gov.in', department='IT', role='System Admin',
                    dms_enabled=True, can_create=True, can_edit=True, can_delete=True, can_read=True,
                    auth_codes='A1111; A1234', hashed_password=hash_password(admin_temp_pw), is_active=True,
                )
                admin_created = True
                # Print once to server stdout/logs — never expose in HTTP response
                print(f'[DMS SEED] Admin account created. ONE-TIME password: {admin_temp_pw}  — change immediately after first login.')
            if not User.objects.filter(email='jeyasurya@npcil.gov.in').exists():
                user_temp_pw = _secrets.token_urlsafe(16)
                User.objects.create(
                    sap_username='JEYASURYAT', employee_id='EMP002', name='Jeyasurya T',
                    email='jeyasurya@npcil.gov.in', department='Engineering', role='Document Creator',
                    dms_enabled=True, can_create=True, can_edit=True, can_delete=True, can_read=True,
                    auth_codes='A1111; A1234', hashed_password=hash_password(user_temp_pw), is_active=True,
                )
                print(f'[DMS SEED] User EMP002 created. ONE-TIME password: {user_temp_pw}  — change immediately after first login.')

            defaults = [
                ('app_name', 'DMS Portal'), ('app_org', 'NPCIL'),
                ('auth_code_enabled', 'false'), ('sap_sso_enabled', 'false'),
                ('frontend_url', 'http://localhost:3000'),
                ('prepare_locked_fields', 'description,usi_kks_code,drawing_type'),
            ]
            for key, val in defaults:
                SystemConfig.objects.get_or_create(key=key, defaults={'value': val})

        msg = f'Seeded {len(MASTER_DOC_TYPES)} document types successfully.'
        if admin_created:
            msg += ' Admin account created — check server logs for the one-time password.'
        return Response({'message': msg})
    except Exception as e:
        error_detail = traceback.format_exc()
        logger.error(f'Seed failed:\n{error_detail}')
        return Response({'error': f'Seed failed: {str(e)}\n\n{error_detail}'}, status=500)


@api_view(['POST'])
def fix_checklist_required(request):
    err = _require_admin(request)
    if err: return err
    updated = WorkflowLevel.objects.update(checklist_required=False)
    return Response({'message': f'Reset checklist_required=False on {updated} workflow levels'})


@api_view(['GET', 'POST'])
def seed_metadata_schemas(request):
    err = _require_admin(request)
    if err: return err
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
    err = _require_admin(request)
    if err: return err
    result = _run_deletion_job()
    return Response({'message': f'Deletion job completed. {result["deleted"]} document(s) deleted.', **result})


@api_view(['POST'])
def run_auto_archive_job(request):
    err = _require_admin(request)
    if err: return err
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
    err = _require_admin(request)
    if err: return err
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
    err = _require_admin(request)
    if err: return err
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_DELETION_ACTIONS, date_from, date_to, doc_type_id)
    return Response([_log_to_dict(r) for r in rows_qs])


@api_view(['GET'])
def deletion_logs_download(request):
    err = _require_admin(request)
    if err: return err
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_DELETION_ACTIONS, date_from, date_to, doc_type_id)
    dicts = [_log_to_dict(r) for r in rows_qs]
    label = f'{date_from or "start"}_to_{date_to or "end"}'
    return _make_csv_response(dicts, f'deletion_log_{label}.csv')


@api_view(['GET'])
def creation_logs(request):
    err = _require_admin(request)
    if err: return err
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_CREATION_ACTIONS, date_from, date_to, doc_type_id, extra_like='New Version v%')
    return Response([_log_to_dict(r) for r in rows_qs])


@api_view(['GET'])
def creation_logs_download(request):
    err = _require_admin(request)
    if err: return err
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    doc_type_id = request.query_params.get('doc_type_id')
    rows_qs = _audit_rows(_CREATION_ACTIONS, date_from, date_to, doc_type_id, extra_like='New Version v%')
    dicts = [_log_to_dict(r) for r in rows_qs]
    label = f'{date_from or "start"}_to_{date_to or "end"}'
    return _make_csv_response(dicts, f'creation_log_{label}.csv')


@api_view(['GET'])
def logs_summary(request):
    err = _require_admin(request)
    if err: return err
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


# ─── Workflow Approver Config (Mock API) ──────────────────────────────────────

def _approver_to_dict(a):
    return {
        'id':                       a.id,
        'employee_number':          a.employee_number,
        'process_id':               a.process_id,
        'approver_employee_number': a.approver_employee_number,
        'approver_employee_name':   a.approver_employee_name,
        'approver_email':           a.approver_email,
        'approver_level':           a.approver_level,
        'final_approver_flag':      a.final_approver_flag,
    }


@api_view(['GET', 'POST'])
def approver_configs(request):
    """List all approver config rows (admin) or create a new one."""
    err = _require_admin(request)
    if err:
        return err
    if request.method == 'GET':
        qs = ApproverConfig.objects.all()
        return Response([_approver_to_dict(a) for a in qs])
    data = request.data
    required = ['employee_number', 'process_id', 'approver_employee_number',
                'approver_employee_name', 'approver_level']
    for f in required:
        if not data.get(f):
            return Response({'detail': f'{f} is required'}, status=400)
    flag = str(data.get('final_approver_flag', 'N')).upper()
    if flag not in ('Y', 'N'):
        flag = 'N'
    a = ApproverConfig.objects.create(
        employee_number          = str(data['employee_number']).strip(),
        process_id               = str(data['process_id']).strip(),
        approver_employee_number = str(data['approver_employee_number']).strip(),
        approver_employee_name   = str(data['approver_employee_name']).strip(),
        approver_email           = str(data.get('approver_email', '')).strip(),
        approver_level           = int(data['approver_level']),
        final_approver_flag      = flag,
    )
    return Response(_approver_to_dict(a), status=201)


@api_view(['PUT', 'DELETE'])
def approver_config_detail(request, config_id):
    """Update or delete a single approver config row."""
    err = _require_admin(request)
    if err:
        return err
    try:
        a = ApproverConfig.objects.get(id=config_id)
    except ApproverConfig.DoesNotExist:
        return Response({'detail': 'Not found'}, status=404)
    if request.method == 'DELETE':
        a.delete()
        return Response(status=204)
    data = request.data
    for field in ['employee_number', 'process_id', 'approver_employee_number',
                  'approver_employee_name', 'approver_email', 'approver_level']:
        if field in data:
            setattr(a, field, data[field])
    if 'final_approver_flag' in data:
        flag = str(data['final_approver_flag']).upper()
        a.final_approver_flag = flag if flag in ('Y', 'N') else 'N'
    a.save()
    return Response(_approver_to_dict(a))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([])
def approver_lookup(request):
    """
    Workflow Approver Lookup API — mirrors the Excel spec.
    Input  (query params): employee_number, process_id
    Output: list of approver rows ordered by level.
    Also resolves approver_email from the User table if blank in config.
    """
    from rest_framework.permissions import AllowAny
    emp_num    = (request.GET.get('employee_number') or '').strip()
    process_id = (request.GET.get('process_id') or '').strip()
    if not emp_num or not process_id:
        return Response({'detail': 'employee_number and process_id are required'}, status=400)

    # Resolve the requesting employee's name from User table if available
    try:
        emp_user = User.objects.get(personnel_number=emp_num)
        emp_name = emp_user.name
    except User.DoesNotExist:
        emp_name = emp_num

    rows = ApproverConfig.objects.filter(
        employee_number=emp_num, process_id=process_id
    ).order_by('approver_level')

    if not rows.exists():
        return Response([], status=200)

    result = []
    for a in rows:
        # Try to enrich approver email from User table
        email = a.approver_email
        if not email:
            try:
                u = User.objects.get(personnel_number=a.approver_employee_number)
                email = u.email or ''
            except User.DoesNotExist:
                pass
        result.append({
            'employee_number':          emp_num,
            'employee_name':            emp_name,
            'approver_employee_number': a.approver_employee_number,
            'approver_employee_name':   a.approver_employee_name,
            'approver_email':           email,
            'approver_level':           a.approver_level,
            'final_approver_flag':      a.final_approver_flag,
        })
    return Response(result)
