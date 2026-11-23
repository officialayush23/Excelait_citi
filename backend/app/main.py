import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import learn, passport, roadmap, scholarships, teacher
from app.api.routes import assist, assistant, catalogue, community, explore, health, me, notifications, partners, plans, students
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="ExcelAIt: voice-first, offline-first learning-to-livelihood platform. OpenAPI 3 docs at /docs.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    for r in (me.router, catalogue.router, students.router, assist.router, explore.router, assistant.router, plans.router,
              partners.router, community.router, notifications.router, learn.router, passport.router, teacher.router,
              scholarships.router, roadmap.router):
        app.include_router(r, prefix="/api/v1")

    @app.on_event("startup")
    def _daily_cleanup() -> None:
        # Stored web finds are deleted only when their own time runs out; pg_cron does this daily too.
        if settings.supabase_secret_key and os.environ.get("KNOWLEDGE_CLEANUP", "1") != "0":
            from app.services.knowledge import start_daily_cleanup
            start_daily_cleanup()
        # The same daily thread pattern re-evaluates every roadmap and sends deadline / watch alerts.
        if settings.supabase_secret_key and os.environ.get("ROADMAP_DAILY", "1") != "0":
            from app.services.roadmap import start_daily
            start_daily()

    return app


app = create_app()
