import Swal from 'sweetalert2';

/**
 * Central SweetAlert2 wrapper - every popup/toast/confirm dialog in the app
 * should go through here so styling stays consistent and on-brand.
 */

const BUTTON_STYLING = { buttonsStyling: false } as const;

const ICON_COLOR: Record<'success' | 'error' | 'warning' | 'info' | 'question', string> = {
  success: '#169A5B',
  error: '#D62828',
  warning: '#B7791F',
  info: '#2563EB',
  question: '#C8202B',
};

/** Toast-style popup in the top-right corner, auto-dismisses - for success/info/warning/error notices. */
export function notify(type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) {
  return Swal.fire({
    ...BUTTON_STYLING,
    toast: true,
    position: 'top-end',
    icon: type,
    iconColor: ICON_COLOR[type],
    title,
    text: message,
    showConfirmButton: false,
    timer: 5000,
    timerProgressBar: true,
    customClass: { popup: 'swal-toast' },
  });
}

interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red) and uses the warning icon. */
  danger?: boolean;
}

/** Centered modal confirmation - resolves true if confirmed, false if cancelled/dismissed. */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const result = await Swal.fire({
    ...BUTTON_STYLING,
    title: opts.title,
    text: opts.text,
    icon: opts.danger ? 'warning' : 'question',
    iconColor: opts.danger ? ICON_COLOR.error : ICON_COLOR.question,
    showCancelButton: true,
    confirmButtonText: opts.confirmLabel ?? 'Confirm',
    cancelButtonText: opts.cancelLabel ?? 'Cancel',
    reverseButtons: true,
    focusCancel: true,
    customClass: {
      popup: 'swal-confirm',
      confirmButton: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`,
      cancelButton: 'btn btn-ghost',
      actions: 'swal-actions',
    },
  });
  return result.isConfirmed;
}

/** Simple informational alert with a single acknowledge button. */
export function alertInfo(title: string, text?: string) {
  return Swal.fire({
    ...BUTTON_STYLING,
    title,
    text,
    icon: 'info',
    iconColor: ICON_COLOR.info,
    confirmButtonText: 'OK',
    customClass: { popup: 'swal-confirm', confirmButton: 'btn btn-primary', actions: 'swal-actions' },
  });
}

interface PromptOptions {
  title: string;
  text?: string;
  /** Small uppercase eyebrow above the title (e.g. "Out of office"). */
  kicker?: string;
  /** Optional pill shown under the lead text (e.g. a date). */
  badge?: string;
  inputLabel?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Minimum trimmed length; defaults to 1. */
  minLength?: number;
  maxLength?: number;
  validationMessage?: string;
}

/**
 * Centered modal with a short text input. Resolves the trimmed value on confirm,
 * or null if cancelled / dismissed.
 */
export async function promptDialog(opts: PromptOptions): Promise<string | null> {
  const minLength = opts.minLength ?? 1;
  const maxLength = opts.maxLength ?? 200;
  const label = opts.inputLabel ?? 'Reason';

  const result = await Swal.fire({
    ...BUTTON_STYLING,
    title: false,
    icon: undefined,
    html: `
      <div class="swal-prompt-head">
        ${opts.kicker ? `<p class="swal-prompt-kicker">${escapeHtml(opts.kicker)}</p>` : ''}
        <h2 class="swal-prompt-title">${escapeHtml(opts.title)}</h2>
        ${opts.text ? `<p class="swal-prompt-lead">${escapeHtml(opts.text)}</p>` : ''}
        ${opts.badge ? `<span class="swal-prompt-date">${escapeHtml(opts.badge)}</span>` : ''}
      </div>
      <div class="swal-prompt-body">
        <label class="swal-prompt-label" for="swal-prompt-input">${escapeHtml(label)}</label>
      </div>
    `,
    input: 'textarea',
    inputPlaceholder: opts.placeholder,
    inputAttributes: {
      id: 'swal-prompt-input',
      maxlength: String(maxLength),
      autocomplete: 'off',
      rows: '3',
    },
    showCancelButton: true,
    confirmButtonText: opts.confirmLabel ?? 'Confirm',
    cancelButtonText: opts.cancelLabel ?? 'Cancel',
    reverseButtons: true,
    focusConfirm: false,
    customClass: {
      popup: 'swal-prompt',
      htmlContainer: 'swal-prompt-html',
      input: 'swal-prompt-input',
      confirmButton: 'btn btn-primary',
      cancelButton: 'btn btn-ghost',
      actions: 'swal-actions swal-prompt-actions',
    },
    inputValidator: (value) => {
      const trimmed = value.trim();
      if (trimmed.length < minLength) {
        return opts.validationMessage ?? 'Please enter a brief reason.';
      }
      if (trimmed.length > maxLength) {
        return `Keep it under ${maxLength} characters.`;
      }
      return null;
    },
  });
  if (!result.isConfirmed || typeof result.value !== 'string') return null;
  return result.value.trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
