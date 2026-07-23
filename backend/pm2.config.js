module.exports = {
  apps: [
    {
      name: 'akshar', // Main app
      script: 'server.js',
      instances: 1, // Single instance, change to 'max' for clustering
      exec_mode: 'fork', // Use 'cluster' if you want load balancing
      watch: false, // Turn off for production
      autorestart: true,
      node_args: '--max-old-space-size=500',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
    },
  ],
};
