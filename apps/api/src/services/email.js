import { prisma } from '../utils/prisma.js';
import logger from '../utils/logger.js';

export async function enqueueVerificationEmail(user, rawToken) {
  try {
    const verifyUrl = `${process.env.APP_DOMAIN || ''}/api/v1/auth/verify-email?token=${rawToken}`;
    const subject = 'Please verify your email address';
    const html = `<p>Hi ${user.firstname || ''},</p><p>Please verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you did not create an account, you can ignore this email.</p>`;
    await prisma.emailOutbox.create({ data: { userId: user.id, to: user.email, subject, bodyHtml: html } });
  } catch (e) {
    logger.warn('[email.service] enqueue verification email failed:', e && e.message ? e.message : e);
  }
}

export default { enqueueVerificationEmail };
