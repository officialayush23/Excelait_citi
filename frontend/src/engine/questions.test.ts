import { describe, expect, it } from 'vitest'

import fixtures from '@shared/rules/question_fixtures.json'

import { applyAnswer, nextQuestions, scoreQuiz, quiz } from './questions'

type Step = { id: string; tier: string; options: unknown[] }

function simulate(start: Record<string, unknown>, answers: Record<string, unknown>): Step[] {
  let facts: Record<string, unknown> = { ...start }
  const skip: string[] = []
  const seq: Step[] = []
  for (let i = 0; i < 40; i++) {
    const r = nextQuestions(facts, 'onboarding', 1, { skip })
    const q = r.questions[0]
    if (!q) break
    seq.push({ id: q.id, tier: q.tier, options: q.options.map((o) => o.value) })
    if (q.field in answers) facts = { ...facts, ...applyAnswer(q.field, answers[q.field], facts) }
    else skip.push(q.field)
  }
  return seq
}

describe('question planner matches the Python planner exactly', () => {
  for (const p of fixtures.personas) {
    it(p.name, () => {
      expect(simulate(p.start as Record<string, unknown>, p.answers as Record<string, unknown>)).toEqual(p.expect)
    })
  }
})

describe('interest quiz', () => {
  it('scores each type out of 100', () => {
    const answers = Object.fromEntries(quiz.items.map((i) => [i.id, 'SC'.includes(i.code) ? 2 : 0]))
    expect(scoreQuiz(answers)).toEqual({ R: 0, I: 0, A: 0, S: 100, E: 0, C: 100 })
    expect(scoreQuiz({})).toEqual({ R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 })
  })
  it('stage answers also set class and course', () => {
    expect(applyAnswer('stage', 'c10')).toEqual({ stage: 'c10', class_level: 10, course: 'school' })
  })
})
