import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function renderVerificationTemplate(user, rawToken) {
  const verifyUrl = `${process.env.APP_DOMAIN || ''}/api/v1/auth/verify-email?token=${rawToken}`;
  const subject = 'Please verify your email address';
  const html = `<p>Hi ${user.firstname || ''},</p><p>Please verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you did not create an account, you can ignore this email.</p>`;
  return { subject, html, verifyUrl };
}

export async function enqueueVerificationEmail(user, rawToken) {
  try {
    const { subject, html } = renderVerificationTemplate(user, rawToken);
    await prisma.emailOutbox.create({ data: { userId: user.id, to: user.email, subject, bodyHtml: html } });
  } catch (e) {
    // Use console here to avoid depending on app-specific logger in the shared package
    console.warn('[packages/email] enqueue verification email failed:', e && e.message ? e.message : e);
  }
}

// Return a preview object (can be used by dev UIs or testing)
export function buildVerificationPreview(user, rawToken) {
  const { subject, html, verifyUrl } = renderVerificationTemplate(user, rawToken);
  return { subject, html, verifyUrl, generatedAt: new Date().toISOString() };
}

export default { renderVerificationTemplate, enqueueVerificationEmail, buildVerificationPreview };
