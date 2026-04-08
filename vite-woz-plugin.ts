import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Vite plugin that adds Wizard-of-Oz relay endpoints.
 *
 * POST /woz/command   – wizard sends a JSON command
 * POST /woz/status    – participant sends status updates
 * GET  /woz/events    – SSE stream for the participant (receives wizard commands)
 * GET  /woz/status-events – SSE stream for the wizard (receives participant status)
 */
export function wozPlugin(): Plugin {
  const commandClients: ServerResponse[] = []
  const statusClients: ServerResponse[] = []

  const sendSSE = (clients: ServerResponse[], data: unknown) => {
    const payload = `data: ${JSON.stringify(data)}\n\n`
    for (let i = clients.length - 1; i >= 0; i--) {
      try {
        clients[i]!.write(payload)
      } catch {
        clients.splice(i, 1)
      }
    }
  }

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => resolve(body))
    })

  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  } as const

  return {
    name: 'vite-woz',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        // SSE stream – participant listens for wizard commands
        if (url === '/woz/events' && req.method === 'GET') {
          res.writeHead(200, sseHeaders)
          res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
          commandClients.push(res)
          req.on('close', () => {
            const idx = commandClients.indexOf(res)
            if (idx !== -1) commandClients.splice(idx, 1)
          })
          return
        }

        // SSE stream – wizard listens for participant status
        if (url === '/woz/status-events' && req.method === 'GET') {
          res.writeHead(200, sseHeaders)
          res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
          statusClients.push(res)
          req.on('close', () => {
            const idx = statusClients.indexOf(res)
            if (idx !== -1) statusClients.splice(idx, 1)
          })
          return
        }

        // Wizard sends a command → relayed to participant
        if (url === '/woz/command' && req.method === 'POST') {
          const body = await readBody(req)
          try {
            const cmd = JSON.parse(body)
            sendSSE(commandClients, cmd)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'invalid json' }))
          }
          return
        }

        // Participant sends status → relayed to wizard
        if (url === '/woz/status' && req.method === 'POST') {
          const body = await readBody(req)
          try {
            const status = JSON.parse(body)
            sendSSE(statusClients, status)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'invalid json' }))
          }
          return
        }

        next()
      })
    },
  }
}
