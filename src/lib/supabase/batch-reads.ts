/**
 * Batched reads (database function batch_reads, migration 20261023090000).
 *
 * A screen asks the database 8 to 16 plain questions at the same moment. Sent one by one, a phone
 * waited for the server to answer them almost in single file. The shared reads layer
 * (read-cache.ts) now collects the plain reads that start together and sends them as one request.
 *
 * Only reads the database function answers exactly as the API would are batched: a list of plain
 * columns (or *), filters from a fixed list (equals, not equals, greater, less, in, is), sort
 * order and a limit. Anything else (embedded tables, renamed columns, "or", counts, single-object
 * answers, other schemas) goes to the server on its own, as before. This file holds the pure part
 * (which reads, and in what form), so it can be tested without a network.
 */

export type BatchTableRead = {
  t: string
  c: string[] | "*"
  f: Array<[string, string, string | string[]]>
  o: Array<[string, "asc" | "desc", "nullsfirst" | "nullslast" | null]>
  l: number | null
  /** Rows to skip (paging). */
  x?: number
}
/** A read-only database function (the database checks it is declared stable and returns rows). */
export type BatchFunctionRead = { r: string; a: Record<string, string | number | boolean | null> }
export type BatchRead = BatchTableRead | BatchFunctionRead

const NAME = /^[a-z_][a-z0-9_]*$/
const OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"])

function parseIn(value: string): string[] | null {
  // in.(a,b,c). Quoted items or items with commas inside are left to the server.
  if (!value.startsWith("(") || !value.endsWith(")")) return null
  const inner = value.slice(1, -1)
  if (inner === "") return []
  if (/["\\()]/.test(inner)) return null
  return inner.split(",")
}

/** The read in the form batch_reads takes, or null when it must go to the server on its own. */
export function batchableRead(
  url: string,
  method: string,
  headers: Headers,
  body: string | null = null,
  isReadOnlyFunction: (name: string) => boolean = () => false,
): BatchRead | null {
  if (method === "POST") return batchableFunction(url, headers, body, isReadOnlyFunction)
  if (method !== "GET") return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (headers.get("prefer") || headers.get("range")) return null
  const profile = headers.get("accept-profile")
  if (profile && profile !== "public") return null
  const accept = headers.get("accept") ?? "application/json"
  if (accept !== "application/json" && accept !== "*/*") return null

  const table = /\/rest\/v1\/([a-z_][a-z0-9_]*)$/.exec(parsed.pathname)?.[1]
  if (!table) return null

  const read: BatchRead = { t: table, c: "*", f: [], o: [], l: null }
  let sawSelect = false
  for (const [key, value] of parsed.searchParams) {
    if (key === "select") {
      sawSelect = true
      if (value === "*") read.c = "*"
      else {
        const columns = value.split(",")
        if (columns.length === 0 || columns.some((column) => !NAME.test(column))) return null
        read.c = columns
      }
    } else if (key === "order") {
      for (const term of value.split(",")) {
        const [column, direction = "asc", nulls, ...rest] = term.split(".")
        if (rest.length > 0 || !NAME.test(column) || (direction !== "asc" && direction !== "desc")) return null
        if (nulls !== undefined && nulls !== "nullsfirst" && nulls !== "nullslast") return null
        read.o.push([column, direction, (nulls as "nullsfirst" | "nullslast" | undefined) ?? null])
      }
    } else if (key === "limit") {
      if (!/^\d+$/.test(value)) return null
      read.l = Number(value)
    } else if (key === "offset") {
      if (!/^\d+$/.test(value)) return null
      read.x = Number(value)
    } else if (NAME.test(key)) {
      const dot = value.indexOf(".")
      if (dot < 0) return null
      let operator = value.slice(0, dot)
      let rest = value.slice(dot + 1)
      if (operator === "not") {
        // Only "not.is.<null|true|false>".
        if (!rest.startsWith("is.")) return null
        operator = "not.is"
        rest = rest.slice(3)
      }
      if (OPERATORS.has(operator)) read.f.push([key, operator, rest])
      else if (operator === "is" || operator === "not.is") {
        if (rest !== "null" && rest !== "true" && rest !== "false") return null
        read.f.push([key, operator, rest])
      } else if (operator === "in") {
        const items = parseIn(rest)
        if (!items) return null
        read.f.push([key, "in", items])
      } else return null
    } else {
      // or, and, and anything else.
      return null
    }
  }
  if (!sawSelect) read.c = "*"
  return read
}

function batchableFunction(url: string, headers: Headers, body: string | null, isReadOnlyFunction: (name: string) => boolean): BatchFunctionRead | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.search || headers.get("prefer") || headers.get("range")) return null
  const profile = headers.get("content-profile") ?? headers.get("accept-profile")
  if (profile && profile !== "public") return null
  const accept = headers.get("accept") ?? "application/json"
  if (accept !== "application/json" && accept !== "*/*") return null
  const name = /\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(parsed.pathname)?.[1]
  if (!name || !isReadOnlyFunction(name)) return null
  let args: unknown = {}
  if (body && body.trim() !== "") {
    try {
      args = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return null
  const out: BatchFunctionRead["a"] = {}
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (!NAME.test(key)) return null
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null
    out[key] = value as string | number | boolean | null
  }
  return { r: name, a: out }
}
