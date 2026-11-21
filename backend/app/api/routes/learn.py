"""Learn: turn a textbook chapter (PDF) into a lesson with audio, quiz and flashcards."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from app.core.auth import CurrentUser, get_current_user
from app.services import lessons as svc

router = APIRouter(tags=["learn"])
MAX_ACTIVE = 2


class ShareIn(BaseModel):
    is_public: bool


class QuizIn(BaseModel):
    answers: list[int | None]


@router.post("/learn/lessons", status_code=202)
async def create_lesson(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    language: str = Form("en"),
    title: str | None = Form(None),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    if file.content_type not in ("application/pdf", "application/x-pdf", "application/octet-stream", None) and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(415, "Please upload a PDF file.")
    data = await file.read(svc.MAX_PDF_BYTES + 1)
    if len(data) > svc.MAX_PDF_BYTES:
        raise HTTPException(413, "This PDF is bigger than 10 MB.")
    if svc.active_count(user.id) >= MAX_ACTIVE:
        raise HTTPException(429, "Two lessons are already being made. Please wait for them to finish.")
    try:
        row, text = svc.start_lesson(user.id, data, language, title, file.filename or "")
    except svc.LessonError as e:
        raise HTTPException(422, str(e)) from e
    background.add_task(svc.process_lesson, row["id"], user.id, text, language, title)
    return {"id": row["id"], "status": "processing", "stage": "writing"}


@router.get("/learn/lessons")
def list_lessons(user: CurrentUser = Depends(get_current_user)) -> dict:
    return svc.list_lessons(user.id)


@router.get("/learn/lessons/{lesson_id}")
def get_lesson(lesson_id: UUID, user: CurrentUser = Depends(get_current_user)) -> dict:
    try:
        return svc.get_lesson(user.id, str(lesson_id))
    except LookupError as e:
        raise HTTPException(404, "Lesson not found.") from e


@router.post("/learn/lessons/{lesson_id}/quiz")
def submit_quiz(lesson_id: UUID, body: QuizIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    try:
        return svc.submit_quiz(user.id, str(lesson_id), body.answers)
    except LookupError as e:
        raise HTTPException(404, "Quiz not found.") from e


class CheckIn(BaseModel):
    index: int
    chosen: int


@router.post("/learn/lessons/{lesson_id}/quiz/check")
def check_answer(lesson_id: UUID, body: CheckIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    try:
        return svc.check_answer(user.id, str(lesson_id), body.index, body.chosen)
    except LookupError as e:
        raise HTTPException(404, "Question not found.") from e


@router.patch("/learn/lessons/{lesson_id}")
def share_lesson(lesson_id: UUID, body: ShareIn, user: CurrentUser = Depends(get_current_user)) -> dict:
    try:
        return svc.set_public(user.id, str(lesson_id), body.is_public)
    except LookupError as e:
        raise HTTPException(404, "Lesson not found.") from e
    except svc.LessonError as e:
        raise HTTPException(409, str(e)) from e


@router.delete("/learn/lessons/{lesson_id}", status_code=204)
def delete_lesson(lesson_id: UUID, user: CurrentUser = Depends(get_current_user)) -> Response:
    try:
        svc.delete_lesson(user.id, str(lesson_id))
    except LookupError as e:
        raise HTTPException(404, "Lesson not found.") from e
    return Response(status_code=204)
