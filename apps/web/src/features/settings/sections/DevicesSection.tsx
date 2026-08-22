import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Smartphone, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ApiError } from '../../../api/client'
import { Badge } from '../../../components/ui/Badge'
import {
  SettingsSection,
  StatusBanner,
} from '../ui'
import { listDeviceTokens, removeDeviceToken } from '../api'

/**
 * S-4 — connected devices (registered push tokens) with remove.
 *
 * The list/remove endpoints are planned but not shipped server-side yet
 * (webdocs/backend-api-gaps.md). Until they land, the section renders an
 * honest "not available yet" notice instead of pretending to work; once the
 * endpoints exist this component works unchanged.
 */

function isMissingEndpoint(err: Error | null): boolean {
  return err instanceof ApiError && (err.status === 404 || err.code === 'not_found');
}

function relativeDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  return then.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function DevicesSection() {
  const query = useQuery({
    queryKey: ['settings', 'devices'],
    queryFn: listDeviceTokens,
    retry: false,
    staleTime: 30_000,
  })
  const queryClient = useQueryClient()

  const remove = useMutation<void, Error, string>({
    mutationFn: removeDeviceToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'devices'] }),
  })

  const missing = isMissingEndpoint(query.error)

  function handleRemove(id: string): void {
    if (!window.confirm('Remove this device? It will stop receiving push notifications.')) {
      return
    }
    remove.mutate(id)
  }

  return (
    <SettingsSection
      id="devices"
      title="Connected devices"
      description="Phones and tablets registered for push notifications."
    >
      {query.isPending ? (
        <p className="flex items-center gap-sm text-sub text-ink2">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      ) : null}

      {missing ? (
        <StatusBanner
          kind="error"
          message="The server doesn't expose device management yet. This section will light up automatically once the endpoint ships (see backend-api-gaps.md)."
        />
      ) : null}

      {!missing && query.isError ? (
        <StatusBanner kind="error" message="Could not load your devices." />
      ) : null}

      {query.data ? (
        query.data.items.length === 0 ? (
          <p className="text-sub text-ink2">
            No devices registered yet — sign in on the mobile app to add one.
          </p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {query.data.items.map((device) => (
              <li
                key={device.id}
                className="flex items-center justify-between gap-md rounded-md border border-hairline bg-surface-alt px-md py-sm"
              >
                <div className="flex min-w-0 items-center gap-md">
                  <Smartphone size={18} className="shrink-0 text-ink2" />
                  <div className="min-w-0">
                    <p className="truncate text-body text-ink">{device.deviceId}</p>
                    <p className="text-micro text-ink3">
                      Last updated {relativeDate(device.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-sm">
                  <Badge tone="neutral">push</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${device.deviceId}`}
                    disabled={remove.isPending}
                    onClick={() => handleRemove(device.id)}
                  >
                    {remove.isPending && remove.variables === device.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {remove.isError ? (
        <StatusBanner
          kind="error"
          message={
            isMissingEndpoint(remove.error)
              // 404 is ambiguous: no delete route yet, or the token is already
              // gone. Phrase it so it stays accurate after the endpoint ships.
              ? 'Remove failed — this device may already be unregistered, or device management isn\'t available on the server yet.'
              : 'Could not remove the device.'
          }
        />
      ) : null}
    </SettingsSection>
  )
}
