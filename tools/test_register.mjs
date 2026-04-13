import 'dotenv/config';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    const firstname = 'Test';
    const lastname = 'Script';
    const email = `test+script${Date.now()}@example.com`;
    const password = 'P@ssw0rd!';

    console.log('Checking system setting...');
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'allow_public_registration' } });
    console.log('Setting:', setting);
    if (!setting || setting.value !== 'true') {
      throw new Error('Public registration disabled');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    console.log('Existing user:', existing);

    const passwordHash = await bcrypt.hash(password, 12);
    console.log('Password hashed');

    const user = await prisma.user.create({ data: { firstname, lastname, email, passwordHash, timezone: 'UTC' } });
    console.log('User created:', user.id);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const token = await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt: expires } });
    console.log('Token created:', token.id);

    await prisma.$disconnect();
    console.log('Done');
  } catch (e) {
    console.error('Error during script:', e);
    try { await prisma.$disconnect(); } catch {};
    process.exit(1);
  }
}

run();
