import { PageHeader } from './page-header'

/**
 * Placeholder for a route that has a shell but no content yet.
 *
 * Deliberately explicit about what is missing rather than showing an empty
 * table that looks like it works and returned nothing.
 */
export function StubPage({
  title,
  purpose,
  planned,
}: {
  title: string
  purpose: string
  planned: string[]
}) {
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader title={title} />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="max-w-xl space-y-4">
          <p className="text-body text-muted-foreground">{purpose}</p>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-small font-medium">Not built yet</div>
            <ul className="mt-2 space-y-1.5">
              {planned.map((item) => (
                <li key={item} className="flex gap-2 text-small text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
