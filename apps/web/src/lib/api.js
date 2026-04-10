import axios from 'axios';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

// Attach JWT from localStorage if present
api.interceptors.request.use(config => {
  const token = localStorage.getItem('rms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally — redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('rms_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
