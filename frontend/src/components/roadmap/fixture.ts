import type { Roadmap, RoadmapStep } from './types'

const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function s(p: Partial<RoadmapStep> & Pick<RoadmapStep, 'id' | 'goal_id' | 'kind' | 'title' | 'bucket'>, due?: number): RoadmapStep {
  return {
    position: 0, status: 'todo', progress: 0, subtasks: [], hard_deadline: false, at_risk: false, refs: [], due_date: due === undefined ? null : day(due),
    days_left: due ?? null, origin: 'plan', ...p,
  }
}

/** A sample roadmap so the page can be seen while the API or migration 0018 is not there yet (dev only). */
export const sampleRoadmap: Roadmap = {
  ready: true, today: day(0), pace: 'behind', tone: 'reassure', progress: 34, days_inactive: 2, fresh_start: false,
  next: null, minor: true, age_known: true,
  signals: [{ kind: 'worry', value: 'exam' }, { kind: 'time', value: 'sundays' }],
  at_risk: [{ step_id: 'e1', goal_id: 'g2', title: 'Take NEET-UG', days_left: 21 }],
  goals: [
    {
      id: 'g1', kind: 'career', title: 'Staff Nurse', career_slug: 'staff-nurse', status: 'active', progress: 45, pace: 'on_track',
      steps: [
        s({ id: 'a1', goal_id: 'g1', position: 0, kind: 'milestone', title: 'Pass Class 12', status: 'done', progress: 100, bucket: 'done', done_by: 'student', hard_deadline: true }),
        s({ id: 'a2', goal_id: 'g1', position: 1, kind: 'scheme', ref_id: 'pm-yasasvi', title: 'Apply: PM YASASVI scholarship', status: 'doing', progress: 50, bucket: 'now', done_by: 'evidence',
            refs: [{ kind: 'scheme', slug: 'pm-yasasvi', name: 'PM YASASVI' }], copy_key: 'scheme', why: 'Money that needs no work. It helps pay for your studies.', now_text: 'Open the scheme and see what it asks for.',
            subtasks: [{ id: 'check', key: 'scheme.check', title: 'Check if you qualify', done: true }, { id: 'docs', key: 'scheme.docs', title: 'Get the documents ready', done: true }, { id: 'apply', key: 'scheme.apply', title: 'Apply on the official site', done: false }, { id: 'save', key: 'scheme.save', title: 'Save the application number', done: false }] }, 6),
        s({ id: 'a3', goal_id: 'g1', position: 2, kind: 'document', ref_id: 'income_certificate', title: 'Get ready: Income certificate', bucket: 'next', copy_key: 'document', refs: [{ kind: 'document', slug: 'income_certificate', name: 'Income certificate' }] }, 13),
        s({ id: 'a4', goal_id: 'g1', position: 3, kind: 'program', ref_id: 'gnm', title: 'Get admission: GNM Nursing', bucket: 'later', hard_deadline: true, copy_key: 'program', refs: [{ kind: 'program', slug: 'gnm', name: 'GNM Nursing' }, { kind: 'career', slug: 'staff-nurse', name: 'Staff Nurse' }] }, 190),
        s({ id: 'a5', goal_id: 'g1', position: 4, kind: 'milestone', title: 'Eligible from age 18', bucket: 'later', hard_deadline: true, copy_key: 'milestone_gate' }, 240),
      ],
    },
    {
      id: 'g2', kind: 'exam', title: 'NEET-UG 2027', exam_slug: 'neet-ug', status: 'active', progress: 20, pace: 'behind',
      steps: [
        s({ id: 'm1', goal_id: 'g2', position: 1, kind: 'micro', title: '10 minutes: Get the syllabus', bucket: 'now', origin: 'adapt', parent_step_id: 'b2', copy_key: 'micro' }, 1),
        s({ id: 'b1', goal_id: 'g2', position: 0, kind: 'task', title: 'Check the official NEET-UG dates and who can sit', status: 'done', progress: 100, bucket: 'done', done_by: 'evidence', refs: [{ kind: 'exam', slug: 'neet-ug', name: 'NEET-UG' }] }),
        s({ id: 'b2', goal_id: 'g2', position: 1, kind: 'task', title: 'Get the syllabus and mark your weak topics', bucket: 'now', progress: 10, status: 'doing' }, 6),
        s({ id: 'b3', goal_id: 'g2', position: 2, kind: 'course', title: 'Start learning: Biology basics', detail: 'https://swayam.gov.in', bucket: 'next', copy_key: 'course' }, 13),
        s({ id: 'b4', goal_id: 'g2', position: 3, kind: 'community', title: 'Ask a senior on this path one question', bucket: 'next', copy_key: 'community', refs: [{ kind: 'community', slug: 'neet-ug' }] }, 20),
        s({ id: 'e1', goal_id: 'g2', position: 4, kind: 'exam', ref_id: 'neet-ug', title: 'Take NEET-UG', bucket: 'later', hard_deadline: true, at_risk: true, copy_key: 'exam', refs: [{ kind: 'exam', slug: 'neet-ug', name: 'NEET-UG' }] }, 21),
      ],
    },
  ],
  changes: [
    { id: 'c1', kind: 'split', reason_code: 'split_worry', reason: 'You said this feels like a lot, so we made it smaller.', params: { step: 'Get the syllabus and mark your weak topics' }, created_at: new Date().toISOString(), can_undo: true },
    { id: 'c2', kind: 'evidence', reason_code: 'evidence_scheme_viewed', reason: 'Saathi noticed you opened this scheme.', params: { steps: ['Apply: PM YASASVI scholarship'] }, created_at: new Date().toISOString(), can_undo: true },
  ],
  watches: [{ id: 'w1', kind: 'exam', ref: 'neet-ug', label: 'NEET-UG' }, { id: 'w2', kind: 'skill', ref: 'electrician|nashik', label: 'electrician' }],
  alerts: [{ id: 'n1', kind: 'roadmap_exam', title: 'NEET-UG usually happens in May', body: 'Check the official site for the form dates.', link: '/app/exams/neet-ug', created_at: new Date().toISOString() }],
}
sampleRoadmap.next = { ...sampleRoadmap.goals[1].steps[0], goal_title: 'NEET-UG 2027', goal_kind: 'exam' }
