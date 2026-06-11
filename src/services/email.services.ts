import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { getConfig } from '../config/constants.js';

/**
 * Email transport.
 *
 * Production: real emails are sent via the Resend HTTP API. Set RESEND_API_KEY
 * and EMAIL_FROM (a verified sender, e.g. "Campus ID <no-reply@smartunivid.xyz>").
 *
 * Local dev: when RESEND_API_KEY is not set, we transparently fall back to
 * Mailtrap SMTP (sandbox or live token) so testing still works without sending
 * real mail. No call site needs to know which transport is active.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Default sender. Override with EMAIL_FROM once your domain is verified in
// Resend. `onboarding@resend.dev` works out of the box but only delivers to the
// Resend account owner's address — fine for a first smoke test.
const EMAIL_FROM = process.env.EMAIL_FROM || 'Campus ID <onboarding@resend.dev>';

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  if (!RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(RESEND_API_KEY);
  return resendClient;
}

// Build a sender string that keeps the verified address from EMAIL_FROM but
// swaps in a custom display name (e.g. "University of X - Campus ID").
function senderWithName(name?: string): string {
  if (!name) return EMAIL_FROM;
  const match = EMAIL_FROM.match(/<([^>]+)>/);
  const address = match ? match[1] : EMAIL_FROM;
  return `${name} <${address}>`;
}

// SMTP fallback transporter (local dev / Mailtrap) — only used when Resend is
// not configured.
const createSmtpTransporter = () => {
  if (process.env.MAILTRAP_API_TOKEN) {
    return nodemailer.createTransport({
      host: 'live.smtp.mailtrap.io',
      port: 587,
      secure: false,
      auth: { user: 'api', pass: process.env.MAILTRAP_API_TOKEN },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 60000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    });
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT || '2525'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
};

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional display name for the sender; the verified address is preserved. */
  fromName?: string;
}

/**
 * Single entry point for sending email. Uses Resend when configured, otherwise
 * falls back to SMTP. Throws on hard failures so callers can decide whether to
 * surface the error.
 */
export async function sendEmail({ to, subject, html, fromName }: SendEmailArgs): Promise<void> {
  const from = senderWithName(fromName);
  const resend = getResend();

  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) {
      throw new Error(`Resend send failed: ${error.message || JSON.stringify(error)}`);
    }
    return;
  }

  // Fallback: SMTP (Mailtrap). The verified-domain "from" doesn't apply here, so
  // use the Mailtrap-appropriate sender.
  const transporter = createSmtpTransporter();
  const smtpFrom = process.env.MAILTRAP_API_TOKEN
    ? senderWithName(fromName) // live token can use the configured EMAIL_FROM
    : `"${fromName || 'Campus ID System'}" <${process.env.SMTP_USER || 'no-reply@campus-id.local'}>`;
  await transporter.sendMail({ from: smtpFrom, to, subject, html });
}

// Email service for sending OTP and other notifications
export async function sendOTPEmail(email: string, code: string, purpose: string): Promise<void> {
  try {
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

    await sendEmail({ to: email, subject, html });

    console.log(`✅ ${purpose} email sent successfully to ${email}`);
  } catch (error: any) {
    console.error(`❌ Failed to send ${purpose} email to ${email}:`, error.message);
    // Don't throw error to prevent breaking the flow
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
    const config = getConfig();

    const activationLink = `${process.env.BACKEND_URL}/api/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    
    // Only include debug info in development
    const debugSection = config.security.includeDebugInEmails ? `
        <!-- Debug Info (Development Only) -->
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #dee2e6;">
          <h4 style="color: #6c757d; margin-top: 0; font-size: 14px;">🔧 Debug Information</h4>
          <p style="color: #6c757d; font-size: 12px; font-family: monospace; margin: 5px 0;">
            <strong>Token:</strong> ${verificationToken}<br>
            <strong>Email:</strong> ${email}<br>
            <strong>Link:</strong> <a href="${activationLink}" style="color: #007bff; word-break: break-all;">${activationLink}</a>
          </p>
        </div>
    ` : '';
    
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
        
        ${debugSection}
        
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

    await sendEmail({
      to: email,
      subject: `Welcome to ${institutionName} - Activate Your Account`,
      html,
      fromName: `${institutionName} - Campus ID`,
    });

    console.log(`✅ Student activation email sent to ${email}`);
  } catch (error: any) {
    console.error(`❌ Failed to send activation email to ${email}:`, error.message);
    throw error; // Throw error so caller knows email failed
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
    const config = getConfig();

    const activationLink = `${process.env.BACKEND_URL}/api/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    
    // Only include debug info in development
    const debugSection = config.security.includeDebugInEmails ? `
        <!-- Debug Info (Development Only) -->
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #dee2e6;">
          <h4 style="color: #6c757d; margin-top: 0; font-size: 14px;">🔧 Debug Information</h4>
          <p style="color: #6c757d; font-size: 12px; font-family: monospace; margin: 5px 0;">
            <strong>Token:</strong> ${verificationToken}<br>
            <strong>Email:</strong> ${email}<br>
            <strong>Link:</strong> <a href="${activationLink}" style="color: #007bff; word-break: break-all;">${activationLink}</a>
          </p>
        </div>
    ` : '';
    
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
        
        ${debugSection}
        
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

    await sendEmail({
      to: email,
      subject: `Welcome to ${institutionName} - Activate Your Lecturer Account`,
      html,
      fromName: `${institutionName} - Campus ID`,
    });

    console.log(`✅ Lecturer activation email sent to ${email}`);
  } catch (error: any) {
    console.error(`❌ Failed to send lecturer activation email to ${email}:`, error.message);
    throw error; // Throw error so caller knows email failed
  }
}


export async function sendDeadlineReminderEmail(
  email: string,
  studentName: string,
  courseCode: string,
  courseName: string,
  assignmentTitle: string,
  deadline: Date,
  hoursLeft: number
): Promise<void> {
  try {
    const deadlineStr = deadline.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const urgencyColor = hoursLeft <= 3 ? '#dc3545' : hoursLeft <= 6 ? '#fd7e14' : '#ffc107';
    const urgencyText = hoursLeft <= 3 ? 'URGENT' : hoursLeft <= 6 ? 'Reminder' : 'Heads up';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">🎓 Campus ID System</h1>
        </div>
        <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; border-left: 4px solid ${urgencyColor};">
          <h2 style="color: ${urgencyColor}; margin-top: 0;">⏰ ${urgencyText}: Assignment Due Soon</h2>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Hi <strong>${studentName}</strong>, your assignment is due in <strong>${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}</strong>.
          </p>
          <div style="background: #ffffff; padding: 20px; margin: 20px 0; border-radius: 8px; border: 1px solid #dee2e6;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Course</td><td style="padding: 8px 0; color: #333; font-weight: bold; font-size: 14px;">${courseCode} — ${courseName}</td></tr>
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Assignment</td><td style="padding: 8px 0; color: #333; font-weight: bold; font-size: 14px;">${assignmentTitle}</td></tr>
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Deadline</td><td style="padding: 8px 0; color: ${urgencyColor}; font-weight: bold; font-size: 14px;">${deadlineStr}</td></tr>
            </table>
          </div>
          <p style="color: #555; font-size: 14px;">Don't forget to submit before the deadline. Late submissions may not be accepted.</p>
        </div>
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 12px; margin: 0;">Campus ID System — Secure Student Management Platform</p>
        </div>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: `⏰ ${urgencyText}: "${assignmentTitle}" due in ${hoursLeft}h — ${courseCode}`,
      html,
    });

    console.log(`✅ Deadline reminder sent to ${email} for ${assignmentTitle}`);
  } catch (error: any) {
    console.error(`❌ Failed to send deadline reminder to ${email}:`, error.message);
  }
}


export async function sendNewAssignmentEmail(
  email: string,
  studentName: string,
  courseCode: string,
  courseName: string,
  assignmentTitle: string,
  description: string,
  deadline: Date,
  lecturerName: string
): Promise<void> {
  try {
    const deadlineStr = deadline.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">🎓 Campus ID System</h1>
        </div>
        <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; border-left: 4px solid #007bff;">
          <h2 style="color: #007bff; margin-top: 0;">📝 New Assignment Posted</h2>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Hi <strong>${studentName}</strong>, a new assignment has been posted for your course.
          </p>
          <div style="background: #ffffff; padding: 20px; margin: 20px 0; border-radius: 8px; border: 1px solid #dee2e6;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Course</td><td style="padding: 8px 0; color: #333; font-weight: bold; font-size: 14px;">${courseCode} — ${courseName}</td></tr>
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Assignment</td><td style="padding: 8px 0; color: #333; font-weight: bold; font-size: 14px;">${assignmentTitle}</td></tr>
              ${description ? `<tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Details</td><td style="padding: 8px 0; color: #555; font-size: 14px;">${description}</td></tr>` : ''}
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Deadline</td><td style="padding: 8px 0; color: #dc3545; font-weight: bold; font-size: 14px;">${deadlineStr}</td></tr>
              <tr><td style="padding: 8px 0; color: #888; font-size: 14px;">Lecturer</td><td style="padding: 8px 0; color: #333; font-size: 14px;">${lecturerName}</td></tr>
            </table>
          </div>
          <p style="color: #555; font-size: 14px;">Log in to your dashboard to view and submit the assignment.</p>
        </div>
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 12px; margin: 0;">Campus ID System — Secure Student Management Platform</p>
        </div>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: `📝 New Assignment: "${assignmentTitle}" — ${courseCode}`,
      html,
    });

    console.log(`✅ New assignment email sent to ${email} for ${assignmentTitle}`);
  } catch (error: any) {
    console.error(`❌ Failed to send new assignment email to ${email}:`, error.message);
  }
}
