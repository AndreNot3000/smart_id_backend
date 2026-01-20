import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

// Routes
import authRoutes from './src/routes/auth.routes.js';
import superadminRoutes from './src/routes/superadmin.routes.js';
import userRoutes from './src/routes/user.routes.js';
import adminRoutes from './src/routes/admin.routes.js';

// Database
import { initDatabase } from './src/database/connection.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Super-Admin-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Health check
app.get('/', (c) => {
  return c.json({ 
    message: 'Campus ID SAAS API Server', 
    version: '1.0.0',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.route('/api/auth', authRoutes);
app.route('/api/superadmin', superadminRoutes);
app.route('/api/users', userRoutes);
app.route('/api/admin', adminRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Route not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server Error:', err);
  return c.json({ 
    error: 'Internal Server Error',
    message: err.message 
  }, 500);
});

// Initialize database and start server
async function startServer() {
  try {
    await initDatabase();
    console.log('✅ Database connected successfully');
    
    const port = parseInt(process.env.PORT || '8000');
    console.log(`🚀 Server running on http://localhost:${port}`);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// For Bun
export default {
  port: parseInt(process.env.PORT || '8000'),
  fetch: app.fetch,
};
