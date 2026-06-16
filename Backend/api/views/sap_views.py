import logging

from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.conf import settings

from api import sap_odata
from api.models import Document

logger = logging.getLogger(__name__)


def _is_admin(user):
    return getattr(user, 'role', '') in ('System Admin', 'Sub-Admin')


# ── GET /sap/documents ─────────────────────────────────────────────────────────
@api_view(['GET'])
def sap_documents(request):
    """
    Fetch all documents from SAP OData and return them as-is.
    Useful for browsing what SAP has before syncing.
    Restricted to admins.
    """
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    if not getattr(settings, 'SAP_ODATA_ENABLED', False):
        return Response({'error': 'SAP OData integration is not enabled'}, status=503)
    try:
        results = sap_odata.fetch_sap_documents()
        return Response({'count': len(results), 'results': results})
    except Exception as e:
        return Response({'error': f'SAP fetch failed: {str(e)}'}, status=502)


# ── POST /sap/push/<doc_id> ────────────────────────────────────────────────────
@api_view(['POST'])
def sap_push_document(request, doc_id):
    """
    Manually push a DMS document to SAP.
    On success, marks sap_synced=True on the document (if field exists).
    """
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    if not getattr(settings, 'SAP_ODATA_ENABLED', False):
        return Response({'error': 'SAP OData integration is not enabled'}, status=503)
    try:
        doc = Document.objects.select_related('doc_type', 'creator').get(id=doc_id)
    except Document.DoesNotExist:
        return Response({'error': 'Document not found'}, status=404)
    try:
        result = sap_odata.push_document_to_sap(doc)
        return Response({'message': f'Document {doc.doc_number} pushed to SAP', 'sap_response': result})
    except Exception as e:
        return Response({'error': f'SAP push failed: {str(e)}'}, status=502)


# ── GET /sap/validate?doc_number=XXX ──────────────────────────────────────────
@api_view(['GET'])
def sap_validate_doc_number(request):
    """
    Check if a document number already exists in SAP.
    Returns { exists: true/false }.
    Used before creating a document in DMS to warn users of duplicates.
    """
    if not getattr(settings, 'SAP_ODATA_ENABLED', False):
        return Response({'exists': False, 'skipped': True})
    doc_number = request.query_params.get('doc_number', '').strip()
    if not doc_number:
        return Response({'error': 'doc_number query param required'}, status=400)
    try:
        exists = sap_odata.validate_doc_in_sap(doc_number)
        return Response({'doc_number': doc_number, 'exists': exists})
    except Exception as e:
        return Response({'error': f'SAP validation failed: {str(e)}'}, status=502)


# ── POST /sap/test-push ────────────────────────────────────────────────────────
@api_view(['POST'])
def sap_test_push(request):
    """
    Send the exact sample DMSDocumentRequest payload to SAP OData for connection testing.
    Uses a minimal test PDF so no real document needs to exist.
    Restricted to admins.
    """
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    if not getattr(settings, 'SAP_ODATA_ENABLED', False):
        return Response({'error': 'SAP OData integration is not enabled'}, status=503)

    try:
        data = sap_odata.push_test_payload_to_sap()
        return Response({
            'message':      'SAP test push successful',
            'sap_response': data,
        })
    except Exception as e:
        logger.error('=== [SAP TEST-PUSH] FAILED: %s ===', e)
        return Response({'error': f'SAP test push failed: {str(e)}'}, status=502)


# ── GET /sap/metadata ─────────────────────────────────────────────────────────
@api_view(['GET'])
def sap_metadata(request):
    """
    Fetch and return SAP OData $metadata XML so admins can discover
    the correct entity sets and function imports available in the service.
    """
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required'}, status=403)
    if not getattr(settings, 'SAP_ODATA_ENABLED', False):
        return Response({'error': 'SAP OData integration is not enabled'}, status=503)
    try:
        from api.sap_odata import _session, _params
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        base_url = getattr(settings, 'SAP_ODATA_URL', '').split('?')[0].rstrip('/')
        # Go up one level to service root if URL ends with entity set name
        # e.g. .../zdms_doc_create_srv/ZDMS_DOCUMENT_SET → .../zdms_doc_create_srv/
        service_root = base_url.rsplit('/', 1)[0]
        metadata_url = f'{service_root}/$metadata'

        s = _session()
        resp = s.get(
            metadata_url,
            params=_params(),
            headers={'Accept': 'application/xml, text/xml, */*'},
            timeout=15,
        )
        resp.raise_for_status()
        return Response({
            'metadata_url': metadata_url,
            'content':      resp.text,
        })
    except Exception as e:
        logger.error('SAP metadata fetch failed: %s', e)
        return Response({'error': f'Metadata fetch failed: {str(e)}'}, status=502)


# ── GET /sap/status ────────────────────────────────────────────────────────────
@api_view(['GET'])
def sap_status(request):
    """Returns whether SAP OData integration is enabled and configured."""
    enabled = getattr(settings, 'SAP_ODATA_ENABLED', False)
    url     = getattr(settings, 'SAP_ODATA_URL', '')
    user    = getattr(settings, 'SAP_ODATA_USER', '')
    return Response({
        'enabled':    enabled,
        'url':        url if _is_admin(request.user) else ('configured' if url else ''),
        'user':       user if _is_admin(request.user) else ('configured' if user else ''),
        'configured': bool(enabled and url and user),
    })
