import { Router } from 'express';
import { AppContext } from '../../context.js';
import { isWhatsAppEnabled } from './whatsapp.config.js';
import { WhatsAppClient } from './whatsapp.client.js';
import { WhatsAppBotService } from './whatsapp-bot.service.js';
import type { WebhookPayload } from './whatsapp.types.js';

/**
 * Mounted at /whatsapp. Registers no routes at all unless every WhatsApp env
 * var is set, so an unconfigured deployment doesn't expose a dead webhook.
 */
export function whatsappRoutes(ctx: AppContext): Router {
  const router = Router();

  if (!isWhatsAppEnabled(ctx.config)) {
    ctx.log.warn(
      'WhatsApp bot disabled - set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN to enable.'
    );
    return router;
  }

  const client = new WhatsAppClient(ctx.config, ctx.log);
  const bot = new WhatsAppBotService(ctx, client);

  /**
   * GET /whatsapp/webhook
   * Meta's one-time webhook verification handshake.
   */
  router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === ctx.config.WHATSAPP_VERIFY_TOKEN && typeof challenge === 'string') {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  /**
   * POST /whatsapp/webhook
   * Meta requires a fast 200 ack; message handling happens after the
   * response is sent so a slow reply from us never causes Meta to retry.
   */
  router.post('/webhook', (req, res) => {
    res.sendStatus(200);
    bot.processWebhook(req.body as WebhookPayload).catch((err) => {
      ctx.log.error({ err }, 'WhatsApp webhook processing failed');
    });
  });

  return router;
}
