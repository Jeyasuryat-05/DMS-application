"""
SAP RFC Integration Module
==========================
Provides RFC-based connectivity between the DMS backend and an SAP system
using the PyRFC library (pip install pyrfc).

STATUS: DORMANT — not imported or called anywhere in the application.
        All functions are ready but disabled until SAP_RFC_ENABLED=True
        is set in the environment and pyrfc is installed.

Prerequisites
-------------
1. Install the SAP NetWeaver RFC SDK on the server (from SAP Service Marketplace).
2. pip install pyrfc
3. Configure the environment variables in .env (see SAP RFC section in .env.example).
4. Create an RFC destination in SAP transaction SM59 pointing to this server
   (only needed for server/callback mode).
5. Grant the RFC user appropriate ABAP authorizations for each function module used.

Supported integrations
----------------------
A. Employee Master Sync  — pulls HR data via BAPI_EMPLOYEE_GETDATA
B. Document Info Record  — creates/updates SAP DIRs via BAPI_DOCUMENT_CREATE2 / BAPI_DOCUMENT_CHANGE
C. Workflow Notifications — sends SAP inbox tasks via SAP_WAPI_CREATE_EVENT
D. Material/Equipment Lookup — reads MM/PM master data via BAPI_MATERIAL_GET_DETAIL / BAPI_EQUI_GETDETAIL
"""

import logging
import os
from datetime import datetime

logger = logging.getLogger(__name__)

# ── Feature gate ───────────────────────────────────────────────────────────────
# Set SAP_RFC_ENABLED=True in .env to activate. All public functions below
# return early with a disabled notice when this is False.
SAP_RFC_ENABLED = os.environ.get('SAP_RFC_ENABLED', 'False').strip().lower() == 'true'

# ── Connection parameters (read from environment) ─────────────────────────────
_SAP_CONN_PARAMS = {
    'ashost':  os.environ.get('SAP_ASHOST', ''),        # SAP application server IP/hostname
    'sysnr':   os.environ.get('SAP_SYSNR',  '00'),      # System number (2 digits)
    'client':  os.environ.get('SAP_CLIENT', '100'),     # SAP client / Mandant
    'user':    os.environ.get('SAP_RFC_USER', ''),      # RFC technical user
    'passwd':  os.environ.get('SAP_RFC_PASSWORD', ''),  # RFC user password
    'lang':    os.environ.get('SAP_LANG', 'EN'),        # Logon language
}


def _get_connection():
    """
    Open a single-use RFC connection. Caller is responsible for closing it.
    Returns pyrfc.Connection or raises RuntimeError if disabled/misconfigured.
    """
    if not SAP_RFC_ENABLED:
        raise RuntimeError('SAP RFC integration is disabled (SAP_RFC_ENABLED is not True).')

    try:
        from pyrfc import Connection  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            'pyrfc is not installed. Run: pip install pyrfc  '
            '(also requires the SAP NetWeaver RFC SDK on the server).'
        ) from exc

    missing = [k for k, v in _SAP_CONN_PARAMS.items() if not v]
    if missing:
        raise RuntimeError(f'Missing SAP connection env vars: {missing}')

    return Connection(**_SAP_CONN_PARAMS)


# ══════════════════════════════════════════════════════════════════════════════
# A. EMPLOYEE MASTER SYNC
# ══════════════════════════════════════════════════════════════════════════════

def sync_employee(personnel_number: str) -> dict:
    """
    Fetch one employee's master data from SAP HR and return it as a dict
    whose keys match the SAP_FIELDS list in admin_views.py.

    RFC used: BAPI_EMPLOYEE_GETDATA
    Required ABAP auth: S_RFC (function group HRBAS), P_ORGIN (HR master data read)

    Args:
        personnel_number: 8-digit SAP personnel number (zero-padded), e.g. '00001234'

    Returns:
        dict with SAP HR fields, ready to be applied to a User instance via
        User.objects.filter(personnel_number=personnel_number).update(**result)

    Raises:
        RuntimeError: if SAP_RFC_ENABLED is False or pyrfc not installed.
        Exception:    propagated from pyrfc on RFC/ABAP errors.
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'BAPI_EMPLOYEE_GETDATA',
            EMPLOYEE_ID=personnel_number,
            INFO_TYPE='0002',   # Personal data
        )
        # Map BAPI return structure to our User model fields.
        # Extend this mapping to cover all SAP_FIELDS as needed.
        personal = result.get('PERSONALDATA', [{}])[0] if result.get('PERSONALDATA') else {}
        employment = result.get('EMPLOYMENTDATA', [{}])[0] if result.get('EMPLOYMENTDATA') else {}

        return {
            'personnel_number':    personnel_number,
            'employee_full_name':  personal.get('FULLNAME', ''),
            'date_of_birth':       personal.get('BIRTHDATE'),
            'gender_code':         personal.get('GENDER', ''),
            'employment_status':   employment.get('STAT2', ''),
            'date_of_joining':     employment.get('BEGDA'),
            'date_of_retirement':  employment.get('ENDDA'),
            'sap_updated_at':      datetime.utcnow(),
            # Add remaining field mappings here when implementing
        }
    finally:
        conn.close()


def sync_all_employees(personnel_numbers: list) -> list[dict]:
    """
    Batch-sync multiple employees. Returns list of result dicts (same shape as
    sync_employee). Errors per employee are logged and skipped rather than
    aborting the whole batch.

    Intended to be called from an APScheduler job (see apps.py).
    """
    results = []
    for pn in personnel_numbers:
        try:
            data = sync_employee(pn)
            results.append({'ok': True, 'personnel_number': pn, 'data': data})
        except Exception as exc:
            logger.error('SAP employee sync failed for %s: %s', pn, exc)
            results.append({'ok': False, 'personnel_number': pn, 'error': str(exc)})
    return results


# ══════════════════════════════════════════════════════════════════════════════
# B. DOCUMENT INFO RECORD (DIR)
# ══════════════════════════════════════════════════════════════════════════════

def create_document_info_record(doc_number: str, doc_type: str, doc_version: str,
                                 doc_part: str = '000', description: str = '',
                                 status: str = '') -> dict:
    """
    Create a Document Info Record in SAP DMS (transaction CV01N).

    RFC used: BAPI_DOCUMENT_CREATE2
    Required ABAP auth: S_RFC (DOCUMENT), C_DRAW_TCD (create)

    Args:
        doc_number:  DMS document number (up to 25 chars)
        doc_type:    SAP document type code, e.g. 'DRW', 'SPE', 'CAL'
        doc_version: Version string, e.g. '00'
        doc_part:    Part (usually '000')
        description: Short text description
        status:      SAP DIR status code

    Returns:
        dict with 'document_number', 'document_type', 'document_part',
        'document_version', 'return_messages' from BAPI_RETURN table.
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'BAPI_DOCUMENT_CREATE2',
            DOCUMENTTYPE=doc_type,
            DOCUMENTNUMBER=doc_number,
            DOCUMENTVERSION=doc_version,
            DOCUMENTPART=doc_part,
            DOCUMENTDESCRIPTION=[{
                'DESCRIPT': description[:40],
                'LANGU': 'E',
            }],
            DOCUMENTDATA={
                'STATUS': status,
            },
        )
        return_msgs = result.get('RETURN', [])
        errors = [m for m in return_msgs if m.get('TYPE') in ('E', 'A')]
        if errors:
            raise RuntimeError(f"BAPI_DOCUMENT_CREATE2 errors: {errors}")

        conn.call('BAPI_TRANSACTION_COMMIT', WAIT='X')
        return {
            'document_number':  result.get('DOCUMENTNUMBER', doc_number),
            'document_type':    doc_type,
            'document_part':    doc_part,
            'document_version': doc_version,
            'return_messages':  return_msgs,
        }
    finally:
        conn.close()


def update_document_info_record(doc_number: str, doc_type: str, doc_version: str,
                                 doc_part: str = '000', status: str = '',
                                 description: str = '') -> dict:
    """
    Update an existing SAP Document Info Record (transaction CV02N).

    RFC used: BAPI_DOCUMENT_CHANGE
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'BAPI_DOCUMENT_CHANGE',
            DOCUMENTTYPE=doc_type,
            DOCUMENTNUMBER=doc_number,
            DOCUMENTVERSION=doc_version,
            DOCUMENTPART=doc_part,
            DOCUMENTDATA={
                'STATUS': status,
            },
            DOCUMENTDATAX={
                'STATUS': 'X' if status else '',
            },
        )
        return_msgs = result.get('RETURN', [])
        errors = [m for m in return_msgs if m.get('TYPE') in ('E', 'A')]
        if errors:
            raise RuntimeError(f"BAPI_DOCUMENT_CHANGE errors: {errors}")

        conn.call('BAPI_TRANSACTION_COMMIT', WAIT='X')
        return {'ok': True, 'return_messages': return_msgs}
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# C. WORKFLOW NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

def send_workflow_notification(sap_user_id: str, event_object_type: str,
                                event_object_key: str, event_name: str,
                                event_container: list | None = None) -> dict:
    """
    Trigger an SAP workflow event, which delivers a work item to the SAP
    Business Workplace inbox of the target user.

    RFC used: SAP_WAPI_CREATE_EVENT
    Required ABAP auth: S_RFC (WAPI), S_WFAR_OBJ

    Args:
        sap_user_id:        SAP user ID of the recipient (UNAME field)
        event_object_type:  ABAP workflow object type, e.g. 'BUS2012' (Purchase Order)
        event_object_key:   Object key (document number, etc.)
        event_name:         Event name defined in the workflow, e.g. 'APPROVED'
        event_container:    Optional list of dicts for event container elements

    Returns:
        dict with 'event_id' and 'return_code' from the RFC.
    """
    conn = _get_connection()
    try:
        params = {
            'OBJTYPE':   event_object_type,
            'OBJKEY':    event_object_key,
            'EVENT':     event_name,
            'CREATOR':   sap_user_id,
        }
        if event_container:
            params['EVENT_CONTAINER'] = event_container

        result = conn.call('SAP_WAPI_CREATE_EVENT', **params)
        return {
            'event_id':    result.get('EVENT_ID', ''),
            'return_code': result.get('RETURN_CODE', ''),
        }
    finally:
        conn.close()


def complete_workflow_workitem(workitem_id: str, sap_user_id: str,
                                decision: str = '') -> dict:
    """
    Complete (execute) a work item in the SAP workflow inbox —
    e.g. to mark an approval as done from the DMS side.

    RFC used: SAP_WAPI_WORKITEM_COMPLETE
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'SAP_WAPI_WORKITEM_COMPLETE',
            WORKITEM_ID=workitem_id,
            ACTUAL_AGENT=sap_user_id,
            DECISION_KEY=decision,
        )
        return {
            'return_code': result.get('RETURN_CODE', ''),
            'messages':    result.get('MESSAGE_LINES', []),
        }
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# D. MATERIAL / EQUIPMENT LOOKUP
# ══════════════════════════════════════════════════════════════════════════════

def get_material(material_number: str, plant: str = '') -> dict:
    """
    Read SAP Material Master data for attaching to a DMS document.

    RFC used: BAPI_MATERIAL_GET_DETAIL
    Required ABAP auth: S_RFC (BAPI_MATERIAL_GET_DETAIL), M_MATE_STA

    Args:
        material_number: SAP material number (up to 18 chars)
        plant:           Optional plant code (4 chars)

    Returns:
        dict with material description, type, unit of measure, plant data.
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'BAPI_MATERIAL_GET_DETAIL',
            MATERIAL=material_number.zfill(18),
            PLANT=plant,
        )
        general = result.get('MATERIALGENERAL', {})
        plant_data = result.get('MATERIALPLANT', {})
        return {
            'material_number':  material_number,
            'description':      general.get('MATL_DESC', ''),
            'material_type':    general.get('MATL_TYPE', ''),
            'base_unit':        general.get('BASE_UOM', ''),
            'material_group':   general.get('MATL_GROUP', ''),
            'plant':            plant,
            'plant_description': plant_data.get('PLNT_SPECIFIC_MATL_STATUS', ''),
        }
    finally:
        conn.close()


def get_equipment(equipment_number: str) -> dict:
    """
    Read SAP Equipment Master data (PM module) for attaching to a DMS document.

    RFC used: BAPI_EQUI_GETDETAIL
    Required ABAP auth: S_RFC (BAPI_EQUI_GETDETAIL), I_EQUI

    Args:
        equipment_number: SAP equipment number (up to 18 chars)

    Returns:
        dict with equipment description, category, plant, location.
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'BAPI_EQUI_GETDETAIL',
            EQUIPMENT=equipment_number,
        )
        data = result.get('EQUIDATA', {})
        return {
            'equipment_number': equipment_number,
            'description':      data.get('DESCRIPT', ''),
            'equipment_category': data.get('EQUICATGRY', ''),
            'plant':            data.get('MAINTPLANT', ''),
            'location':         data.get('LOCATION', ''),
            'object_type':      data.get('OBJECT', ''),
            'serial_number':    data.get('SERNR', ''),
        }
    finally:
        conn.close()


def search_materials(description_pattern: str, plant: str = '',
                     max_rows: int = 50) -> list[dict]:
    """
    Search SAP materials by description pattern (wildcard * supported).

    RFC used: BAPI_MATERIAL_GETLIST
    """
    conn = _get_connection()
    try:
        result = conn.call(
            'BAPI_MATERIAL_GETLIST',
            MATNRSELECTION=[{
                'SIGN':   'I',
                'OPTION': 'CP',
                'MATNR_LOW': description_pattern.upper(),
            }],
            PLANTSELECTION=[{'SIGN': 'I', 'OPTION': 'EQ', 'PLANT_LOW': plant}] if plant else [],
            MAXROWS=max_rows,
        )
        rows = result.get('MATNRLIST', [])
        return [
            {
                'material_number': r.get('MATERIAL', ''),
                'description':     r.get('MATL_DESC', ''),
                'material_type':   r.get('MATL_TYPE', ''),
                'base_unit':       r.get('BASE_UOM', ''),
            }
            for r in rows
        ]
    finally:
        conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# Utility: connection test
# ══════════════════════════════════════════════════════════════════════════════

def test_connection() -> dict:
    """
    Ping the SAP system to verify RFC connectivity.
    Call this from a Django management command or admin action to test setup.

    Returns:
        dict with 'ok', 'system_id', 'message'
    """
    if not SAP_RFC_ENABLED:
        return {'ok': False, 'message': 'SAP RFC is disabled (SAP_RFC_ENABLED != True).'}

    try:
        conn = _get_connection()
        result = conn.call('STFC_CONNECTION', REQUTEXT='DMS ping')
        conn.close()
        return {
            'ok': True,
            'echo': result.get('ECHOTEXT', ''),
            'resptext': result.get('RESPTEXT', ''),
            'message': 'SAP RFC connection successful.',
        }
    except Exception as exc:
        logger.error('SAP RFC connection test failed: %s', exc)
        return {'ok': False, 'message': str(exc)}
