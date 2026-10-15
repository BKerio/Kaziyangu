import type { PrismaClient } from '../../generated/prisma/index.js';

/**
 * WhatsApp senders arrive as a bare international-format digit string (e.g.
 * "2547XXXXXXXX"). Staff `phone` is free-text (e.g. "07XXXXXXXX",
 * "+254 7XX XXX XXX"), so exact equality would rarely match. Comparing the
 * last 9 digits is long enough to be unique per person while absorbing
 * country-code / leading-zero formatting differences.
 */
export function significantDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').slice(-9);
}

/**
 * A free-text staff phone ("0712 345 678", "+254 712…") as the international
 * digits WhatsApp delivers to ("254712345678"). A local number without the
 * country code would otherwise be rejected or sent to the wrong country.
 */
export function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

export async function findUserByPhone(prisma: PrismaClient, waPhone: string) {
  const target = significantDigits(waPhone);
  // Fewer than 9 digits can't identify anyone - and would otherwise match
  // every staff row whose phone was saved blank.
  if (target.length < 9) return null;

  const candidates = await prisma.user.findMany({
    where: { isActive: true, phone: { not: null } },
  });

  return candidates.find((u) => u.phone && significantDigits(u.phone) === target) ?? null;
}

/** The active user a WhatsApp business-scoped user id has been linked to, if any. */
export async function findUserByWhatsAppId(prisma: PrismaClient, userId: string) {
  return prisma.user.findFirst({ where: { whatsappUserId: userId, isActive: true } });
}

/**
 * Remembers which business-scoped id belongs to a user, so they're still
 * recognised if they later hide their number behind a WhatsApp username.
 * Moves the id off any other row first (ids are unique per person).
 */
export async function linkWhatsAppId(prisma: PrismaClient, userId: string, whatsappUserId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.updateMany({ where: { whatsappUserId, NOT: { id: userId } }, data: { whatsappUserId: null } }),
    prisma.user.update({ where: { id: userId }, data: { whatsappUserId } }),
  ]);
}
