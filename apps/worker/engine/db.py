"""
SQLAlchemy database session for the dispatch engine.
Reads DATABASE_URL from environment.
"""
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

engine = create_engine(os.environ['DATABASE_URL'], pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)

def get_setting(session, key: str, default=None) -> str:
    """Read a value from system_settings. Returns default if key not found."""
    row = session.execute(text('SELECT value FROM system_settings WHERE key = :k'), {'k': key}).fetchone()
    return row[0] if row else default
