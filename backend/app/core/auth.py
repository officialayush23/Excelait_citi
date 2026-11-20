"""Verify Supabase access tokens and expose the signed-in user to routes.

Supabase signs access tokens with an asymmetric key (ES256 for this project).
We fetch the public keys from the project's JWKS endpoint, cache them, and
verify signature, expiry, audience and issuer locally on every request.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.db import get_roles

ALLOWED_ALGS = ["ES256", "RS256"]
bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: str
    email: str | None
    roles: set[str] = field(default_factory=set)
    claims: dict = field(default_factory=dict)

    def has(self, role: str) -> bool:
        return role in self.roles


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def decode_token(token: str, settings: Settings, jwks: jwt.PyJWKClient | None = None) -> dict:
    client = jwks or _jwks_client(settings.jwks_url)
    try:
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=ALLOWED_ALGS,
            audience="authenticated",
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.") from exc
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid sign-in token.") from exc


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required.")
    claims = decode_token(creds.credentials, settings)
    user_id = claims["sub"]
    return CurrentUser(id=user_id, email=claims.get("email"), roles=get_roles(user_id), claims=claims)


def require_role(*roles: str) -> Callable[[CurrentUser], CurrentUser]:
    """Route dependency: the user must hold at least one of the given roles."""

    def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not user.roles.intersection(roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this.")
        return user

    return checker
