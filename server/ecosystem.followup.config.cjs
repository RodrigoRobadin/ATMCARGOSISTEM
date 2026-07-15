module.exports = {
  apps: [
    {
      name: 'crm-followup-reminders',
      script: 'scripts/followupReminderWorker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
