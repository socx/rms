import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export function useGetProfile(userId) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get(`/users/${userId}`).then(r => r.data.data.user),
    enabled: !!userId,
  });
}

export function useUpdateProfile(userId) {
  return useMutation({
    mutationFn: (fields) =>
      api.patch(`/users/${userId}`, fields).then(r => r.data.data.user),
  });
}

export function useChangePassword(userId) {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }) =>
      api.post(`/users/${userId}/change-password`, { currentPassword, newPassword })
        .then(r => r.data.data),
  });
}
