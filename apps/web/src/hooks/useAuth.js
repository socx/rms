import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export function useRegister() {
  return useMutation({
    mutationFn: ({ firstname, lastname, email, password }) =>
      api.post('/auth/register', { firstname, lastname, email, password }).then(r => r.data.data),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: ({ email, password }) =>
      api.post('/auth/login', { email, password }).then(r => r.data.data),
    onSuccess(data) {
      localStorage.setItem('rms_token', data.token);
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled() {
      localStorage.removeItem('rms_token');
    },
  });
}

export function getStoredToken() {
  return localStorage.getItem('rms_token');
}
