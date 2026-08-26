import { AppContext } from '../../context.js';
import { BadRequestError, NotFoundError } from '../../shared/errors/AppError.js';
import {
  deleteOpportunityAttachmentFile,
  opportunityAttachmentFilePath,
  saveOpportunityAttachmentFile,
} from './attachment-storage.js';
import { MAX_ATTACHMENTS_PER_OPPORTUNITY } from './attachment-constants.js';

export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

/** Documents attached to an opportunity - proposals, RFQs, contracts, etc. */
export class OpportunityAttachmentService {
  constructor(private app: AppContext) {}

  private async findOpportunity(opportunityId: string) {
    const opportunity = await this.app.prisma.opportunity.findUnique({ where: { id: opportunityId } });
    if (!opportunity) throw new NotFoundError('Opportunity');
    return opportunity;
  }

  async list(opportunityId: string) {
    await this.findOpportunity(opportunityId);
    return this.app.prisma.opportunityAttachment.findMany({
      where: { opportunityId },
      orderBy: { createdAt: 'asc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async addMany(opportunityId: string, uploadedById: string, files: UploadedFile[]) {
    const opportunity = await this.findOpportunity(opportunityId);

    const existingCount = await this.app.prisma.opportunityAttachment.count({ where: { opportunityId } });
    if (existingCount + files.length > MAX_ATTACHMENTS_PER_OPPORTUNITY) {
      throw new BadRequestError(`An opportunity can have at most ${MAX_ATTACHMENTS_PER_OPPORTUNITY} files`);
    }

    const created = [];
    for (const file of files) {
      const storageKey = await saveOpportunityAttachmentFile(opportunity.id, file.buffer, file.originalName);
      const attachment = await this.app.prisma.opportunityAttachment.create({
        data: {
          opportunityId: opportunity.id,
          uploadedById,
          fileName: file.originalName,
          mimeType: file.mimeType,
          bytes: file.size,
          storageKey,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
      created.push(attachment);
      await this.app.auditLog.record({
        actorId: uploadedById, action: 'CREATE', subjectType: 'OPPORTUNITY_ATTACHMENT', subjectId: attachment.id,
        summary: `Attached file to opportunity "${opportunity.name}": ${attachment.fileName}`,
        newValues: attachment,
      });
    }
    return created;
  }

  async getFile(opportunityId: string, attachmentId: string) {
    await this.findOpportunity(opportunityId);
    const attachment = await this.app.prisma.opportunityAttachment.findFirst({
      where: { id: attachmentId, opportunityId },
    });
    if (!attachment) throw new NotFoundError('Attachment');
    return { ...attachment, path: opportunityAttachmentFilePath(attachment.storageKey) };
  }

  async remove(opportunityId: string, attachmentId: string, actorId: string): Promise<void> {
    await this.findOpportunity(opportunityId);
    const attachment = await this.app.prisma.opportunityAttachment.findFirst({
      where: { id: attachmentId, opportunityId },
    });
    if (!attachment) throw new NotFoundError('Attachment');

    await deleteOpportunityAttachmentFile(attachment.storageKey);
    await this.app.prisma.opportunityAttachment.delete({ where: { id: attachment.id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'OPPORTUNITY_ATTACHMENT', subjectId: attachment.id,
      summary: `Removed opportunity attachment: ${attachment.fileName}`,
      oldValues: attachment,
    });
  }

  async removeAllForOpportunity(opportunityId: string): Promise<void> {
    const attachments = await this.app.prisma.opportunityAttachment.findMany({ where: { opportunityId } });
    await Promise.all(attachments.map((a) => deleteOpportunityAttachmentFile(a.storageKey)));
  }
}
