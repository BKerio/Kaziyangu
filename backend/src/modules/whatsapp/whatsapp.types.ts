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
  statuses?: Array<{ id: string; status: string; recipient_id: string }>;
}

export interface WebhookContact {
  profile: { name: string };
  wa_id: string;
}

export type IncomingMessage = TextMessage | InteractiveMessage | ButtonMessage | ImageMessage;

interface BaseMessage {
  from: string;
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
