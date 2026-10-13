/**
 * How many database requests are on their way. Background work that is not urgent (fetching the
 * code of other tabs) waits until the screen's own data has arrived, so on a phone the two do not
 * compete for the connection.
 */

let pending = 0
const waiting = new Set<() => void>()

function settle() {
  if (pending > 0) return
  for (const resolve of [...waiting]) resolve()
}

export function countInFlight(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    pending += 1
    try {
      return await inner(input, init)
    } finally {
      pending -= 1
      // Let a request that starts right after this one (the next step of a screen) count first.
      setTimeout(settle, 300)
    }
  }
}

/** Resolves once no database request has been on its way for a moment, or after `maxWaitMs`. */
export function whenDatabaseQuiet(maxWaitMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      waiting.delete(finish)
      resolve()
    }
    waiting.add(finish)
    setTimeout(finish, maxWaitMs)
    if (pending === 0) setTimeout(settle, 300)
  })
}
