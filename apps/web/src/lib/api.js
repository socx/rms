import axios from 'axios';

// VITE_API_URL must be set to the full API origin in production builds
// (e.g. https://api.example.com/api/v1). Local dev leaves it unset and
// relies on the Vite proxy configured in vite.config.js.
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export const api = axios.create({ baseURL: BASE_URL, withCredentials: true });

// Attach JWT from localStorage if present
api.interceptors.request.use(config => {
  const token = localStorage.getItem('rms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally — redirect to login (but not for the login endpoint itself)
api.interceptors.response.use(
  res => res,
  err => {
    const isLoginEndpoint = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLoginEndpoint) {
      localStorage.removeItem('rms_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
