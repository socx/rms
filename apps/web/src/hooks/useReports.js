import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const reportsKey = (eventId, reminderId) => ['reports', eventId, reminderId];

export function useListReports(eventId, reminderId, { page = 1, perPage = 20 } = {}) {
  return useQuery({
    queryKey: [...reportsKey(eventId, reminderId), page, perPage],
    queryFn: () =>
      api.get(`/events/${eventId}/reminders/${reminderId}/report`, {
        params: { page, per_page: perPage },
      }).then(r => r.data),
    enabled: !!eventId && !!reminderId,
  });
}
