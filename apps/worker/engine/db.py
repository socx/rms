"""
SQLAlchemy database session for the dispatch engine.
Reads DATABASE_URL from environment.
"""
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    # Try to load a repo-root env file as a fallback (covers different startup paths).
    # Search for .env first, then .env.dev — walk up from this file's directory.
    try:
        from dotenv import load_dotenv
        cur = os.path.abspath(os.path.dirname(__file__))
        while True:
            for name in ('.env', '.env.dev'):
                candidate = os.path.join(cur, name)
                if os.path.exists(candidate):
                    load_dotenv(candidate, override=False)
                    DATABASE_URL = os.environ.get('DATABASE_URL')
                    if DATABASE_URL:
                        import logging
                        logging.getLogger(__name__).info('Loaded DATABASE_URL from %s', candidate)
                        break
            if DATABASE_URL:
                break
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    except Exception:
        # ignore dotenv import/load errors here; we'll raise below if still missing
        pass

if not DATABASE_URL:
    raise RuntimeError(
        'DATABASE_URL is not set. Ensure a .env or .env.dev file is present and contains DATABASE_URL='
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)

def get_setting(session, key: str, default=None) -> str:
    """Read a value from system_settings. Returns default if key not found."""
    row = session.execute(text('SELECT value FROM system_settings WHERE key = :k'), {'k': key}).fetchone()
    return row[0] if row else default
