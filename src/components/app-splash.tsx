/** A quiet holding screen while the app works out where a signed-in person should land. */
export function AppSplash({ note }: { note?: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-6 text-center" aria-busy="true">
      <img src="/favicon.svg" alt="" width={72} height={72} className="size-[72px]" />
      <p className="sr-only">Opening SKTR Coach</p>
      {note ? <p className="max-w-xs text-base text-sk-ink-2">{note}</p> : null}
    </main>
  )
}
