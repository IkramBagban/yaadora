import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { GitMerge, TriangleAlert } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { formatDate } from '../format'
import { mergeEntities, type EntityDirectoryItem, type MergeEntitiesResult } from '../api'

interface MergeDialogProps {
  entities: EntityDirectoryItem[]
  /** Ids picked via directory checkboxes (order = pick order). */
  preselected: string[]
  onClose: () => void
  /** Called after a successful merge with the surviving entity id. */
  onMerged: (primaryId: string) => void
}

function PickerSelect({
  label,
  hint,
  entities,
  value,
  onChange,
}: {
  label: string
  hint: string
  entities: EntityDirectoryItem[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="block">
      <span className="text-caption-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="mt-xs h-10 w-full rounded-md border border-hairline bg-surface px-md text-sub text-ink focus:border-accent focus:outline-none"
      >
        <option value="">Choose…</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.canonicalName} ({e.type}, {e.mentionCount} mentions)
          </option>
        ))}
      </select>
      <span className="mt-xs block text-caption text-ink3">{hint}</span>
    </label>
  )
}

/**
 * Preview row describing one thing the merge transaction will remap.
 */
function PreviewRow({ what, detail }: { what: string; detail: string }) {
  return (
    <li className="flex items-start justify-between gap-md py-sm">
      <span className="text-sub text-ink">{what}</span>
      <span className="text-right text-caption text-ink2">{detail}</span>
    </li>
  )
}

const REMAP_SUMMARY_ROWS: Array<{ key: keyof MergeEntitiesResult['remapped']; label: string }> = [
  { key: 'memoryEntities', label: 'mention links' },
  { key: 'factsAsSubject', label: 'facts (as subject)' },
  { key: 'factsAsObject', label: 'facts (as object)' },
  { key: 'openLoops', label: 'open loops' },
  { key: 'edgesDeleted', label: 'derived edges dropped*' },
]

/** E-8 merge dialog: preview what gets remapped, confirm to execute. */
export function MergeDialog({ entities, preselected, onClose, onMerged }: MergeDialogProps) {
  const [primaryId, setPrimaryId] = useState(preselected[0] ?? '')
  const [duplicateId, setDuplicateId] = useState(preselected[1] ?? '')
  const [result, setResult] = useState<MergeEntitiesResult | null>(null)

  const merge = useMutation({
    mutationFn: () => mergeEntities(primaryId, duplicateId),
    onSuccess: (r) => setResult(r),
  })

  const primary = entities.find((e) => e.id === primaryId) ?? null
  const duplicate = entities.find((e) => e.id === duplicateId) ?? null
  const ready = Boolean(primary && duplicate && primaryId !== duplicateId)

  /**
   * Backdrop dismissal. Before a merge runs it just closes; after a merge has
   * run it must behave like Done — invalidate the directory cache (the
   * duplicate row is gone server-side), clear pick mode, and navigate to the
   * survivor — so the UI never keeps the merged-away entity selected.
   */
  const dismiss = (): void => {
    if (result) onMerged(result.primary.id)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-lg" role="dialog" aria-modal="true" aria-label="Merge duplicate entities">
      <button type="button" aria-label="Close merge dialog" className="absolute inset-0 bg-black/40" onClick={dismiss} />
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-hairline bg-surface p-xl shadow-xl">
        {!result ? (
          <>
            <div className="flex items-center gap-sm">
              <span className="flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                <GitMerge size={16} />
              </span>
              <h2 className="text-title font-semibold">Merge duplicates</h2>
            </div>

            <div className="mt-lg grid gap-lg sm:grid-cols-2">
              <PickerSelect
                label="Keep"
                hint="The canonical entity that survives."
                entities={entities}
                value={primaryId}
                onChange={setPrimaryId}
              />
              <PickerSelect
                label="Merge into it"
                hint="The duplicate — removed after remapping."
                entities={entities}
                value={duplicateId}
                onChange={setDuplicateId}
              />
            </div>

            {ready && primary && duplicate && (
              <div className="mt-lg rounded-md border border-hairline">
                <ul className="divide-y divide-hairline px-lg">
                  <PreviewRow what="Surviving profile" detail={`${primary.canonicalName} (${primary.type})`} />
                  <PreviewRow
                    what="Mention count"
                    detail={`${primary.mentionCount} + ${duplicate.mentionCount} → ${primary.mentionCount + duplicate.mentionCount}`}
                  />
                  <PreviewRow what="Last seen" detail={formatDate(latestIso(primary.lastSeen, duplicate.lastSeen))} />
                  <PreviewRow what="Memory links · facts · open loops" detail="all references remapped to the survivor" />
                  <PreviewRow what="Aliases" detail="unioned on the survivor" />
                  <PreviewRow what="Derived relationship edges" detail="rebuilt overnight from remapped facts" />
                </ul>
              </div>
            )}

            <p className="mt-lg flex items-start gap-sm text-caption text-ink2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-pending" />
              Nothing captured is ever deleted — memories stay immutable and every fact keeps its provenance. Only the duplicate entity row is folded away.
            </p>

            {merge.isError && (
              <p className="mt-md text-caption text-danger" role="alert">
                {(merge.error as Error).message}
              </p>
            )}

            <div className="mt-lg flex justify-end gap-sm">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={!ready || merge.isPending} onClick={() => merge.mutate()}>
                {merge.isPending ? 'Merging…' : 'Merge'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-title font-semibold">Merged ✓</h2>
            <p className="mt-sm text-sub text-ink2">
              “{duplicate?.canonicalName ?? 'Duplicate'}” now lives inside{' '}
              <Badge tone="accent">{result.primary.canonicalName}</Badge>
            </p>
            <ul className="mt-lg rounded-md border border-hairline px-lg py-sm">
              {REMAP_SUMMARY_ROWS.map(({ key, label }) => (
                <li key={key} className="flex items-center justify-between py-sm text-sub">
                  <span className="text-ink2">{label}</span>
                  <span className="font-medium">{result.remapped[key]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-md text-caption text-ink3">
              * Edges touching the duplicate are re-derived from the remapped facts during tonight's consolidation rebuild.
            </p>
            <div className="mt-lg flex justify-end">
              <Button onClick={() => onMerged(result.primary.id)}>Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Later of two ISO timestamps (null-safe). */
function latestIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}
