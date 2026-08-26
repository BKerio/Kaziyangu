import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { TaskOptions } from '@/types/api';

/** Vertical / category / status dropdown options - static, so cached indefinitely. */
export function useTaskOptions() {
  return useQuery({
    queryKey: ['tasks', 'options'],
    queryFn: async () => {
      const res = await api.get('/tasks/options');
      return res.data.data as TaskOptions;
    },
    staleTime: Infinity,
  });
}
