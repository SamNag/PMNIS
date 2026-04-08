import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Vite plugin that adds Wizard-of-Oz relay endpoints.
 *
 * POST /woz/command        – wizard sends a JSON command
 * POST /woz/status         – participant sends status updates
 * GET  /woz/events         – SSE stream for the participant (receives wizard commands)
 * GET  /woz/status-events  – SSE stream for the wizard (receives participant status)
 * POST /woz/upload-volume  – participant uploads a medical file for wizard to mirror
 * GET  /woz/volume         – wizard downloads the participant's current volume file
 */
export function wozPlugin(): Plugin {
  const commandClients: ServerResponse[] = []
  const statusClients: ServerResponse[] = []

  /** In-memory storage for the participant's uploaded volume file. */
  let volumeBuffer: Buffer | null = null
  let volumeFileName = ''

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

  const readBinaryBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks)))
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

        // Participant uploads a volume file → stored in memory for wizard
        if (url === '/woz/upload-volume' && req.method === 'POST') {
          const fileName = (req.headers['x-filename'] as string) || 'volume.bin'
          volumeBuffer = await readBinaryBody(req)
          volumeFileName = fileName
          // Notify wizard that volume changed
          sendSSE(statusClients, { type: 'volume-changed', fileName })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, size: volumeBuffer.length }))
          return
        }

        // Wizard downloads the participant's current volume file
        if (url === '/woz/volume' && req.method === 'GET') {
          if (!volumeBuffer) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'no volume uploaded' }))
            return
          }
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${volumeFileName}"`,
            'Content-Length': String(volumeBuffer.length),
          })
          res.end(volumeBuffer)
          return
        }

        next()
      })
    },
  }
}
