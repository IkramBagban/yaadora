import { getAdminUsageCells } from "@repo/db";
import type { UsageGranularity } from "@repo/db";
import {
  estimateUsageCostUsd,
  findUnknownModels,
} from "@repo/core";
import { createLogger } from "@repo/logger";
import { badRequest, json, serverError } from "../../http";
import { requireAdmin } from "./guard";
import { requireUuidParam } from "./util";

const log = createLogger("server:admin:usage");

/**
 * GET /admin/users/:id/usage?granularity=day|week|month&span=6 (issue #31):
 * ai_usage_daily grouped period × tier × model × phase with totals; USD is a
 * price-map estimate (@repo/core prices.ts) — unknown models cost $0 and are
 * surfaced in totals.unknownModels so stale prices are visible, not silent.
 */

const GRANULARITIES: readonly UsageGranularity[] = ["day", "week", "month"];

function parseParams(url: URL): {
  granularity: UsageGranularity;
  span: number;
} | null {
  const rawGran = url.searchParams.get("granularity") ?? "day";
  if (!GRANULARITIES.includes(rawGran as UsageGranularity)) return null;
  const rawSpan = url.searchParams.get("span") ?? "6";
  const span = Number(rawSpan);
  if (!Number.isInteger(span) || span < 1 || span > 24) return null;
  return { granularity: rawGran as UsageGranularity, span };
}

/** GET /admin/users/:id/usage — token matrix + estimated cost totals. */
export async function getAdminUserUsageRoute(
  req: Request & { params: Record<string, string> },
): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const id = requireUuidParam(req.params.id!, "User");
  if ("response" in id) return id.response;

  const parsed = parseParams(new URL(req.url));
  if (!parsed) {
    return badRequest(
      "granularity must be day|week|month and span an integer 1-24.",
    );
  }

  try {
    const cells = await getAdminUsageCells({
      userId: id.id,
      granularity: parsed.granularity,
      span: parsed.span,
    });

    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const c of cells) {
      calls += c.calls;
      inputTokens += c.inputTokens;
      outputTokens += c.outputTokens;
    }

    return json({
      rows: cells.map((c) => ({
        period: c.period,
        tier: c.tier,
        model: c.model,
        phase: c.phase,
        calls: c.calls,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
      })),
      totals: {
        calls,
        inputTokens,
        outputTokens,
        costEstimateUsd: estimateUsageCostUsd(cells),
        // Additive over the UI contract: models without a price-map entry.
        unknownModels: findUnknownModels(cells),
      },
    });
  } catch (err) {
    log.error("getAdminUserUsage failed", err as Error);
    return serverError();
  }
}
