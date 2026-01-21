// Test Mailtrap Email API configuration
import nodemailer from 'nodemailer';
import 'dotenv/config';

async function testEmailConfig() {
  console.log('🧪 Testing Email Configuration...\n');
  
  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log('MAILTRAP_API_TOKEN:', process.env.MAILTRAP_API_TOKEN ? '✅ Set' : '❌ Not set');
  console.log('MAILTRAP_DOMAIN:', process.env.MAILTRAP_DOMAIN || 'Not set');
  console.log('SMTP_USER:', process.env.SMTP_USER ? '✅ Set' : '❌ Not set');
  console.log('SMTP_PASS:', process.env.SMTP_PASS ? '✅ Set' : '❌ Not set');
  
  // Test Email API configuration
  if (process.env.MAILTRAP_API_TOKEN) {
    console.log('\n🚀 Testing Mailtrap Email API...');
    
    const transporter = nodemailer.createTransport({
      host: 'live.smtp.mailtrap.io',
      port: 587,
      secure: false,
      auth: {
        user: 'api',
        pass: process.env.MAILTRAP_API_TOKEN,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    try {
      // Verify connection
      await transporter.verify();
      console.log('✅ Email API connection successful!');
      
      // Send test email
      const info = await transporter.sendMail({
        from: `"Campus ID Test" <hello@demomailtrap.com>`, // Use Mailtrap's demo domain
        to: 'andreolumide@gmail.com', // Your email
        subject: '🎉 Campus ID Email API Test',
        html: `
          <h2>🎉 Success!</h2>
          <p>Your Mailtrap Email API is working correctly!</p>
          <p><strong>Token:</strong> ***${process.env.MAILTRAP_API_TOKEN.slice(-4)}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        `
      });
      
      console.log('✅ Test email sent successfully!');
      console.log('📧 Message ID:', info.messageId);
      console.log('📬 Check your inbox at andreolumide@gmail.com');
      
    } catch (error) {
      console.error('❌ Email API test failed:', error.message);
    }
  } else {
    console.log('\n🧪 Testing Sandbox SMTP...');
    
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    try {
      await transporter.verify();
      console.log('✅ Sandbox SMTP connection successful!');
    } catch (error) {
      console.error('❌ Sandbox SMTP test failed:', error.message);
    }
  }
}

testEmailConfig();