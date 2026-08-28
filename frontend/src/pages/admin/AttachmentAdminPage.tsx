import { useState } from 'react';
import { GraduationCap, CalendarCheck, BookOpen } from 'lucide-react';
import AttacheeManagement from './attachments/AttacheeManagement';
import AttendanceManagement from './attachments/AttendanceManagement';
import LogbookManagement from './attachments/LogbookManagement';

type Tab = 'attachees' | 'attendance' | 'logbook';

const TABS: { key: Tab; label: string; Icon: typeof GraduationCap }[] = [
  { key: 'attachees', label: 'Attachees', Icon: GraduationCap },
  { key: 'attendance', label: 'Attendance', Icon: CalendarCheck },
  { key: 'logbook', label: 'Logbook', Icon: BookOpen },
];

function AttachmentAdminPage() {
  const [tab, setTab] = useState<Tab>('attachees');

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <p className="eyebrow">Management</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Attachment Management</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Manage attachee candidates, verify daily attendance, and review logbook submissions.
        </p>hfh
        
      </div>

      <div className="tabs">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)} type="button">
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'attachees' && <AttacheeManagement />}
      {tab === 'attendance' && <AttendanceManagement />}
      {tab === 'logbook' && <LogbookManagement />}
    </div>
  );
}

export default AttachmentAdminPage;
