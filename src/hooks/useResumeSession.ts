import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionView } from '../../shared/apiTypes';
import { ApiError, api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export const sessionKey = (id: string) => ['resume-session', id] as const;

export function useResumeSession(id: string | undefined) {
  return useQuery({
    queryKey: sessionKey(id || ''),
    queryFn: () => api.get(id!),
    enabled: !!id,
    staleTime: Infinity,
    retry: (count, err) => !(err instanceof ApiError && [401, 404].includes(err.status)) && count < 2,
  });
}

/**
 * Wraps a server mutation that returns the updated SessionView. The cache is
 * only replaced on success, so a failed edit never clears the visible resume.
 */
export function useSessionMutation<A>(id: string, fn: (arg: A) => Promise<SessionView | { session: SessionView }>, opts: { successMessage?: string; silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['session-mutation', id],
    mutationFn: fn,
    onSuccess: (result) => {
      const view = 'session' in result ? result.session : result;
      qc.setQueryData(sessionKey(id), view);
      if (opts.successMessage) toast({ title: opts.successMessage });
    },
    onError: (err: unknown) => {
      if (!opts.silent) toast({ title: 'Something went wrong', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' });
      // Resync in case the server stored an error message in the chat.
      qc.invalidateQueries({ queryKey: sessionKey(id) });
    },
  });
}

export function useSaving(id: string) {
  return useIsMutating({ mutationKey: ['session-mutation', id] }) > 0;
}
