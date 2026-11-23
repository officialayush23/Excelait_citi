# Adaptive roadmap: what we borrowed and why

One roadmap per student, several goals (career, course, exam, scheme, job watch, own goal with a date).
Fixed rules (`backend/app/services/roadmap_engine.py`) decide dates, eligibility and progress. The model never does.

## What others do

| Source | What they do | What we took |
|---|---|---|
| [Duolingo: how the streak builds habit](https://blog.duolingo.com/how-duolingo-streak-builds-habit) | Streak Freeze pauses a streak on busy days. Allowing two freezes raised daily active learners. Losing a streak demotivates people. | We have **no streak to lose**. After a lapse the roadmap re-spaces itself and says so. Nothing is counted as "lost". |
| [Coursera: sessions update](https://blog.coursera.org/improvements-to-sessions-experience-for-learners/) | Learners who miss personal deadlines can "Reset", which moves the deadlines forward so nothing shows as late. | When a student falls behind, the plan **re-spaces soft dates by itself**, with no button to press. Every move is logged with a reason and can be undone. |
| [Khan Academy: mastery levels](https://support.khanacademy.org/hc/tr/articles/5548760867853) | Skill levels go up or down from evidence (exercise and quiz results), not from self-report. | Steps move forward from **evidence**: lessons, quizzes, scheme views and applications, credentials. Each one is labelled "Saathi noticed you did this" or "you marked it". |
| [SATHEE (IIT Kanpur) study planner](https://sathee.iitk.ac.in/pyqs/medical-study-planner) | An Indian exam planner. It takes free hours per day and weak areas, then reallocates hours weekly and when scores drop or signs of fatigue appear. | **Time available** (from Saathi, e.g. "only Sundays") sets the gap between steps. Evidence and inactivity change the pace. |
| [Naukri job alerts](https://www.naukri.com/blog/how-to-get-maximum-value-out-of-naukri-job-alerts) | Saved-search alerts that only include fresh posts (from the last 2–3 days). | Watching a job only alerts on items **first seen after the last check**, grouped into one notification a day. |
| [Mindler (YourStory)](https://yourstory.com/2016/07/mindler/) | Assessment, then a career plan that counsellors check monthly and quarterly and adjust. | The daily re-check is the "counsellor check-in". Saathi's conversation feeds it. |

We did not open product pages for Testbook, Unacademy, Adda247, Apna, NCS or iDreamCareer, so they are not cited.

## Behavioural science

- **Self-Determination Theory** ([APA](https://apa.org/research-practice/conduct-research/self-determination-theory)): autonomy, competence and relatedness drive lasting motivation, and outside pressure undermines it. What we do:
  - **Undo** on every automatic change (autonomy). An undone change is not redone for 14 days.
  - Small, visible wins (competence).
  - "Ask a senior" steps link to Community (relatedness).
- **Implementation intentions** ([NCI summary of Gollwitzer & Sheeran 2006](https://cancercontrol.cancer.gov/brp/research/constructs/implementation-intentions)): if-then plans had d = .65 across 94 studies, and d = .77 for staying on track. Every step has a concrete **"What to do now"** line and sub-tasks.
- **Goal gradient** ([Kivetz, Urminsky & Zheng](https://business.columbia.edu/faculty/research/goal-gradient-hypothesis-resurrected-purchase-acceleration-illusionary-goal)): perceived closeness speeds people up, even when the progress is "free". What we do:
  - Progress rings count partial progress.
  - A 10-minute micro-step gives a quick first win.
  - Overall % is shown first.
- **Fresh start effect** ([Dai, Milkman & Riis 2014](https://econpapers.repec.org/RePEc:inm:ormnsc:v:60:y:2014:i:10:p:2563-2582)): new week or month landmarks put past setbacks in an "old period" and raise effort. After 7+ days away:
  - Re-entry starts on **next Monday**.
  - Dates are re-spaced and the next step is split.
  - The copy is "Welcome back, a fresh start", never "you missed".

## Design rules that follow

1. **Hard deadlines never move.** This covers exam windows, scheme deadlines and the legal "Eligible from age N" gate. They are flagged **at risk** with the days left (≤ 30 days while behind, or ≤ 7 days always).
2. **States:**
   - **on_track**
   - **ahead:** add an optional stretch step and pull the next soft date in by up to 7 days.
   - **behind:** split the next step into a micro-step and re-space soft dates up to the next hard date.
   - **inactive (7 days):** fresh start.
3. **Saathi signals** shape the plan:
   - **worry:** smaller steps and reassuring copy.
   - **money pressure:** money-that-needs-no-work and earn-while-learning steps first. Minors get scholarships and skills, never jobs.
   - **time available:** sets the spacing between steps.
   - **goal:** suggests a goal.
4. **Alerts:**
   - Deadlines at 7, 3 and 1 days.
   - An exam's usual window opening.
   - New matching jobs.
   - A minor never gets job alerts (`work_rules`). Their job watch is turned into skill-training and scholarship alerts.
