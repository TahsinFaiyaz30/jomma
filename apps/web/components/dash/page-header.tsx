import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <div className="min-w-0 flex-1">
        {/* Page titles are the only place the display size is used. */}
        <h1 className="truncate text-title font-medium leading-none">{title}</h1>
        {description ? (
          <p className="mt-0.5 truncate text-micro text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions}
    </header>
  )
}
