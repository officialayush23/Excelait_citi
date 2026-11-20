"""Onboarding conversation with tool calls (Groq now; Ollama later via the same OpenAI-style API).

The model's job is narrow: ask one simple question at a time in the student's language,
and record only facts the student actually said. It never decides eligibility and never
invents scheme details: it can look schemes up with a deterministic search tool.
"""

from __future__ import annotations

import json

import httpx

from app.core.config import get_settings
from app.services.catalogue import fields
from app.services.scheme_search import search_schemes
from app.services.students import EXTRA_FACTS, merge_facts

LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu",
              "kn": "Kannada", "ml": "Malayalam", "gu": "Gujarati", "pa": "Punjabi", "od": "Odia"}

SYSTEM = """You are ExcelAIt's friendly career guide for rural students in India (Class 9 to graduation).
Speak in {language}, in short, simple sentences a Class 9 student understands. Ask ONE question at a time.

Goal: learn about the student so the app can suggest careers and check scholarships. Useful facts, roughly in order:
class or course, what they enjoy doing, favourite subjects, last exam marks, state, whether they need to earn soon,
whether they can move to a city, family yearly income, social category (only if they are comfortable sharing).

Rules:
- Call save_facts whenever the student states a fact. Save only what they actually said; never guess.
- Never say a student is or is not eligible for anything. The app's rules engine decides that and shows it.
- If they ask about a scheme or scholarship, call search_schemes and mention only what it returns, with its official link.
- Be warm. If they do not want to answer something, say that is fine and move on.
- Keep replies under 40 words."""


def _fact_schema() -> dict:
    props: dict = {}
    for name, f in fields().items():
        t = {"number": "number", "boolean": "boolean"}.get(f["type"], "string")
        p: dict = {"type": t}
        if f["type"] == "enum":
            p["enum"] = f["options"]
        props[name] = p
    props["interests"] = {"type": "array", "items": {"type": "string"},
                          "description": "Activities they enjoy, e.g. hands_on, computers, helping, health, creative, nature, business, teaching"}
    props["subjects"] = {"type": "array", "items": {"type": "string", "enum": ["maths", "science", "biology", "english", "languages", "social", "computers", "art", "commerce"]}}
    props["needs_income_soon"] = {"type": "boolean"}
    props["can_relocate"] = {"type": "boolean"}
    assert EXTRA_FACTS >= {"interests", "subjects", "needs_income_soon", "can_relocate"}
    return {"type": "object", "properties": props, "additionalProperties": False}


def _tools() -> list[dict]:
    return [
        {"type": "function", "function": {
            "name": "save_facts",
            "description": "Save facts the student has clearly stated about themselves.",
            "parameters": {"type": "object", "properties": {"facts": _fact_schema()}, "required": ["facts"]}}},
        {"type": "function", "function": {
            "name": "search_schemes",
            "description": "Search the verified list of government scholarships and schemes.",
            "parameters": {"type": "object", "properties": {
                "query": {"type": "string"}, "state": {"type": "string"},
                "kind": {"type": "string", "enum": ["scholarship", "scheme", "apprenticeship", "internship", "loan", "entrepreneurship"]}},
                "required": ["query"]}}},
    ]


def _chat(messages: list[dict]) -> dict:
    s = get_settings()
    r = httpx.post(f"{s.llm_base_url}/chat/completions", timeout=60,
                   headers={"Authorization": f"Bearer {s.groq_api_key}"},
                   json={"model": s.llm_model, "messages": messages, "tools": _tools(), "temperature": 0.3})
    r.raise_for_status()
    return r.json()["choices"][0]["message"]


def onboard_turn(user_id: str, history: list[dict], message: str, language: str) -> dict:
    messages = [{"role": "system", "content": SYSTEM.format(language=LANG_NAMES.get(language, "English"))}]
    messages += [m for m in history[-12:] if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    messages.append({"role": "user", "content": message})
    saved: dict = {}
    for _ in range(4):
        msg = _chat(messages)
        calls = msg.get("tool_calls") or []
        if not calls:
            return {"reply": msg.get("content") or "", "saved": saved}
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for call in calls:
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if name == "save_facts":
                facts = args.get("facts") or {}
                merge_facts(user_id, facts)
                saved.update(facts)
                result = {"ok": True, "saved": list(facts)}
            elif name == "search_schemes":
                result = {"results": search_schemes(args.get("query", ""), args.get("state"), args.get("kind"))}
            else:
                result = {"error": "unknown tool"}
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, ensure_ascii=False)})
    return {"reply": "", "saved": saved}
