import { describe, expect, it } from 'vitest'
import { editsNote, trimChat, type ChatMessage } from './chat-history'

const chat = (n: number): ChatMessage[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }))

describe('trimChat', () => {
  it('leaves short chats alone', () => {
    expect(trimChat(chat(10))).toHaveLength(10)
  })

  it('keeps the newest, from a rider message on, still alternating', () => {
    const t = trimChat(chat(81), 40)
    expect(t.length).toBeLessThanOrEqual(40)
    expect(t[0]!.role).toBe('user')
    expect(t[0]!.content).toBe('m42')
    expect(t.at(-1)!.content).toBe('m80')
    for (let i = 1; i < t.length; i++) expect(t[i]!.role).not.toBe(t[i - 1]!.role)
  })
})

describe('editsNote', () => {
  const block = '```crankhog\naction: remove\nref: abc123\n```'
  it('says what the rider did with each change in a reply', () => {
    expect(editsNote({ role: 'assistant', content: `${block}\n${block}\n${block}`, edits: { 0: { status: 'applied' }, 2: { status: 'undone' } } })).toBe('\n\n[Calendar changes: 1 applied, 2 not applied yet, 3 applied, then undone]')
  })
  it('says nothing for a reply without changes, or a rider message', () => {
    expect(editsNote({ role: 'assistant', content: 'Ride easy.' })).toBe('')
    expect(editsNote({ role: 'user', content: block })).toBe('')
  })
})
