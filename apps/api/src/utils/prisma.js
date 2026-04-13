import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Ensure environment variables are loaded before PrismaClient is instantiated.
// Load .env first, then fall back to .env.dev when DATABASE_URL is missing.
try {
	dotenv.config({ path: path.resolve(process.cwd(), '.env') });
	if (!process.env.DATABASE_URL) {
		// Search upwards for .env.dev in parent directories (repo root) up to 5 levels
		let cur = process.cwd();
		for (let i = 0; i < 6; i++) {
			const candidate = path.resolve(cur, '.env.dev');
			try {
				if (fs.existsSync(candidate)) {
					dotenv.config({ path: candidate });
					console.log('[prisma.util] loaded .env.dev from', candidate);
					break;
				}
			} catch (e) {
				// ignore
			}
			const parent = path.resolve(cur, '..');
			if (parent === cur) break;
			cur = parent;
		}
	}
} catch (e) {
	// ignore
}
console.log('[prisma.util] cwd', process.cwd(), 'DATABASE_URL present?', !!process.env.DATABASE_URL);

const g = globalThis;
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
