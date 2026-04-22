from fastapi import FastAPI, Request as _Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import uvicorn, os, traceback

from database import engine, Base

# Create all tables
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print("DB create error:", e)


def _migrate_doctype_schemas():
    """Add expiry_date and revision_due fields to every doc type schema that lacks them."""
    try:
        import copy
        from database import SessionLocal
        from sqlalchemy.orm.attributes import flag_modified
        import models as _m

        NEW_FIELDS = [
            {"key": "expiry_date",  "label": "Expiry Date",  "type": "date", "required": False, "options": [], "children": {}},
            {"key": "revision_due", "label": "Revision Due", "type": "date", "required": False, "options": [], "children": {}},
        ]
        db = SessionLocal()
        try:
            for dt in db.query(_m.DocumentType).all():
                schema = dt.metadata_schema or []
                if not isinstance(schema, list):
                    schema = list(schema.values()) if isinstance(schema, dict) else []
                existing_keys = {f.get("key") for f in schema if isinstance(f, dict)}
                added = False
                for nf in NEW_FIELDS:
                    if nf["key"] not in existing_keys:
                        schema.append(nf)
                        added = True
                if added:
                    dt.metadata_schema = copy.deepcopy(schema)
                    flag_modified(dt, "metadata_schema")
            db.commit()
            print("Schema migration: expiry_date/revision_due ensured on all doc types")
        finally:
            db.close()
    except Exception:
        print("Schema migration error:", traceback.format_exc())


def _sync_document_core_fields():
    """Backfill expiry_date, revision_due, and usi_kks_code on all documents
    from their custom_metadata, for documents where the core column is empty
    but the value exists in the JSON metadata."""
    try:
        from database import SessionLocal
        from datetime import datetime as _dt
        import models as _m

        db = SessionLocal()
        try:
            updated = 0
            for doc in db.query(_m.Document).filter(_m.Document.is_deleted == False).all():
                cm = doc.custom_metadata or {}
                if not isinstance(cm, dict):
                    continue
                changed = False

                for meta_key, core_attr in [("expiry_date", "expiry_date"), ("revision_due", "revision_due")]:
                    if not getattr(doc, core_attr) and cm.get(meta_key):
                        try:
                            raw = str(cm[meta_key]).split("T")[0]
                            setattr(doc, core_attr, _dt.fromisoformat(raw))
                            changed = True
                        except Exception:
                            pass

                for meta_key, core_attr in [("usi", "usi_kks_code"), ("usi_kks_code", "usi_kks_code")]:
                    if not getattr(doc, core_attr) and cm.get(meta_key):
                        setattr(doc, core_attr, cm[meta_key])
                        changed = True

                if changed:
                    updated += 1

            db.commit()
            print(f"Core-field sync: updated {updated} document(s) from custom_metadata")
        finally:
            db.close()
    except Exception:
        print("Core-field sync error:", traceback.format_exc())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _migrate_doctype_schemas()
    _sync_document_core_fields()
    yield


app = FastAPI(title="NPCIL DMS API", version="2.0.0", lifespan=lifespan)

_cors_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]

app.add_middleware(CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: _Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(_SecurityHeadersMiddleware)

# Import routers one by one with error reporting
try:
    from routers import auth
    app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
    print("auth router OK")
except Exception as e:
    print("auth router FAILED:", traceback.format_exc())

try:
    from routers import documents
    app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
    print("documents router OK")
except Exception as e:
    print("documents router FAILED:", traceback.format_exc())

try:
    from routers import workflow
    app.include_router(workflow.router, prefix="/api/workflow", tags=["Workflow"])
    print("workflow router OK")
except Exception as e:
    print("workflow router FAILED:", traceback.format_exc())

try:
    from routers import reports
    app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
    print("reports router OK")
except Exception as e:
    print("reports router FAILED:", traceback.format_exc())

try:
    from routers import admin
    app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
    print("admin router OK")
except Exception as e:
    print("admin router FAILED:", traceback.format_exc())

try:
    from routers import alerts
    app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
    print("alerts router OK")
except Exception as e:
    print("alerts router FAILED:", traceback.format_exc())

try:
    from routers import converter
    app.include_router(converter.router, prefix="/api/convert", tags=["Converter"])
    print("converter router OK")
except Exception as e:
    print("converter router FAILED:", traceback.format_exc())

os.makedirs("uploads", exist_ok=True)
try:
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
except Exception as e:
    print("uploads mount error:", e)



@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}

@app.get("/api/test")
def test():
    return {"message": "Backend is working"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
