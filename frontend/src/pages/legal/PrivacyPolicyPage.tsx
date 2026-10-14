import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import logo from '@/assets/logos/logo(black).png';

// Public page (no login) - its URL is what Meta (WhatsApp Cloud API) and
// Microsoft (Outlook sign-in) are given as this app's privacy policy, so keep
// it reachable without auth and keep it in sync with what the backend collects.
const COMPANY = 'Millenium Solutions E.A Ltd';
const CONTACT_EMAIL = 'info@millenium.co.ke';
const LAST_UPDATED = '14 October 2026';

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="privacy-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function PrivacyPolicyPage() {
  return (
    <div className="privacy-page">
      <article className="privacy-card fade-up">
        <header className="privacy-head">
          <img src={logo} draggable={false} alt={COMPANY} style={{ height: 56, width: 'auto' }} />
          <h1 className="login-title" style={{ marginTop: 18 }}>Privacy Policy</h1>
          <p className="login-sub" style={{ margin: 0 }}>Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="privacy-body">
          <p>
            This policy explains how {COMPANY} ("we", "us") collects, uses and protects personal information
            in our internal task management workspace at <strong>tasks.millenium.co.ke</strong>, including its
            WhatsApp assistant and its Outlook sign-in. The workspace is for our staff, attachees (interns) and
            authorised personnel only.
          </p>

          <Section title="1. Information we collect">
            <ul>
              <li><strong>Account details:</strong> your name, work email, phone number, role, department and a securely hashed password.</li>
              <li><strong>Attachee details:</strong> registration number, course, institution, attachment dates and assigned supervisor.</li>
              <li><strong>Work records:</strong> tasks, hours, reports, logbook entries, attendance (check-in/out times and work mode), out-of-office days, reminders and opportunity/client activity you log.</li>
              <li><strong>Files:</strong> documents and images you upload as task or opportunity attachments.</li>
              <li><strong>WhatsApp messages:</strong> when you message our WhatsApp number, we receive your phone number, your messages and delivery statuses through the WhatsApp Business Platform (Meta). We use your phone number to match you to your workspace account and keep a short-lived conversation state so the assistant can log tasks for you.</li>
              <li><strong>Microsoft (Outlook) data:</strong> if you choose "Sign in with Outlook", we receive your basic profile and email address, and, with your consent, read-only access to your calendar events and your inbox's unread message count to show on your dashboard. We do not read, store or send your email content. We store only an encrypted refresh token so this access keeps working.</li>
              <li><strong>Activity logs:</strong> sign-ins and changes made in the workspace are recorded in an audit log for security and accountability.</li>
            </ul>
          </Section>

          <Section title="2. How we use your information">
            <ul>
              <li>To provide the workspace: sign-in, task logging, attendance, reporting and team collaboration.</li>
              <li>To send you task reminders and notifications by WhatsApp, SMS or email.</li>
              <li>To let supervisors and managers review work, attendance and team reports.</li>
              <li>To keep the service secure, investigate misuse and meet our legal obligations.</li>
            </ul>
            <p>We do not sell your personal information or use it for advertising.</p>
          </Section>

          <Section title="3. Who we share it with">
            <p>We only share information with the service providers needed to run the workspace:</p>
            <ul>
              <li><strong>Meta Platforms (WhatsApp Business Platform):</strong> to send and receive WhatsApp messages.</li>
              <li><strong>Microsoft:</strong> for Outlook sign-in and calendar access you authorise.</li>
              <li><strong>Supabase:</strong> database hosting.</li>
              <li><strong>Advanta Africa:</strong> SMS delivery for reminders.</li>
            </ul>
            <p>We may also disclose information if the law requires it.</p>
          </Section>

          <Section title="4. Security and retention">
            <p>
              Data is sent over encrypted (HTTPS) connections. Passwords are hashed, OAuth tokens are encrypted, and
              access is restricted by role. We keep your information for as long as you have an account and for as
              long as we need it for business records or the law requires. WhatsApp conversation state expires automatically.
            </p>
          </Section>

          <Section title="5. Your rights">
            <p>
              Under the Kenya Data Protection Act, 2019, you may ask to access, correct or delete your personal
              information, or object to how it is processed. You can disconnect Outlook at any time from your Microsoft
              account settings, and stop WhatsApp messages by not messaging our number or by asking us to remove your
              phone number.
            </p>
          </Section>

          <Section id="data-deletion" title="6. Requesting deletion of your data">
            <p>To have your data deleted, including WhatsApp and Outlook-related data:</p>
            <ol>
              <li>Email <a href={`mailto:${CONTACT_EMAIL}?subject=Data%20deletion%20request`}>{CONTACT_EMAIL}</a> with the subject "Data deletion request".</li>
              <li>Include your full name and the email address and/or phone number linked to your account.</li>
              <li>We will confirm your identity and delete or anonymise your data within 30 days, except records we must keep by law. We will confirm by email when this is done.</li>
            </ol>
          </Section>

          <Section title="7. Changes to this policy">
            <p>We may update this policy from time to time. The "Last updated" date above shows when it last changed.</p>
          </Section>

          <Section title="8. Contact us">
            <p>
              {COMPANY}<br />
              Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </Section>
        </div>

        <div className="login-foot" style={{ justifyContent: 'space-between' }}>
          <span className="flex items-center gap-2"><ShieldCheck size={15} /> Your data is handled under Kenyan law</span>
          <Link to="/login" className="flex items-center gap-1" style={{ color: 'var(--green)', fontWeight: 600 }}>
            <ArrowLeft size={14} /> Sign in
          </Link>
        </div>
      </article>
    </div>
  );
}

export default PrivacyPolicyPage;
