import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const listKey = (params) => ['events', params];

export function useListEvents({ q = '', limit = 50, offset = 0 } = {}) {
  return useQuery({
    queryKey: listKey({ q, limit, offset }),
    queryFn: () =>
      api.get('/events', { params: { ...(q ? { q } : {}), limit, offset } })
        .then(r => r.data.data.events),
  });
}

export function useGetEvent(id) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => api.get(`/events/${id}`).then(r => r.data.data.event),
    enabled: !!id,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) =>
      api.post('/events', data).then(r => r.data.data.event),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) =>
      api.patch(`/events/${id}`, data).then(r => r.data.data.event),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['event', id] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId) =>
      api.post(`/events/${eventId}/cancel`).then(r => r.data.data.event),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
}
