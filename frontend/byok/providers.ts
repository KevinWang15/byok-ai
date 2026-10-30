import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { ProviderPreset } from './types'

const fields: NonNullable<ProviderPreset['fields']> = [
  { name: 'apiKey', label: 'API key', type: 'password', placeholder: 'Paste your API key', required: true },
  { name: 'model', label: 'Model', placeholder: 'Model ID', required: true },
]
export const defaultProviders: ProviderPreset[] = [
  {
    id: 'openai', name: 'OpenAI', description: 'Connect directly with your OpenAI API key.',
    defaultValues: { model: 'gpt-4.1-mini' }, fields,
    createModel: v => createOpenAI({ apiKey: v.apiKey })(v.model),
  },
  {
    id: 'anthropic', name: 'Anthropic', description: 'Claude, with direct browser access explicitly enabled.',
    defaultValues: { model: 'claude-sonnet-4-5' }, fields,
    createModel: v => createAnthropic({ apiKey: v.apiKey, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(v.model),
  },
  {
    id: 'google', name: 'Google Gemini', description: 'Use your Google AI Studio key.',
    defaultValues: { model: 'gemini-2.5-flash' }, fields,
    createModel: v => createGoogleGenerativeAI({ apiKey: v.apiKey })(v.model),
  },
  {
    id: 'compatible', name: 'OpenAI compatible', description: 'Your own endpoint, local model, or gateway. Browser CORS support is required.',
    defaultValues: { model: '', baseURL: '' }, fields: [
      { name: 'baseURL', label: 'API base URL', type: 'url', placeholder: 'https://your-provider.example/v1', required: true },
      ...fields.map(f => f.name === 'apiKey' ? { ...f, required: false } : f),
    ],
    validate: v => {
      try {
        const u = new URL(v.baseURL)
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) return 'Use HTTPS, or HTTP for localhost.'
      } catch { return 'Enter a valid API base URL.' }
    },
    createModel: v => createOpenAI({ apiKey: v.apiKey || 'local', baseURL: v.baseURL }).chat(v.model),
  },
]
