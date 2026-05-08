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
TOKEN_MINS = 480  # 8 hours


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
    # Endpoints that may receive the JWT via ?token= query string.
    # Required because <iframe>/<video>/<img> tags can't attach Authorization
    # headers, but the security trade-off is JWTs leaking into server logs and
    # referers — so allow it ONLY for these read-only file endpoints.
    _QUERY_TOKEN_PATH_FRAGMENTS = ('/files/', '/uploads/')

    def authenticate(self, request):
        from api.models import User
        token = None
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        if not token:
            path = request.path or ''
            if any(frag in path for frag in self._QUERY_TOKEN_PATH_FRAGMENTS):
                token = request.GET.get('token') or request.query_params.get('token', '')
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
    def has_permission(self, request, view):
        from api.models import User
        return bool(request.user and isinstance(request.user, User))
