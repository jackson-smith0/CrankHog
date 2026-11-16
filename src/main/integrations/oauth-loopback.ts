// One-shot loopback listener for an OAuth redirect: the system browser
// comes back to http://127.0.0.1:<random port><path> with a code, which is
// only accepted with the state CrankHog sent. Shared by Strava and Google.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BRAND_COLORS, wordmarkSvg } from '@shared/brand'

export interface LoopbackOpts {
  /** The redirect path, e.g. "/strava/callback". Anything else gets a 404. */
  path: string
  expectedState: string
  timeoutMs: number
  /** The service's name, for the page and the errors: "Strava", "Google". */
  provider: string
  /** What the browser tab says once it worked. */
  successMessage: string
}

export function listenForCode(opts: LoopbackOpts): Promise<{ server: Server; port: number; code: Promise<string> }> {
  return new Promise((resolveListen, rejectListen) => {
    let settle: { resolve: (c: string) => void; reject: (e: Error) => void } | null = null
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== opts.path) {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const state = url.searchParams.get('state')
      const c = url.searchParams.get('code')
      const ok = !err && state === opts.expectedState && !!c
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page(ok ? opts.successMessage : `${opts.provider} authorization failed. Close this tab and try again from CrankHog.`))
      if (ok) settle?.resolve(c!)
      else settle?.reject(new Error(err ? `${opts.provider} authorization ${err}` : 'OAuth state mismatch'))
    })
    const timer = setTimeout(() => settle?.reject(new Error(`Timed out waiting for ${opts.provider} authorization`)), opts.timeoutMs)
    code.finally(() => clearTimeout(timer)).catch(() => undefined)
    server.on('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      resolveListen({ server, port: (server.address() as AddressInfo).port, code })
    })
  })
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>CrankHog</title><body style="font:16px -apple-system,sans-serif;background:${BRAND_COLORS.night};color:${BRAND_COLORS.chalk};display:grid;place-items:center;align-content:center;gap:20px;height:100vh;margin:0">${wordmarkSvg(BRAND_COLORS.chalk, 'style="height:40px;width:auto"')}<p>${message}</p></body>`
}
