import type { ProfileData } from './types'

/** Sample profile used in dev (and tests) while the endpoint does not exist yet. */
export const sampleProfile: ProfileData = {
  facts: [
    { key: 'class_level', value: 12, label: { en: 'Class', hi: 'कक्षा', mr: 'इयत्ता' }, group: 'study', source: 'onboarding', at: '2026-11-20T09:00:00Z', note: null, sensitive: false },
    { key: 'district', value: 'Satara', label: { en: 'District', hi: 'ज़िला', mr: 'जिल्हा' }, group: 'basics', source: 'onboarding', at: '2026-11-20T09:00:00Z', note: null, sensitive: false },
    { key: 'marks_percent', value: 72, label: { en: 'Marks (%)', hi: 'अंक (%)', mr: 'गुण (%)' }, group: 'study', source: 'teacher', at: '2026-11-21T10:00:00Z', note: 'Marks from the unit test sheet', sensitive: false },
    { key: 'interests', value: ['farming', 'repairing things'], label: { en: 'Interests', hi: 'रुचियाँ', mr: 'आवड' }, group: 'interests', source: 'saathi', at: '2026-11-21T11:30:00Z', note: 'I like fixing the water pump at home and helping in the field.', sensitive: false },
    { key: 'hours_per_week', value: 8, label: { en: 'Hours a week', hi: 'हफ़्ते में घंटे', mr: 'आठवड्यात तास' }, group: 'work', source: 'saathi', at: '2026-11-21T11:31:00Z', note: null, sensitive: false },
    { key: 'family_income_annual', value: 200000, label: { en: 'Family income', hi: 'परिवार की आमदनी', mr: 'कुटुंबाचे उत्पन्न' }, group: 'money', source: 'onboarding', at: '2026-11-20T09:05:00Z', note: null, sensitive: true },
    { key: 'social_category', value: 'obc', label: { en: 'Category', hi: 'श्रेणी', mr: 'प्रवर्ग' }, group: 'personal', source: 'onboarding', at: '2026-11-20T09:06:00Z', note: null, sensitive: true },
  ],
  interests: {
    riasec: { R: 82, I: 64, A: 30, S: 55, E: 40, C: 35 },
    top: ['R', 'I'],
    labels: {},
    tags: ['machines', 'outdoors'],
    quiz_done: true,
  },
  skills: ['pump repair'],
  subjects: ['Physics', 'Maths'],
  saved_careers: [
    { slug: 'electrician', name: 'Electrician' },
    { slug: 'agri-officer', name: 'Agriculture officer' },
  ],
  plans: [{ id: 'p1', career_slug: 'electrician', title: 'ITI Electrician', done: 2, total: 6 }],
  money: { eligible_inr: 48000, eligible: [{ slug: 'post-matric-obc', name: 'Post Matric Scholarship (OBC)' }], needs_info: 2 },
  credentials: [{ public_id: 'abc123', skill: 'Wiring a switchboard', issued_at: '2026-11-18T00:00:00Z' }],
  graph: {
    nodes: [
      { id: 'me', type: 'me', label: 'You' },
      { id: 'fact:interests', type: 'interest', label: 'Repairing things' },
      { id: 'fact:marks_percent', type: 'fact', label: '72% marks' },
      { id: 'skill:pump', type: 'skill', label: 'Pump repair' },
      { id: 'career:electrician', type: 'career', label: 'Electrician' },
      { id: 'career:agri-officer', type: 'career', label: 'Agriculture officer' },
      { id: 'course:iti-electrician', type: 'course', label: 'ITI Electrician' },
      { id: 'scheme:post-matric-obc', type: 'scheme', label: 'Post Matric (OBC)' },
    ],
    edges: [
      { from: 'me', to: 'fact:interests', label: 'told Saathi' },
      { from: 'me', to: 'fact:marks_percent' },
      { from: 'me', to: 'skill:pump' },
      { from: 'fact:interests', to: 'career:electrician', label: 'fits' },
      { from: 'skill:pump', to: 'career:electrician' },
      { from: 'fact:marks_percent', to: 'career:agri-officer' },
      { from: 'career:electrician', to: 'course:iti-electrician' },
      { from: 'course:iti-electrician', to: 'scheme:post-matric-obc' },
    ],
  },
  completeness: { pct: 64, next: [{ field: 'gender', why: 'Some scholarships are only for girls, so we need this to check.' }, { field: 'is_disabled', why: 'Some schemes give extra help.' }] },
}
