import { defineAnswerComponent } from '../byok'

// The demo's answer component: a figure with its label. Props come from the model, so they are
// checked here and shown only as text.
type StatCard = { label: string; value: string; note?: string }

export const statCard = defineAnswerComponent<StatCard>({
  name: 'stat-card',
  label: 'Figure',
  description: 'One figure that matters, with a short label and an optional note. Use it for the headline number of an answer.',
  schema: {
    type: 'object', additionalProperties: false, required: ['label', 'value'],
    properties: { label: { type: 'string', maxLength: 60 }, value: { type: 'string', maxLength: 30 }, note: { type: 'string', maxLength: 120 } },
  },
  example: { label: 'Open issues', value: '12', note: 'Down from 20 last week' },
  parse: value => {
    const props = value as Partial<StatCard>
    if (typeof props.label !== 'string' || typeof props.value !== 'string') throw new Error('label and value are text')
    if (props.note !== undefined && typeof props.note !== 'string') throw new Error('note is text')
    return { label: props.label.slice(0, 60), value: props.value.slice(0, 30), ...(props.note ? { note: props.note.slice(0, 120) } : {}) }
  },
  render: ({ props }) => <figure className="demo-stat-card">
    <figcaption>{props.label}</figcaption>
    <strong>{props.value}</strong>
    {props.note && <span>{props.note}</span>}
  </figure>,
})

export const DEMO_COMPONENTS = [statCard]
