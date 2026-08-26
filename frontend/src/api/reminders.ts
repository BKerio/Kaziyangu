import api from '@/api/client';
import type { ReminderChannel, TaskReminder } from '@/types/api';

export interface ReminderInput {
  taskId: string;
  dueAt: string; // ISO instant
  channels: ReminderChannel[];
  repeatCount: number;
}

export type ReminderUpdateInput = Partial<Omit<ReminderInput, 'taskId'>>;

export async function listReminders(): Promise<TaskReminder[]> {
  const res = await api.get('/reminders');
  return res.data.data as TaskReminder[];
}

export async function createReminder(input: ReminderInput): Promise<TaskReminder> {
  const res = await api.post('/reminders', input);
  return res.data.data as TaskReminder;
}

export async function updateReminder(id: string, patch: ReminderUpdateInput): Promise<TaskReminder> {
  const res = await api.patch(`/reminders/${id}`, patch);
  return res.data.data as TaskReminder;
}

export async function deleteReminder(id: string): Promise<void> {
  await api.delete(`/reminders/${id}`);
}
