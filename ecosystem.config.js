module.exports = {
  apps: [{
    name: 'food-scraper',
    script: 'server.js',
    autorestart: true,
    watch: false,
    max_memory_restart: '3G',
    kill_timeout: 5000,
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
};