import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, CalendarCheck, BookOpen, Users } from 'lucide-react';
import api from '@/api/client';
import { Attachee, DEPARTMENT_OPTIONS } from '@/types/api';
import SupervisedAttendance from './SupervisedAttendance';
import SupervisedLogbook from './SupervisedLogbook';

type Tab = 'roster' | 'attendance' | 'logbook';

const TABS: { key: Tab; label: string; Icon: typeof GraduationCap }[] = [
  { key: 'roster', label: 'My Attachees', Icon: GraduationCap },
  { key: 'attendance', label: 'Attendance', Icon: CalendarCheck },
  { key: 'logbook', label: 'Logbook', Icon: BookOpen },
];

function departmentLabel(dept?: string | null) {
  return DEPARTMENT_OPTIONS.find((d) => d.value === dept)?.label ?? '-';
}

function MyAttacheesPage() {
  const [tab, setTab] = useState<Tab>('roster');

  const { data: attachees, isLoading } = useQuery({
    queryKey: ['attachments', 'my-attachees'],
    queryFn: async () => {
      const res = await api.get<{ data: Attachee[] }>('/attachments/my-attachees');
      return res.data.data;
    },
  });

  const roster = attachees ?? [];

  return (
    <div className="col" style={{ gap: 20 }}>
      <div>
        <p className="eyebrow">Attachment</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>My Attachees</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Verify daily attendance and review logbook submissions for the attachees you supervise.
        </p>
      </div>

      <div className="tabs">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)} type="button">
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card card-pad"><div className="skel" style={{ height: 200 }} /></div>
      ) : roster.length === 0 ? (
        <div className="card card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
          <Users size={32} style={{ color: 'var(--red)' }} />
          <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>No attachees assigned to you yet</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>An admin can assign you as a supervisor from the Attachment Admin page.</p>
        </div>
      ) : (
        <>
          {tab === 'roster' && (
            <div className="card">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      {['Candidate', 'Course & Dept', 'Host Company', 'Status'].map((h) => (
                        <th key={h} style={{ padding: '10px 14px', color: 'var(--muted)', fontWeight: 650, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((a) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 650, color: 'var(--ink)' }}>{a.name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Reg: {a.registrationNo} • {a.email}</div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600 }}>{a.course || '-'}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{departmentLabel(a.department)}</div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>{a.organization || '-'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className={`pill ${a.isActive ? 'pill-green' : 'pill-gray'}`}>{a.isActive ? 'Active' : 'Inactive'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'attendance' && <SupervisedAttendance attachees={roster} />}
          {tab === 'logbook' && <SupervisedLogbook attachees={roster} />}
        </>
      )}
    </div>
  );
}

export default MyAttacheesPage;
