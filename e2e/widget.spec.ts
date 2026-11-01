import { test, expect, type Page } from '@playwright/test'

// The demo's saved data, written before the page loads (once per tab, so reloads keep what the
// test did). `conversations` is the main assistant's `byok-ai:conversations` record.
type Seed = { conversations?: unknown[]; activeConversationId?: string; connected?: boolean; keys?: Record<string, unknown> }
const CONNECTION = { providerId: 'compatible', values: { apiKey: 'test-key', model: 'test', baseURL: 'https://model.example/v1' } }
async function seed(page: Page, { conversations, activeConversationId, connected = true, keys = {} }: Seed) {
  const items: Record<string, unknown> = { ...keys }
  if (conversations) items['byok-ai:conversations'] = { conversations, activeConversationId }
  if (connected) items['byok-ai:conversations:connection'] = CONNECTION
  await page.addInitScript(items => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', 'true')
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value))
  }, items)
}
const at = new Date().toISOString()
const message = (id: string, role: 'user' | 'assistant', content: unknown[], createdAt = at) => ({
  id, role, createdAt, content, attachments: [], metadata: { custom: {} },
  ...(role === 'assistant' ? { status: { type: 'complete', reason: 'stop' } } : {}),
})
const text = (id: string, role: 'user' | 'assistant', value: string, createdAt?: string) => message(id, role, [{ type: 'text', text: value }], createdAt)
const conversation = (id: string, title: string, messages: unknown[], { updatedAt = Date.now(), draft = '' } = {}) => ({ id, title, updatedAt, draft, messages })

// An OpenAI-compatible streaming response.
const chunk = (delta: unknown, finish: string | null = null) => ({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: finish }] })
const stream = (...chunks: unknown[]) => ({ contentType: 'text/event-stream', body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' })
const answer = (value: string) => stream(chunk({ role: 'assistant', content: value }), chunk({}, 'stop'))
const searchDocs = stream(
  chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'docs__search_docs', arguments: '{"query":"providers"}' } }] }),
  chunk({}, 'tool_calls'),
)
const MODEL = 'https://model.example/v1/chat/completions'
const openChat = (page: Page) => page.getByRole('button', { name: 'Open Ask AI', exact: true }).click()
const messageBox = (page: Page) => page.getByRole('textbox', { name: 'Message', exact: true })

test('connect, chat, switch conversations, and find it all after a reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route(MODEL, route => {
    expect(route.request().headers().authorization).toBe('Bearer test-key-private')
    return route.fulfill(answer('Hello from your browser.'))
  })
  await page.goto('/')
  await expect(page.getByRole('dialog')).toBeHidden()
  await openChat(page)
  await page.getByRole('button', { name: /OpenAI compatible/ }).click()
  await page.getByLabel('API base URL').fill('https://model.example/v1')
  await page.getByLabel('API key', { exact: true }).fill('test-key-private')
  await page.getByLabel('Model', { exact: true }).fill('test')
  await page.getByRole('button', { name: 'Connect provider' }).click()
  await messageBox(page).fill('Hello there')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await page.getByRole('button', { name: /Hello there/ }).first().click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()
  await messageBox(page).fill('A saved draft')

  await page.reload()
  await openChat(page)
  await expect(page.getByText('Hello from your browser.', { exact: true })).toBeVisible()
  await expect(messageBox(page)).toHaveValue('A saved draft')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Hello from your browser.', { exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Close assistant' }).click()
  await expect(page.getByRole('button', { name: 'Open Ask AI' })).toBeFocused()
  expect(errors).toEqual([])
})

test('an answer can be copied and regenerated, and the regenerated one is kept', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seed(page, {})
  const prompts: unknown[] = []
  await page.route(MODEL, route => {
    prompts.push(route.request().postDataJSON().messages)
    return route.fulfill(answer(prompts.length === 1 ? 'First answer.' : 'Second answer.'))
  })
  await page.goto('/')
  await openChat(page)
  await messageBox(page).fill('Question')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('First answer.', { exact: true })).toBeVisible()

  const actions = page.locator('[data-byok="message-actions"]')
  await actions.getByRole('button', { name: 'Copy' }).click()
  await expect(actions.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('First answer.')

  await actions.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('Second answer.', { exact: true })).toBeVisible()
  await expect(page.getByText('First answer.', { exact: true })).toHaveCount(0)
  // The model is asked the same question again.
  expect(prompts[1]).toEqual(prompts[0])

  await page.reload()
  await openChat(page)
  await expect(page.getByText('Second answer.', { exact: true })).toBeVisible()
  await expect(page.getByText('Question', { exact: true })).toHaveCount(1)
})

test('the latest answer always shows its actions; earlier ones while hovered, in the same place', async ({ page }) => {
  await seed(page, { activeConversationId: 'c', conversations: [conversation('c', 'First question', [
    text('u1', 'user', 'First question'), text('a1', 'assistant', 'First answer. '.repeat(30)),
    text('u2', 'user', 'Second question'), text('a2', 'assistant', 'Second answer.'),
  ])] })
  await page.goto('/')
  await openChat(page)
  const answers = page.locator('[data-byok="message"][data-role="assistant"]')
  const earlier = answers.first()
  const actions = earlier.locator('[data-byok="message-actions"]')
  await expect(answers.last().locator('[data-byok="message-actions"]')).toBeVisible()
  await expect(actions).toBeHidden()
  // Where the message sits in the scrolled list, and the list's size.
  const layout = () => earlier.evaluate(el => {
    const list = el.closest('[data-byok="messages"]')!
    const box = el.getBoundingClientRect()
    return { top: box.top - list.getBoundingClientRect().top + list.scrollTop, width: box.width, height: box.height, listWidth: list.clientWidth, listHeight: list.scrollHeight }
  })
  const before = await layout()
  await earlier.hover()
  await expect(actions).toBeVisible()
  expect(await layout()).toEqual(before)
  await page.mouse.move(2, 2)
  await expect(actions).toBeHidden()
  expect(await layout()).toEqual(before)
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

test('a custom interface uses the headless provider, and disconnecting removes its key', async ({ page }) => {
  await page.goto('/')
  const custom = page.getByRole('region', { name: 'Custom headless example' })
  expect(await custom.evaluate(el => el.parentElement?.tagName)).toBe('MAIN')
  await custom.getByLabel('OpenAI API key').fill('test-persisted-key')
  await custom.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(custom.getByText(/Connected to OpenAI/)).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.reload()
  await expect(custom.getByText(/Connected to OpenAI/)).toBeVisible()
  await custom.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(custom.getByLabel('OpenAI API key')).toHaveValue('')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-persisted-key')
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
})

test('provider settings save or discard changes, keep the key hidden, and disconnect', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await seed(page, { keys: { 'byok-ai:demo-panel': { maximized: true } } })
  await page.goto('/')
  await openChat(page)
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  const key = page.getByLabel('API key', { exact: true })
  const model = page.getByLabel('Model', { exact: true })
  await expect(key).toHaveValue('test-key')
  await expect(key).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show API key', exact: true }).click()
  await expect(key).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide API key', exact: true }).click()
  await expect(key).toHaveAttribute('type', 'password')
  await model.fill('discard-this-model')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  await expect(model).toHaveValue('test')
  await model.fill('updated-model')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.locator('.chat-title')).toContainText('updated-model')

  await page.reload()
  await openChat(page)
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  await expect(model).toHaveValue('updated-model')
  // Another provider's form is a draft: the connection stays until it is saved.
  await page.getByRole('button', { name: 'Change provider', exact: true }).click()
  await page.getByRole('button', { name: /Google Gemini/ }).click()
  await expect(key).toHaveValue('')
  await expect(page.locator('.chat-title')).toContainText('updated-model')
  await page.getByRole('button', { name: 'Change provider', exact: true }).click()
  await page.getByRole('button', { name: /OpenAI compatible/ }).click()
  await expect(key).toHaveValue('test-key')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.getByRole('button', { name: 'Disconnect provider' }).click()
  await page.getByRole('button', { name: /OpenAI compatible/ }).click()
  await expect(key).toHaveValue('')
  await page.reload()
  await openChat(page)
  await expect(page.getByText('Choose an AI provider')).toBeVisible()
})

test('Markdown renders safely, in the default renderer and a custom one', async ({ page }) => {
  const markdown = [
    '## Markdown works', '', '**Strong text** and *emphasis* with ~~removed~~.', '', '- First item', '- Second item', '',
    '- [x] Task done', '', '| Name | Value |', '| --- | --- |', '| Example | 42 |', '',
    '[Documentation](https://example.com/docs)', '', '`inline code`', '', '```ts', 'const answer = 42;', '```', '',
    '<script>window.__markdownExecuted = true</script>', '', '[Unsafe](javascript:alert(1))',
  ].join('\n')
  const saved = { conversations: [conversation('markdown', 'Markdown test', [text('answer', 'assistant', markdown)])], activeConversationId: 'markdown' }
  await seed(page, { keys: {
    'byok-ai:conversations': saved, 'byok-ai:headless-demo': saved,
    'byok-ai:headless-demo:connection': { providerId: 'openai', values: { apiKey: 'test-key', model: 'test' } },
  } })
  await page.goto('/')
  const custom = page.getByRole('region', { name: 'Custom headless example' })
  await expect(custom.locator('[data-demo-heading="custom"]')).toHaveText('Markdown works')
  await expect(custom.getByRole('link', { name: 'Documentation' })).toHaveAttribute('target', '_blank')
  await openChat(page)
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

test('a custom layout separates speakers and groups adjacent tool calls', async ({ page }) => {
  const tools = ['search_docs', 'search_docs', 'get_current_time'].map((name, i) => ({
    type: 'tool-call', toolCallId: 't' + i, toolName: 'docs__' + name, args: { query: 'providers' }, argsText: '{"query":"providers"}',
    result: { content: [{ type: 'text', text: 'Workspace documentation retrieved.' }] },
  }))
  await seed(page, { activeConversationId: 'tools', conversations: [conversation('tools', 'Summarize the docs', [
    text('user', 'user', 'Summarize the docs.'),
    message('assistant', 'assistant', [{ type: 'text', text: 'I checked the documentation.' }, ...tools, { type: 'text', text: '### The docs, at a glance' }]),
  ])] })
  await page.goto('/')
  await openChat(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-role="user"]')).toHaveCount(1)
  await expect(dialog.locator('[data-role="assistant"]')).toHaveCount(1)
  const group = dialog.getByRole('button', { name: /Used connected tools/ })
  await expect(group).toHaveCount(1)
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.getByRole('heading', { name: 'The docs, at a glance' })).toBeVisible()
  await group.click()
  await expect(dialog.locator('.chat-tool-row')).toHaveCount(3)
  await dialog.locator('.chat-tool-row').first().click()
  await expect(dialog.getByText('Workspace documentation retrieved.', { exact: false })).toBeVisible()
  await group.click()
  await expect(dialog.locator('.chat-tool-list')).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  const shell = (await dialog.boundingBox())!
  const composer = (await dialog.locator('.chat-compose').boundingBox())!
  expect(composer.y + composer.height).toBeLessThan(shell.y + shell.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('the status follows the agent through thinking, tools and writing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seed(page, {})
  let releaseModel!: () => void
  let releaseTool!: () => void
  const modelGate = new Promise<void>(resolve => { releaseModel = resolve })
  const toolGate = new Promise<void>(resolve => { releaseTool = resolve })
  let requests = 0
  await page.route(MODEL, async route => {
    if (requests++ === 0) { await modelGate; return route.fulfill(searchDocs) }
    return route.fulfill(answer('Found the provider documentation.'))
  })
  await page.route('**/api/mcp', async route => {
    if (route.request().postDataJSON()?.method === 'tools/call') await toolGate
    await route.continue()
  })
  try {
    await page.goto('/')
    await openChat(page)
    const dialog = page.getByRole('dialog')
    const status = dialog.locator('.chat-title > span')
    await expect(status).toHaveText('test')
    await messageBox(page).fill('Find the provider docs')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(status).toHaveText('Thinking')
    // Reduced motion stops the spinner.
    await expect(dialog.locator('.chat-header-mark .chat-spin')).toHaveCSS('animation-name', 'none')
    releaseModel()
    await expect(status).toHaveText('Searching connected tools')
    await expect(dialog.getByRole('button', { name: /Using connected tools/ })).toBeVisible()
    releaseTool()
    await expect(dialog.getByText('Found the provider documentation.', { exact: true })).toBeVisible()
    await expect(status).toHaveText('test')
    await expect(dialog.getByRole('button', { name: /Used connected tools/ })).toBeVisible()
    await expect(dialog.locator('.chat-working')).toHaveCount(0)
  } finally {
    releaseModel()
    releaseTool()
  }
})

test('stopping during a tool call keeps the answer so far and marks the call interrupted', async ({ page }) => {
  await seed(page, {})
  await page.route(MODEL, route => route.fulfill(searchDocs))
  // The tool call never finishes.
  await page.route('**/api/mcp', route => route.request().postDataJSON()?.method === 'tools/call' ? undefined : route.continue())
  await page.goto('/')
  await openChat(page)
  const dialog = page.getByRole('dialog')
  await messageBox(page).fill('Find the provider docs')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(dialog.getByRole('button', { name: /Using connected tools/ })).toBeVisible()
  await page.getByRole('button', { name: 'Stop response' }).click()
  const group = dialog.getByRole('button', { name: /Tool activity needs attention/ })
  await expect(group).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  await page.reload()
  await openChat(page)
  await group.click()
  await expect(dialog.locator('.chat-tool-row')).toContainText('Interrupted')
  await expect(dialog.getByText('Find the provider docs', { exact: true })).toBeVisible()
})

test('history lists conversations with a message or a draft, newest first, and confirms deletion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const now = Date.UTC(2026, 9, 30, 12)
  await page.clock.install({ time: new Date(now) })
  const saved = [
    { id: 'older', title: 'Provider integration', updatedAt: now - 3 * 86400_000 },
    { id: 'recent', title: 'Available tools', updatedAt: now - 225_000 },
    { id: 'yesterday', title: 'Markdown rendering', updatedAt: now - 86400_000 },
  ].map(c => conversation(c.id, c.title, [
    text(c.id + '-user', 'user', c.title, new Date(c.updatedAt).toISOString()),
    text(c.id + '-reply', 'assistant', 'Here is the documentation for ' + c.title + '.', new Date(c.updatedAt).toISOString()),
  ], { updatedAt: c.updatedAt }))
  await seed(page, { activeConversationId: 'recent', conversations: saved })
  await page.goto('/')
  await openChat(page)
  await page.getByRole('button', { name: 'Conversation history' }).click()
  const history = page.locator('[data-byok="history"]')
  const titles = history.locator('[data-byok="history-title"]')
  await expect(titles).toHaveText(['Available tools', 'Markdown rendering', 'Provider integration'])
  await expect(history.locator('time')).toHaveText(['3 minutes ago', '1 day ago', '3 days ago'])
  await expect(history.locator('time').first()).toHaveAttribute('datetime', new Date(now - 225_000).toISOString())
  await expect(history.locator('[aria-current="true"]')).toContainText('Available tools')
  await page.clock.fastForward(60_000)
  await expect(history.locator('time').first()).toHaveText('4 minutes ago')

  // Opening a conversation is not activity: its date and place stay.
  await history.getByRole('button', { name: /^Provider integration/ }).click()
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await expect(history.locator('time').last()).toHaveText('3 days ago')
  await expect(history.locator('[aria-current="true"]')).toContainText('Provider integration')

  const remove = page.getByRole('button', { name: 'Delete Provider integration', exact: true })
  const confirmation = page.getByRole('dialog', { name: 'Delete conversation?', exact: true })
  await remove.click()
  await expect(confirmation.getByRole('button', { name: 'Keep conversation' })).toBeFocused()
  await expect(confirmation).toContainText('Provider integration')
  await confirmation.getByRole('button', { name: 'Keep conversation' }).click()
  await expect(confirmation).toBeHidden()
  await expect(remove).toBeFocused()
  await remove.click()
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
  await remove.click()
  await confirmation.getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await expect(titles).toHaveText(['Available tools', 'Markdown rendering'])
  await expect(history.getByRole('heading', { name: 'Conversations' })).toBeFocused()

  // A new chat is listed once it holds a draft.
  await page.getByRole('button', { name: 'Back to chat' }).click()
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await expect(titles).toHaveText(['Available tools', 'Markdown rendering'])
  await page.getByRole('button', { name: 'Back to chat' }).click()
  await messageBox(page).fill('Unsent question')
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await expect(titles).toHaveText(['New conversation', 'Available tools', 'Markdown rendering'])
  await expect(history.locator('[data-byok="history-preview"]').first()).toHaveText('Draft: Unsent question')

  await page.reload()
  await openChat(page)
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await expect(titles).toHaveText(['New conversation', 'Available tools', 'Markdown rendering'])
})

test('the chat window moves, resizes from every edge and corner, maximizes, and keeps its geometry and draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await seed(page, { activeConversationId: 'draft', conversations: [conversation('draft', 'New conversation', [], { draft: 'Keep this draft' })] })
  await page.goto('/')
  await openChat(page)
  const shell = page.locator('.demo-chat-shell')
  const box = async () => (await shell.boundingBox())!
  const handle = (side: string) => page.getByRole('button', { name: 'Resize chat from the ' + side, exact: true })
  const drag = async (from: { x: number; y: number }, dx: number, dy: number) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 })
    await page.mouse.up()
  }
  const center = async (side: string) => { const b = (await handle(side).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }

  // In its default corner, the top-left corner resizes it toward the bottom-right, which stays put.
  let before = await box()
  await drag(await center('top left'), 40, 120)
  let after = await box()
  expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0)
  expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0)
  expect(after.width).toBeCloseTo(before.width - 40, 0)
  expect(after.height).toBeCloseTo(before.height - 120, 0)

  // The header moves it: by drag, and by arrow keys while focused.
  before = await box()
  await drag({ x: before.x + 200, y: before.y + 18 }, -500, -130)
  after = await box()
  expect(after.x).toBeCloseTo(before.x - 500, 0)
  expect(after.y).toBeCloseTo(before.y - 130, 0)
  expect(after.width).toBeCloseTo(before.width, 2)
  await page.locator('.chat-header').focus()
  await page.keyboard.press('ArrowLeft')
  expect((await box()).x).toBeCloseTo(after.x - 24, 0)

  // Each handle moves its own edges by the pointer's travel; the opposite ones stay put.
  for (const [side, dx, dy] of [
    ['right', 30, 0], ['bottom', 0, 30], ['left', -30, 0], ['top', 0, -30],
    ['top right', 30, -30], ['bottom right', 30, 30], ['bottom left', -30, 30], ['top left', -30, -30],
  ] as const) {
    before = await box()
    await drag(await center(side), dx, dy)
    after = await box()
    const left = side.includes('left') ? dx : 0, right = side.includes('right') ? dx : 0
    const top = side.includes('top') ? dy : 0, bottom = side.includes('bottom') ? dy : 0
    expect(after.x, side).toBeCloseTo(before.x + left, 0)
    expect(after.x + after.width, side).toBeCloseTo(before.x + before.width + right, 0)
    expect(after.y, side).toBeCloseTo(before.y + top, 0)
    expect(after.y + after.height, side).toBeCloseTo(before.y + before.height + bottom, 0)
  }
  // Arrow keys move a focused handle's edge the same way.
  before = await box()
  await handle('right').focus()
  await page.keyboard.press('ArrowRight')
  after = await box()
  expect(after.width).toBeCloseTo(before.width + 24, 0)
  expect(after.x).toBeCloseTo(before.x, 0)

  const placed = await box()
  await page.getByRole('button', { name: 'Maximize chat', exact: true }).click()
  expect(await box()).toEqual({ x: 16, y: 16, width: 1408, height: 968 })
  await expect(handle('right')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click()
  await openChat(page)
  await page.getByRole('button', { name: 'Restore chat size', exact: true }).click()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect((await box())[key]).toBeCloseTo(placed[key], 0)

  await page.reload()
  await openChat(page)
  for (const key of ['x', 'y', 'width', 'height'] as const) expect((await box())[key]).toBeCloseTo(placed[key], 0)
  await expect(messageBox(page)).toHaveValue('Keep this draft')

  // A resize stops at the smallest size.
  await handle('bottom right').focus()
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowLeft')
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowUp')
  expect((await box()).width).toBe(320)
  expect((await box()).height).toBe(320)

  // On a small screen it stays within the margins, and maximizes to them.
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await box()
  expect(mobile.x).toBeGreaterThanOrEqual(11)
  expect(mobile.y).toBeGreaterThanOrEqual(11)
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(379)
  expect(mobile.y + mobile.height).toBeLessThanOrEqual(833)
  await page.getByRole('button', { name: 'Maximize chat', exact: true }).click()
  expect(await box()).toEqual({ x: 12, y: 12, width: 366, height: 820 })
  const composer = (await page.locator('.chat-compose').boundingBox())!
  expect(composer.y + composer.height).toBeLessThan(12 + 820)
})

test('the chat header moves the window by touch, stops at the screen edge, and cancels', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  try {
    await seed(page, { connected: false, keys: { 'byok-ai:demo-panel': { size: { width: 320, height: 440 }, maximized: false } } })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open Ask AI', exact: true }).tap()
    const shell = page.locator('.demo-chat-shell')
    const session = await context.newCDPSession(page)
    const initial = (await shell.boundingBox())!
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: initial.x + 100, y: initial.y + 17 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 10, y: 1 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const moved = (await shell.boundingBox())!
    expect(moved.x).toBeCloseTo(12, 0)
    expect(moved.y).toBeCloseTo(12, 0)
    expect(moved.width).toBeCloseTo(initial.width, 2)
    const x = moved.x + 100
    const y = moved.y + 17
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y: y + 150 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    expect((await shell.boundingBox())!.x).toBeCloseTo(moved.x, 0)
    expect((await shell.boundingBox())!.y).toBeCloseTo(moved.y, 0)
    await page.getByRole('button', { name: 'Maximize chat', exact: true }).tap()
    expect(await shell.boundingBox()).toEqual({ x: 12, y: 12, width: 366, height: 820 })
    await page.getByRole('button', { name: 'Restore chat size', exact: true }).tap()
    expect((await shell.boundingBox())!.y).toBeCloseTo(12, 0)
  } finally { await context.close() }
})

test('the launcher drags without opening, stays on screen, and keeps its place after a reload', async ({ page }) => {
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
  // A drag past the edge stops at the margin and doesn't open the chat.
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
  // A small wobble is a click.
  await page.mouse.move(mobile.x + mobile.width / 2, mobile.y + mobile.height / 2)
  await page.mouse.down()
  await page.mouse.move(mobile.x + mobile.width / 2 + 2, mobile.y + mobile.height / 2 + 2)
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
})

test('the launcher moves by touch, and a cancelled gesture puts it back', async ({ browser }) => {
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
    const cx = moved.x + moved.width / 2
    const cy = moved.y + moved.height / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 50, y: cy - 100 }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    expect((await trigger.boundingBox())!.x).toBeCloseTo(moved.x, 0)
    expect((await trigger.boundingBox())!.y).toBeCloseTo(moved.y, 0)
    await page.reload()
    expect((await trigger.boundingBox())!.x).toBeCloseTo(moved.x, 0)
    await trigger.tap()
    await expect(page.getByRole('dialog', { name: 'Ask AI', exact: true })).toBeVisible()
  } finally { await context.close() }
})

test('the launcher keeps its size and label when dragged against the right edge', async ({ page }) => {
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

test('the workspace keeps files in the browser, runs scripts over them in a worker, and goes with its conversation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const call = (id: string, name: string, args: unknown) => stream(
    chunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }),
    chunk({}, 'tool_calls'),
  )
  // The model writes a file, computes over it, then answers with what the script returned.
  const turns = [
    call('w', 'workspace__write_file', { name: 'sales.json', text: JSON.stringify([{ amount: 12.5 }, { amount: 30 }, { amount: 7.5 }]) }),
    call('r', 'workspace__run_javascript', { code: 'const rows = files.readJSON("sales.json"); files.write("total.txt", String(rows.reduce((s, r) => s + r.amount, 0))); return { rows: rows.length, fetch: typeof fetch }' }),
  ]
  await page.route(MODEL, route => {
    const next = turns.shift()
    if (next) return route.fulfill(next)
    const messages = route.request().postDataJSON().messages as { role: string; content: string }[]
    return route.fulfill(answer('Script said: ' + messages.filter(m => m.role === 'tool').at(-1)!.content))
  })
  await seed(page, {})
  await page.goto('/')
  await openChat(page)
  await messageBox(page).fill('Total my sales')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  // The first script also loads the engine (and, in dev, has it compiled).
  await expect(page.getByText(/^Script said:/)).toContainText('"result":{"rows":3,"fetch":"undefined"}', { timeout: 20_000 })

  const conversationId = await page.evaluate(() => JSON.parse(localStorage.getItem('byok-ai:conversations')!).activeConversationId as string)
  const readFiles = () => page.evaluate(async id => {
    try {
      let dir = await navigator.storage.getDirectory()
      for (const name of ['byok-ai', 'byok-ai%3aconversations', id, 'files']) dir = await dir.getDirectoryHandle(name)
      const files: Record<string, string> = {}
      for await (const handle of dir.values()) files[handle.name] = await (await (handle as FileSystemFileHandle).getFile()).text()
      return files
    } catch { return null }
  }, conversationId)
  await page.reload()
  expect(await readFiles()).toEqual({ 'sales.json': '[{"amount":12.5},{"amount":30},{"amount":7.5}]', 'total.txt': '50' })

  await openChat(page)
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await page.getByRole('button', { name: 'Delete Total my sales', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete conversation?', exact: true }).getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await expect.poll(readFiles).toBeNull()
  expect(errors).toEqual([])
})

test('Stop ends a script that never finishes', async ({ page }) => {
  let requests = 0
  await page.route(MODEL, route => {
    requests++
    return route.fulfill(stream(
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'loop', type: 'function', function: { name: 'workspace__run_javascript', arguments: '{"code":"while (true) {}"}' } }] }),
      chunk({}, 'tool_calls'),
    ))
  })
  await seed(page, {})
  await page.goto('/')
  await openChat(page)
  await messageBox(page).fill('Spin')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: /Using connected tools/ })).toBeVisible({ timeout: 20_000 })
  const workers = () => page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('sandbox-worker')).length)
  await expect.poll(workers).toBeGreaterThan(0)
  const stopped = Date.now()
  await page.getByRole('button', { name: 'Stop response', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible()
  expect(Date.now() - stopped).toBeLessThan(3_000)
  expect(requests).toBe(1)
})

test('an attached image is scaled, sent to the model, kept across a reload, and goes with its conversation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  let sentImage = ''
  await page.route(MODEL, route => {
    const user = (route.request().postDataJSON().messages as { role: string; content: unknown }[]).find(m => m.role === 'user')!
    const parts = user.content as { type: string; image_url?: { url: string } }[]
    sentImage = parts.find(p => p.type === 'image_url')?.image_url?.url ?? ''
    return route.fulfill(answer('A purple rectangle.'))
  })
  await seed(page, {})
  await page.goto('/')
  // A 3000×1500 PNG: wider than models read, so it is scaled to 1568 wide.
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(3000, 1500)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#8b739f'
    context.fillRect(0, 0, 3000, 1500)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return btoa(String.fromCharCode(...bytes))
  })
  await openChat(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach image' }).click()
  await (await chooser).setFiles({ name: 'chart.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await expect(page.getByRole('img', { name: 'chart.png' })).toBeVisible()
  await messageBox(page).fill('What is this?')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('A purple rectangle.', { exact: true })).toBeVisible()
  expect(sentImage).toMatch(/^data:image\/png;base64,/)
  const header = Buffer.from(sentImage.split(',')[1]!, 'base64')
  expect([header.readUInt32BE(16), header.readUInt32BE(20)]).toEqual([1568, 784])
  await expect(page.getByRole('button', { name: 'Remove chart.png' })).toHaveCount(0)

  await page.reload()
  await openChat(page)
  await expect(page.getByRole('img', { name: 'chart.png' })).toBeVisible()
  const images = () => page.evaluate(async () => {
    try {
      let dir = await navigator.storage.getDirectory()
      for (const name of ['byok-ai', 'byok-ai%3aconversations']) dir = await dir.getDirectoryHandle(name)
      let count = 0
      for await (const conversation of dir.values()) {
        if (conversation.kind !== 'directory') continue
        try { for await (const image of (await (conversation as FileSystemDirectoryHandle).getDirectoryHandle('images')).keys()) count += image ? 1 : 0 } catch { /* none */ }
      }
      return count
    } catch { return 0 }
  })
  expect(await images()).toBe(1)
  await page.getByRole('button', { name: 'Conversation history' }).click()
  await page.getByRole('button', { name: 'Delete What is this?', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete conversation?', exact: true }).getByRole('button', { name: 'Delete conversation', exact: true }).click()
  await expect.poll(images).toBe(0)
  expect(errors).toEqual([])
})

test('at most four images go in a message, and an image that cannot be read says so', async ({ page }) => {
  await seed(page, {})
  await page.goto('/')
  await openChat(page)
  const attach = page.getByRole('button', { name: 'Attach image' })
  await expect(attach).toBeVisible()
  const add = async (files: { name: string; mimeType: string; buffer: Buffer }[]) => {
    const chooser = page.waitForEvent('filechooser')
    await attach.click()
    await (await chooser).setFiles(files)
  }
  await add([{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') }])
  await expect(page.getByRole('alert')).toContainText('"broken.png" could not be read as an image.')
  const tiny = Buffer.from(await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4, 4)
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    return btoa(String.fromCharCode(...bytes))
  }), 'base64')
  await add(Array.from({ length: 5 }, (_, i) => ({ name: `dot${i}.png`, mimeType: 'image/png', buffer: tiny })))
  await expect(page.locator('[data-byok="composer-images"] [data-byok="image"]')).toHaveCount(4)
  await expect(page.getByRole('alert')).toContainText('at most 4 images')
})
