interface PlaceholderPageProps {
  title: string
  track: string
}

export function PlaceholderPage({ title, track }: PlaceholderPageProps) {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-md text-center">
      <h1 className="text-display font-bold tracking-tight">{title}</h1>
      <p className="text-sub text-ink2">
        coming from track <span className="font-medium text-accent">{track}</span>
      </p>
    </section>
  )
}
