import type { PrismaClient } from '../../generated/prisma/index.js';

/**
 * WhatsApp senders arrive as a bare international-format digit string (e.g.
 * "2547XXXXXXXX"). Staff `phone` is free-text (e.g. "07XXXXXXXX",
 * "+254 7XX XXX XXX"), so exact equality would rarely match. Comparing the
 * last 9 digits is long enough to be unique per person while absorbing
 * country-code / leading-zero formatting differences.
 */
function significantDigits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-9);
}

export async function findUserByPhone(prisma: PrismaClient, waPhone: string) {
  const target = significantDigits(waPhone);
  if (!target) return null;

  const candidates = await prisma.user.findMany({
    where: { isActive: true, phone: { not: null } },
  });

  return candidates.find((u) => u.phone && significantDigits(u.phone) === target) ?? null;
}
