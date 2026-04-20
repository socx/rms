"""
SQLAlchemy database session for the dispatch engine.
Reads DATABASE_URL from environment.

Engine and session factory are initialised lazily on first use so that
importing this module (or any module that depends on it) does NOT raise an
error when DATABASE_URL is absent — e.g. during unit-test collection.
"""
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

_engine = None
_SessionLocal = None


def _ensure_init():
    global _engine, _SessionLocal
    if _engine is not None:
        return

    url = os.environ.get('DATABASE_URL')
    if not url:
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
                        url = os.environ.get('DATABASE_URL')
                        if url:
                            import logging
                            logging.getLogger(__name__).info('Loaded DATABASE_URL from %s', candidate)
                            break
                if url:
                    break
                parent = os.path.dirname(cur)
                if parent == cur:
                    break
                cur = parent
        except Exception:
            # ignore dotenv import/load errors here; we'll raise below if still missing
            pass

    if not url:
        raise RuntimeError(
            'DATABASE_URL is not set. Ensure a .env or .env.dev file is present and contains DATABASE_URL='
        )

    _engine = create_engine(url, pool_pre_ping=True)
    _SessionLocal = sessionmaker(bind=_engine)


class _LazySessionFactory:
    """Callable proxy that initialises the DB engine on first use."""

    def __call__(self, *args, **kwargs):
        _ensure_init()
        return _SessionLocal(*args, **kwargs)


SessionLocal = _LazySessionFactory()


def get_setting(session, key: str, default=None) -> str:
    """Read a value from system_settings. Returns default if key not found."""
    row = session.execute(text('SELECT value FROM system_settings WHERE key = :k'), {'k': key}).fetchone()
    return row[0] if row else default
