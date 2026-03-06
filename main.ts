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
import qrRoutes from './src/routes/qr.routes.js';
import paymentRoutes from './src/routes/payment.routes.js';

// Database
import { initDatabase } from './src/database/connection.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', prettyJSON());

// CORS Configuration - supports multiple origins including Ngrok
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map(origin => origin.trim()) || ['http://localhost:3000'];

app.use('*', cors({
  origin: (origin) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return '*';
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) return origin;
    
    // Allow all Ngrok domains (*.ngrok-free.dev, *.ngrok.io, *.ngrok-free.app)
    if (origin.includes('.ngrok-free.dev') || 
        origin.includes('.ngrok.io') || 
        origin.includes('.ngrok-free.app')) {
      return origin;
    }
    
    // Allow Vercel preview deployments
    if (origin.includes('.vercel.app')) {
      return origin;
    }
    
    return allowedOrigins[0]; // fallback to first allowed origin
  },
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
app.route('/api/qr', qrRoutes);
app.route('/api/payments', paymentRoutes);

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
    
    // Start the Bun server
    Bun.serve({
      port: port,
      hostname: '0.0.0.0', // Listen on all interfaces (required for VPS)
      fetch: app.fetch,
    });
    
    console.log(`🚀 Server running on http://0.0.0.0:${port}`);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
