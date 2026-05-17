import { Pool } from 'pg';
import { getDatabasePool } from '../database';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

export class EmailVerificationService {
  private pool: Pool;
  private transporter: nodemailer.Transporter;

  constructor() {
    this.pool = getDatabasePool();

    const port = parseInt(String(process.env.SMTP_PORT || '587').trim(), 10);
    // Port 465 = SSL/TLS; 587 = STARTTLS
    const secure = process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;

    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();

    this.transporter = nodemailer.createTransport({
      host: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
      port,
      secure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      ...(port === 587 && !secure && {
        tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
      }),
    });
  }

  // Generate a 6-digit verification code
  generateVerificationCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  // Send verification code to email
  async sendVerificationCode(email: string, code: string): Promise<void> {
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();
    
    // Development mode: If SMTP credentials are not configured, log the code to console
    if (!smtpUser || !smtpPass) {
      console.log('\n========================================');
      console.log('📧 EMAIL VERIFICATION CODE (DEV MODE)');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Verification Code: ${code}`);
      console.log('========================================\n');
      console.warn('⚠️  SMTP credentials not configured. Email not sent. Code logged above for development.');
      return; // Don't throw error in development mode
    }

    // In development, use SMTP_USER as From so Gmail doesn't require DKIM for aiquery.ai.
    // In production, use SMTP_FROM (e.g. support@aiquery.ai) once DKIM is set up for that domain.
    const smtpFrom = (process.env.SMTP_FROM || 'support@aiquery.ai').trim();
    const fromAddress =
      process.env.NODE_ENV !== 'production' && smtpUser
        ? smtpUser
        : smtpFrom;
    const mailOptions = {
      from: { name: 'AIquery Support', address: fromAddress },
      to: email,
      subject: 'AIquery Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111827;">Verify Your Email Address</h2>
          <p>Thank you for signing up for AIquery!</p>
          <p>Your verification code is:</p>
          <div style="background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="color: #111827; font-size: 32px; letter-spacing: 8px; margin: 0;">${code}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">© ${new Date().getFullYear()} AIquery. All rights reserved.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Verification code sent to ${email}`);
    } catch (error) {
      console.error('Error sending verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  /**
   * Send password reset email with a link. Link should point to frontend /reset-password/:token
   */
  async sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();

    if (!smtpUser || !smtpPass) {
      console.log('\n========================================');
      console.log('📧 PASSWORD RESET LINK (DEV MODE)');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Reset link: ${resetLink}`);
      console.log('========================================\n');
      return;
    }

    const smtpFrom = (process.env.SMTP_FROM || 'support@aiquery.ai').trim();
    const fromAddress =
      process.env.NODE_ENV !== 'production' && smtpUser ? smtpUser : smtpFrom;
    const mailOptions = {
      from: { name: 'AIquery Support', address: fromAddress },
      to: email,
      subject: 'AIquery – Reset Your Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111827;">Reset Your Password</h2>
          <p>We received a request to reset the password for your AIquery account.</p>
          <p>Click the link below to set a new password. This link will expire in 1 hour.</p>
          <p><a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: #fff; text-decoration: none; border-radius: 8px;">Reset Password</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p style="word-break: break-all; color: #6b7280;">${resetLink}</p>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">© ${new Date().getFullYear()} AIquery. All rights reserved.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to ${email}`);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Send a support request email to support@aiquery.ai (or SUPPORT_EMAIL).
   * Uses same SMTP config as verification emails. Reply-To is set to the sender's email.
   */
  async sendSupportRequest(fromName: string, fromEmail: string, subject: string, message: string): Promise<void> {
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();
    const supportEmail = (process.env.SUPPORT_EMAIL || 'support@aiquery.ai').trim();

    if (!smtpUser || !smtpPass) {
      console.log('\n========================================');
      console.log('📧 SUPPORT REQUEST (DEV MODE – email not sent)');
      console.log('========================================');
      console.log(`From: ${fromName} <${fromEmail}>`);
      console.log(`Subject: ${subject}`);
      console.log(`Message: ${message}`);
      console.log('========================================\n');
      console.warn('⚠️  SMTP credentials not configured. Support email not sent. Logged above for development.');
      return;
    }

    const smtpFrom = (process.env.SMTP_FROM || 'support@aiquery.ai').trim();
    const fromAddress =
      process.env.NODE_ENV !== 'production' && smtpUser
        ? smtpUser
        : smtpFrom;

    const mailOptions = {
      from: { name: 'AIquery App', address: fromAddress },
      to: supportEmail,
      replyTo: fromEmail,
      subject: subject || `AIquery Support: ${fromName || 'Support request'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #111827;">Support Request</h2>
          <p><strong>Name:</strong> ${(fromName || '-').replace(/</g, '&lt;')}</p>
          <p><strong>Email:</strong> ${(fromEmail || '-').replace(/</g, '&lt;')}</p>
          <p><strong>Subject:</strong> ${(subject || '-').replace(/</g, '&lt;')}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
          <p style="white-space: pre-wrap;">${(message || '').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">Sent from AIquery Help → Contact Support</p>
        </div>
      `,
      text: `Name: ${fromName || '-'}\nEmail: ${fromEmail || '-'}\nSubject: ${subject || '-'}\n\n${message || ''}`,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Support request sent to ${supportEmail} from ${fromEmail}`);
    } catch (error) {
      console.error('Error sending support email:', error);
      throw new Error('Failed to send support request');
    }
  }

  // Store verification code in database
  async storeVerificationCode(email: string, code: string, userId?: number): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Code expires in 10 minutes

    // Delete any existing codes for this email
    await this.pool.query(
      'DELETE FROM verification_codes WHERE email = $1',
      [email.toLowerCase()]
    );

    // Insert new code
    await this.pool.query(
      `INSERT INTO verification_codes (email, code, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email.toLowerCase(), code, userId || null, expiresAt]
    );
  }

  // Verify code
  async verifyCode(email: string, code: string): Promise<{ valid: boolean; userId?: number }> {
    const result = await this.pool.query(
      `SELECT user_id, expires_at FROM verification_codes
       WHERE email = $1 AND code = $2`,
      [email.toLowerCase(), code]
    );

    if (result.rows.length === 0) {
      return { valid: false };
    }

    const row = result.rows[0];
    const expiresAt = new Date(row.expires_at);

    if (expiresAt < new Date()) {
      // Code expired, delete it
      await this.pool.query(
        'DELETE FROM verification_codes WHERE email = $1 AND code = $2',
        [email.toLowerCase(), code]
      );
      return { valid: false };
    }

    // Code is valid, delete it
    await this.pool.query(
      'DELETE FROM verification_codes WHERE email = $1 AND code = $2',
      [email.toLowerCase(), code]
    );

    return { valid: true, userId: row.user_id || undefined };
  }

  // Store pending registration
  async storePendingRegistration(email: string, passwordHash: string, name?: string, phoneNumber?: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // Expires in 1 hour

    // Delete any existing pending registration
    await this.pool.query(
      'DELETE FROM pending_registrations WHERE email = $1',
      [email.toLowerCase()]
    );

    // Insert new pending registration
    await this.pool.query(
      `INSERT INTO pending_registrations (email, password_hash, name, phone_number, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [email.toLowerCase(), passwordHash, name || null, phoneNumber || null, expiresAt]
    );
  }

  // Get pending registration
  async getPendingRegistration(email: string): Promise<{ passwordHash: string; name?: string; phoneNumber?: string } | null> {
    const result = await this.pool.query(
      `SELECT password_hash, name, phone_number, expires_at FROM pending_registrations
       WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const expiresAt = new Date(row.expires_at);

    if (expiresAt < new Date()) {
      // Expired, delete it
      await this.pool.query(
        'DELETE FROM pending_registrations WHERE email = $1',
        [email.toLowerCase()]
      );
      return null;
    }

    return {
      passwordHash: row.password_hash,
      name: row.name,
      phoneNumber: row.phone_number,
    };
  }

  // Create user with verification (called after email verification)
  async createVerifiedUser(email: string, passwordHash: string, name?: string, phoneNumber?: string): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO users (email, password_hash, name, phone_number, email_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [email.toLowerCase(), passwordHash, name || null, phoneNumber || null]
    );

    return result.rows[0].id;
  }

  // Mark email as verified
  async markEmailAsVerified(userId: number): Promise<void> {
    await this.pool.query(
      'UPDATE users SET email_verified = TRUE WHERE id = $1',
      [userId]
    );
  }
}

export const emailVerificationService = new EmailVerificationService();
