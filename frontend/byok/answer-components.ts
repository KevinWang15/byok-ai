import type { ComponentType } from 'react'

// Components the model may place in an answer: charts, cards, whatever the host defines. The model
// writes one as a fenced block whose info string names it, with its props as one JSON object:
//
//   ```component:<name>
//   {"title": "…"}
//   ```
//
// The fence is Markora's component syntax (markora-extension-components), so answers render with
// the same engine as documents that embed components. The host defines each component; this
// library only tells the model about them and renders them. Props are model output, which can be
// steered by tool results: `parse` checks them, and `render` must treat them as untrusted data
// (text, never HTML or URLs it loads).

export interface AnswerComponent<Props extends Record<string, unknown> = Record<string, unknown>> {
  /** What the model writes after `component:`. Lower-case kebab case, up to 100 characters. */
  name: string
  /** A short name for people, shown while the component is being written. */
  label: string
  /** For the model: what the component shows, and when to use it. */
  description: string
  /** JSON Schema of the props object, for the model. */
  schema: Record<string, unknown>
  /** Props the model can copy the shape of. */
  example: Props
  /** Checks props and returns them, or throws an Error saying what is wrong. Pure and synchronous. */
  parse: (value: unknown) => Props
  render: ComponentType<{ props: Props }>
}

/** Types an answer component's props through `parse` and `render`. */
export const defineAnswerComponent = <Props extends Record<string, unknown>>(component: AnswerComponent<Props>) =>
  component as unknown as AnswerComponent

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Throws when names are not kebab case, too long, or used twice. */
export function checkAnswerComponents(components: readonly AnswerComponent[]) {
  const names = new Set<string>()
  for (const { name } of components) {
    if (!NAME.test(name) || name.length > 100) throw new Error(`Answer component names are lower-case kebab case, up to 100 characters: "${name}"`)
    if (names.has(name)) throw new Error(`Two answer components are named "${name}"`)
    names.add(name)
  }
}

/**
 * What the model is told about `components`, to add to its system prompt; '' when there are none.
 * AskAIProvider adds it on its own (`componentInstructions`); call it when you build the prompt
 * for `createBrowserAdapter` yourself.
 */
export function answerComponentInstructions(components: readonly AnswerComponent[]): string {
  if (components.length === 0) return ''
  const entries = components.map(component => [
    `## ${component.name}`,
    component.description,
    `Props (JSON Schema): ${JSON.stringify(component.schema)}`,
    `Example:\n${fence(component.name, component.example)}`,
  ].join('\n'))
  return `# Components in answers
Besides Markdown, an answer can show these components. Write one as a fenced block: three backticks and "component:" with its name, then its props as one JSON object, then three backticks.
- Use one only where it shows something better than text would, next to the text it supports; never only to decorate.
- Fill its props with values you have (from tool results, or what the user gave); never invent data to fill one.
- The props must match the component's schema exactly, as strict JSON: no comments, no trailing commas.
- Only the components listed here exist.

${entries.join('\n\n')}`
}

const fence = (name: string, props: unknown) => '```component:' + name + '\n' + JSON.stringify(props) + '\n```'

/**
 * Splits text being streamed before a component fence that is still open, so a half-written
 * component isn't rendered: `shown` is the text before it, `pending` the component's name.
 */
export function splitOpenComponent(markdown: string): { shown: string; pending: string | null } {
  let open: { at: number; marker: string; name: string | null } | null = null
  let at = 0
  for (const line of markdown.split('\n')) {
    const fenceLine = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fenceLine) {
      const [, marker, info] = fenceLine
      if (!open) {
        if (!(marker[0] === '`' && info.includes('`'))) open = { at, marker, name: /^\s*component:([a-z0-9-]+)\s*$/.exec(info)?.[1] ?? null }
      } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && !info.trim()) open = null
    }
    at += line.length + 1
  }
  if (!open?.name) return { shown: markdown, pending: null }
  return { shown: markdown.slice(0, open.at).trimEnd(), pending: open.name }
}
