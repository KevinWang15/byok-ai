import assert from 'node:assert/strict'
import test from 'node:test'
import { answerComponentInstructions, checkAnswerComponents, defineAnswerComponent, splitOpenComponent } from '../frontend/byok/answer-components'

const card = defineAnswerComponent<{ title: string }>({
  name: 'stat-card', label: 'Figure', description: 'One figure.',
  schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
  example: { title: 'Open issues' },
  parse: value => { if (typeof (value as { title?: unknown }).title !== 'string') throw new Error('title'); return value as { title: string } },
  render: () => null,
})

test('the instructions name each component, its schema and an example fence; none without components', () => {
  assert.equal(answerComponentInstructions([]), '')
  const text = answerComponentInstructions([card])
  assert.match(text, /## stat-card\nOne figure\./)
  assert.ok(text.includes('Props (JSON Schema): {"type":"object","required":["title"]'))
  assert.ok(text.includes('```component:stat-card\n{"title":"Open issues"}\n```'), 'the example is the fence to write')
  assert.match(text, /never invent data/)
})

test('component names are kebab case and unique', () => {
  checkAnswerComponents([card])
  assert.throws(() => checkAnswerComponents([{ ...card, name: 'Stat_Card' }]), /kebab case/)
  assert.throws(() => checkAnswerComponents([card, card]), /Two answer components are named "stat-card"/)
})

test('while streaming, a component whose fence is still open is held back', () => {
  const done = 'Text\n\n```component:stat-card\n{"title":"A"}\n```\n\nMore'
  assert.deepEqual(splitOpenComponent(done), { shown: done, pending: null }, 'closed: shown whole')
  assert.deepEqual(splitOpenComponent('Text\n\n```component:stat-card\n{"tit'), { shown: 'Text', pending: 'stat-card' })
  assert.deepEqual(splitOpenComponent('Text\n\n```component:stat-card'), { shown: 'Text', pending: 'stat-card' }, 'just the opening line')
  const code = 'Text\n\n```ts\nconst a = 1'
  assert.deepEqual(splitOpenComponent(code), { shown: code, pending: null }, 'an open code block is ordinary text')
  const inCode = '````md\n```component:stat-card\n{}\n```\n'
  assert.deepEqual(splitOpenComponent(inCode), { shown: inCode, pending: null }, 'a fence inside a longer one is code')
  assert.deepEqual(splitOpenComponent('~~~component:stat-card\n{"a":'), { shown: '', pending: 'stat-card' }, 'tildes too')
})
