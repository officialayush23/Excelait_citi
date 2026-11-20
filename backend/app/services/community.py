"""Gyan Chaupal: questions with verified answers, an opportunity board, study circles,
seniors from the same path, and girls-only spaces. Moderation is built in."""

from __future__ import annotations

import re

from app.core.db import get_db
from app.services.graph import graph

POST_FIELDS = "id, group_id, author_id, kind, title, body, tags, deadline, link, district, language, status, answer_count, score, created_at, profiles!posts_author_id_fkey(full_name, is_senior, senior_path)"
# Students are minors too: phone numbers, payment handles and chat-app invites go to review first.
RISKY = re.compile(r"(\+?91[\s-]?)?[6-9]\d{9}|\b[\w.-]+@(upi|ybl|okaxis|oksbi|okhdfcbank|paytm|ibl)\b|chat\.whatsapp\.com|t\.me/", re.I)
TRUSTED_ROLES = {"mentor", "facilitator", "admin"}


class CommunityError(ValueError):
    pass


def _flag(text: str) -> bool:
    return bool(RISKY.search(text or ""))


def can_see_group(group: dict, facts: dict) -> bool:
    return not group.get("women_only") or facts.get("gender") == "female"


def ensure_default_groups() -> None:
    """One circle per career and per exam, and a girls-only space. Idempotent."""
    g = graph()
    rows = [{"slug": f"career-{c}", "name": v["name"], "kind": "career", "career_slug": c} for c, v in g.careers.items()]
    rows += [{"slug": f"exam-{e}", "name": f"{v['name']} preparation", "kind": "exam", "exam_slug": e} for e, v in g.exams.items()]
    rows += [{"slug": "girls-space", "name": "Girls' space", "kind": "women", "women_only": True,
              "description": "A safe space for girls and women only. Mentors here are women."}]
    keys = ("slug", "name", "kind", "career_slug", "exam_slug", "women_only", "description")
    rows = [{k: r.get(k, False if k == "women_only" else None) for k in keys} for r in rows]
    get_db().table("groups").upsert(rows, on_conflict="slug", ignore_duplicates=True).execute()


def groups_for(user_id: str, facts: dict, saved_careers: list[str]) -> dict:
    db = get_db()
    joined = {r["group_id"] for r in db.table("group_members").select("group_id").eq("user_id", user_id).execute().data}
    allg = db.table("groups").select("id, slug, name, kind, women_only, career_slug, exam_slug, description").execute().data
    g = graph()
    exam_set = {e for c in saved_careers if c in g.careers for p in g.careers[c]["program_slugs"] if p in g.programs for e in g.programs[p]["exam_slugs"]}
    suggested = [x for x in allg if can_see_group(x, facts) and x["id"] not in joined and (
        x["career_slug"] in saved_careers or x["exam_slug"] in exam_set or (x["women_only"] and facts.get("gender") == "female"))]
    return {"joined": [x for x in allg if x["id"] in joined], "suggested": suggested[:8]}


def join(user_id: str, group_id: str, facts: dict, on: bool = True) -> None:
    db = get_db()
    grp = db.table("groups").select("id, women_only").eq("id", group_id).single().execute().data
    if on and not can_see_group(grp, facts):
        raise CommunityError("This space is for girls and women only.")
    if on:
        db.table("group_members").upsert({"group_id": group_id, "user_id": user_id}).execute()
    else:
        db.table("group_members").delete().eq("group_id", group_id).eq("user_id", user_id).execute()


def feed(facts: dict, kind: str | None = None, group_id: str | None = None, career: str | None = None,
         exam: str | None = None, q: str | None = None, limit: int = 30) -> list[dict]:
    db = get_db()
    query = db.table("posts").select(POST_FIELDS).eq("status", "visible")
    if kind:
        query = query.eq("kind", kind)
    if group_id:
        grp = db.table("groups").select("women_only").eq("id", group_id).single().execute().data
        if not can_see_group(grp, facts):
            raise CommunityError("This space is for girls and women only.")
        query = query.eq("group_id", group_id)
    if career:
        query = query.contains("tags", {"careers": [career]})
    if exam:
        query = query.contains("tags", {"exams": [exam]})
    if q:
        query = query.or_(f"title.ilike.%{q[:60]}%,body.ilike.%{q[:60]}%")
    rows = query.order("created_at", desc=True).limit(limit * 2).execute().data
    hidden = {x["id"] for x in db.table("groups").select("id").eq("women_only", True).execute().data} if facts.get("gender") != "female" else set()
    out = [_post(r) for r in rows if r["group_id"] not in hidden][:limit]
    ids = [p["id"] for p in out]
    accepted = {c["post_id"] for c in db.table("comments").select("post_id").in_("post_id", ids).eq("is_accepted", True).execute().data} if ids else set()
    for p in out:
        p["has_accepted"] = p["id"] in accepted
    return out


def _post(r: dict) -> dict:
    a = r.pop("profiles", None) or {}
    return {**r, "author_name": a.get("full_name"), "author_senior": a.get("is_senior"), "author_path": a.get("senior_path")}


def create_post(user_id: str, roles: set[str], data: dict) -> dict:
    text = f"{data.get('title', '')} {data.get('body', '')}"
    status = "flagged" if _flag(text) and not (roles & TRUSTED_ROLES) else "visible"
    row = {"author_id": user_id, **{k: data.get(k) for k in ("group_id", "kind", "title", "body", "tags", "deadline", "link", "district", "language")}}
    row["tags"] = row.get("tags") or {}
    row["kind"] = row.get("kind") or "post"
    post = get_db().table("posts").insert({**row, "status": status}).execute().data[0]
    return {**post, "held_for_review": status != "visible"}


def get_post(post_id: str, facts: dict) -> dict:
    db = get_db()
    p = db.table("posts").select(POST_FIELDS).eq("id", post_id).single().execute().data
    if p["status"] != "visible":
        raise CommunityError("This post is not available.")
    if p["group_id"]:
        grp = db.table("groups").select("women_only").eq("id", p["group_id"]).single().execute().data
        if not can_see_group(grp, facts):
            raise CommunityError("This space is for girls and women only.")
    comments = db.table("comments").select("id, author_id, body, is_accepted, approved_by, created_at, profiles!comments_author_id_fkey(full_name, is_senior, senior_path)") \
        .eq("post_id", post_id).eq("status", "visible").order("is_accepted", desc=True).order("created_at").execute().data
    for c in comments:
        a = c.pop("profiles", None) or {}
        c.update(author_name=a.get("full_name"), author_senior=a.get("is_senior"), author_path=a.get("senior_path"), verified=bool(c["approved_by"]))
    return {**_post(p), "comments": comments}


def comment(user_id: str, roles: set[str], post_id: str, body: str) -> dict:
    db = get_db()
    status = "pending" if _flag(body) and not (roles & TRUSTED_ROLES) else "visible"
    trusted = bool(roles & TRUSTED_ROLES)
    c = db.table("comments").insert({"post_id": post_id, "author_id": user_id, "body": body, "status": status,
                                     **({"approved_by": user_id, "approved_at": "now()"} if trusted else {})}).execute().data[0]
    if status == "visible":
        n = db.table("comments").select("id", count="exact").eq("post_id", post_id).eq("status", "visible").execute().count or 0
        post = db.table("posts").update({"answer_count": n}).eq("id", post_id).execute().data[0]
        if post["author_id"] != user_id:
            db.table("notifications").insert({"user_id": post["author_id"], "kind": "answer", "title": "New answer to your question",
                                              "body": post["title"], "link": f"/app/community/{post_id}"}).execute()
    return {**c, "held_for_review": status != "visible"}


def accept(user_id: str, roles: set[str], post_id: str, comment_id: str) -> None:
    db = get_db()
    post = db.table("posts").select("author_id").eq("id", post_id).single().execute().data
    if post["author_id"] != user_id and not (roles & TRUSTED_ROLES):
        raise CommunityError("Only the person who asked, or a mentor, can mark the answer.")
    db.table("comments").update({"is_accepted": False}).eq("post_id", post_id).execute()
    patch = {"is_accepted": True, **({"approved_by": user_id, "approved_at": "now()"} if roles & TRUSTED_ROLES else {})}
    db.table("comments").update(patch).eq("id", comment_id).eq("post_id", post_id).execute()


def vote(user_id: str, post_id: str, value: int) -> int:
    db = get_db()
    if value == 0:
        db.table("votes").delete().eq("user_id", user_id).eq("target_kind", "post").eq("target_id", post_id).execute()
    else:
        db.table("votes").upsert({"user_id": user_id, "target_kind": "post", "target_id": post_id, "value": 1 if value > 0 else -1}).execute()
    score = sum(v["value"] for v in db.table("votes").select("value").eq("target_kind", "post").eq("target_id", post_id).execute().data)
    db.table("posts").update({"score": score}).eq("id", post_id).execute()
    return score


def report(user_id: str, kind: str, target_id: str, reason: str) -> None:
    db = get_db()
    db.table("reports").insert({"reporter_id": user_id, "target_kind": kind, "target_id": target_id, "reason": reason[:500]}).execute()
    if kind == "post":  # three reports hide a post until a moderator looks
        n = db.table("reports").select("id", count="exact").eq("target_kind", "post").eq("target_id", target_id).eq("status", "open").execute().count or 0
        if n >= 3:
            db.table("posts").update({"status": "flagged"}).eq("id", target_id).execute()


def seniors(career: str | None = None, q: str | None = None, limit: int = 20) -> list[dict]:
    query = get_db().table("profiles").select("id, full_name, senior_path, bio").eq("is_senior", True)
    if q or career:
        term = q or graph().careers.get(career, {}).get("name", career)
        query = query.ilike("senior_path", f"%{term.split('(')[0].strip()[:40]}%")
    return query.limit(limit).execute().data


def moderation_queue() -> dict:
    db = get_db()
    return {"posts": db.table("posts").select("id, title, body, kind, created_at").eq("status", "flagged").order("created_at").limit(50).execute().data,
            "comments": db.table("comments").select("id, post_id, body, created_at").eq("status", "pending").order("created_at").limit(50).execute().data,
            "reports": db.table("reports").select("id, target_kind, target_id, reason, created_at").eq("status", "open").order("created_at").limit(50).execute().data}


def moderate(admin_id: str, kind: str, target_id: str, approve: bool) -> None:
    db = get_db()
    if kind == "post":
        db.table("posts").update({"status": "visible" if approve else "hidden"}).eq("id", target_id).execute()
    elif kind == "comment":
        db.table("comments").update({"status": "visible" if approve else "hidden"}).eq("id", target_id).execute()
    db.table("reports").update({"status": "dismissed" if approve else "actioned", "resolved_by": admin_id}).eq("target_id", target_id).eq("status", "open").execute()
