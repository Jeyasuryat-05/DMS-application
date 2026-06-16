"""
SAP OData client for ZDMS_DOCUMENT_SET.

Three operations:
  fetch_sap_documents()         → list of dicts from SAP
  push_document_to_sap(doc)     → POST DMSDocumentRequest payload to SAP (DocumentType=TDS, Status=30)
  validate_doc_in_sap(doc_num)  → True if doc_num already exists in SAP

All calls are no-ops when SAP_ODATA_ENABLED=False (safe for local dev).
"""

import base64
import logging
import mimetypes
import os

from django.conf import settings

logger = logging.getLogger(__name__)

# SAP status code mapping (DMS status → SAP status code)
_STATUS_MAP = {
    'Draft':        '10',
    'Pending':      '20',
    'Under Review': '20',
    'In Review':    '20',
    'Approved':     '30',
    'Released':     '30',
    'Archived':     '40',
    'Rejected':     '10',
}


def _enabled():
    return getattr(settings, 'SAP_ODATA_ENABLED', False)


def _base_url():
    url = getattr(settings, 'SAP_ODATA_URL', '')
    return url.split('?')[0].rstrip('/')


def _service_root():
    """Service root (strips the entity set segment from SAP_ODATA_URL)."""
    return _base_url().rsplit('/', 1)[0]


def _params():
    return {'sap-client': getattr(settings, 'SAP_ODATA_CLIENT', '120')}


def _session():
    import requests
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
    s = requests.Session()
    user = getattr(settings, 'SAP_ODATA_USER', '')
    pwd  = getattr(settings, 'SAP_ODATA_PASSWORD', '')
    if user:
        s.auth = (user, pwd)
    s.verify = getattr(settings, 'SAP_ODATA_VERIFY_SSL', False)
    s.headers.update({'Accept': 'application/json'})
    return s


def _fetch_csrf_token(session):
    """
    Fetch CSRF token from the service root (not the entity set URL).
    ZDMS_DOCUMENT_SET is sap:addressable=false so a GET there returns nothing useful.
    The service root always supports GET and returns a valid CSRF token.
    """
    for fetch_url in (_service_root(), _base_url()):
        try:
            resp = session.get(
                fetch_url,
                params=_params(),
                headers={'X-CSRF-Token': 'Fetch', 'Accept': 'application/json, */*'},
                timeout=15,
            )
            token = resp.headers.get('x-csrf-token', '')
            logger.info('=== [SAP CSRF] GET %s → HTTP %s  token=%s ===',
                        fetch_url, resp.status_code, token or '(empty)')
            if token:
                return token
        except Exception as e:
            logger.warning('=== [SAP CSRF] Fetch from %s failed: %s ===', fetch_url, e)
    return ''


def _raise_for_status(resp):
    """Like resp.raise_for_status() but includes SAP's error body in the message."""
    if not resp.ok:
        import requests as _req
        body = resp.text[:2000]
        raise _req.HTTPError(
            f'HTTP {resp.status_code} {resp.reason} for url: {resp.url}\nSAP response: {body}',
            response=resp,
        )


def _file_to_base64(file_path):
    """Read file from disk and return base64-encoded string."""
    try:
        with open(file_path, 'rb') as fh:
            return base64.b64encode(fh.read()).decode('utf-8')
    except Exception as e:
        logger.error('Cannot read file for base64 encoding %s: %s', file_path, e)
        return ''


def _ws_application(filename):
    """Return file extension (without dot) as WSApplication value, e.g. 'pdf'."""
    ext = os.path.splitext(filename or '')[1].lstrip('.').lower()
    return ext or 'pdf'


def _sap_status(doc_status):
    """Map DMS document status string to SAP status code."""
    default = getattr(settings, 'SAP_ODATA_DEFAULT_STATUS', '30')
    return _STATUS_MAP.get(doc_status or '', default)


def _entity_payloads(doc):
    """
    Build one flat OData entity dict per attached file, matching ZDMS_DOCUMENT_SET schema:
      IvDocumenttype  — Document type code (e.g. TDS)
      IvFilename      — Original file name
      IvStoragecategory — Storage category (e.g. DMS_C1_ST)
      IvFilecontent   — Base64-encoded file content (xstring)
      Statusextern    — SAP status code (e.g. 30)
    """
    from api.models import DocumentFile

    doc_type_code = (
        doc.doc_type.code
        if doc.doc_type else
        getattr(settings, 'SAP_ODATA_DOC_TYPE', 'TDS')
    )
    storage_cat = getattr(settings, 'SAP_ODATA_STORAGE_CATEGORY', 'DMS_C1_ST')
    status_code = getattr(settings, 'SAP_ODATA_DEFAULT_STATUS', '30')

    payloads = []
    for df in DocumentFile.objects.filter(document=doc).order_by('id'):
        if not df.file_path:
            continue
        content_b64 = _file_to_base64(df.file_path)
        if not content_b64:
            continue
        payloads.append({
            'IvDocumenttype':    doc_type_code,
            'IvFilename':        df.filename,
            'IvStoragecategory': storage_cat,
            'IvFilecontent':     content_b64,
            'Statusextern':      status_code,
        })

    return payloads



# ── Public API ────────────────────────────────────────────────────────────────

def fetch_sap_documents():
    """Fetch all documents from SAP OData. Returns [] if disabled."""
    if not _enabled():
        return []
    try:
        s = _session()
        resp = s.get(_base_url(), params=_params(), timeout=30)
        resp.raise_for_status()
        data = resp.json()
        results = (
            data.get('d', {}).get('results')
            or data.get('value')
            or []
        )
        logger.info('SAP fetch returned %d documents', len(results))
        return results
    except Exception as e:
        logger.error('SAP fetch_sap_documents failed: %s', e)
        raise


def push_document_to_sap(doc):
    """
    Push a DMS Document to SAP OData (ZDMS_DOCUMENT_SET).
    One POST per attached file using flat IvXxx entity fields.
    No-op if SAP integration is disabled.
    """
    # ── BREAKPOINT 2: enabled check ───────────────────────────────────────────
    enabled = _enabled()
    logger.info('=== [SAP BREAKPOINT 2] SAP_ODATA_ENABLED=%s ===', enabled)
    if not enabled:
        logger.info('=== [SAP BREAKPOINT 2] SAP disabled — skipping push ===')
        return {}

    # ── BREAKPOINT 3: build payloads ──────────────────────────────────────────
    logger.info('=== [SAP BREAKPOINT 3] Building entity payloads for doc=%s ===', doc.doc_number)
    payloads = _entity_payloads(doc)
    if not payloads:
        logger.warning('=== [SAP BREAKPOINT 3] No files found — SAP push skipped for %s ===', doc.doc_number)
        return {}

    logger.info('=== [SAP BREAKPOINT 3] %d file(s) to push: %s ===',
                len(payloads), [p['IvFilename'] for p in payloads])

    try:
        # ── BREAKPOINT 4: session + CSRF ──────────────────────────────────────
        s = _session()
        logger.info('=== [SAP BREAKPOINT 4] Fetching CSRF token from %s ===', _base_url())
        csrf = _fetch_csrf_token(s)
        logger.info('=== [SAP BREAKPOINT 4] CSRF token: %s ===', csrf or '(empty)')

        url    = _base_url()
        params = _params()
        results = []

        for payload in payloads:
            safe = {**payload, 'IvFilecontent': f'<base64 {len(payload["IvFilecontent"])} chars>'}
            logger.info('=== [SAP BREAKPOINT 5] POSTing to %s — %s ===', url, safe)

            resp = s.post(
                url, params=params, json=payload,
                headers={'X-CSRF-Token': csrf, 'Content-Type': 'application/json'},
                timeout=120,
            )

            logger.info('=== [SAP BREAKPOINT 6] Response status=%s body=%s ===',
                        resp.status_code, resp.text[:1000])
            _raise_for_status(resp)

            data = resp.json().get('d', resp.json())
            logger.info('=== [SAP BREAKPOINT 6] SUCCESS — EvDocnumber=%s EvMessage=%s ===',
                        data.get('EvDocnumber', ''), data.get('EvMessage', ''))
            results.append(data)

        return results

    except Exception as e:
        logger.error('=== [SAP BREAKPOINT 6] FAILED — %s: %s ===', type(e).__name__, e)
        raise


def push_test_payload_to_sap():
    """
    POST flat IvXxx fields to ZDMS_DOCUMENT_SET.
    FileContent is the real PDF base64 from the reference sample (sap_test_payload.json).
    Field names confirmed against OData $metadata:
      IvDocumenttype, IvFilename, IvStoragecategory, IvFilecontent, Statusextern
    """
    import json as _json

    sample_path = os.path.join(os.path.dirname(__file__), 'sap_test_payload.json')
    with open(sample_path, 'r', encoding='utf-8') as fh:
        sample = _json.load(fh)
    file_content_b64 = sample['DMSDocumentRequest'][0]['Files'][0]['FileContent']

    payload = {
        'IvDocumenttype':    getattr(settings, 'SAP_ODATA_DOC_TYPE', 'TDS'),
        'IvFilename':        'testfile.pdf',
        'IvStoragecategory': getattr(settings, 'SAP_ODATA_STORAGE_CATEGORY', 'DMS_C1_ST'),
        'IvFilecontent':     file_content_b64,
        'Statusextern':      getattr(settings, 'SAP_ODATA_DEFAULT_STATUS', '30'),
    }

    s      = _session()
    csrf   = _fetch_csrf_token(s)
    url    = _base_url()
    params = _params()

    logger.info('=== [SAP TEST-PUSH] POSTing to %s params=%s csrf=%s ===',
                url, params, csrf or '(empty)')
    logger.info('=== [SAP TEST-PUSH] payload keys=%s IvFilecontent_len=%d ===',
                list(payload.keys()), len(file_content_b64))

    resp = s.post(
        url, params=params, json=payload,
        headers={
            'X-CSRF-Token': csrf,
            'Content-Type': 'application/json',
            'Accept':       'application/json',
        },
        timeout=120,
    )

    logger.info('=== [SAP TEST-PUSH] status=%s body=%s ===', resp.status_code, resp.text[:1000])
    _raise_for_status(resp)
    return resp.json().get('d', resp.json())


def validate_doc_in_sap(doc_number):
    """Return True if doc_number already exists in SAP, False if not."""
    if not _enabled():
        return False
    import requests as _req
    try:
        s    = _session()
        url  = f"{_base_url()}('{doc_number}')"
        resp = s.get(url, params=_params(), timeout=15)
        if resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True
    except _req.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            return False
        logger.error('SAP validate error for %s: %s', doc_number, e)
        raise
    except Exception as e:
        logger.error('SAP validate error for %s: %s', doc_number, e)
        raise
