import { AppContext } from '../../context.js';
import { Role } from '../../shared/types/index.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { attachmentFilePath, deleteAttachmentFile, saveAttachmentFile } from './attachment-storage.js';
import { MAX_ATTACHMENTS_PER_TASK } from './attachment-constants.js';

const MANAGER_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

/**
 * Screenshots (or a PDF) attached to a WorkTask as proof of work - uploaded
 * from the web "Log a Task" form or sent as a photo to the WhatsApp bot.
 * Shares ownership rules with TaskService: the task's own logger, or any
 * Admin/Super Admin, may view/add/remove attachments.
 */
export class TaskAttachmentService {
  constructor(private app: AppContext) {}

  private isManager(role: Role): boolean {
    return MANAGER_ROLES.includes(role);
  }

  private async findOwnedTask(taskId: string, actor: { userId: string; role: Role }) {
    const task = await this.app.prisma.workTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError('Task');
    if (task.userId !== actor.userId && !this.isManager(actor.role)) {
      throw new ForbiddenError('You do not have permission to access this task');
    }
    return task;
  }

  async list(taskId: string, actor: { userId: string; role: Role }) {
    await this.findOwnedTask(taskId, actor);
    return this.app.prisma.taskAttachment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
  }

  async addMany(taskId: string, actor: { userId: string; role: Role }, files: UploadedFile[]) {
    const task = await this.findOwnedTask(taskId, actor);

    const existingCount = await this.app.prisma.taskAttachment.count({ where: { taskId } });
    if (existingCount + files.length > MAX_ATTACHMENTS_PER_TASK) {
      throw new BadRequestError(`A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments`);
    }

    const created = [];
    for (const file of files) {
      const storageKey = await saveAttachmentFile(task.id, file.buffer, file.originalName);
      const attachment = await this.app.prisma.taskAttachment.create({
        data: {
          taskId: task.id,
          uploadedById: actor.userId,
          fileName: file.originalName,
          mimeType: file.mimeType,
          bytes: file.size,
          storageKey,
        },
      });
      created.push(attachment);
      await this.app.auditLog.record({
        actorId: actor.userId, action: 'CREATE', subjectType: 'TASK_ATTACHMENT', subjectId: attachment.id,
        summary: `Attached file to task "${task.description}": ${attachment.fileName}`,
        newValues: attachment,
      });
    }
    return created;
  }

  /** Used by the WhatsApp bot, which already has raw bytes rather than a multipart upload. */
  async addFromBuffer(taskId: string, uploadedById: string, buffer: Buffer, mimeType: string, fileName: string) {
    const existingCount = await this.app.prisma.taskAttachment.count({ where: { taskId } });
    if (existingCount + 1 > MAX_ATTACHMENTS_PER_TASK) {
      throw new BadRequestError(`A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments`);
    }

    const storageKey = await saveAttachmentFile(taskId, buffer, fileName);
    return this.app.prisma.taskAttachment.create({
      data: { taskId, uploadedById, fileName, mimeType, bytes: buffer.length, storageKey },
    });
  }

  async getFile(taskId: string, attachmentId: string, actor: { userId: string; role: Role }) {
    await this.findOwnedTask(taskId, actor);
    const attachment = await this.app.prisma.taskAttachment.findFirst({ where: { id: attachmentId, taskId } });
    if (!attachment) throw new NotFoundError('Attachment');
    return { ...attachment, path: attachmentFilePath(attachment.storageKey) };
  }

  async remove(taskId: string, attachmentId: string, actor: { userId: string; role: Role }): Promise<void> {
    await this.findOwnedTask(taskId, actor);
    const attachment = await this.app.prisma.taskAttachment.findFirst({ where: { id: attachmentId, taskId } });
    if (!attachment) throw new NotFoundError('Attachment');

    await deleteAttachmentFile(attachment.storageKey);
    await this.app.prisma.taskAttachment.delete({ where: { id: attachment.id } });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'TASK_ATTACHMENT', subjectId: attachment.id,
      summary: `Removed attachment: ${attachment.fileName}`,
      oldValues: attachment,
    });
  }
}
