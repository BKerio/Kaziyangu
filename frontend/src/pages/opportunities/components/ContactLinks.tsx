import { Mail, MessageCircle, Phone } from 'lucide-react';
import { whatsappLink } from '@/utils/opportunity';

const linkStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-2)', textDecoration: 'none',
} as const;

/** Inline phone / email / WhatsApp links for a person. */
function ContactLinks({ phone, email, compact = false }: { phone?: string | null; email?: string | null; compact?: boolean }) {
  const wa = whatsappLink(phone);
  if (!phone && !email) return <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>No contact details</span>;
  return (
    <span className="flex items-center" style={{ gap: 12, flexWrap: 'wrap' }}>
      {phone && (
        <a href={`tel:${phone.replace(/\s/g, '')}`} style={linkStyle} title={`Call ${phone}`} onClick={(e) => e.stopPropagation()}>
          <Phone size={12} style={{ color: 'var(--red)' }} /> {!compact && phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} style={linkStyle} title={`Email ${email}`} onClick={(e) => e.stopPropagation()}>
          <Mail size={12} style={{ color: 'var(--red)' }} /> {!compact && email}
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" style={linkStyle} title="WhatsApp" onClick={(e) => e.stopPropagation()}>
          <MessageCircle size={12} style={{ color: 'var(--green)' }} /> {!compact && 'WhatsApp'}
        </a>
      )}
    </span>
  );
}

export default ContactLinks;
