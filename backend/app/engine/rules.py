"""Three-valued eligibility engine. Mirrors frontend/src/engine/rules.ts exactly.

A rule is a tree of `all` / `any` groups whose leaves are conditions on a student's
facts. Missing facts make a condition UNKNOWN instead of false, so the app can ask
for exactly the missing fact instead of silently saying no.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Result = Literal["eligible", "not_eligible", "needs_info"]

TRUE, FALSE, UNKNOWN = "T", "F", "U"


@dataclass
class Outcome:
    result: Result
    failed: list[dict] = field(default_factory=list)  # [{id, label}]
    missing: list[str] = field(default_factory=list)  # fact names, de-duplicated, in order found
    passed: list[dict] = field(default_factory=list)  # [{id, label}] conditions that held

    def as_dict(self) -> dict:
        return {"result": self.result, "failed": self.failed, "missing": self.missing, "passed": self.passed}


def _missing(value: Any) -> bool:
    return value is None or value == ""


def _compare(op: str, actual: Any, expected: Any) -> bool:
    if op == "eq":
        return actual == expected
    if op == "ne":
        return actual != expected
    if op == "lt":
        return actual < expected
    if op == "lte":
        return actual <= expected
    if op == "gt":
        return actual > expected
    if op == "gte":
        return actual >= expected
    if op == "in":
        return actual in expected
    if op == "not_in":
        return actual not in expected
    if op == "between":
        lo, hi = expected
        return lo <= actual <= hi
    if op == "is_true":
        return actual is True
    if op == "is_false":
        return actual is False
    raise ValueError(f"Unknown operator: {op}")


def _ref(node: dict) -> dict:
    return {"id": node.get("id", ""), "label": node.get("label", "")}


def _eval(node: dict, facts: dict, out: Outcome) -> str:
    if "all" in node or "any" in node:
        is_all = "all" in node
        children = node["all"] if is_all else node["any"]
        child_out = Outcome(result="eligible")
        states = [_eval(c, facts, child_out) for c in children]
        if is_all:
            if FALSE in states:
                out.failed.extend(child_out.failed)
                return FALSE
            state = UNKNOWN if UNKNOWN in states else TRUE
        else:
            if TRUE in states:
                out.passed.extend(child_out.passed)
                return TRUE
            if UNKNOWN not in states:
                # Every option failed: report the group, it reads better than each option.
                out.failed.append(_ref(node) if node.get("label") else (child_out.failed[0] if child_out.failed else _ref(node)))
                return FALSE
            state = UNKNOWN
        out.passed.extend(child_out.passed)
        for m in child_out.missing:
            if m not in out.missing:
                out.missing.append(m)
        return state

    name = node["field"]
    actual = facts.get(name)
    if _missing(actual):
        if name not in out.missing:
            out.missing.append(name)
        return UNKNOWN
    ok = _compare(node["op"], actual, node.get("value"))
    (out.passed if ok else out.failed).append(_ref(node))
    return TRUE if ok else FALSE


def evaluate(rule: dict, facts: dict) -> Outcome:
    out = Outcome(result="eligible")
    state = _eval(rule, facts, out)
    if state == TRUE:
        out.result, out.missing, out.failed = "eligible", [], []
    elif state == FALSE:
        out.result, out.missing = "not_eligible", []
    else:
        out.result, out.failed = "needs_info", []
    return out
