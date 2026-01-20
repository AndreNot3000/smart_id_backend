import nodemailer from 'nodemailer';

// Create transporter for Mailtrap
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT || '2525'),
    secure: false, // Mailtrap uses port 2525 (not secure)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// Email service for sending OTP and other notifications
export async function sendOTPEmail(email: string, code: string, purpose: string): Promise<void> {
  try {
    const transporter = createTransporter();

    const subject = purpose === 'email_verification' 
      ? 'Campus ID - Email Verification Code' 
      : 'Campus ID - Password Reset Code';
      
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">🎓 Campus ID System</h1>
        </div>
        
        <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; border-left: 4px solid #007bff;">
          <h2 style="color: #333; margin-top: 0;">
            ${purpose === 'email_verification' ? 'Email Verification' : 'Password Reset'}
          </h2>
          
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            ${purpose === 'email_verification' 
              ? 'Please use the following code to verify your email address:' 
              : 'Please use the following code to reset your password:'}
          </p>
          
          <div style="background: #ffffff; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; border: 2px dashed #007bff;">
            <span style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 3px;">${code}</span>
          </div>
          
          <p style="color: #666; font-size: 14px; margin-bottom: 0;">
            ⏰ This code will expire in 10 minutes for security reasons.
          </p>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
          <p style="color: #856404; font-size: 14px; margin: 0;">
            <strong>Security Notice:</strong> If you didn't request this code, please ignore this email or contact your institution administrator.
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 12px; margin: 0;">

          Campus ID System - Secure Student Management Platform
          </p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Campus ID System" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      html,
    });

    console.log(`✅ ${purpose} email sent to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send ${purpose} email to ${email}:`, error);
    // Don't throw error to prevent breaking the flow
    // In production, you might want to implement retry logic
  }
}

export async function sendWelcomeEmail(email: string, name: string, userType: string): Promise<void> {
  console.log(`📧 Welcome email for ${name} (${email}) - ${userType}`);
  
  // Implement welcome email logic here
}

export async function sendStudentActivationEmail(
  email: string, 
  firstName: string, 
  lastName: string, 
  studentId: string, 
  defaultPassword: string, 
  verificationToken: string,
  institutionName: string
): Promise<void> {
  try {
    const transporter = createTransporter();
    
    const activationLink = `${process.env.BACKEND_URL}/api/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #2c3e50; margin: 0; font-size: 28px;">🎓 ${institutionName}</h1>
          <p style="color: #7f8c8d; margin: 10px 0 0 0; font-size: 16px;">Student Account Activation</p>
        </div>
        
        <!-- Welcome Message -->
        <div style="background: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #2c3e50; margin-top: 0;">Welcome ${firstName} ${lastName}!</h2>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Your student account has been created successfully. Please find your login credentials below and activate your account.
          </p>
        </div>
        
        <!-- Credentials Box -->
        <div style="background: #e8f4fd; padding: 25px; border-radius: 10px; margin-bottom: 25px; border-left: 5px solid #007bff;">
          <h3 style="color: #007bff; margin-top: 0; margin-bottom: 15px;">📋 Your Login Credentials</h3>
          <div style="background: white; padding: 20px; border-radius: 8px; font-family: 'Courier New', monospace;">
            <div style="margin-bottom: 10px;">
              <strong style="color: #333;">Student ID:</strong> 
              <span style="color: #007bff; font-size: 18px; font-weight: bold;">${studentId}</span>
            </div>
            <div style="margin-bottom: 10px;">
              <strong style="color: #333;">Email:</strong> 
              <span style="color: #007bff;">${email}</span>
            </div>
            <div>
              <strong style="color: #333;">Default Password:</strong> 
              <span style="color: #dc3545; font-weight: bold;">${defaultPassword}</span>
            </div>
          </div>
        </div>
        
        <!-- Activation Button -->
        <div style="text-align: center; margin: 30px 0;">
          <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 20px; border-radius: 10px;">
            <h3 style="color: white; margin-top: 0; margin-bottom: 15px;">🔗 Activate Your Account</h3>
            <p style="color: #e3f2fd; margin-bottom: 20px;">Click the button below to verify your email and activate your account:</p>
            <a href="${activationLink}" 
               style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);">
              ✅ ACTIVATE ACCOUNT
            </a>
            <p style="color: #e3f2fd; font-size: 12px; margin-top: 15px; margin-bottom: 0;">
              This link will expire in 24 hours
            </p>
          </div>
        </div>
        
        <!-- Next Steps -->
        <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h3 style="color: #2c3e50; margin-top: 0;">📝 Next Steps</h3>
          <ol style="color: #555; line-height: 1.8; padding-left: 20px;">
            <li>Click the activation link above</li>
            <li>You'll be redirected to the login page</li>
            <li>Login using your <strong>Student ID</strong> or <strong>Email</strong></li>
            <li>Change your password after first login (required for security)</li>
          </ol>
        </div>
        
        <!-- Login Options -->
        <div style="background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 5px solid #ffc107;">
          <h4 style="color: #856404; margin-top: 0;">💡 Login Options</h4>
          <p style="color: #856404; margin-bottom: 10px;">You can login using either:</p>
          <ul style="color: #856404; margin-bottom: 15px;">
            <li><strong>Student ID:</strong> ${studentId}</li>
            <li><strong>Email:</strong> ${email}</li>
          </ul>
          <p style="color: #856404; margin: 0;">
            <strong>Login URL:</strong> <a href="${loginUrl}" style="color: #007bff;">${loginUrl}</a>
          </p>
        </div>
        
        <!-- Security Notice -->
        <div style="background: #f8d7da; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 5px solid #dc3545;">
          <h4 style="color: #721c24; margin-top: 0;">⚠️ Important Security Notice</h4>
          <p style="color: #721c24; margin: 0;">
            For security reasons, you will be required to change your password after your first login. 
            Keep your credentials secure and never share them with anyone.
          </p>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <p style="color: #666; font-size: 14px; margin-bottom: 10px;">
            If you didn't request this account, please ignore this email or contact your institution administrator.
          </p>
          <div style="border-top: 1px solid #eee; padding-top: 15px; margin-top: 15px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              <strong>Welcome aboard!</strong><br>
              ${institutionName} - Campus ID System
            </p>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"${institutionName} - Campus ID" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Welcome to ${institutionName} - Activate Your Account`,
      html,
    });

    console.log(`✅ Student activation email sent to ${email}`);
    console.log(`🔗 Activation link: ${activationLink}`);
  } catch (error) {
    console.error(`❌ Failed to send activation email to ${email}:`, error);
    // Don't throw error to prevent breaking the flow
  }
}

export async function sendLecturerActivationEmail(
  email: string, 
  firstName: string, 
  lastName: string, 
  lecturerId: string, 
  defaultPassword: string, 
  verificationToken: string,
  institutionName: string,
  role: string,
  department: string
): Promise<void> {
  try {
    const transporter = createTransporter();
    
    const activationLink = `${process.env.BACKEND_URL}/api/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 30px; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: #2c3e50; margin: 0; font-size: 28px;">🎓 ${institutionName}</h1>
          <p style="color: #7f8c8d; margin: 10px 0 0 0; font-size: 16px;">Lecturer Account Activation</p>
        </div>
        
        <!-- Welcome Message -->
        <div style="background: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #2c3e50; margin-top: 0;">Welcome ${role} ${firstName} ${lastName}!</h2>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Your lecturer account has been created successfully. Please find your login credentials below and activate your account.
          </p>
        </div>
        
        <!-- Credentials Box -->
        <div style="background: #e8f4fd; padding: 25px; border-radius: 10px; margin-bottom: 25px; border-left: 5px solid #007bff;">
          <h3 style="color: #007bff; margin-top: 0; margin-bottom: 15px;">📋 Your Login Credentials</h3>
          <div style="background: white; padding: 20px; border-radius: 8px; font-family: 'Courier New', monospace;">
            <div style="margin-bottom: 10px;">
              <strong style="color: #333;">Lecturer ID:</strong> 
              <span style="color: #007bff; font-size: 18px; font-weight: bold;">${lecturerId}</span>
            </div>
            <div style="margin-bottom: 10px;">
              <strong style="color: #333;">Email:</strong> 
              <span style="color: #007bff;">${email}</span>
            </div>
            <div style="margin-bottom: 10px;">
              <strong style="color: #333;">Role:</strong> 
              <span style="color: #28a745; font-weight: bold;">${role}</span>
            </div>
            <div style="margin-bottom: 10px;">
              <strong style="color: #333;">Department:</strong> 
              <span style="color: #6c757d;">${department}</span>
            </div>
            <div>
              <strong style="color: #333;">Default Password:</strong> 
              <span style="color: #dc3545; font-weight: bold;">${defaultPassword}</span>
            </div>
          </div>
        </div>
        
        <!-- Activation Button -->
        <div style="text-align: center; margin: 30px 0;">
          <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 20px; border-radius: 10px;">
            <h3 style="color: white; margin-top: 0; margin-bottom: 15px;">🔗 Activate Your Account</h3>
            <p style="color: #e3f2fd; margin-bottom: 20px;">Click the button below to verify your email and activate your account:</p>
            <a href="${activationLink}" 
               style="display: inline-block; background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(40, 167, 69, 0.3);">
              ✅ ACTIVATE ACCOUNT
            </a>
            <p style="color: #e3f2fd; font-size: 12px; margin-top: 15px; margin-bottom: 0;">
              This link will expire in 24 hours
            </p>
          </div>
        </div>
        
        <!-- Next Steps -->
        <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h3 style="color: #2c3e50; margin-top: 0;">📝 Next Steps</h3>
          <ol style="color: #555; line-height: 1.8; padding-left: 20px;">
            <li>Click the activation link above</li>
            <li>You'll be redirected to the login page</li>
            <li>Login using your <strong>Lecturer ID</strong> or <strong>Email</strong></li>
            <li>Change your password after first login (required for security)</li>
          </ol>
        </div>
        
        <!-- Login Options -->
        <div style="background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 5px solid #ffc107;">
          <h4 style="color: #856404; margin-top: 0;">💡 Login Options</h4>
          <p style="color: #856404; margin-bottom: 10px;">You can login using either:</p>
          <ul style="color: #856404; margin-bottom: 15px;">
            <li><strong>Lecturer ID:</strong> ${lecturerId}</li>
            <li><strong>Email:</strong> ${email}</li>
          </ul>
          <p style="color: #856404; margin: 0;">
            <strong>Login URL:</strong> <a href="${loginUrl}" style="color: #007bff;">${loginUrl}</a>
          </p>
        </div>
        
        <!-- Security Notice -->
        <div style="background: #f8d7da; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 5px solid #dc3545;">
          <h4 style="color: #721c24; margin-top: 0;">⚠️ Important Security Notice</h4>
          <p style="color: #721c24; margin: 0;">
            For security reasons, you will be required to change your password after your first login. 
            Keep your credentials secure and never share them with anyone.
          </p>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 30px; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <p style="color: #666; font-size: 14px; margin-bottom: 10px;">
            If you didn't request this account, please ignore this email or contact your institution administrator.
          </p>
          <div style="border-top: 1px solid #eee; padding-top: 15px; margin-top: 15px;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              <strong>Welcome to the team!</strong><br>
              ${institutionName} - Campus ID System
            </p>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"${institutionName} - Campus ID" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Welcome to ${institutionName} - Activate Your Lecturer Account`,
      html,
    });

    console.log(`✅ Lecturer activation email sent to ${email}`);
    console.log(`🔗 Activation link: ${activationLink}`);
  } catch (error) {
    console.error(`❌ Failed to send lecturer activation email to ${email}:`, error);
    // Don't throw error to prevent breaking the flow
  }
}
