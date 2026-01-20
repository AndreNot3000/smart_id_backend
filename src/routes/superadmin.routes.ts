import { Hono } from 'hono';
import { z } from 'zod';
import { getInstitutionsCollection } from '../database/connection.js';

const superadmin = new Hono();

// Super Admin API Key middleware (simple protection)
const superAdminAuth = async (c: any, next: any) => {
  const apiKey = c.req.header('X-Super-Admin-Key');
  const validKey = process.env.SUPER_ADMIN_KEY || 'your-super-secret-key-change-this';
  
  if (!apiKey || apiKey !== validKey) {
    return c.json({ error: 'Unauthorized - Invalid super admin key' }, 401);
  }
  
  await next();
};

// Apply middleware to all routes
superadmin.use('*', superAdminAuth);

// Validation schema
const createInstitutionSchema = z.object({
  name: z.string().min(2, 'Institution name must be at least 2 characters'),
  code: z.string().min(3, 'Institution code must be at least 3 characters').max(20),
  domain: z.string().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
});

// Create Institution
superadmin.post('/institutions', async (c) => {
  try {
    const body = await c.req.json();
    const data = createInstitutionSchema.parse(body);

    const institutionsCollection = getInstitutionsCollection();

    // Check if institution code already exists
    const existing = await institutionsCollection.findOne({ 
      code: data.code.toUpperCase() 
    });
    
    if (existing) {
      return c.json({ error: 'Institution code already exists' }, 400);
    }

    // Create institution
    const newInstitution = {
      name: data.name,
      code: data.code.toUpperCase(),
      domain: data.domain || '',
      status: data.status as 'active' | 'inactive' | 'suspended',
      settings: {
        allowStudentSelfRegistration: false,
        requireEmailVerification: true
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await institutionsCollection.insertOne(newInstitution);

    return c.json({
      message: 'Institution created successfully',
      institution: {
        id: result.insertedId.toString(),
        name: newInstitution.name,
        code: newInstitution.code,
        status: newInstitution.status
      }
    }, 201);

  } catch (error) {
    console.error('Create institution error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'Failed to create institution' }, 500);
  }
});

// List all institutions
superadmin.get('/institutions', async (c) => {
  try {
    const institutionsCollection = getInstitutionsCollection();
    
    const institutions = await institutionsCollection.find({}).toArray();

    return c.json({
      institutions: institutions.map(inst => ({
        id: inst._id?.toString(),
        name: inst.name,
        code: inst.code,
        domain: inst.domain,
        status: inst.status,
        createdAt: inst.createdAt
      }))
    });
  } catch (error) {
    console.error('List institutions error:', error);
    return c.json({ error: 'Failed to fetch institutions' }, 500);
  }
});

// Update institution status
superadmin.patch('/institutions/:code/status', async (c) => {
  try {
    const code = c.req.param('code');
    const { status } = await c.req.json();

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }

    const institutionsCollection = getInstitutionsCollection();
    
    const result = await institutionsCollection.updateOne(
      { code: code.toUpperCase() },
      { 
        $set: { 
          status,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return c.json({ error: 'Institution not found' }, 404);
    }

    return c.json({ 
      message: 'Institution status updated successfully',
      code: code.toUpperCase(),
      status
    });

  } catch (error) {
    console.error('Update institution status error:', error);
    return c.json({ error: 'Failed to update institution status' }, 500);
  }
});

// Delete institution (soft delete - set to inactive)
superadmin.delete('/institutions/:code', async (c) => {
  try {
    const code = c.req.param('code');

    const institutionsCollection = getInstitutionsCollection();
    
    const result = await institutionsCollection.updateOne(
      { code: code.toUpperCase() },
      { 
        $set: { 
          status: 'inactive',
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return c.json({ error: 'Institution not found' }, 404);
    }

    return c.json({ 
      message: 'Institution deactivated successfully',
      code: code.toUpperCase()
    });

  } catch (error) {
    console.error('Delete institution error:', error);
    return c.json({ error: 'Failed to delete institution' }, 500);
  }
});

export default superadmin;
