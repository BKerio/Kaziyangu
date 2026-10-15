/**
 * Meta WhatsApp Cloud API shapes - just the subset this bot sends/receives.
 * https://developers.facebook.com/docs/whatsapp/cloud-api
 */

export interface WebhookPayload {
  object: string;
  entry?: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  field: string;
  value: WebhookValue;
}

export interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WebhookContact[];
  messages?: IncomingMessage[];
  /** Delivery receipts for messages we sent - a "failed" one is the only sign a reply never arrived. */
  statuses?: Array<{
    id: string;
    status: string;
    recipient_id?: string;
    recipient_user_id?: string;
    errors?: Array<{ code: number; title?: string; message?: string; error_data?: { details?: string } }>;
  }>;
}

/**
 * Since Meta's 2026 username rollout, a sender who has set a WhatsApp username
 * may arrive without a phone number - identified only by a business-scoped
 * user id (BSUID, e.g. "KE.1234…") - so wa_id and `from` can't be assumed to
 * be phone numbers.
 */
export interface WebhookContact {
  profile?: { name: string; username?: string };
  wa_id?: string;
  user_id?: string;
}

export type IncomingMessage = TextMessage | InteractiveMessage | ButtonMessage | ImageMessage | DocumentMessage;

interface BaseMessage {
  /** Usually the sender's phone digits; may be a BSUID or missing for username-only senders. */
  from?: string;
  from_user_id?: string;
  id: string;
  timestamp: string;
}

export interface TextMessage extends BaseMessage {
  type: 'text';
  text: { body: string };
}

/** A photo sent to the bot - used to attach a proof-of-work screenshot while logging a task. */
export interface ImageMessage extends BaseMessage {
  type: 'image';
  image: { id: string; mime_type: string; sha256: string; caption?: string };
}

/** A file sent with WhatsApp's attach-document option - a PDF or Word file attached as proof of work. */
export interface DocumentMessage extends BaseMessage {
  type: 'document';
  document: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
}

export interface InteractiveMessage extends BaseMessage {
  type: 'interactive';
  interactive: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface ButtonMessage extends BaseMessage {
  type: 'button';
  button: { payload: string; text: string };
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

/** A titled group of rows within a list message - renders as a labeled divider in WhatsApp. */
export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface ReplyButton {
  id: string;
  title: string;
}
