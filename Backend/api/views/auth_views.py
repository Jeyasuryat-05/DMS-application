import os, base64, hashlib, pathlib, io, time, json as _json
from datetime import datetime, timedelta
from rest_framework.decorators import api_view, permission_classes, authentication_classes, parser_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from django.http import HttpResponse, HttpResponseRedirect


class LoginRateThrottle(AnonRateThrottle):
    scope = 'login'

from api.models import User, SystemConfig
from api.authentication import (
    hash_password, verify_password, create_token, cfg, set_cfg,
    SECRET_KEY, ALGORITHM,
)

_BASE_DIR = pathlib.Path(__file__).resolve().parent.parent.parent
_PROFILE_UPLOAD_DIR = _BASE_DIR / 'uploads' / 'profiles'
_ALLOWED_IMAGE_EXTS = {'.jpg', '.jpeg', '.png'}
_AVATAR_PX = 256


def _make_gate_token():
    from jose import jwt
    payload = {'gate': True, 'exp': datetime.utcnow() + timedelta(hours=1)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_gate_token(gate_token):
    if cfg('auth_code_enabled', 'false') != 'true':
        return True
    if not gate_token:
        return False
    try:
        from jose import jwt, JWTError
        payload = jwt.decode(gate_token, SECRET_KEY, algorithms=[ALGORITHM])
        return bool(payload.get('gate'))
    except Exception:
        return False


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
        'last_login': user.last_login.isoformat() + 'Z' if user.last_login else None,
        'created_at': user.created_at.isoformat() + 'Z' if user.created_at else None,
        'profile_picture': user.profile_picture,
    }


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_config(request):
    auth_code_enabled = cfg('auth_code_enabled', 'false') == 'true'
    sso_enabled = cfg('sap_sso_enabled', 'false') == 'true'
    return Response({
        'auth_code_required': auth_code_enabled,
        'sso_enabled': sso_enabled,
        'sso_login_url': '/api/auth/sso/login' if sso_enabled else None,
        'app_name': cfg('app_name', 'DMS Portal'),
        'app_org': cfg('app_org', 'NPCIL'),
    })


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def verify_auth_code(request):
    if cfg('auth_code_enabled', 'false') != 'true':
        return Response({'gate_token': _make_gate_token()})
    code = request.data.get('code', '')
    stored_hash = cfg('auth_code_hash', '')
    provided_hash = hashlib.sha256(code.strip().encode()).hexdigest()
    if not stored_hash or provided_hash != stored_hash:
        return Response({'error': 'Invalid access code'}, status=403)
    return Response({'gate_token': _make_gate_token()})


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
@parser_classes([FormParser, MultiPartParser, JSONParser])
def login(request):
    gate_token = (
        request.META.get('HTTP_X_GATE_TOKEN')
        or request.data.get('gate_token')
        or request.query_params.get('gate_token')
    )
    if not _verify_gate_token(gate_token):
        return Response({'error': 'Access code required'}, status=403)
    username = request.data.get('username', '')
    password = request.data.get('password', '')
    try:
        user = User.objects.get(employee_id=username)
    except User.DoesNotExist:
        return Response({'error': 'Incorrect employee ID or password'}, status=400)
    if not user.hashed_password or not verify_password(password, user.hashed_password):
        return Response({'error': 'Incorrect employee ID or password'}, status=400)
    if not user.is_active:
        return Response({'error': 'Account deactivated'}, status=403)
    user.last_login = datetime.utcnow()
    user.save(update_fields=['last_login'])
    return Response({
        'access_token': create_token(user.id),
        'token_type': 'bearer',
        'user': _user_to_dict(user),
    })


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def register(request):
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
        hashed_password=hash_password(data['password']) if data.get('password') else None,
    )
    user.save()
    return Response(_user_to_dict(user), status=201)


@api_view(['GET'])
def me(request):
    return Response(_user_to_dict(request.user))


@api_view(['POST', 'DELETE'])
@parser_classes([MultiPartParser, FormParser])
def profile_picture(request):
    if request.method == 'POST':
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'No file provided'}, status=400)
        ext = pathlib.Path(file.name or '').suffix.lower()
        if ext not in _ALLOWED_IMAGE_EXTS:
            return Response({'error': 'Only JPG and PNG files are allowed'}, status=400)
        try:
            from PIL import Image, ImageOps
            img = Image.open(io.BytesIO(file.read())).convert('RGB')
            img = ImageOps.fit(img, (_AVATAR_PX, _AVATAR_PX), Image.LANCZOS)
        except Exception as exc:
            return Response({'error': f'Invalid image: {exc}'}, status=400)
        try:
            _PROFILE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            dest = _PROFILE_UPLOAD_DIR / f'user_{request.user.id}.jpg'
            img.save(str(dest), 'JPEG', quality=85, optimize=True)
        except Exception as exc:
            return Response({'error': f'Could not save file: {exc}'}, status=500)
        url = f'/uploads/profiles/user_{request.user.id}.jpg?t={int(time.time())}'
        User.objects.filter(id=request.user.id).update(profile_picture=url)
        return Response({'url': url})
    else:
        dest = _PROFILE_UPLOAD_DIR / f'user_{request.user.id}.jpg'
        try:
            if dest.exists():
                dest.unlink()
        except Exception as exc:
            return Response({'error': f'Could not delete file: {exc}'}, status=500)
        User.objects.filter(id=request.user.id).update(profile_picture=None)
        return Response({'url': None})


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def sso_login(request):
    gate_token = request.query_params.get('gate_token')
    if not _verify_gate_token(gate_token):
        return Response({'error': 'Access code required before SSO'}, status=403)
    sso_url = cfg('sap_sso_sso_url', '')
    sp_entity = cfg('sap_sso_sp_entity_id', 'http://localhost:8000')
    if not sso_url:
        return Response({'error': 'SAP SSO not configured'}, status=503)
    import uuid, urllib.parse
    from datetime import timezone
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    req_id = '_' + uuid.uuid4().hex
    acs_url = f'{sp_entity}/api/auth/sso/callback'
    authn_request = (
        f'<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" '
        f'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" '
        f'ID="{req_id}" Version="2.0" IssueInstant="{now}" '
        f'AssertionConsumerServiceURL="{acs_url}" Destination="{sso_url}">'
        f'<saml:Issuer>{sp_entity}</saml:Issuer>'
        f'</samlp:AuthnRequest>'
    )
    saml_encoded = base64.b64encode(authn_request.encode()).decode()
    redirect_url = (
        f'{sso_url}?SAMLRequest={urllib.parse.quote(saml_encoded)}'
        f'&RelayState={urllib.parse.quote(gate_token or "")}'
    )
    return HttpResponseRedirect(redirect_url)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([FormParser, MultiPartParser])
def sso_callback(request):
    saml_response = request.data.get('SAMLResponse', '')
    relay_state = request.data.get('RelayState', '')
    if not _verify_gate_token(relay_state or None):
        return Response({'error': 'Access code gate failed'}, status=403)
    try:
        xml_bytes = base64.b64decode(saml_response)
        attrs = _parse_saml_assertion(xml_bytes)
    except Exception as e:
        return Response({'error': f'Invalid SAML response: {e}'}, status=400)
    email = attrs.get('email') or attrs.get('name_id', '')
    name = attrs.get('displayName') or attrs.get('cn') or email
    emp_id = attrs.get('employeeNumber') or email.split('@')[0]
    department = attrs.get('department', '')
    name_id = attrs.get('name_id', '')
    if not email:
        return Response({'error': 'SAP SSO did not return email'}, status=400)
    try:
        user = User.objects.get(email=email)
        user.name = name
        user.department = department
        user.is_sso_user = True
        user.sso_name_id = name_id
    except User.DoesNotExist:
        user = User(
            employee_id=emp_id, name=name, email=email,
            department=department, role='Document Creator',
            is_sso_user=True, sso_name_id=name_id, is_active=True,
        )
    user.last_login = datetime.utcnow()
    user.save()
    token = create_token(user.id, {'sso': True})
    # Only allow http(s) URLs as the postMessage / redirect target. Without
    # this check a misconfiguration could land a javascript: URI here, turning
    # the SSO callback into a stored-XSS sink.
    raw_frontend_url = cfg('frontend_url', 'http://localhost:3000') or ''
    frontend_url = raw_frontend_url if raw_frontend_url.lower().startswith(('http://', 'https://')) else 'http://localhost:3000'
    token_json = _json.dumps(token)
    user_json = _json.dumps({
        'id': user.id, 'name': user.name, 'email': user.email,
        'role': user.role, 'is_sso_user': True,
    })
    origin_json = _json.dumps(frontend_url)
    html = f"""<html><body><script>
  (function(){{
    var token={token_json};
    var user={user_json};
    var origin={origin_json};
    if(window.opener){{
      window.opener.postMessage({{type:"SSO_LOGIN",token:token,user:user}},origin);
    }}else{{
      localStorage.setItem("dms_token",token);
      localStorage.setItem("dms_user",JSON.stringify(user));
      window.location.href=origin;
    }}
    window.close();
  }})();
</script><p>Authenticating via SAP SSO...</p></body></html>"""
    return HttpResponse(html, content_type='text/html')


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def sso_metadata(request):
    sp_entity = cfg('sap_sso_sp_entity_id', 'http://localhost:8000')
    acs_url = f'{sp_entity}/api/auth/sso/callback'
    xml = (
        '<?xml version="1.0"?>\n'
        f'<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{sp_entity}">\n'
        '  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"\n'
        '    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">\n'
        f'    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"\n'
        f'      Location="{acs_url}" index="1"/>\n'
        '  </md:SPSSODescriptor>\n'
        '</md:EntityDescriptor>'
    )
    return HttpResponse(xml, content_type='application/xml')


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    return Response({'status': 'ok', 'version': '2.0.0'})


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def test_endpoint(request):
    return Response({'message': 'Backend is working'})


def _parse_saml_assertion(xml_bytes):
    import xml.etree.ElementTree as ET
    NS = {
        'saml': 'urn:oasis:names:tc:SAML:2.0:assertion',
        'samlp': 'urn:oasis:names:tc:SAML:2.0:protocol',
    }
    root = ET.fromstring(xml_bytes)
    assertion = root.find('.//saml:Assertion', NS)
    if assertion is None:
        raise ValueError('No Assertion found in SAML response')
    attrs = {}
    name_id_el = assertion.find('.//saml:NameID', NS)
    if name_id_el is not None:
        attrs['name_id'] = name_id_el.text
    for attr_stmt in assertion.findall('.//saml:AttributeStatement/saml:Attribute', NS):
        attr_name = attr_stmt.get('Name', '')
        attr_vals = [v.text for v in attr_stmt.findall('saml:AttributeValue', NS)]
        short_name = attr_name.split('/')[-1]
        attrs[short_name] = attr_vals[0] if attr_vals else ''
    for sap_key, our_key in [
        ('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'email'),
        ('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', 'displayName'),
        ('http://schemas.sap.com/2012/01/addressbook/EmployeeNumber', 'employeeNumber'),
        ('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department', 'department'),
    ]:
        if sap_key in attrs and our_key not in attrs:
            attrs[our_key] = attrs[sap_key]
    if 'email' not in attrs and '@' in attrs.get('name_id', ''):
        attrs['email'] = attrs['name_id']
    return attrs
