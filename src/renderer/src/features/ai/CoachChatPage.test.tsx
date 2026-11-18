import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryRef } from '@core/ai/calendar-edits'
import type { AiMessage } from '@core/ai/types'
import { addDays, dateKey } from '@core/workout/schedule'
import { db } from '../../db/db'
import { scheduleSession } from '../../plan/schedule-repo'
import { CoachChatPage } from './CoachChatPage'

const sent: AiMessage[][] = []
let reply = ''

vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('../../ai/client', () => ({
  coachVoiceNow: () => '[Coach settings]\n[/Coach settings]',
  coachContext: async () => '{}',
  streamAi: (_purpose: string, messages: AiMessage[], onDelta: (t: string) => void) => {
    sent.push(messages)
    onDelta(reply)
    return { done: Promise.resolve({ text: reply, error: null, code: null, model: 'test' }), cancel: () => undefined }
  },
}))

const day = addDays(dateKey(Date.now()), 2)

beforeEach(async () => {
  await db().delete()
  await db().open()
  sent.length = 0
})
afterEach(() => cleanup())

const ask = async (text: string) => {
  // the stored chat loads first
  await act(async () => new Promise((r) => setTimeout(r, 30)))
  fireEvent.change(screen.getByLabelText('Message the coach'), { target: { value: text } })
  await act(async () => fireEvent.click(screen.getByLabelText('Send')))
}

describe('coach chat calendar changes', () => {
  it('shows a change as a card, applies it, tells the coach, and undoes it', async () => {
    const e = await scheduleSession(day, 'run', 'Run-walk 40', { durationS: 2400, text: '8x\n- 4m Z2 HR\n- 1m Z1 HR walk' })
    reply = `Run the lot, then.\n\n\`\`\`crankhog\naction: change\nref: ${entryRef(e.id)}\nsport: run\nname: Easy run 40\nwhy: No more walk breaks.\n\n- 40m Z2 HR\n\`\`\``
    render(<CoachChatPage />)
    await ask("I'd rather run the whole time on Thursday")

    const card = await screen.findByTestId('coach-edit')
    expect(card.textContent).toContain('Change on the calendar')
    expect(card.textContent).toContain('No more walk breaks.')
    await waitFor(() => expect(card.textContent).toContain('Easy run 40'))
    expect(screen.getByText('Run the lot, then.')).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Apply' })))
    await waitFor(async () => expect((await db().schedule.get(e.id))!.name).toBe('Easy run 40'))
    expect(screen.getByText('Applied')).toBeTruthy()
    // the card still reads as the change it made, not the calendar it left
    expect(screen.getByTestId('coach-edit').textContent).toContain('Run-walk 40')
    // kept with the chat
    const stored = (await db().kv.get('coach.chat'))!.value as { edits?: Record<number, { status: string }> }[]
    expect(stored[1]!.edits?.[0]?.status).toBe('applied')

    // the next message tells the coach what happened to its change
    reply = 'Good.'
    await ask('Thanks')
    expect(sent[1]![1]!.content).toContain('[Calendar changes: 1 applied]')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Undo/ })))
    await waitFor(async () => expect((await db().schedule.get(e.id))!.name).toBe('Run-walk 40'))
  })

  it('says why a change cannot be applied', async () => {
    reply = '```crankhog\naction: remove\nref: zzzzzz\n```'
    render(<CoachChatPage />)
    await ask('Drop Friday')
    await screen.findByText(/isn't on the calendar any more/)
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('applies every change in a reply at once', async () => {
    const a = await scheduleSession(day, 'run', 'Run A', { durationS: 1800 })
    const b = await scheduleSession(day, 'swim', 'Swim B', { durationS: 1800 })
    reply = `\`\`\`crankhog\naction: move\nref: ${entryRef(a.id)}\ndate: ${addDays(day, 1)}\n\`\`\`\n\n\`\`\`crankhog\naction: remove\nref: ${entryRef(b.id)}\n\`\`\``
    render(<CoachChatPage />)
    await ask("I'm wrecked")
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Apply all 2 changes' })))
    await waitFor(async () => expect((await db().schedule.get(a.id))!.date).toBe(addDays(day, 1)))
    await waitFor(async () => expect(await db().schedule.get(b.id)).toBeUndefined())
  })

  it('dismisses a change, and shows one it cannot read', async () => {
    reply = '```crankhog\naction: teleport\n```\n\n```crankhog\naction: add\ndate: ' + day + '\nsport: run\nduration: 30m\n```'
    render(<CoachChatPage />)
    await ask('Add a run')
    await screen.findByText(/can't read: The change has no action/)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })))
    expect(screen.getByText('Dismissed')).toBeTruthy()
    expect(await db().schedule.count()).toBe(0)
  })
})
