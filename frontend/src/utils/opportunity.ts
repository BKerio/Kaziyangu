import { OpportunityPriority, OpportunityStage, PRIORITY_OPTIONS, STAGE_OPTIONS } from '@/types/api';

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
