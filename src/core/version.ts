/** "30.10.2026 12:00 · f5eee21": build time in Kyiv and the short commit hash, if known. */
export function formatBuildVersion(date: Date, commit: string | null): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]))
  const time = `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`
  return commit ? `${time} · ${commit}` : time
}
