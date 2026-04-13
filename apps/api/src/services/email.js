// Re-export higher-level email helpers from the shared package so callers
// can import from `apps/api/src/services/email.js` without changing paths.
// Dynamically import shared package by name, with relative fallback when
// workspace package resolution is not set up (local dev/test).
let renderVerificationTemplate, pkgEnqueue, buildVerificationPreview;
try {
	// prefer package name
	// eslint-disable-next-line no-await-in-loop, no-unused-vars
	const pkg = await import('@rms/email');
	({ renderVerificationTemplate, enqueueVerificationEmail: pkgEnqueue, buildVerificationPreview } = pkg);
} catch (e) {
	// fallback to relative path
	const pkg = await import('../../../../packages/email/src/index.js');
	({ renderVerificationTemplate, enqueueVerificationEmail: pkgEnqueue, buildVerificationPreview } = pkg);
}

// Local enqueue implementation using Prisma — injected into the shared package
import { prisma } from '../utils/prisma.js';

async function prismaEnqueue(row) {
	return prisma.emailOutbox.create({ data: { userId: row.userId, to: row.to, subject: row.subject, bodyHtml: row.bodyHtml } });
}

export async function enqueueVerificationEmail(user, rawToken) {
	return pkgEnqueue(prismaEnqueue, user, rawToken);
}

export { renderVerificationTemplate, buildVerificationPreview };

export default { renderVerificationTemplate, enqueueVerificationEmail, buildVerificationPreview };
