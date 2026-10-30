import { test, expect } from '@playwright/test'
test('setup, browser streaming, history, settings, reload and deletion', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://model.example/v1/chat/completions', route => {
    expect(route.request().headers().authorization).toBe('Bearer test-key-private')
    const chunks = [
      { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello from your browser.' }, finish_reason: null }] },
      { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    return route.fulfill({ contentType: 'text/event-stream', body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' })
  })
  const connect = async () => {
    await page.getByRole('button', { name: /OpenAI compatible/ }).click()
    await page.getByLabel('API base URL').fill('https://model.example/v1')
    await page.getByLabel('API key', { exact: true }).fill('test-key-private')
    await page.getByLabel('Model', { exact: true }).fill('test')
    await page.getByRole('button', { name: 'Connect provider' }).click()
  }
  await page.goto('/')
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await connect()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello there')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Provider settings' }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await page.getByRole('button', { name: /Hello there/ }).first().click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toContain('test-key-private')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A saved draft')
  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await expect(page.getByText('Choose an AI provider')).toHaveCount(0)
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('A saved draft')
  await page.getByRole('button', { name: 'Provider settings' }).click()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('test-key-private')
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('test')
  await expect(page.getByLabel('API base URL')).toHaveValue('https://model.example/v1')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await page.getByRole('button', { name: 'Delete Hello there' }).click()
  await page.getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Delete Hello there' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close assistant' }).click()
  await expect(page.getByRole('button', { name: 'Open Ask AI' })).toBeFocused()
  expect(errors).toEqual([])
})
test('assistant answers can be copied and regenerated, and the regenerated answer is kept', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  let calls = 0
  const prompts: unknown[] = []
  await page.route('https://model.example/v1/chat/completions', route => {
    prompts.push(route.request().postDataJSON().messages)
    const text = ++calls === 1 ? 'First answer.' : 'Second answer.'
    const chunks = [
      { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
      { id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    return route.fulfill({ contentType: 'text/event-stream', body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await page.getByRole('button', { name: /OpenAI compatible/ }).click()
  await page.getByLabel('API base URL').fill('https://model.example/v1')
  await page.getByLabel('Model', { exact: true }).fill('test')
  await page.getByRole('button', { name: 'Connect provider' }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Question')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('First answer.', { exact: true })).toBeVisible()

  const actions = page.locator('[data-byok="message-actions"]')
  await expect(actions).toHaveCount(1)
  await actions.getByRole('button', { name: 'Copy' }).click()
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('First answer.')

  await actions.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Second answer.', { exact: true })).toBeVisible()
  await expect(page.getByText('First answer.', { exact: true })).toHaveCount(0)
  // The model is asked the same question again, without the answer being replaced.
  expect(JSON.stringify(prompts[1])).toBe(JSON.stringify(prompts[0]))

  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await expect(page.getByText('Second answer.', { exact: true })).toBeVisible()
  await expect(page.getByText('First answer.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Question', { exact: true })).toHaveCount(1)
  expect(errors).toEqual([])
})
test('widget fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  const bounds = await page.getByRole('dialog').boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
})

test('Headless UI manages dialog focus, Escape, and outside-click dismissal', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Open Ask AI' })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.mouse.click(5, 5)
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('custom UI uses the headless provider without a wrapper or default widget', async ({ page }) => {
  await page.goto('/')
  const custom = page.getByRole('region', { name: 'Custom headless example' })
  expect(await custom.evaluate(el => el.parentElement?.tagName)).toBe('MAIN')
  await custom.getByLabel('OpenAI API key').fill('test-persisted-key')
  await custom.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(custom.getByText(/Connected to OpenAI/)).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toContain('test-persisted-key')
  await page.reload()
  await expect(custom.getByText(/Connected to OpenAI/)).toBeVisible()
  await custom.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(custom.getByLabel('OpenAI API key')).toHaveValue('')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-persisted-key')
  await page.reload()
  await expect(custom.getByLabel('OpenAI API key')).toHaveValue('')
})

test('assistants sharing a connection key connect and disconnect together, in this tab and others', async ({ page, context }) => {
  await page.goto('/')
  const shared = page.getByRole('region', { name: 'Shared connection example' })
  const first = shared.getByRole('article', { name: 'First assistant' })
  const second = shared.getByRole('article', { name: 'Second assistant' })
  await first.getByLabel('Shared OpenAI key').fill('shared-test-key')
  await first.getByRole('button', { name: 'Connect' }).click()
  await expect(second.getByText(/Connected to OpenAI/)).toBeVisible()
  const other = await context.newPage()
  await other.goto('/')
  const otherSecond = other.getByRole('region', { name: 'Shared connection example' }).getByRole('article', { name: 'Second assistant' })
  await expect(otherSecond.getByText(/Connected to OpenAI/)).toBeVisible()
  await otherSecond.getByRole('button', { name: 'Disconnect' }).click()
  await expect(first.getByLabel('Shared OpenAI key')).toBeVisible()
  await expect(second.getByLabel('Shared OpenAI key')).toBeVisible()
  // Each keeps its own conversations; only the connection key holds the key.
  const stored = await page.evaluate(() => ({ ...localStorage }))
  expect(JSON.stringify(stored)).not.toContain('shared-test-key')
})

test('disconnecting from provider settings clears the setup fields', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click()
  await page.getByLabel('API key', { exact: true }).fill('test-forget-this-key')
  await page.getByRole('button', { name: 'Connect provider' }).click()
  await page.getByRole('button', { name: 'Provider settings' }).click()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('test-forget-this-key')
  await page.getByRole('button', { name: 'Disconnect provider' }).click()
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-forget-this-key')
  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await expect(page.getByText('Choose an AI provider')).toBeVisible()
})

test('default Markdown and custom headless Markdown render stored messages safely', async ({ page }) => {
  const markdown = [
    '## Markdown works',
    '',
    '**Strong text** and *emphasis* with ~~removed~~.',
    '',
    '- First item',
    '- Second item',
    '',
    '- [x] Task done',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| Example | 42 |',
    '',
    '[Documentation](https://example.com/docs)',
    '',
    '`inline code`',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '<script>window.__markdownExecuted = true</script>',
    '',
    '[Unsafe](javascript:alert(1))',
  ].join('\n')
  await page.addInitScript(({ markdown }) => {
    const conversation = { id: 'markdown-chat', title: 'Markdown test', updatedAt: 1, messages: [{
      id: 'answer', role: 'assistant', createdAt: new Date().toISOString(),
      content: [{ type: 'text', text: markdown }],
      status: { type: 'complete', reason: 'stop' },
      metadata: { custom: {} },
    }] }
    const state = { version: 2, connection: { providerId: 'openai', values: { apiKey: 'test-only', model: 'test' } },
      conversations: [conversation], activeConversationId: conversation.id }
    for (const key of ['byok-ai:conversations:v1', 'byok-ai:headless-demo:v1']) localStorage.setItem(key, JSON.stringify(state))
  }, { markdown })
  await page.goto('/')
  const custom = page.getByRole('region', { name: 'Custom headless example' })
  await expect(custom.locator('[data-demo-heading="custom"]')).toHaveText('Markdown works')
  await expect(custom.getByRole('link', { name: 'Documentation' })).toHaveAttribute('target', '_blank')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Markdown works', level: 2 })).toBeVisible()
  await expect(dialog.locator('strong').filter({ hasText: 'Strong text' })).toBeVisible()
  await expect(dialog.locator('em')).toHaveText('emphasis')
  await expect(dialog.locator('del')).toHaveText('removed')
  await expect(dialog.getByRole('cell', { name: '42', exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await expect(dialog.locator('pre code')).toContainText('const answer = 42;')
  await expect(dialog.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://example.com/docs')
  await expect(dialog.locator('script')).toHaveCount(0)
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0)
  expect(await page.evaluate(() => '__markdownExecuted' in window)).toBe(false)
})

test('consumer layout separates speakers and collapses adjacent tool calls', async ({ page }) => {
  await page.addInitScript(() => {
    const date = new Date().toISOString()
    const conversation = { id: 'tools-demo', title: 'Summarize the workspace', updatedAt: 1, messages: [
      { id: 'user', role: 'user', createdAt: date, content: [{ type: 'text', text: 'Create a table using what you learned from the workspace.' }], attachments: [], metadata: { custom: {} } },
      { id: 'assistant', role: 'assistant', createdAt: date, status: { type: 'complete', reason: 'stop' }, metadata: { custom: {} }, content: [
        { type: 'text', text: 'I checked the workspace documentation. Here’s a quick overview of what you can build.' },
        ...['search_docs', 'search_docs', 'get_current_time'].map((name, i) => ({ type: 'tool-call', toolCallId: 't' + i, toolName: 'workspace__' + name, args: { query: 'providers' }, argsText: '{"query":"providers"}', result: { content: [{ type: 'text', text: 'Workspace documentation retrieved.' }] } })),
        { type: 'text', text: '### Your workspace, at a glance\n\n| Capability | What it does |\n| --- | --- |\n| Providers | Connect your preferred AI model |\n| MCP tools | Search docs and access workspace context |\n| Conversations | Keep your history and drafts on this browser |\n\nYou can extend any of these through the **headless API**.' },
      ] },
    ] }
    localStorage.setItem('byok-ai:conversations:v1', JSON.stringify({ version: 2, connection: { providerId: 'compatible', values: { model: 'gpt-4.1-mini', baseURL: 'https://model.example/v1', apiKey: 'test-only' } }, conversations: [conversation], activeConversationId: conversation.id }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-role="user"]')).toHaveCount(1)
  await expect(dialog.locator('[data-role="assistant"]')).toHaveCount(1)
  await expect(dialog.locator('header button')).toHaveCount(5)
  const group = dialog.getByRole('button', { name: /Used connected tools/ })
  await expect(group).toHaveCount(1)
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.getByRole('heading', { name: 'Your workspace, at a glance' })).toBeVisible()
  await group.click()
  await expect(dialog.locator('.chat-tool-row')).toHaveCount(3)
  await dialog.locator('.chat-tool-row').first().click()
  await expect(dialog.getByText('Workspace documentation retrieved.', { exact: false })).toBeVisible()
  await group.click()
  await expect(dialog.locator('.chat-tool-list')).toBeHidden()
  await dialog.locator('[data-byok="messages"]').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: 'test-results/conversation-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  const shell = await dialog.boundingBox()
  const composer = await dialog.locator('.chat-compose').boundingBox()
  expect(composer!.y + composer!.height).toBeLessThan(shell!.y + shell!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/conversation-mobile.png' })
})

test('thinking-orbs follow the live agent and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('byok-ai:conversations:v1', JSON.stringify({ version: 2,
      connection: { providerId: 'compatible', values: { apiKey: 'orb-test', model: 'test', baseURL: 'https://model.example/v1' } }, conversations: [] }))
  })
  let releaseModel!: () => void
  let releaseTool!: () => void
  const modelGate = new Promise<void>(resolve => { releaseModel = resolve })
  const toolGate = new Promise<void>(resolve => { releaseTool = resolve })
  let requests = 0
  await page.route('https://model.example/v1/chat/completions', async route => {
    const first = requests++ === 0
    if (first) await modelGate
    const chunks = first ? [
      { id: 'orbs', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'orb-tool', type: 'function', function: { name: 'workspace__search_docs', arguments: '{"query":"providers"}' } }] }, finish_reason: null }] },
      { id: 'orbs', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ] : [
      { id: 'orbs', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Found the provider documentation.' }, finish_reason: null }] },
      { id: 'orbs', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    await route.fulfill({ contentType: 'text/event-stream', body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' })
  })
  await page.route('**/api/mcp', async route => {
    if (route.request().postDataJSON()?.method === 'tools/call') await toolGate
    await route.continue()
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Open Ask AI' }).click()
    const dialog = page.getByRole('dialog')
    const orb = dialog.locator('.chat-header-orb .demo-thinking-orb')
    await expect(orb).toHaveAttribute('data-orb-state', 'idle')
    await expect(orb).toHaveAttribute('data-orb-shape', 'globe')
    await expect.poll(() => orb.evaluate((element: HTMLCanvasElement) => {
      const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
      return pixels.some((v, i) => i % 4 === 3 && v > 0)
    })).toBe(true)
    const staticFrame = await orb.evaluate((element: HTMLCanvasElement) => element.toDataURL())
    await page.waitForTimeout(150)
    expect(await orb.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(staticFrame)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Find the provider docs')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(orb).toHaveAttribute('data-orb-state', 'working')
    await page.getByRole('button', { name: 'Maximize chat', exact: true }).click()
    await expect(orb).toHaveAttribute('data-orb-state', 'working')
    releaseModel()
    await expect(orb).toHaveAttribute('data-orb-state', 'searching')
    await expect(dialog.locator('.chat-tool-summary .demo-thinking-orb')).toHaveAttribute('data-orb-state', 'searching')
    releaseTool()
    await expect(dialog.getByText('Found the provider documentation.', { exact: true })).toBeVisible()
    await expect(orb).toHaveAttribute('data-orb-state', 'idle')
    await expect(dialog.locator('.chat-avatar .demo-thinking-orb')).toHaveAttribute('data-orb-paused', 'true')
    await expect(dialog.locator('.chat-working')).toHaveCount(0)
  } finally {
    releaseModel()
    releaseTool()
  }
})

test('large demo orbs render at screen resolution and honor motion preferences', async ({ browser }) => {
  for (const deviceScaleFactor of [1, 2, 3]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor })
    const page = await context.newPage()
    try {
      await page.addInitScript(() => localStorage.setItem('byok-ai:conversations:v1', JSON.stringify({ version: 2,
        connection: { providerId: 'compatible', values: { apiKey: 'test', model: 'test', baseURL: 'https://model.example/v1' } }, conversations: [] })))
      await page.goto('/')
      const preview = page.locator('.demo-orb-halo canvas')
      const pixels = await preview.evaluate((canvas: HTMLCanvasElement) => ({
        actual: canvas.width, required: Math.ceil(canvas.getBoundingClientRect().width * devicePixelRatio),
      }))
      expect(pixels.actual).toBeGreaterThanOrEqual(pixels.required)
      const firstFrame = await preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
      await expect.poll(() => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(firstFrame)
      await page.getByRole('button', { name: 'Open Ask AI' }).click()
      const welcome = page.locator('.chat-empty-orb canvas')
      await expect(welcome).toBeVisible()
      const welcomePixels = await welcome.evaluate((canvas: HTMLCanvasElement) => ({
        actual: canvas.width, required: Math.ceil(canvas.getBoundingClientRect().width * devicePixelRatio),
      }))
      expect(welcomePixels.actual).toBeGreaterThanOrEqual(welcomePixels.required)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(100)
      const still = await welcome.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
      await page.waitForTimeout(150)
      expect(await welcome.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(still)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect.poll(() => welcome.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(still)
    } finally { await context.close() }
  }
})

test('history shows activity dates and confirms deletion without changing dates on view', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const now = Date.UTC(2026, 9, 30, 12)
  await page.clock.install({ time: new Date(now) })
  await page.addInitScript(({ now }) => {
    if (localStorage.getItem('history-test-initialized')) return
    localStorage.setItem('history-test-initialized', 'true')
    const conversations = [
      { id: 'older', title: 'Provider integration', updatedAt: now - 3 * 86400_000 },
      { id: 'recent', title: 'Available tools', updatedAt: now - 225_000 },
      { id: 'yesterday', title: 'Markdown rendering', updatedAt: now - 86400_000 },
    ].map(c => ({ ...c, messages: [
      { id: c.id + '-user', role: 'user', createdAt: new Date(c.updatedAt).toISOString(), content: [{ type: 'text', text: c.title }], attachments: [], metadata: { custom: {} } },
      { id: c.id + '-reply', role: 'assistant', createdAt: new Date(c.updatedAt).toISOString(), content: [{ type: 'text', text: 'Here is the documentation for ' + c.title + '.' }], status: { type: 'complete', reason: 'stop' }, metadata: { custom: {} } },
    ] }))
    localStorage.setItem('byok-ai:conversations:v1', JSON.stringify({ version: 2, activeConversationId: 'recent', conversations,
      connection: { providerId: 'compatible', values: { apiKey: 'test', model: 'test', baseURL: 'https://model.example/v1' } } }))
  }, { now })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await page.getByRole('button', { name: 'Conversation history' }).click()
  const history = page.locator('[data-byok="history"]')
  await expect(history.locator('[data-byok="history-title"]')).toHaveText(['Available tools', 'Markdown rendering', 'Provider integration'])
  await expect(history.locator('time')).toHaveText(['3 minutes ago', '1 day ago', '3 days ago'])
  await expect(history.locator('time').first()).toHaveAttribute('datetime', new Date(now - 225_000).toISOString())
  await expect(history.locator('[aria-current="true"]')).toContainText('Available tools')
  await page.clock.fastForward(60_000)
  await expect(history.locator('time').first()).toHaveText('4 minutes ago')
  await page.screenshot({ path: 'test-results/history-desktop.png' })

  await history.getByRole('button', { name: /^Provider integration/ }).click()
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await expect(history.locator('time').last()).toHaveText('3 days ago')
  await expect(history.locator('[aria-current="true"]')).toContainText('Provider integration')
  await page.getByRole('button', { name: 'Delete Provider integration', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete conversation?', exact: true })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: 'Keep conversation' })).toBeFocused()
  await expect(confirmation).toContainText('Provider integration')
  await confirmation.getByRole('button', { name: 'Keep conversation' }).click()
  await expect(confirmation).toBeHidden()
  await expect(page.getByRole('button', { name: 'Delete Provider integration', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Delete Provider integration', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete Provider integration', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/history-delete-mobile.png' })
  await confirmation.getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await expect(confirmation).toBeHidden()
  await expect(history.locator('[data-byok="history-title"]')).toHaveText(['Available tools', 'Markdown rendering'])
  await expect(history.getByRole('heading', { name: 'Conversations' })).toBeFocused()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('byok-ai:conversations:v1')!))
  expect(saved.conversations.some((c: { id: string }) => c.id === 'older')).toBe(false)
  expect(saved.conversations.find((c: { id: string }) => c.id === 'recent').updatedAt).toBe(now - 225_000)
  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await expect(history.locator('[data-byok="history-title"]')).toHaveText(['Available tools', 'Markdown rendering'])
  await page.screenshot({ path: 'test-results/history-mobile.png' })
})

test('demo chat resizes, maximizes, restores, and keeps its size and draft across reloads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    if (localStorage.getItem('byok-ai:conversations:v1')) return
    const conversation = { id: 'resize-draft', title: 'New conversation', updatedAt: Date.now(), messages: [], draft: 'Keep this draft while resizing' }
    localStorage.setItem('byok-ai:conversations:v1', JSON.stringify({ version: 2, activeConversationId: conversation.id, conversations: [conversation],
      connection: { providerId: 'compatible', values: { apiKey: 'test', model: 'test', baseURL: 'https://model.example/v1' } } }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  const shell = page.locator('.demo-chat-shell')
  const original = (await shell.boundingBox())!
  const grip = (await page.getByRole('button', { name: 'Resize chat', exact: true }).boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 - 180, grip.y + grip.height / 2 - 60, { steps: 8 })
  await page.mouse.up()
  const resized = (await shell.boundingBox())!
  expect(resized.width).toBeCloseTo(original.width + 180, 0)
  expect(resized.height).toBeCloseTo(original.height + 60, 0)
  expect(resized.x + resized.width).toBeCloseTo(original.x + original.width, 0)
  expect(resized.y + resized.height).toBeCloseTo(original.y + original.height, 0)
  await page.getByRole('button', { name: 'Resize chat width', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  const restoredSize = (await shell.boundingBox())!
  expect(restoredSize.width).toBeCloseTo(resized.width - 24, 0)
  await page.getByRole('button', { name: 'Maximize chat', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resize chat', exact: true })).toHaveCount(0)
  const maximized = (await shell.boundingBox())!
  expect(maximized.x).toBe(16)
  expect(maximized.y).toBe(16)
  expect(maximized.width).toBe(1440 - 32)
  expect(maximized.height).toBe(1000 - 32)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this draft while resizing')
  await page.screenshot({ path: 'test-results/chat-maximized-desktop.png' })
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  await expect(page.getByRole('button', { name: 'Restore chat size', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restore chat size', exact: true }).click()
  expect((await shell.boundingBox())!.width).toBeCloseTo(restoredSize.width, 0)
  expect((await shell.boundingBox())!.height).toBeCloseTo(restoredSize.height, 0)
  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI' }).click()
  expect((await shell.boundingBox())!.width).toBeCloseTo(restoredSize.width, 0)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this draft while resizing')
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = (await shell.boundingBox())!
  expect(mobile.x).toBeGreaterThanOrEqual(12)
  expect(mobile.y).toBeGreaterThanOrEqual(12)
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(378)
  expect(mobile.y + mobile.height).toBeLessThanOrEqual(832)
  await page.getByRole('button', { name: 'Maximize chat', exact: true }).click()
  const mobileMax = (await shell.boundingBox())!
  expect(mobileMax).toEqual({ x: 12, y: 12, width: 366, height: 820 })
  const composer = (await page.locator('.chat-compose').boundingBox())!
  expect(composer.y + composer.height).toBeLessThan(mobileMax.y + mobileMax.height)
  await page.screenshot({ path: 'test-results/chat-maximized-mobile.png' })
  await page.getByRole('button', { name: 'Restore chat size', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  expect((await shell.boundingBox())!.width).toBeCloseTo(restoredSize.width, 0)
  await page.getByRole('button', { name: 'Resize chat', exact: true }).focus()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowDown')
  expect((await shell.boundingBox())!.width).toBe(320)
  expect((await shell.boundingBox())!.height).toBe(320)
  await expect(page.getByRole('button', { name: 'Maximize chat', exact: true })).toBeInViewport()
})

test('floating launcher drags without opening, persists, and remains reachable after resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Open Ask AI', exact: true })
  const initial = (await trigger.boundingBox())!
  const start = { x: initial.x + initial.width / 2, y: initial.y + initial.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - 500, start.y - 300, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toBeHidden()
  const moved = (await trigger.boundingBox())!
  expect(moved.x).toBeCloseTo(initial.x - 500, 0)
  expect(moved.y).toBeCloseTo(initial.y - 300, 0)
  await page.reload()
  const restored = (await trigger.boundingBox())!
  expect(restored.x).toBeCloseTo(moved.x, 0)
  expect(restored.y).toBeCloseTo(moved.y, 0)
  await trigger.click()
  await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  expect((await trigger.boundingBox())!.x).toBeCloseTo(restored.x - 24, 0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  // Clamp at the viewport edge and don't interpret a completed drag as a click.
  const bounds = (await trigger.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(0, 0, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toBeHidden()
  const clamped = (await trigger.boundingBox())!
  expect(clamped.x).toBeCloseTo(12, 0)
  expect(clamped.y).toBeCloseTo(12, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = (await trigger.boundingBox())!
  expect(mobile.x).toBeGreaterThanOrEqual(11)
  expect(mobile.y).toBeGreaterThanOrEqual(11)
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(379)
  expect(mobile.y + mobile.height).toBeLessThanOrEqual(833)
  // A tiny pointer wobble is still a normal click.
  await page.mouse.move(mobile.x + mobile.width / 2, mobile.y + mobile.height / 2)
  await page.mouse.down()
  await page.mouse.move(mobile.x + mobile.width / 2 + 2, mobile.y + mobile.height / 2 + 2)
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
})

test('floating launcher supports touch drag and cancelled gestures', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  try {
    await page.goto('/')
    const trigger = page.getByRole('button', { name: 'Open Ask AI', exact: true })
    const session = await context.newCDPSession(page)
    const bounds = (await trigger.boundingBox())!
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 120, y: y - 240 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.getByRole('dialog')).toBeHidden()
    const moved = (await trigger.boundingBox())!
    expect(moved.x).toBeCloseTo(bounds.x - 120, 0)
    expect(moved.y).toBeCloseTo(bounds.y - 240, 0)
    const saved = await page.evaluate(() => localStorage.getItem('byok-ai:demo-launcher:v1'))
    const cx = moved.x + moved.width / 2
    const cy = moved.y + moved.height / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 50, y: cy - 100 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    expect((await trigger.boundingBox())!.x).toBeCloseTo(moved.x, 0)
    expect((await trigger.boundingBox())!.y).toBeCloseTo(moved.y, 0)
    expect(await page.evaluate(() => localStorage.getItem('byok-ai:demo-launcher:v1'))).toBe(saved)
    await trigger.tap()
    await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
  } finally { await context.close() }
})

test('launcher keeps its label and dimensions when dragged against the right edge', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const trigger = page.getByRole('button', { name: 'Open Ask AI', exact: true })
    const original = (await trigger.boundingBox())!
    await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2)
    await page.mouse.down()
    await page.mouse.move(width - 1, 200, { steps: 8 })
    const dragging = (await trigger.boundingBox())!
    expect(dragging.width).toBeCloseTo(original.width, 0)
    expect(dragging.height).toBeCloseTo(original.height, 0)
    expect(dragging.x + dragging.width).toBeLessThanOrEqual(width - 11)
    expect((await trigger.locator('svg').boundingBox())!.width).toBe(18)
    await page.mouse.up()
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.reload()
    const restored = (await trigger.boundingBox())!
    expect(restored.width).toBeCloseTo(original.width, 0)
    expect(restored.height).toBeCloseTo(original.height, 0)
  }
})

test('chat header moves the window and preserves its position through resize, maximize, and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI', exact: true }).click()
  const shell = page.locator('.demo-chat-shell')
  const header = page.locator('.chat-header')
  const initial = (await shell.boundingBox())!
  const point = { x: initial.x + 160, y: initial.y + 18 }
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x - 350, point.y - 70, { steps: 8 })
  await page.mouse.up()
  const moved = (await shell.boundingBox())!
  expect(moved.x).toBeCloseTo(initial.x - 350, 0)
  expect(moved.y).toBeCloseTo(initial.y - 70, 0)
  expect(moved.width).toBeCloseTo(initial.width, 2)
  expect(moved.height).toBeCloseTo(initial.height, 2)
  await header.focus()
  await page.keyboard.press('ArrowLeft')
  const shifted = (await shell.boundingBox())!
  expect(shifted.x).toBeCloseTo(moved.x - 24, 0)
  const grip = (await page.getByRole('button', { name: 'Resize chat', exact: true }).boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 - 50, grip.y + grip.height / 2 - 30, { steps: 5 })
  await page.mouse.up()
  const resized = (await shell.boundingBox())!
  expect(resized.width).toBeCloseTo(shifted.width + 50, 0)
  expect(resized.height).toBeCloseTo(shifted.height + 30, 0)
  expect(resized.x + resized.width).toBeCloseTo(shifted.x + shifted.width, 0)
  expect(resized.y + resized.height).toBeCloseTo(shifted.y + shifted.height, 0)
  await page.getByRole('button', { name: 'Maximize chat', exact: true }).click()
  expect(await shell.boundingBox()).toEqual({ x: 16, y: 16, width: 1408, height: 968 })
  await page.getByRole('button', { name: 'Restore chat size', exact: true }).click()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect((await shell.boundingBox())![key]).toBeCloseTo(resized[key], 0)
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click()
  await page.getByRole('button', { name: 'Open Ask AI', exact: true }).click()
  expect((await shell.boundingBox())!.x).toBeCloseTo(resized.x, 0)
  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI', exact: true }).click()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect((await shell.boundingBox())![key]).toBeCloseTo(resized[key], 0)
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = (await shell.boundingBox())!
  expect(mobile.x).toBeGreaterThanOrEqual(11)
  expect(mobile.y).toBeGreaterThanOrEqual(11)
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(379)
  expect(mobile.y + mobile.height).toBeLessThanOrEqual(833)
  await page.screenshot({ path: 'test-results/chat-window-moved-mobile.png' })
  await page.mouse.click(2, 2)
  await expect(shell).toBeHidden()
})

test('chat header supports touch dragging, clamps to screen edges, and cancels gestures', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  try {
    await page.addInitScript(() => localStorage.setItem('byok-ai:demo-panel:v1', JSON.stringify({ size: { width: 320, height: 440 }, maximized: false })))
    await page.goto('/')
    await page.getByRole('button', { name: 'Open Ask AI', exact: true }).tap()
    const shell = page.locator('.demo-chat-shell')
    const session = await context.newCDPSession(page)
    const initial = (await shell.boundingBox())!
    const x = initial.x + 100
    const y = initial.y + 17
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 10, y: 1 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const moved = (await shell.boundingBox())!
    expect(moved.x).toBeCloseTo(12, 0)
    expect(moved.y).toBeCloseTo(12, 0)
    expect(moved.width).toBeCloseTo(initial.width, 2)
    expect(moved.height).toBeCloseTo(initial.height, 2)
    const cx = moved.x + 100
    const cy = moved.y + 17
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 30, y: cy + 150 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    expect((await shell.boundingBox())!.x).toBeCloseTo(moved.x, 0)
    expect((await shell.boundingBox())!.y).toBeCloseTo(moved.y, 0)
    await page.getByRole('button', { name: 'Maximize chat', exact: true }).tap()
    expect(await shell.boundingBox()).toEqual({ x: 12, y: 12, width: 366, height: 820 })
    await page.getByRole('button', { name: 'Restore chat size', exact: true }).tap()
    expect((await shell.boundingBox())!.y).toBeCloseTo(12, 0)
  } finally { await context.close() }
})

test('provider settings save or discard changes and keep credentials hidden by default', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    if (localStorage.getItem('byok-ai:conversations:v1')) return
    localStorage.setItem('byok-ai:conversations:v1', JSON.stringify({ version: 2, conversations: [],
      connection: { providerId: 'compatible', values: { apiKey: 'test-settings-key', model: 'demo-model', baseURL: 'https://model.example/v1' } } }))
    localStorage.setItem('byok-ai:demo-panel:v1', JSON.stringify({ maximized: true }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Ask AI', exact: true }).click()
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  const key = page.getByLabel('API key', { exact: true })
  const model = page.getByLabel('Model', { exact: true })
  await expect(key).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show API key', exact: true }).click()
  await expect(key).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide API key', exact: true }).click()
  await expect(key).toHaveAttribute('type', 'password')
  await model.fill('discard-this-model')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  await expect(model).toHaveValue('demo-model')
  await model.fill('updated-model')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.locator('.chat-title')).toContainText('updated-model')
  await page.reload()
  await page.getByRole('button', { name: 'Open Ask AI', exact: true }).click()
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  await expect(model).toHaveValue('updated-model')
  await expect(key).toHaveValue('test-settings-key')
  await expect(key).toHaveAttribute('type', 'password')
  await page.screenshot({ path: 'test-results/provider-settings-wide.png' })
  await page.getByRole('button', { name: 'Change provider', exact: true }).click()
  await page.getByRole('button', { name: /Google Gemini/ }).click()
  await expect(key).toHaveValue('')
  // Choosing a different form must not alter the active provider until saving.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('byok-ai:conversations:v1:connection')!).connection.providerId)).toBe('compatible')
  await page.getByRole('button', { name: 'Change provider', exact: true }).click()
  await page.getByRole('button', { name: /OpenAI compatible/ }).click()
  await expect(key).toHaveValue('test-settings-key')
  await expect(model).toHaveValue('updated-model')
  await page.getByRole('button', { name: 'Restore chat size', exact: true }).click()
  await page.screenshot({ path: 'test-results/provider-settings-compact.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/provider-settings-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
