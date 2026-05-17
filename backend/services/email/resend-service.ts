/**
 * Resend email service – delivers support, contact, and demo request emails to support@aiquery.ai.
 * Requires RESEND_API_KEY in .env. From address must be verified in Resend (e.g. support@aiquery.ai).
 */

import { Resend } from 'resend';

const apiKey = (process.env.RESEND_API_KEY || '').trim();
const fromEmail = (process.env.RESEND_FROM_EMAIL || 'AIquery Support <support@aiquery.ai>').trim();
const supportTo = (process.env.SUPPORT_EMAIL || 'support@aiquery.ai').trim();

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
}

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

/**
 * Send support request (Help → Contact Support) to support@aiquery.ai.
 */
export async function sendSupportEmail(
  fromName: string,
  fromEmailAddress: string,
  subject: string,
  message: string
): Promise<void> {
  const client = getResend();
  if (!client) {
    console.log('[Resend] RESEND_API_KEY not set – support email not sent (dev mode).');
    return;
  }

  const subj = (subject || `AIquery Support: ${fromName || 'Support request'}`).trim();
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #111827;">Support Request</h2>
      <p><strong>Name:</strong> ${escapeHtml(fromName || '-')}</p>
      <p><strong>Email:</strong> ${escapeHtml(fromEmailAddress || '-')}</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject || '-')}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
      <p style="white-space: pre-wrap;">${escapeHtml(message || '')}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #6b7280; font-size: 12px;">Sent from AIquery Help → Contact Support</p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: fromEmail,
    to: [supportTo],
    replyTo: fromEmailAddress,
    subject: subj,
    html,
  });

  if (error) {
    console.error('[Resend] Support email error:', error);
    throw new Error(error.message || 'Failed to send support email');
  }
  console.log(`[Resend] Support request sent to ${supportTo} from ${fromEmailAddress}`);
}

/**
 * Send contact form message (e.g. from /contact or landing contact section) to support@aiquery.ai.
 */
export async function sendContactMessageEmail(
  name: string,
  emailAddress: string,
  subject: string,
  message: string
): Promise<void> {
  const client = getResend();
  if (!client) {
    console.log('[Resend] RESEND_API_KEY not set – contact message not sent (dev mode).');
    return;
  }

  const subj = (subject || `AIquery Contact: ${name || 'New message'}`).trim();
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #111827;">Contact Message</h2>
      <p><strong>Name:</strong> ${escapeHtml(name || '-')}</p>
      <p><strong>Email:</strong> ${escapeHtml(emailAddress || '-')}</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject || '-')}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
      <p style="white-space: pre-wrap;">${escapeHtml(message || '')}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #6b7280; font-size: 12px;">Sent from AIquery contact form</p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: fromEmail,
    to: [supportTo],
    replyTo: emailAddress,
    subject: subj,
    html,
  });

  if (error) {
    console.error('[Resend] Contact message email error:', error);
    throw new Error(error.message || 'Failed to send contact message');
  }
  console.log(`[Resend] Contact message sent to ${supportTo} from ${emailAddress}`);
}

/**
 * Send demo request (Request Demo form on /contact) to support@aiquery.ai.
 */
export async function sendDemoRequestEmail(params: {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  jobTitle: string;
  phoneNumber: string;
  timeZone: string;
  projectDescription: string;
}): Promise<void> {
  const client = getResend();
  if (!client) {
    console.log('[Resend] RESEND_API_KEY not set – demo request email not sent (dev mode).');
    return;
  }

  const { firstName, lastName, email, companyName, jobTitle, phoneNumber, timeZone, projectDescription } = params;
  const subject = `AIquery Demo Request: ${firstName} ${lastName} from ${companyName}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #111827;">Demo Request</h2>
      <p><strong>Name:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Company:</strong> ${escapeHtml(companyName)}</p>
      <p><strong>Job Title:</strong> ${escapeHtml(jobTitle)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phoneNumber)}</p>
      <p><strong>Time Zone:</strong> ${escapeHtml(timeZone)}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
      <p><strong>Project Description:</strong></p>
      <p style="white-space: pre-wrap;">${escapeHtml(projectDescription)}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #6b7280; font-size: 12px;">Sent from AIquery Request Demo form (/contact)</p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: fromEmail,
    to: [supportTo],
    replyTo: email,
    subject,
    html,
  });

  if (error) {
    console.error('[Resend] Demo request email error:', error);
    throw new Error(error.message || 'Failed to send demo request email');
  }
  console.log(`[Resend] Demo request sent to ${supportTo} from ${email}`);
}

/**
 * Send auto-reply to the user so they know we received their message.
 */
export async function sendAutoReply(toEmail: string, type: 'support' | 'contact' | 'demo'): Promise<void> {
  const client = getResend();
  if (!client) return;

  const titles = { support: 'Support Request', contact: 'Contact Message', demo: 'Demo Request' };
  const subject = `We received your ${titles[type].toLowerCase()} – AIquery`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #111827;">Thank you for reaching out</h2>
      <p>We've received your message and will get back to you at <strong>${escapeHtml(toEmail)}</strong> within 1–2 business days.</p>
      <p>If your matter is urgent, you can reply to this email or contact us at support@aiquery.ai.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="color: #6b7280; font-size: 12px;">© ${new Date().getFullYear()} AIquery. All rights reserved.</p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: fromEmail,
    to: [toEmail],
    subject,
    html,
  });

  if (error) console.warn('[Resend] Auto-reply error:', error);
}

/**
 * Send a notification email to a user (e.g. usage warning, payment due).
 */
export async function sendNotificationEmail(toEmail: string, subject: string, htmlBody: string): Promise<void> {
  const client = getResend();
  if (!client) {
    console.log('[Resend] RESEND_API_KEY not set – notification email not sent.');
    return;
  }
  const { error } = await client.emails.send({
    from: fromEmail,
    to: [toEmail],
    subject,
    html: htmlBody,
  });
  if (error) {
    console.error('[Resend] Notification email error:', error);
    throw new Error(error.message || 'Failed to send notification email');
  }
  console.log(`[Resend] Notification email sent to ${toEmail}: ${subject}`);
}
