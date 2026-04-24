// PM2 process configuration for the RMS API server and dispatch worker.
// Start with: pm2 start ecosystem.config.cjs
// Reload with: pm2 reload all

module.exports = {
  apps: [
    {
      name: 'rms-api',
      script: 'apps/api/src/index.js',
      instances: 1,          // Increase for multi-core. Ensure Redis rate limiting is enabled first.
      exec_mode: 'fork',
      watch: false,
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/rms/api-error.log',
      out_file:   '/var/log/rms/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
    },
    {
      name: 'rms-worker',
      script: 'apps/worker/main.py',
      interpreter: 'apps/worker/.venv/bin/python3',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      error_file: '/var/log/rms/worker-error.log',
      out_file:   '/var/log/rms/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
};
