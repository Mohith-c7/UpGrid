import type { CompanyStage } from '@/api/opsTypes';
export const STAGES: { value: CompanyStage; label: string }[] = [
  { value: 'prospect', label: 'Prospect' }, { value: 'contacted', label: 'Contacted' }, { value: 'interested', label: 'Interested' },
  { value: 'mou', label: 'MoU signed' }, { value: 'hiring', label: 'Hiring' },
];
export const stageLabel = (s: string) => STAGES.find((x) => x.value === s)?.label ?? s;
export const stageTone = (s: string) => (s === 'hiring' || s === 'mou' ? 'success' : s === 'interested' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';
