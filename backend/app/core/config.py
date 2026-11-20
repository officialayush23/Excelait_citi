from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from backend/.env or the environment."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "ExcelAIt API"
    supabase_url: str = "https://wdjnewpceirxywjpnacn.supabase.co"
    supabase_publishable_key: str = Field(
        default="", validation_alias=AliasChoices("SUPABASE_PUBLISHABLE_API_KEY", "SUPABASE_PUBLISHABLE_KEY")
    )
    # The team's .env spells this SUPABASE_SECRECT_KEY; accept both spellings.
    supabase_secret_key: str = Field(
        default="", validation_alias=AliasChoices("SUPABASE_SECRET_KEY", "SUPABASE_SECRECT_KEY")
    )
    supabase_db_url: str = ""
    groq_api_key: str = ""
    sarvam_api_key: str = ""
    # OpenAI-compatible chat endpoint. Groq today; for Ollama use http://localhost:11434/v1 and a local model.
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "openai/gpt-oss-120b"
    tavily_api_key: str = ""
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
