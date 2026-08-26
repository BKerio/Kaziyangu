import { AppContext } from '../../context.js';
import { ReminderService } from './reminder.service.js';

const POLL_INTERVAL_MS = 60_000;

/**
 * Starts the background poller that fires due task reminders. Runs once a
 * minute for the lifetime of the process - fine-grained enough given
 * reminders are scheduled in whole minutes (30-min lead, 10-min repeats).
 * Returns the interval handle so server.ts can clear it on shutdown.
 */
export function startReminderScheduler(ctx: AppContext): NodeJS.Timeout {
  const reminderService = new ReminderService(ctx);

  const tick = () => {
    reminderService.runDueReminders().catch((err) => {
      ctx.log.error({ err }, 'Reminder scheduler run failed');
    });
  };

  tick(); // don't wait a full minute after boot for the first pass
  return setInterval(tick, POLL_INTERVAL_MS);
}
