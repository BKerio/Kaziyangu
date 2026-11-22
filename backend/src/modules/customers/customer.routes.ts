import { Router } from 'express';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { CustomerService } from './customer.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Role } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';

const staffRoles = [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN];
const managerRoles = [Role.ADMIN, Role.SUPER_ADMIN];

// Blank form inputs become null so an edit can clear a field.
const optText = z.string().trim().optional().transform((v) => (v === '' ? null : v));
const optEmail = z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional()
  .transform((v) => (v === '' ? null : v));

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required'),
  shortName: optText,
  industry: optText,
  sector: optText,
  website: optText,
  email: optEmail,
  phone: optText,
  address: optText,
  kraPin: optText,
  notes: optText,
  accountManagerId: z.string().uuid().nullable().optional(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Contact name is required'),
  title: optText,
  department: optText,
  email: optEmail,
  phone: optText,
  altPhone: optText,
  isPrimary: z.boolean().optional(),
  notes: optText,
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestError(result.error.issues[0].message);
  return result.data;
}

export function customerRoutes(ctx: AppContext): Router {
  const router = Router();
  const service = new CustomerService(ctx);

  router.use(authenticate);
  router.use(requireRole(staffRoles));

  router.get('/', async (req, res) => {
    const q = req.query as { search?: string; page?: string; limit?: string };
    const result = await service.list({
      search: q.search,
      page: q.page ? parseInt(q.page, 10) : 1,
      limit: q.limit ? Math.min(parseInt(q.limit, 10), 200) : 20,
    });
    res.send({ ok: true, ...result });
  });

  router.get('/options', async (_req, res) => {
    res.send({ ok: true, data: await service.options() });
  });

  router.get('/:id', async (req, res) => {
    res.send({ ok: true, data: await service.getById(req.params.id) });
  });

  router.post('/', async (req, res) => {
    const data = parse(customerSchema, req.body);
    res.status(201).send({ ok: true, data: await service.create(data, req.user.userId) });
  });

  router.patch('/:id', async (req, res) => {
    const data = parse(customerSchema.partial(), req.body);
    res.send({ ok: true, data: await service.update(req.params.id, data, req.user.userId) });
  });

  router.delete('/:id', requireRole(managerRoles), async (req, res) => {
    await service.delete(req.params.id, req.user.userId);
    res.send({ ok: true });
  });

  router.post('/:id/contacts', async (req, res) => {
    const data = parse(contactSchema, req.body);
    res.status(201).send({ ok: true, data: await service.addContact(req.params.id, data, req.user.userId) });
  });

  router.patch('/:id/contacts/:contactId', async (req, res) => {
    const data = parse(contactSchema.partial(), req.body);
    res.send({ ok: true, data: await service.updateContact(req.params.id, req.params.contactId, data, req.user.userId) });
  });

  router.delete('/:id/contacts/:contactId', async (req, res) => {
    await service.deleteContact(req.params.id, req.params.contactId, req.user.userId);
    res.send({ ok: true });
  });

  return router;
}
