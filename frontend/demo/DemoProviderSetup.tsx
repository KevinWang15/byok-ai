import { useId, useState } from 'react'
import { Button, Field, Fieldset, Input, Label, Legend } from '@headlessui/react'
import { useAskAI, type ProviderPreset, type ProviderValues } from '../byok'
import { DemoIcon } from './DemoIcon'

/** Consumer-owned layout using the library's provider contracts and connection actions. */
export function DemoProviderSetup() {
  const { providers, connection, connect, disconnect, setPage, busy } = useAskAI()
  const [selected, setSelected] = useState<ProviderPreset | undefined>(connection?.provider)
  const [values, setValues] = useState<ProviderValues>(connection?.values ?? {})
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const choiceId = useId()
  const CustomForm = selected?.Form
  const choose = (provider?: ProviderPreset) => {
    setSelected(provider)
    setValues(provider && connection && provider.id === connection.provider.id ? { ...connection.values } : { ...provider?.defaultValues })
    setVisibleFields({})
    setError('')
  }
  return <section className="demo-provider-settings" aria-label="Provider configuration">
    <h2>{selected ? connection ? 'Provider settings' : 'Connect your provider' : 'Choose an AI provider'}</h2>
    <p className="provider-intro">{selected ? 'Choose the model and credentials this assistant uses.' : 'Use your own account to connect a model.'}</p>
    {selected ? <>
      <div className="provider-choice">
        <span className="provider-choice-icon"><DemoIcon name="tools" size={20} /></span>
        <div><strong>{selected.name}</strong><span>{connection?.provider.id === selected.id ? 'Current provider' : 'New connection'}</span></div>
        <Button type="button" className="provider-change" disabled={busy} onClick={() => choose()}>Change provider</Button>
      </div>
      <p className="provider-description">{selected.description}</p>
      <form onSubmit={event => {
        event.preventDefault()
        setError(connect(selected, values) ?? '')
      }}>
        <Fieldset disabled={busy}>
          <Legend className="demo-sr-only">Provider credentials</Legend>
          {CustomForm ? <CustomForm values={values} onChange={setValues} /> : selected.fields?.map(field => <Field key={field.name} className="provider-field">
            <div className="provider-field-label"><Label>{field.label}</Label>{!field.required && <span>Optional</span>}</div>
            <div className="provider-input-wrap">
              <Input autoComplete="off" spellCheck={false} required={field.required} placeholder={field.placeholder}
                type={field.type === 'password' && visibleFields[field.name] ? 'text' : field.type ?? 'text'}
                data-secret={field.type === 'password' || undefined}
                value={values[field.name] ?? ''} onChange={event => setValues({ ...values, [field.name]: event.target.value })} />
              {field.type === 'password' && <Button type="button" className="provider-reveal"
                aria-label={`${visibleFields[field.name] ? 'Hide' : 'Show'} ${field.label}`} aria-pressed={Boolean(visibleFields[field.name])}
                onClick={() => setVisibleFields({ ...visibleFields, [field.name]: !visibleFields[field.name] })}>
                <DemoIcon name={visibleFields[field.name] ? 'eyeOff' : 'eye'} size={16} />
              </Button>}
            </div>
          </Field>)}
        </Fieldset>
        {error && <p role="alert">{error}</p>}
        <p className="provider-storage-note"><DemoIcon name="storage" size={15} /><span>Settings, including your API key, are saved in this browser’s localStorage.</span></p>
        <div className="provider-actions">
          {connection && <Button type="button" className="provider-cancel" disabled={busy} onClick={() => setPage('chat')}>Cancel</Button>}
          <Button type="submit" className="provider-save" disabled={busy}>{connection ? 'Save changes' : 'Connect provider'}<DemoIcon name="arrow" size={15} /></Button>
        </div>
      </form>
    </> : <ul className="provider-options">{providers.map((provider, index) => <li key={provider.id}>
      <Button type="button" disabled={busy} aria-label={provider.name} aria-describedby={choiceId + '-' + index} onClick={() => choose(provider)}>
        <span><strong>{provider.name}</strong><span id={choiceId + '-' + index}>{provider.description}</span></span><DemoIcon name="chevron" size={16} />
      </Button>
    </li>)}</ul>}
    {connection && <div className="provider-disconnect">
      <div><strong>Remove connection</strong><p>Remove the saved key. Keep your conversations.</p></div>
      <Button type="button" disabled={busy} onClick={disconnect}>Disconnect provider</Button>
    </div>}
  </section>
}
