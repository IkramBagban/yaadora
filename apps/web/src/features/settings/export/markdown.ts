import type { Memory } from '../../../api/types'
import type { AccountExport } from './exportClient'

/**
 * Markdown journal serializer for the data export (S-3). Memories become a
 * day-by-day journal; open loops and reminders are appended as compact
 * appendix lists so nothing actionable is lost.
 */

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function memoryDay(m: Memory): string {
  return (m.occurredAt ?? m.createdAt).slice(0, 10);
}

function formatMemoryTimestamp(m: Memory): string {
  const d = new Date(m.occurredAt ?? m.createdAt);
  return Number.isNaN(d.getTime()) ? '—' : TIME_FORMAT.format(d);
}

/** Keep newlines inside one list item via aligned continuation lines. */
function indentLines(text: string): string {
  return text.trimEnd().replace(/\r?\n/g, '\n  ');
}

function journalSection(memories: Memory[]): string[] {
  const byDay = new Map<string, Memory[]>();
  for (const m of memories) {
    const day = memoryDay(m);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(m);
    else byDay.set(day, [m]);
  }

  const lines: string[] = ['', '## Journal', ''];
  for (const day of [...byDay.keys()].sort()) {
    const entries = byDay.get(day)!;
    lines.push(`### ${DAY_FORMAT.format(new Date(`${day}T00:00:00`))}`, '');
    for (const m of entries) {
      lines.push(
        `- **${formatMemoryTimestamp(m)}** · ${m.source}${m.status !== 'processed' ? ` · _(${m.status})_` : ''} — ${indentLines(m.rawText)}`,
      );
    }
    lines.push('');
  }
  return lines;
}

function listAppendix(title: string, rows: string[]): string[] {
  if (rows.length === 0) return [];
  return [`## ${title}`, '', ...rows.map((r) => `- ${r}`), ''];
}

export function buildMarkdownJournal(exportData: AccountExport): string {
  const header = [
    '# Yaadora journal',
    '',
    `Exported ${DAY_FORMAT.format(new Date(exportData.exportedAt))}.`,
    `${exportData.memories.length} memories · ${exportData.facts.length} facts · ${exportData.entities.length} entities.`,
    '',
  ];

  const loops = exportData.openLoops.map((loop) => {
    const due = loop.dueAt ? ` · due ${loop.dueAt.slice(0, 10)}` : '';
    return `${loop.title} _(${loop.kind}, ${loop.status}${due})_`;
  });

  const reminders = exportData.reminders.map((r) =>
    `${r.text} — ${r.dueAt.slice(0, 16).replace('T', ' ')}`,
  );

  return [
    ...header,
    ...journalSection(exportData.memories),
    ...listAppendix('Open loops', loops),
    ...listAppendix('Reminders', reminders),
  ].join('\n');
}
