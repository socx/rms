import { prisma } from './prisma.js';

/**
 * Write an audit log entry. Failures are swallowed so they never
 * interrupt the originating request.
 *
 * @param {object} opts
 * @param {string|null} opts.actorId       - UUID of the acting user (null for system)
 * @param {string}      opts.actorEmail    - Email of the acting user
 * @param {'CREATE'|'UPDATE'|'DELETE'} opts.action
 * @param {'EVENT'|'REMINDER'|'SUBSCRIBER'|'USER'} opts.entityType
 * @param {string}      opts.entityId      - UUID of the affected entity
 * @param {string}      [opts.entitySummary] - Human-readable summary (e.g. event subject)
 * @param {object}      [opts.changes]     - { before, after } or freeform diff
 * @param {string}      [opts.ipAddress]   - Request IP
 */
export async function writeAudit({ actorId, actorEmail, action, entityType, entityId, entitySummary, changes, ipAddress }) {
	try {
		await prisma.auditLog.create({
			data: {
				actorId:       actorId ?? null,
				actorEmail:    actorEmail ?? 'system',
				action:        action.toUpperCase(),
				entityType:    entityType.toUpperCase(),
				entityId,
				entitySummary: entitySummary ?? null,
				changes:       changes ?? null,
				ipAddress:     ipAddress ?? null,
			},
		});
	} catch (e) {
		// Audit write failures must never disrupt the originating operation
		console.error('[audit] write failed:', e.message);
	}
}

/** Convenience: extract client IP from an Express request */
export function getIp(req) {
	return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null)?.toString().split(',')[0].trim();
}
