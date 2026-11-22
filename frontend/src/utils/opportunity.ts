import { DealRegStatus, OpportunityPriority, OpportunityStage, PRIORITY_OPTIONS, STAGE_OPTIONS } from '@/types/api';

export function formatKsh(value?: number | null): string {
  if (value == null) return '-';
  if (Math.abs(value) >= 1_000_000) return `KSh ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `KSh ${(value / 1_000).toFixed(1)}K`;
  return `KSh ${value.toLocaleString()}`;
}

export function stagePillClass(stage: OpportunityStage): string {
  switch (stage) {
    case 'NEW': return 'pill pill-gray';
    case 'QUALIFICATION':
    case 'ASSIGNED': return 'pill pill-blue';
    case 'ENGAGEMENT':
    case 'PROPOSAL': return 'pill pill-gold';
    case 'NEGOTIATION': return 'pill pill-amber';
    case 'WON': return 'pill pill-green';
    case 'LOST': return 'pill pill-red';
  }
}

export function priorityPillClass(priority: OpportunityPriority): string {
  switch (priority) {
    case 'LOW': return 'pill pill-gray';
    case 'MEDIUM': return 'pill pill-blue';
    case 'HIGH': return 'pill pill-amber';
    case 'CRITICAL': return 'pill pill-red';
  }
}

export function stageLabel(stage: string) {
  return STAGE_OPTIONS.find((s) => s.value === stage)?.label ?? stage;
}
export function priorityLabel(priority: string) {
  return PRIORITY_OPTIONS.find((p) => p.value === priority)?.label ?? priority;
}

export function dealRegPillClass(status: DealRegStatus): string {
  switch (status) {
    case 'APPROVED': return 'pill pill-green';
    case 'PENDING': return 'pill pill-amber';
    case 'REJECTED':
    case 'EXPIRED': return 'pill pill-red';
    default: return 'pill pill-gray';
  }
}

export function optionLabel<T extends string>(options: { value: T; label: string }[], value: T | string | null | undefined) {
  return options.find((o) => o.value === value)?.label ?? value ?? '';
}

/** wa.me link for a Kenyan-style number ("0712 345678" -> 254712345678). */
export function whatsappLink(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  return digits.length >= 9 ? `https://wa.me/${digits}` : null;
}

/** Current best estimate of an opportunity's value. */
export function currentValue(o: { revisedValue?: number | null; proposedValue?: number | null; estimatedValue?: number | null }) {
  return o.revisedValue ?? o.proposedValue ?? o.estimatedValue ?? null;
}

/** Days until a date (negative when past), or null. */
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/** ISO string -> value for <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value -> ISO string ('' stays ''). */
export function fromLocalInput(v?: string): string | undefined {
  if (v === undefined) return undefined;
  return v ? new Date(v).toISOString() : '';
}
