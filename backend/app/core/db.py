"""Server-side Supabase client.

Uses the secret key, which bypasses RLS, so every query here must be scoped
to the signed-in user (or be a deliberate admin/catalogue operation).
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_db() -> Client:
    settings = get_settings()
    if not settings.supabase_secret_key:
        raise RuntimeError("SUPABASE_SECRECT_KEY (or SUPABASE_SECRET_KEY) is not set in backend/.env")
    return create_client(settings.supabase_url, settings.supabase_secret_key)


def get_roles(user_id: str) -> set[str]:
    rows = get_db().table("user_roles").select("role").eq("user_id", user_id).execute().data or []
    return {r["role"] for r in rows}
