"""Learn: turn a textbook chapter (PDF or photos of its pages) into a lesson with audio, quiz and flashcards."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from app.core.auth import CurrentUser, get_current_user
from app.services import lessons as svc
from app.services.roadmap import record_event

router = APIRouter(tags=["learn"])
MAX_ACTIVE = 2


class ShareIn(BaseModel):
    is_public: bool


class QuizIn(BaseModel):
    answers: list[int | None]


@router.post("/learn/lessons", status_code=202)
async def create_lesson(
    background: BackgroundTasks,
    files: list[UploadFile] = File(default=[]),
    file: UploadFile | None = File(default=None),  # older clients sent one PDF as `file`
    language: str = Form("en"),
    title: str | None = Form(None),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """One PDF, or up to 10 photos (JPEG, PNG, WebP) in reading order, as multipart `files`."""
    uploads = ([file] if file else []) + list(files)
    if not uploads:
        raise HTTPException(422, "Please choose a PDF or some photos.")
    if len(uploads) > svc.MAX_IMAGES:
        raise HTTPException(422, f"You can add up to {svc.MAX_IMAGES} photos.")
    data: list[bytes] = []
    for up in uploads:
        head = await up.read(svc.MAX_PDF_BYTES + 1)
        limit, what = (svc.MAX_PDF_BYTES, "This PDF is bigger than 10 MB.") if head.startswith(b"%PDF") else (svc.MAX_IMAGE_BYTES, "A photo is bigger than 8 MB.")
        if len(head) > limit:
            raise HTTPException(413, what)
        data.append(head)
    if svc.active_count(user.id) >= MAX_ACTIVE:
        raise HTTPException(429, "Two lessons are already being made. Please wait for them to finish.")
    try:
        row, source = svc.start_lesson(user.id, data, language, title, uploads[0].filename or "")
    except svc.LessonError as e:
        raise HTTPException(422, str(e)) from e
    background.add_task(svc.process_lesson, row["id"], user.id, source, language, title)
    return {"id": row["id"], "status": "processing", "stage": row["stage"]}


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
        out = svc.submit_quiz(user.id, str(lesson_id), body.answers)
    except LookupError as e:
        raise HTTPException(404, "Quiz not found.") from e
    record_event(user.id, "lesson_completed", str(lesson_id), {"score": out.get("score")})
    return out


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
