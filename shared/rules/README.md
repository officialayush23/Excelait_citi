# Eligibility rules (shared)

One JSON file per scheme in `schemes/`. The **same file** is evaluated by:

- `frontend/src/engine/rules.ts` on the phone (works offline)
- `backend/app/engine/rules.py` on the server

`fixtures.json` holds hand-checked cases; both test suites run every case and must agree.

## Rule format

```json
{
  "all": [
    { "id": "class", "field": "class_level", "op": "in", "value": [9, 10, 11, 12], "label": "Studying in Class 9 to 12" },
    { "any": [
        { "id": "sc", "field": "social_category", "op": "eq", "value": "SC", "label": "SC" },
        { "id": "st", "field": "social_category", "op": "eq", "value": "ST", "label": "ST" }
      ], "id": "category", "label": "SC or ST" }
  ]
}
```

Operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `between` (inclusive `[min, max]`), `is_true`, `is_false`.

## Three answers, never a silent no

| Result | Meaning |
| --- | --- |
| `eligible` | every condition is true |
| `not_eligible` | a condition is false; `failed` says which one |
| `needs_info` | nothing is false yet, but some facts are missing; `missing` lists only those facts |

Groups use three-valued logic: in `all`, one false makes it false, otherwise any unknown makes it unknown; in `any`, one true makes it true, otherwise any unknown makes it unknown.

The AI never decides eligibility. It may explain a result, never change it.
