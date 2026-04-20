import crypto from 'crypto';

// Render template for verification emails.
export function renderVerificationTemplate(user, rawToken) {
  const verifyUrl = `${process.env.WEB_URL || 'http://localhost:5173'}/verify-email?token=${rawToken}`;
  const subject = 'Please verify your email address';
  const html = `<p>Hi ${user.firstname || ''},</p><p>Please verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you did not create an account, you can ignore this email.</p>`;
  return { subject, html, verifyUrl };
}

// DB-agnostic enqueue: callers must pass an `enqueueFn` that accepts a single
// object matching the email_outbox columns (userId, to, subject, bodyHtml, ...)
export async function enqueueVerificationEmail(enqueueFn, user, rawToken) {
  try {
    const { subject, html } = renderVerificationTemplate(user, rawToken);
    await enqueueFn({ userId: user.id, to: user.email, subject, bodyHtml: html });
  } catch (e) {
    console.warn('[packages/email] enqueue verification email failed:', e && e.message ? e.message : e);
  }
}

// Return a preview object (can be used by dev UIs or testing)
export function buildVerificationPreview(user, rawToken) {
  const { subject, html, verifyUrl } = renderVerificationTemplate(user, rawToken);
  return { subject, html, verifyUrl, generatedAt: new Date().toISOString() };
}

export default { renderVerificationTemplate, enqueueVerificationEmail, buildVerificationPreview };
