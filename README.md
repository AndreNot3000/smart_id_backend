<<<<<<< HEAD
# smart_id_backend
=======
# 🎓 Campus ID SAAS Backend

A comprehensive multi-tenant Software as a Service (SAAS) backend for student smart ID systems. This system enables universities and educational institutions to manage students, lecturers, and administrators with secure authentication and user management.

## ✨ Features

- 🏫 **Multi-Tenant Architecture** - Support for multiple institutions
- 👥 **Role-Based Access Control** - Admin, Student, Lecturer roles
- 🔐 **Secure Authentication** - JWT tokens, email verification, password security
- 📧 **Magic Link Verification** - One-click email verification for students/lecturers
- 🎯 **Admin Dashboard** - Complete user management and statistics
- 🔒 **Password Security** - History tracking, complexity requirements
- 📱 **Dual Login Options** - Email or ID-based login for flexibility
- 🌐 **RESTful API** - Complete API for frontend integration

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas account
- Mailtrap account (for email testing)

### Installation
```bash
# Clone repository
git clone <your-repo-url>
cd campus-id-backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run dev
```

### First Setup
1. **Create Institution** (Super Admin):
```bash
POST http://localhost:8000/api/superadmin/institutions
Headers: X-Super-Admin-Key: andrenaline
Body: { "name": "Your University", "code": "UNIV", "domain": "university.edu" }
```

2. **Register Admin**:
```bash
POST http://localhost:8000/api/auth/admin/register
Body: { "institutionCode": "UNIV", "adminEmail": "admin@university.edu", ... }
```

3. **Start Creating Users** via admin dashboard!

## 📚 Documentation

- **[API Reference](API_REFERENCE.md)** - Complete API documentation with examples
- **[Setup Guide](SETUP_GUIDE.md)** - Detailed installation and configuration
- **[User Guide](USER_GUIDE.md)** - How to use the system for all user roles

## 🏗️ Architecture

### User Roles
- **Super Admin** - Creates and manages institutions
- **Institution Admin** - Manages students, lecturers, and institution settings
- **Students** - Access student dashboard, manage profile
- **Lecturers** - Access lecturer dashboard, manage profile

### Key Components
- **Authentication System** - JWT-based with email verification
- **User Management** - Complete CRUD operations for all user types
- **Email Service** - Magic links and OTP verification
- **Dashboard APIs** - Statistics and user management
- **Security Layer** - Password policies, role-based access

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login` - User login (all types)
- `POST /api/auth/admin/register` - Admin registration
- `GET /api/auth/verify-email` - Magic link verification
- `POST /api/auth/forgot-password` - Password reset

### Super Admin
- `POST /api/superadmin/institutions` - Create institution
- `GET /api/superadmin/institutions` - List institutions

### Admin Management
- `POST /api/admin/students` - Create student account
- `POST /api/admin/lecturers` - Create lecturer account
- `GET /api/admin/students` - List students
- `GET /api/admin/lecturers` - List lecturers

### User Management
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `PUT /api/users/change-password` - Change password
- `GET /api/users/dashboard-stats` - Dashboard statistics

## 🔒 Security Features

- **JWT Authentication** with access and refresh tokens
- **Email Verification** via magic links (24-hour expiry)
- **Password Security** - History tracking, complexity requirements
- **Role-Based Access** - Endpoint-level permission control
- **Institution Isolation** - Multi-tenant data separation
- **Rate Limiting** and input validation

## 🎯 User Flows

### Student Onboarding
1. Admin creates student account
2. Student receives magic link email
3. Student clicks link → account activated
4. Student logs in → required to change password
5. Student accesses dashboard

### Lecturer Onboarding
1. Admin creates lecturer account with role (Prof, Dr, Mr, Mrs, Ms)
2. Lecturer receives role-specific activation email
3. Same activation and login flow as students
4. Access to lecturer-specific dashboard

## 🛠️ Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Hono.js (lightweight, fast)
- **Database**: MongoDB Atlas
- **Authentication**: JWT tokens
- **Email**: Nodemailer with Mailtrap (development)
- **Validation**: Zod schema validation
- **Security**: bcrypt password hashing

## 📊 Database Schema

### Users Collection
```typescript
{
  email: string,
  passwordHash: string,
  userType: 'admin' | 'student' | 'lecturer',
  institutionId: ObjectId,
  status: 'active' | 'pending' | 'suspended',
  profile: {
    firstName: string,
    lastName: string,
    studentId?: string,      // For students
    lecturerId?: string,     // For lecturers  
    role?: string,           // For lecturers (Prof, Dr, etc.)
    department: string,
    // ... other fields
  }
}
```

### Institutions Collection
```typescript
{
  name: string,
  code: string,           // Unique identifier (HARV, MIT, etc.)
  domain: string,         // Email domain (harvard.edu)
  status: 'active' | 'inactive'
}
```

## 🔄 Development Workflow

### Adding New Features
1. Update models in `src/models/`
2. Add routes in `src/routes/`
3. Implement services in `src/services/`
4. Add middleware if needed
5. Update API documentation

### Testing
```bash
# Run tests
npm test

# Test specific endpoint
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@university.edu","password":"password","userType":"admin"}'
```

## 🚀 Deployment

### Environment Variables
```env
NODE_ENV=production
MONGODB_URL=your-production-mongodb-url
JWT_SECRET=your-production-jwt-secret
CORS_ORIGIN=https://yourdomain.com
```

### Production Checklist
- [ ] Update JWT secrets
- [ ] Configure production database
- [ ] Set up production email service
- [ ] Configure CORS for production domain
- [ ] Set up SSL/HTTPS
- [ ] Configure monitoring and logging

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check the guides in this repository
- **Issues**: Open an issue on GitHub
- **API Reference**: See [API_REFERENCE.md](API_REFERENCE.md)

## 🎉 Acknowledgments

- Built with [Hono.js](https://hono.dev/) for high performance
- MongoDB Atlas for reliable database hosting
- Mailtrap for email testing during development

---

**Ready to build the future of campus management!** 🚀
>>>>>>> 43aaf9c (commit before render)
