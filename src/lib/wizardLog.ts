export interface WozLogEntry {
  timestamp: number
  event: string
  data?: Record<string, unknown>
}

const log: WozLogEntry[] = []

export function wozLog(event: string, data?: Record<string, unknown>) {
  log.push({ timestamp: Date.now(), event, data })
}

export function getWozLog(): WozLogEntry[] {
  return log
}

export function exportWozLog(): string {
  return JSON.stringify(log, null, 2)
}

export function clearWozLog() {
  log.length = 0
}
