// Simple script to keep Render service warm
// Run this locally or use a cron service like cron-job.org

const RENDER_URL = 'https://smart-id-exvb.onrender.com';

async function pingServer() {
  try {
    const response = await fetch(RENDER_URL);
    const data = await response.json();
    console.log(`✅ Ping successful at ${new Date().toISOString()}:`, data.message);
  } catch (error) {
    console.log(`❌ Ping failed at ${new Date().toISOString()}:`, error.message);
  }
}

// Ping every 10 minutes (600,000 ms)
setInterval(pingServer, 10 * 60 * 1000);

// Initial ping
pingServer();

console.log('🔄 Keep-warm service started. Pinging every 10 minutes...');