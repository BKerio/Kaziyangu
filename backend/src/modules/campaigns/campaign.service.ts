import { AppContext } from '../../context.js';
import { Department, Role } from '../../shared/types/index.js';
import { BadRequestError, NotFoundError } from '../../shared/errors/AppError.js';
import { isWhatsAppEnabled } from '../whatsapp/whatsapp.config.js';
import { WhatsAppClient } from '../whatsapp/whatsapp.client.js';
import { toWhatsAppNumber } from '../whatsapp/user-lookup.js';
import { isSmsEnabled } from '../reminders/reminder.config.js';
import { AdvantaSmsClient } from '../reminders/sms.client.js';

export type CampaignChannel = 'WHATSAPP' | 'SMS';

export interface CampaignAudience {
  everyone: boolean;
  roles: Role[];
  departments: Department[];
  /** Specific people, added on top of any role/department filter. */
  userIds: string[];
}

export interface CreateCampaignInput {
  title: string;
  message: string;
  channels: CampaignChannel[];
  audience: CampaignAudience;
}

// WhatsApp's template body tops out at 1024 characters including the fixed
// text around the parameters, so the message itself is capped well under it.
export const MAX_MESSAGE_LENGTH = 700;
export const MAX_TITLE_LENGTH = 60;

// WhatsApp campaigns send a short utility "you have a notice" template
// (body params {{1}} first name, {{2}} notice title, plus a "View Notice"
// quick-reply button). The full message is sent only when the person taps
// the button - as an ordinary reply inside the conversation they just opened -
// so the template itself stays a plain notification and keeps Utility pricing.
const NOTICE_TEMPLATE = 'staff_notice';
const NOTICE_TEMPLATE_LANGUAGE = 'en';
export const NOTICE_PAYLOAD_PREFIX = 'notice_';

// Sends run a few at a time - fast for a staff-sized list, gentle on the gateways.
const SEND_CONCURRENCY = 4;

interface Person {
  id: string;
  name: string;
  phone: string | null;
}

function firstName(name: string): string {
  return name.split(' ')[0] || name;
}

/** Fills {name} with the recipient's first name. */
function personalise(text: string, person: Person): string {
  return text.replace(/\{name\}/gi, firstName(person.name));
}

/** The full notice as shown in the chat. */
export function noticeText(title: string, message: string, person: { name: string }): string {
  return `*${title}*\n\nHello ${firstName(person.name)},\n\n${message.replace(/\{name\}/gi, firstName(person.name))}\n\n_Sent by Millenium Solutions management_`;
}

export class CampaignService {
  private readonly whatsapp: WhatsAppClient | null;
  private readonly sms: AdvantaSmsClient | null;

  constructor(private app: AppContext) {
    this.whatsapp = isWhatsAppEnabled(app.config) ? new WhatsAppClient(app.config, app.log) : null;
    this.sms = isSmsEnabled(app.config) ? new AdvantaSmsClient(app.config, app.log) : null;
  }

  availableChannels(): CampaignChannel[] {
    return [...(this.whatsapp ? ['WHATSAPP' as const] : []), ...(this.sms ? ['SMS' as const] : [])];
  }

  /** Everyone who can be chosen as a recipient, for the people picker. */
  async listPeople() {
    const users = await this.app.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, role: true, department: true, phone: true },
      orderBy: { name: 'asc' },
    });
    return users.map(({ phone, ...u }) => ({ ...u, hasPhone: (phone ?? '').replace(/\D/g, '').length >= 9 }));
  }

  /** The active users an audience resolves to. */
  private async resolveAudience(audience: CampaignAudience) {
    const select = { id: true, name: true, phone: true } as const;
    if (audience.everyone) {
      return this.app.prisma.user.findMany({ where: { isActive: true }, select, orderBy: { name: 'asc' } });
    }

    const filtered = audience.roles.length > 0 || audience.departments.length > 0;
    const or = [
      ...(filtered
        ? [{
            ...(audience.roles.length > 0 ? { role: { in: audience.roles } } : {}),
            ...(audience.departments.length > 0 ? { department: { in: audience.departments } } : {}),
          }]
        : []),
      ...(audience.userIds.length > 0 ? [{ id: { in: audience.userIds } }] : []),
    ];
    if (or.length === 0) return [];

    return this.app.prisma.user.findMany({ where: { isActive: true, OR: or }, select, orderBy: { name: 'asc' } });
  }

  async previewAudience(audience: CampaignAudience) {
    const people = await this.resolveAudience(audience);
    const withPhone = people.filter((p) => (p.phone ?? '').replace(/\D/g, '').length >= 9);
    return {
      count: people.length,
      reachable: withPhone.length,
      missingPhone: people.filter((p) => !withPhone.includes(p)).map((p) => p.name),
      sample: people.slice(0, 8).map((p) => p.name),
    };
  }

  async create(actor: { userId: string }, input: CreateCampaignInput) {
    const title = input.title.trim();
    const message = input.message.trim();
    if (!title) throw new BadRequestError('Add a title');
    if (!message) throw new BadRequestError('Write a message');
    if (title.length > MAX_TITLE_LENGTH) throw new BadRequestError(`Keep the title under ${MAX_TITLE_LENGTH} characters`);
    if (message.length > MAX_MESSAGE_LENGTH) throw new BadRequestError(`Keep the message under ${MAX_MESSAGE_LENGTH} characters`);

    const available = this.availableChannels();
    const channels = [...new Set(input.channels)];
    if (channels.length === 0) throw new BadRequestError('Choose at least one channel');
    const unavailable = channels.filter((c) => !available.includes(c));
    if (unavailable.length > 0) throw new BadRequestError(`${unavailable.join(', ')} is not configured on the server`);

    const people = await this.resolveAudience(input.audience);
    if (people.length === 0) throw new BadRequestError('No one matches the chosen audience');

    const campaign = await this.app.prisma.campaign.create({
      data: {
        title,
        message,
        channels,
        audience: input.audience as object,
        recipientCount: people.length,
        createdById: actor.userId,
        recipients: {
          create: people.flatMap((p) =>
            channels.map((channel) => ({
              userId: p.id,
              name: p.name,
              channel,
              ...((p.phone ?? '').replace(/\D/g, '').length < 9 ? { status: 'FAILED', error: 'No phone number on profile' } : {}),
            }))
          ),
        },
      },
    });

    await this.app.auditLog.record({
      actorId: actor.userId, action: 'CREATE', subjectType: 'CAMPAIGN', subjectId: campaign.id,
      summary: `Sent campaign "${title}" to ${people.length} ${people.length === 1 ? 'person' : 'people'} via ${channels.join(' and ')}`,
      newValues: { title, channels, audience: input.audience, recipientCount: people.length },
    });

    // Sending can take a while for a large list - it runs after the request
    // returns, and the page polls the campaign for progress.
    void this.deliver(campaign.id, title, message, new Map(people.map((p) => [p.id, p]))).catch((err) =>
      this.app.log.error({ err, campaignId: campaign.id }, 'Campaign delivery crashed')
    );

    return campaign;
  }

  private async deliver(campaignId: string, title: string, message: string, people: Map<string, Person>): Promise<void> {
    const queue = await this.app.prisma.campaignRecipient.findMany({ where: { campaignId, status: 'PENDING' } });

    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const person = people.get(job.userId);
        let ok = false;
        let error: string | undefined;

        try {
          if (!person?.phone) {
            error = 'No phone number on profile';
          } else if (job.channel === 'WHATSAPP' && this.whatsapp) {
            const to = toWhatsAppNumber(person.phone);
            ok = await this.whatsapp.sendTemplate(to, NOTICE_TEMPLATE, NOTICE_TEMPLATE_LANGUAGE, [firstName(person.name), title], {
              maxParamLength: MAX_TITLE_LENGTH,
              quickReplyPayloads: [`${NOTICE_PAYLOAD_PREFIX}${job.id}`],
            });
            // Until the template is approved, the full message still reaches
            // anyone who has messaged the bot in the last 24 hours.
            if (!ok) ok = await this.whatsapp.sendMessage(to, { type: 'text', text: noticeText(title, message, person) });
            if (!ok) error = 'WhatsApp rejected the message (template not approved yet, or outside the 24-hour window)';
          } else if (job.channel === 'SMS' && this.sms) {
            ok = await this.sms.sendSms(toWhatsAppNumber(person.phone), `${title}: ${personalise(message, person)}`);
            if (!ok) error = 'SMS gateway rejected the message';
          } else {
            error = `${job.channel} is not configured`;
          }
        } catch (err) {
          error = err instanceof Error ? err.message : 'Send failed';
        }

        await this.app.prisma.campaignRecipient.update({
          where: { id: job.id },
          data: { status: ok ? 'SENT' : 'FAILED', error: ok ? null : error, sentAt: ok ? new Date() : null },
        });
      }
    };

    await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));

    const [sent, failed] = await Promise.all([
      this.app.prisma.campaignRecipient.count({ where: { campaignId, status: 'SENT' } }),
      this.app.prisma.campaignRecipient.count({ where: { campaignId, status: 'FAILED' } }),
    ]);
    await this.app.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: sent,
        failedCount: failed,
        status: failed === 0 ? 'SENT' : sent === 0 ? 'FAILED' : 'PARTIAL',
        completedAt: new Date(),
      },
    });
  }

  /**
   * "View Notice" tapped: the full message for that recipient, provided the
   * notice really was sent to this user. Marks it read the first time.
   */
  async openNotice(recipientId: string, userId: string) {
    const recipient = await this.app.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: { campaign: { select: { title: true, message: true } } },
    });
    if (!recipient || recipient.userId !== userId) return null;
    if (!recipient.readAt) {
      await this.app.prisma.campaignRecipient.update({ where: { id: recipientId }, data: { readAt: new Date() } });
    }
    return recipient.campaign;
  }

  async list(page: number, limit: number) {
    const [data, total] = await Promise.all([
      this.app.prisma.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.app.prisma.campaign.count(),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async get(id: string) {
    const campaign = await this.app.prisma.campaign.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        recipients: { orderBy: [{ status: 'asc' }, { name: 'asc' }] },
      },
    });
    if (!campaign) throw new NotFoundError('Campaign');
    // Live counts while it's still sending.
    if (campaign.status === 'SENDING') {
      campaign.sentCount = campaign.recipients.filter((r) => r.status === 'SENT').length;
      campaign.failedCount = campaign.recipients.filter((r) => r.status === 'FAILED').length;
    }
    return campaign;
  }
}
