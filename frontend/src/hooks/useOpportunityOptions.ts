import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { CustomerOption, Oem, StaffContact } from '@/types/api';

/** Active internal staff (non-attachees) who can sit on a deal team. */
export function useTeamDirectory() {
  return useQuery({
    queryKey: ['opportunities', 'team-directory'],
    queryFn: async () => (await api.get<{ data: StaffContact[] }>('/opportunities/team-directory')).data.data,
    staleTime: 5 * 60_000,
  });
}

export function useCustomerOptions() {
  return useQuery({
    queryKey: ['customers', 'options'],
    queryFn: async () => (await api.get<{ data: CustomerOption[] }>('/customers/options')).data.data,
  });
}

export function useOems() {
  return useQuery({
    queryKey: ['oems'],
    queryFn: async () => (await api.get<{ data: Oem[] }>('/oems')).data.data,
  });
}
