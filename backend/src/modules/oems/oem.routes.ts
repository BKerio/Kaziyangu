import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { OpportunityStage, Role } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/AppError.js';

const staffRoles = [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN];
const managerRoles = [Role.ADMIN, Role.SUPER_ADMIN];

const optText = z.string().trim().optional().transform((v) => (v === '' ? null : v));

const oemSchema = z.object({
  name: z.string().trim().min(1, 'OEM name is required'),
  category: optText,
  website: optText,
  partnerManagerName: optText,
  partnerManagerEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional()
    .transform((v) => (v === '' ? null : v)),
  partnerManagerPhone: optText,
  notes: optText,
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);
  return result.data;
}

/** Finds an OEM by case-insensitive name, creating it if it's new. */
export async function resolveOem(ctx: AppContext, name: string, actorId: string) {
  const trimmed = name.trim();
  const existing = await ctx.prisma.oem.findFirst({ where: { name: { equals: trimmed, mode: 'insensitive' } } });
  if (existing) return existing;
  const oem = await ctx.prisma.oem.create({ data: { name: trimmed } });
  await ctx.auditLog.record({
    actorId, action: 'CREATE', subjectType: 'OEM', subjectId: oem.id, summary: `Added OEM: ${oem.name}`, newValues: oem,
  });
  return oem;
}

/** OEM / vendor catalogue (HPE, Hikvision, ...) with per-OEM pipeline roll-ups. */
export function oemRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requireRole(staffRoles));

  router.get('/', async (_req, res) => {
    const oems = await ctx.prisma.oem.findMany({
      orderBy: { name: 'asc' },
      include: { opportunities: { select: { value: true, opportunity: { select: { stage: true } } } } },
    });
    const data = oems.map(({ opportunities, ...o }) => {
      let openCount = 0, openValue = 0, wonCount = 0;
      for (const link of opportunities) {
        const stage = link.opportunity.stage;
        if (stage === OpportunityStage.WON) wonCount++;
        else if (stage !== OpportunityStage.LOST) { openCount++; openValue += link.value ?? 0; }
      }
      return { ...o, dealCount: opportunities.length, openCount, openValue, wonCount };
    });
    res.send({ ok: true, data });
  });

  router.post('/', async (req, res) => {
    const data = parse(oemSchema, req.body);
    const clash = await ctx.prisma.oem.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } } });
    if (clash) throw new ConflictError(`${clash.name} is already in the OEM list`);
    const oem = await ctx.prisma.oem.create({ data });
    await ctx.auditLog.record({
      actorId: req.user.userId, action: 'CREATE', subjectType: 'OEM', subjectId: oem.id,
      summary: `Added OEM: ${oem.name}`, newValues: oem,
    });
    res.status(201).send({ ok: true, data: oem });
  });

  router.patch('/:id', async (req, res) => {
    const data = parse(oemSchema.partial(), req.body);
    const existing = await ctx.prisma.oem.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('OEM');
    if (data.name) {
      const clash = await ctx.prisma.oem.findFirst({
        where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id: existing.id } },
      });
      if (clash) throw new ConflictError(`${clash.name} is already in the OEM list`);
    }
    const oem = await ctx.prisma.oem.update({ where: { id: existing.id }, data });
    await ctx.auditLog.record({
      actorId: req.user.userId, action: 'UPDATE', subjectType: 'OEM', subjectId: oem.id,
      summary: `Updated OEM: ${oem.name}`, oldValues: existing, newValues: oem,
    });
    res.send({ ok: true, data: oem });
  });

  router.delete('/:id', requireRole(managerRoles), async (req, res) => {
    const existing = await ctx.prisma.oem.findUnique({
      where: { id: req.params.id }, include: { _count: { select: { opportunities: true } } },
    });
    if (!existing) throw new NotFoundError('OEM');
    if (existing._count.opportunities > 0) {
      throw new ConflictError(`${existing.name} is linked to ${existing._count.opportunities} opportunit${existing._count.opportunities === 1 ? 'y' : 'ies'} - remove it from those first`);
    }
    await ctx.prisma.oem.delete({ where: { id: existing.id } });
    await ctx.auditLog.record({
      actorId: req.user.userId, action: 'DELETE', subjectType: 'OEM', subjectId: existing.id,
      summary: `Deleted OEM: ${existing.name}`, oldValues: existing,
    });
    res.send({ ok: true });
  });

  return router;
}
