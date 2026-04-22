from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Resolve to the directory containing this file so the DB path is stable
# regardless of which working directory the server is launched from.
_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dms.db")
DATABASE_URL = f"sqlite:///{_DB_PATH}"
# For production: "postgresql://user:password@localhost/dms"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # SQLite only
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
