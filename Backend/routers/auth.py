"""
auth.py — JWT login, SAP SSO (SAML 2.0), auth-code gate.

Uses bcrypt directly (no passlib) — fully compatible with Python 3.14.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request, Header
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
import os, base64, hashlib, traceback, bcrypt, json as _json

from database import get_db
import models, schemas

router = APIRouter()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\" "
        "then set it as SECRET_KEY=<value> in your environment or .env file."
    )
ALGORITHM  = "HS256"
TOKEN_MINS = 480   # 8 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ─── Password hashing (bcrypt directly — no passlib) ─────────────────────────

def hash_password(password: str) -> str:
    """Hash a plain-text password using bcrypt."""
    pw_bytes = password.encode("utf-8")
    salt     = bcrypt.gensalt()
    return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─── JWT helpers ──────────────────────────────────────────────────────────────

def create_token(user_id: int, extra: dict = {}) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(minutes=TOKEN_MINS),
    }
    payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ─── Config helpers ───────────────────────────────────────────────────────────

def _cfg(db: Session, key: str, default=None):
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    return row.value if row else default


def _set_cfg(db: Session, key: str, value: str):
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.SystemConfig(key=key, value=value))
    db.commit()


# ─── Current user dependency ──────────────────────────────────────────────────

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise exc
    try:
        payload  = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id  = payload.get("sub")
        if not user_id:
            raise exc
    except JWTError:
        raise exc
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise exc
    return user


# ─── Auth config (called by frontend on load) ─────────────────────────────────

@router.get("/config")
def auth_config(db: Session = Depends(get_db)):
    auth_code_enabled = _cfg(db, "auth_code_enabled", "false") == "true"
    sso_enabled       = _cfg(db, "sap_sso_enabled",   "false") == "true"
    return {
        "auth_code_required": auth_code_enabled,
        "sso_enabled":        sso_enabled,
        "sso_login_url":      "/api/auth/sso/login" if sso_enabled else None,
        "app_name":           _cfg(db, "app_name", "DMS Portal"),
        "app_org":            _cfg(db, "app_org",  "NPCIL"),
    }


# ─── Auth-code gate ───────────────────────────────────────────────────────────

def _make_gate_token() -> str:
    payload = {"gate": True, "exp": datetime.utcnow() + timedelta(hours=1)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _verify_gate_token(gate_token: Optional[str], db: Session) -> bool:
    if _cfg(db, "auth_code_enabled", "false") != "true":
        return True
    if not gate_token:
        return False
    try:
        payload = jwt.decode(gate_token, SECRET_KEY, algorithms=[ALGORITHM])
        return bool(payload.get("gate"))
    except JWTError:
        return False


@router.post("/verify-code")
def verify_auth_code(body: schemas.AuthCodeVerify, db: Session = Depends(get_db)):
    if _cfg(db, "auth_code_enabled", "false") != "true":
        return {"gate_token": _make_gate_token()}
    stored_hash   = _cfg(db, "auth_code_hash", "")
    provided_hash = hashlib.sha256(body.code.strip().encode()).hexdigest()
    if not stored_hash or provided_hash != stored_hash:
        raise HTTPException(status_code=403, detail="Invalid access code")
    return {"gate_token": _make_gate_token()}


# ─── Local login ──────────────────────────────────────────────────────────────

@router.post("/login", response_model=schemas.TokenResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    gate_token: Optional[str] = None,
    x_gate_token: Optional[str] = Header(None, alias="X-Gate-Token"),
    db: Session = Depends(get_db),
):
    effective_gate = x_gate_token or gate_token
    if not _verify_gate_token(effective_gate, db):
        raise HTTPException(status_code=403, detail="Access code required")

    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not user.hashed_password:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    user.last_login = datetime.utcnow()
    db.commit()
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": user}


# ─── Register ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=schemas.UserOut)
def register(data: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = models.User(
        sap_username=data.sap_username or data.employee_id,
        employee_id=data.employee_id,
        name=data.name,
        email=data.email,
        department=data.department,
        role=data.role,
        hashed_password=hash_password(data.password) if data.password else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ─── Me ───────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user


# ─── SAP SSO (SAML 2.0) ───────────────────────────────────────────────────────

@router.get("/sso/login")
def sso_login(gate_token: Optional[str] = None, db: Session = Depends(get_db)):
    if not _verify_gate_token(gate_token, db):
        raise HTTPException(status_code=403, detail="Access code required before SSO")
    sso_url   = _cfg(db, "sap_sso_sso_url", "")
    sp_entity = _cfg(db, "sap_sso_sp_entity_id", "http://localhost:8000")
    if not sso_url:
        raise HTTPException(status_code=503, detail="SAP SSO not configured")
    acs_url      = f"{sp_entity}/api/auth/sso/callback"
    authn_request = _build_authn_request(sp_entity, acs_url, sso_url)
    saml_encoded  = base64.b64encode(authn_request.encode()).decode()
    import urllib.parse
    redirect_url = (
        f"{sso_url}?SAMLRequest={urllib.parse.quote(saml_encoded)}"
        f"&RelayState={urllib.parse.quote(gate_token or '')}"
    )
    return RedirectResponse(redirect_url)


@router.post("/sso/callback")
async def sso_callback(request: Request, db: Session = Depends(get_db)):
    form          = await request.form()
    saml_response = form.get("SAMLResponse", "")
    relay_state   = form.get("RelayState", "")
    if not _verify_gate_token(relay_state or None, db):
        raise HTTPException(status_code=403, detail="Access code gate failed")
    try:
        xml_bytes = base64.b64decode(saml_response)
        attrs     = _parse_saml_assertion(xml_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid SAML response: {e}")
    email      = attrs.get("email") or attrs.get("name_id", "")
    name       = attrs.get("displayName") or attrs.get("cn") or email
    emp_id     = attrs.get("employeeNumber") or email.split("@")[0]
    department = attrs.get("department", "")
    name_id    = attrs.get("name_id", "")
    if not email:
        raise HTTPException(status_code=400, detail="SAP SSO did not return email")
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        user = models.User(
            employee_id=emp_id, name=name, email=email,
            department=department, role="Document Creator",
            is_sso_user=True, sso_name_id=name_id, is_active=True,
        )
        db.add(user)
    else:
        user.name        = name
        user.department  = department
        user.is_sso_user = True
        user.sso_name_id = name_id
    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)
    token        = create_token(user.id, {"sso": True})
    frontend_url = _cfg(db, "frontend_url", "http://localhost:3000")
    token_json   = _json.dumps(token)
    user_json    = _json.dumps({
        "id": user.id, "name": user.name, "email": user.email,
        "role": user.role, "is_sso_user": True,
    })
    origin_json  = _json.dumps(frontend_url)
    return HTMLResponse(f"""<html><body><script>
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
    </script><p>Authenticating via SAP SSO...</p></body></html>""")


@router.get("/sso/metadata")
def sso_metadata(db: Session = Depends(get_db)):
    sp_entity = _cfg(db, "sap_sso_sp_entity_id", "http://localhost:8000")
    acs_url   = f"{sp_entity}/api/auth/sso/callback"
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
    from fastapi.responses import Response as FR
    return FR(content=xml, media_type="application/xml")


# ─── Private helpers ──────────────────────────────────────────────────────────

def _build_authn_request(sp_entity: str, acs_url: str, sso_url: str) -> str:
    import uuid
    from datetime import timezone
    now    = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    req_id = "_" + uuid.uuid4().hex
    return (
        f'<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" '
        f'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" '
        f'ID="{req_id}" Version="2.0" IssueInstant="{now}" '
        f'AssertionConsumerServiceURL="{acs_url}" Destination="{sso_url}">'
        f'<saml:Issuer>{sp_entity}</saml:Issuer>'
        f'</samlp:AuthnRequest>'
    )


def _parse_saml_assertion(xml_bytes: bytes) -> dict:
    import xml.etree.ElementTree as ET
    NS = {
        "saml":  "urn:oasis:names:tc:SAML:2.0:assertion",
        "samlp": "urn:oasis:names:tc:SAML:2.0:protocol",
    }
    root      = ET.fromstring(xml_bytes)
    assertion = root.find(".//saml:Assertion", NS)
    if assertion is None:
        raise ValueError("No Assertion found in SAML response")
    attrs      = {}
    name_id_el = assertion.find(".//saml:NameID", NS)
    if name_id_el is not None:
        attrs["name_id"] = name_id_el.text
    for attr_stmt in assertion.findall(".//saml:AttributeStatement/saml:Attribute", NS):
        attr_name  = attr_stmt.get("Name", "")
        attr_vals  = [v.text for v in attr_stmt.findall("saml:AttributeValue", NS)]
        short_name = attr_name.split("/")[-1]
        attrs[short_name] = attr_vals[0] if attr_vals else ""
    for sap_key, our_key in [
        ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "email"),
        ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",    "displayName"),
        ("http://schemas.sap.com/2012/01/addressbook/EmployeeNumber",          "employeeNumber"),
        ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department",   "department"),
    ]:
        if sap_key in attrs and our_key not in attrs:
            attrs[our_key] = attrs[sap_key]
    if "email" not in attrs and "@" in attrs.get("name_id", ""):
        attrs["email"] = attrs["name_id"]
    return attrs
