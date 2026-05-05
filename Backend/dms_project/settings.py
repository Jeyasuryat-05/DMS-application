import os
from pathlib import Path

def _load_dotenv():
    env_path = Path(__file__).resolve().parent.parent / '.env'
    if env_path.exists():
        with open(env_path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip())

_load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-dms-npcil-change-in-production')

DEBUG = os.environ.get('DEBUG', 'True') == 'True'

ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'rest_framework',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = 'dms_project.urls'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'dms.db',
    }
}

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
MEDIA_URL = '/uploads/'
MEDIA_ROOT = BASE_DIR / 'uploads'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS
_origins_raw = os.environ.get('ALLOWED_ORIGINS', 'http://localhost:3000,http://localhost:5173')
CORS_ALLOWED_ORIGINS = [o.strip() for o in _origins_raw.split(',') if o.strip()]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_ALL_ORIGINS = True

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'api.authentication.IsAuthenticatedUser',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'UNAUTHENTICATED_USER': None,
}

# File uploads
DATA_UPLOAD_MAX_MEMORY_SIZE = 104857600   # 100 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 104857600

WSGI_APPLICATION = 'dms_project.wsgi.application'
