"""Career matching with reasons. Mirrors frontend/src/engine/matching.ts exactly.

Six weighted factors (from the Round 2 design): interest 35, subjects 20, local demand 15,
marks 10, affordability 10, earning speed 10. Every point carries a reason code so a
student and teacher can see why a career was suggested, and every gap is spelled out.

When the student has taken the "Know yourself" quiz (facts.riasec, 0-100 per Holland type), the
interest factor is split: 21 for the interests they picked and 14 for how well the career's
RIASEC codes fit their quiz scores. Without the quiz the interest factor is exactly as before.
"""

from __future__ import annotations

from dataclasses import dataclass, field

WEIGHTS = {"interest": 35, "subjects": 20, "demand": 15, "marks": 10, "affordability": 10, "earning": 10}
MARKS_BAR = {"ug_degree": 50, "ug_technical": 50, "diploma": 40, "class_12": 40}
COST_POINTS = {"low": 10, "medium": 6, "high": 2}
MAX_PER_CATEGORY = 3
RIASEC = "RIASEC"
RIASEC_SHARE = 14  # of the 35 interest points, when the quiz was taken
CODE_WEIGHTS = [3, 2, 1]  # a career's first code counts most


@dataclass
class Match:
    slug: str
    score: int
    reasons: list[dict] = field(default_factory=list)  # {code, points, detail}
    gaps: list[dict] = field(default_factory=list)  # {code, detail}

    def as_dict(self) -> dict:
        return {"slug": self.slug, "score": self.score, "reasons": self.reasons, "gaps": self.gaps}


def _r(x: float) -> float:
    return round(x, 2)


def quiz_scores(p: dict) -> dict | None:
    r = p.get("riasec")
    if not isinstance(r, dict) or not any(isinstance(r.get(k), (int, float)) for k in RIASEC):
        return None
    return {k: (r.get(k) if isinstance(r.get(k), (int, float)) else 0) for k in RIASEC}


def riasec_top(scores: dict | None) -> list[str]:
    """The student's strongest types: those at 50 or more (at most 3), else the best two above 0."""
    if not scores:
        return []
    order = sorted(RIASEC, key=lambda k: (-scores.get(k, 0), RIASEC.index(k)))
    top = [k for k in order if scores.get(k, 0) >= 50][:3]
    return top or [k for k in order[:2] if scores.get(k, 0) > 0]


def score_career(career: dict, p: dict) -> Match:
    reasons: list[dict] = []
    gaps: list[dict] = []

    scores = quiz_scores(p)
    codes = career.get("riasec") or []
    fit_quiz = bool(scores and codes)
    tag_weight = WEIGHTS["interest"] - RIASEC_SHARE if fit_quiz else WEIGHTS["interest"]
    interests = set(p.get("interests") or [])
    hits = sorted(interests & set(career["interest_tags"]))
    pts = _r(tag_weight * min(1.0, len(hits) / 2))
    if hits:
        reasons.append({"code": "interest", "points": pts, "detail": hits})
    if fit_quiz:
        ws = CODE_WEIGHTS[:len(codes)]
        got = 0.0
        for w, c in zip(ws, codes):
            got += w * scores.get(c, 0)
        pts_q = _r(RIASEC_SHARE * got / (sum(ws) * 100))
        top = riasec_top(scores)
        matched = [c for c in codes if c in top]
        if matched and pts_q > 0:
            reasons.append({"code": "riasec", "points": pts_q, "detail": matched})
        pts += pts_q

    subjects = set(p.get("subjects") or [])
    need = career["subject_tags"]
    if not need:
        pts_s = _r(WEIGHTS["subjects"] * 0.5)
        reasons.append({"code": "no_subject_barrier", "points": pts_s, "detail": []})
    else:
        sh = sorted(subjects & set(need))
        pts_s = _r(WEIGHTS["subjects"] * min(1.0, len(sh) / min(2, len(need))))
        if sh:
            reasons.append({"code": "subjects", "points": pts_s, "detail": sh})
        else:
            gaps.append({"code": "subjects", "detail": need})

    city_blocked = career["needs_city"] and p.get("can_relocate") is False
    demand = career["rural_demand"] * (0.3 if city_blocked else 1.0)
    pts_d = _r(WEIGHTS["demand"] * demand)
    if city_blocked:
        gaps.append({"code": "needs_city", "detail": []})
    elif career["rural_demand"] >= 0.7:
        reasons.append({"code": "local_demand", "points": pts_d, "detail": []})

    marks = p.get("marks_percent")
    bar = MARKS_BAR.get(career["min_education"], 0)
    if marks is None:
        pts_m = _r(WEIGHTS["marks"] * 0.5)
    elif marks >= bar:
        pts_m = float(WEIGHTS["marks"])
        if bar:
            reasons.append({"code": "marks", "points": pts_m, "detail": [bar]})
    else:
        pts_m = _r(WEIGHTS["marks"] * marks / bar)
        gaps.append({"code": "marks", "detail": [bar]})

    low_income = (p.get("family_income_annual") or 10**9) <= 250000
    pts_a = 0.0 if (career["cost_band"] == "high" and low_income) else float(COST_POINTS[career["cost_band"]])
    if career["cost_band"] == "low":
        reasons.append({"code": "affordable", "points": pts_a, "detail": []})
    elif career["cost_band"] == "high":
        gaps.append({"code": "cost", "detail": career.get("scheme_slugs", [])})

    speed = career["earning_speed"]
    if p.get("needs_income_soon"):
        pts_e = {"fast": 10.0, "medium": 5.0, "slow": 0.0}[speed]
        if speed == "fast":
            reasons.append({"code": "earn_soon", "points": pts_e, "detail": []})
        elif speed == "slow":
            gaps.append({"code": "slow_to_earn", "detail": []})
    else:
        pts_e = {"fast": 8.0, "medium": 8.0, "slow": 7.0}[speed]

    total = pts + pts_s + pts_d + pts_m + pts_a + pts_e
    reasons.sort(key=lambda r: (-r["points"], r["code"]))
    return Match(slug=career["slug"], score=int(round(total)), reasons=reasons, gaps=gaps)


def rank(careers: list[dict], profile: dict, limit: int = 10) -> list[Match]:
    """Best matches, at most MAX_PER_CATEGORY from one category, so options stay wide."""
    scored = sorted((score_career(c, profile) for c in careers), key=lambda m: (-m.score, m.slug))
    by_slug = {c["slug"]: c for c in careers}
    picked: list[Match] = []
    per_cat: dict[str, int] = {}
    for m in scored:
        cat = by_slug[m.slug]["category"]
        if per_cat.get(cat, 0) >= MAX_PER_CATEGORY:
            continue
        per_cat[cat] = per_cat.get(cat, 0) + 1
        picked.append(m)
        if len(picked) == limit:
            break
    return picked
