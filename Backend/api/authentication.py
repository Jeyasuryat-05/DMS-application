import os
import bcrypt
import hashlib
from datetime import datetime, timedelta
from jose import jwt, JWTError
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
ALGORITHM = 'HS256'
TOKEN_MINS = int(os.environ.get('JWT_EXPIRY_MINUTES', '480'))  # default 8 h (one full workday)


def hash_password(password: str) -> str:
    pw_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pw_bytes, salt).decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False


def create_token(user_id: int, extra: dict = {}) -> str:
    payload = {
        'sub': str(user_id),
        'exp': datetime.utcnow() + timedelta(minutes=TOKEN_MINS),
    }
    payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def cfg(key: str, default=None):
    from api.models import SystemConfig
    try:
        row = SystemConfig.objects.get(key=key)
        return row.value
    except SystemConfig.DoesNotExist:
        return default


def set_cfg(key: str, value: str):
    from api.models import SystemConfig
    SystemConfig.objects.update_or_create(key=key, defaults={'value': str(value)})


class JWTAuthentication(BaseAuthentication):
    def authenticate(self, request):
        from api.models import User
        token = None
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        # Main session JWT is NEVER accepted via query string — it leaks to
        # server logs and HTTP Referer headers. File viewing uses short-lived
        # file-view tokens via create_file_view_token() instead.
        if not token:
            return None
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get('sub')
            if not user_id:
                raise AuthenticationFailed('Invalid token')
        except JWTError:
            raise AuthenticationFailed('Invalid token')
        try:
            user = User.objects.get(id=int(user_id), is_active=True)
        except User.DoesNotExist:
            raise AuthenticationFailed('User not found or inactive')
        return (user, token)


class IsAuthenticatedUser(BasePermission):
    # A user with `dms_enabled=False` may have a valid token (issued before the
    # admin revoked access) but must be denied at every endpoint — checking
    # here is the defence-in-depth complement to the login-time check.
    message = 'DMS access is not enabled for this account.'

    def has_permission(self, request, view):
        from api.models import User
        if not (request.user and isinstance(request.user, User)):
            return False
        if not request.user.dms_enabled:
            return False
        return True


# ─── Permission-flag helpers ──────────────────────────────────────────────────
# These guard endpoints by the per-user `can_read / can_create / can_edit /
# can_delete` flags managed in Admin → Users. The Admin UI surfaces these
# flags; without enforcement here they were purely cosmetic.

def _flag_check(user, attr, action):
    """Return (ok, error_response_or_none). Always allow System Admins."""
    from rest_framework.response import Response
    if getattr(user, 'role', '') == 'System Admin':
        return True, None
    if not getattr(user, attr, False):
        return False, Response(
            {'error': f'You do not have {action} access. Contact your administrator.'},
            status=403,
        )
    return True, None


def require_read(view_func):
    from functools import wraps
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        ok, resp = _flag_check(request.user, 'can_read', 'Read')
        return resp if not ok else view_func(request, *args, **kwargs)
    return wrapped


def require_create(view_func):
    from functools import wraps
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        ok, resp = _flag_check(request.user, 'can_create', 'Create')
        return resp if not ok else view_func(request, *args, **kwargs)
    return wrapped


def require_edit(view_func):
    from functools import wraps
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        ok, resp = _flag_check(request.user, 'can_edit', 'Edit')
        return resp if not ok else view_func(request, *args, **kwargs)
    return wrapped


def require_delete(view_func):
    from functools import wraps
    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        ok, resp = _flag_check(request.user, 'can_delete', 'Delete')
        return resp if not ok else view_func(request, *args, **kwargs)
    return wrapped


# ─── Short-lived file-view tokens ────────────────────────────────────────────
# Used instead of passing the main session JWT in query strings (?token=...).
# These tokens embed the specific file_id they grant access to and expire in
# 5 minutes, limiting the damage if a token leaks into server logs.

FILE_VIEW_TOKEN_MINS = 5


def create_file_view_token(user_id: int, doc_id: int, file_id: int) -> str:
    payload = {
        'sub':     str(user_id),
        'fv_doc':  doc_id,
        'fv_file': file_id,
        'exp':     datetime.utcnow() + timedelta(minutes=FILE_VIEW_TOKEN_MINS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_file_view_token(token: str, doc_id: int, file_id: int):
    """
    Decode and validate a file-view token.
    Returns the user_id (int) on success, raises AuthenticationFailed otherwise.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise AuthenticationFailed('File view token is invalid or expired.')
    if payload.get('fv_doc') != doc_id or payload.get('fv_file') != file_id:
        raise AuthenticationFailed('File view token does not match the requested file.')
    user_id = payload.get('sub')
    if not user_id:
        raise AuthenticationFailed('File view token missing subject.')
    return int(user_id)
