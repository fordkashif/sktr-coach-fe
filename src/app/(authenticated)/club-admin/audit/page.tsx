"use client"

import { useEffect, useMemo, useState } from "react"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ClubAdminNav } from "@/components/club-admin/admin-nav"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type AuditEvent, loadAuditLogs } from "@/lib/mock-audit"
import { getBackendMode } from "@/lib/supabase/config"
import { getClubAdminAuditEvents } from "@/lib/data/club-admin/ops-data"

const columnHelper = createColumnHelper<AuditEvent>()

export default function ClubAdminAuditPage() {
  const backendMode = getBackendMode()
  const isSupabaseMode = backendMode === "supabase"
  const [entries, setEntries] = useState<AuditEvent[]>(() => (isSupabaseMode ? [] : loadAuditLogs()))
  const [query, setQuery] = useState("")
  const [actionFilter, setActionFilter] = useState("all")
  const [backendLoading, setBackendLoading] = useState(isSupabaseMode)
  const [backendError, setBackendError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseMode) return
    let cancelled = false

    const load = async () => {
      setBackendLoading(true)
      const result = await getClubAdminAuditEvents()
      if (cancelled) return

      if (!result.ok) {
        setBackendError(result.error.message)
        setBackendLoading(false)
        return
      }

      setEntries(result.data)
      setBackendError(null)
      setBackendLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isSupabaseMode])

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const actionOk = actionFilter === "all" || entry.action === actionFilter
      const queryLower = query.trim().toLowerCase()
      const queryOk =
        !queryLower ||
        entry.actor.toLowerCase().includes(queryLower) ||
        entry.target.toLowerCase().includes(queryLower) ||
        (entry.detail ?? "").toLowerCase().includes(queryLower)
      return actionOk && queryOk
    })
  }, [actionFilter, entries, query])

  const actions = Array.from(new Set(entries.map((entry) => entry.action)))
  const columns = useMemo(
    () => [
      columnHelper.accessor("action", {
        header: "Action",
        cell: (info) => <span className="font-semibold text-slate-950">{info.getValue()}</span>,
      }),
      columnHelper.accessor("actor", {
        header: "Actor",
      }),
      columnHelper.accessor("target", {
        header: "Target",
      }),
      columnHelper.accessor("detail", {
        header: "Detail",
        cell: (info) => <span className="text-slate-500">{info.getValue() || "-"}</span>,
      }),
      columnHelper.accessor("at", {
        header: "At",
        cell: (info) => <span className="whitespace-nowrap text-slate-500">{info.getValue()}</span>,
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:space-y-6 sm:p-6">
      <section className="page-intro">
        <div className="space-y-3">
          <div>
            <h1 className="page-intro-title">Audit / Activity Logs</h1>
            <p className="page-intro-copy">Review admin actions, filter events, and inspect the current audit history.</p>
          </div>
          <ClubAdminNav />
        </div>
      </section>
      {backendError ? (
        <section className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Backend sync issue: {backendError}
        </section>
      ) : null}
      {isSupabaseMode && backendLoading ? (
        <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading audit logs...
        </section>
      ) : null}

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Filters</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">Search Activity</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input className="h-12 rounded-[16px] border-slate-200 bg-slate-50" placeholder="Search logs..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-12 rounded-[16px] border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actions.map((action) => (
                <SelectItem key={action} value={action}>{action}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="mobile-card-primary">
        <div className="space-y-1 border-b border-slate-200 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Entries</p>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{filtered.length} matched records</h2>
        </div>
        <div className="mt-4 space-y-3 md:hidden">
          {filtered.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No activity logs yet.
            </div>
          ) : (
            filtered.map((entry) => (
              <div key={entry.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-950">{entry.action}</p>
                  <p className="text-xs text-slate-500">{entry.at}</p>
                </div>
                <p className="mt-2 text-sm text-slate-500">Actor: {entry.actor} | Target: {entry.target}</p>
                {entry.detail ? <p className="mt-1 text-xs text-slate-500">{entry.detail}</p> : null}
              </div>
            ))
          )}
        </div>
        <div className="mt-4 hidden overflow-hidden rounded-[18px] border border-slate-200 md:block">
          {filtered.length === 0 ? (
            <div className="bg-slate-50 px-4 py-6 text-sm text-slate-500">No activity logs yet.</div>
          ) : (
            <table className="w-full border-collapse bg-white">
              <thead className="bg-slate-50">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-slate-200">
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-200 last:border-b-0">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-sm text-slate-700 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
