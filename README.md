# ExcelAIt

Voice-first, offline-first learning-to-livelihood platform for rural students (Class 9 to graduation) and the teachers who guide them.

| Part | Stack |
| --- | --- |
| `frontend/` | Vite, React 19, TypeScript, Tailwind CSS v4, Motion, motion-primitives, shadcn/ui, Supabase JS, i18next |
| `backend/` | FastAPI, Pydantic, Supabase (secret key), PyJWT (ES256 tokens verified against the project JWKS) |
| `supabase/migrations/` | Postgres schema: 67 tables, row-level security on every table, storage buckets |

Rule of the product: **AI suggests, the rules engine decides eligibility, the teacher confirms.**

## Run it locally

### 1. Backend (Python 3.11 or newer)

```bash
cd backend
# Windows: make sure the venv uses your newest Python, not an older one on PATH
#   py -0                    (lists installed versions)
#   py -3.13 -m venv .venv   (use the newest one listed)
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
# backend/.env must exist (see backend/.env.example). It is git-ignored.
uvicorn app.main:app --reload --port 8000
```

API docs (OpenAPI 3): http://localhost:8000/docs · tests: `python -m pytest`

### 2. Frontend (Node 20+)

```bash
cd frontend
npm install
# create frontend/.env.local from frontend/.env.example (publishable key only)
npm run dev
```

Open http://localhost:5173.

### 3. Supabase dashboard settings (one time)

Authentication → URL Configuration:

- **Site URL:** `http://localhost:5173` (change to the Vercel URL when deployed)
- **Redirect URLs:** add `http://localhost:5173/auth/callback` (and the Vercel one later)

Without these, the email-confirmation link opens the wrong address.

## Roles

`student`, `facilitator`, `parent`, `mentor`, `partner` can be chosen at sign-up. `funder` and `admin` can only be granted by an admin: a sign-up that asks for them gets `student`.

## Languages

UI text lives in `frontend/src/i18n/locales/<code>.json` (English, Hindi, Marathi today). Adding a language means adding one file; languages without a file fall back to English text.

## Database migrations

Files in `supabase/migrations/` are applied in order. They are already applied to the `Excelait_citi` project.
