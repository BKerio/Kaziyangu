import { useState } from 'react';
import { Crown, Plus, Trash2 } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import { Opportunity, OpportunityTeamRole, StaffContact, TEAM_ROLE_OPTIONS } from '@/types/api';
import { optionLabel } from '@/utils/opportunity';
import ContactLinks from './ContactLinks';
import { SectionHeading, rowCardStyle, sectionStyle, useOpportunityMutation } from './shared';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** Internal people working the deal, with their phone/email from the staff directory. */
function TeamSection({ opportunity, staff }: { opportunity: Opportunity; staff: StaffContact[] }) {
  const id = opportunity.id;
  const team = opportunity.team ?? [];
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<OpportunityTeamRole>('ACCOUNT_MANAGER');
  const available = staff.filter((s) => !team.some((m) => m.userId === s.id));

  const addMutation = useOpportunityMutation(
    () => api.post(`/opportunities/${id}/team`, { userId, role }),
    { success: 'Team member added', error: 'Could not add team member' },
    () => setUserId(''),
  );
  const removeMutation = useOpportunityMutation(
    (uid: string) => api.delete(`/opportunities/${id}/team/${uid}`),
    { success: 'Team member removed', error: 'Could not remove team member' },
  );

  return (
    <section className="col" style={sectionStyle}>
      <SectionHeading>Internal account team</SectionHeading>

      {team.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>No one is on this deal yet. Add the account manager and anyone supporting them.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {team.map((m) => {
          const isLead = opportunity.assignedToId === m.userId;
          return (
            <div key={m.userId} className="flex items-start gap-2" style={rowCardStyle}>
              <div
                aria-hidden
                style={{
                  width: 32, height: 32, borderRadius: 999, flexShrink: 0, display: 'grid', placeItems: 'center',
                  background: 'var(--red-soft)', color: 'var(--red)', fontWeight: 700, fontSize: 12,
                }}
              >
                {initials(m.user.name)}
              </div>
              <div className="col" style={{ minWidth: 0, flex: 1, gap: 3 }}>
                <div className="flex items-center gap-1" style={{ fontWeight: 650, color: 'var(--ink)' }}>
                  {m.user.name}
                  {isLead && <Crown size={12} style={{ color: 'var(--gold)' }} aria-label="Lead account manager" />}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                  {isLead ? 'Lead account manager' : optionLabel(TEAM_ROLE_OPTIONS, m.role)}
                </div>
                <ContactLinks phone={m.user.phone} email={m.user.email} />
              </div>
              <button
                type="button" className="icon-btn" title="Remove from team"
                onClick={() => removeMutation.mutate(m.userId)}
                disabled={removeMutation.isPending && removeMutation.variables === m.userId}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {available.length > 0 && (
        <div className="flex items-end gap-2" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label className="label" htmlFor="t-user">Add team member</label>
            <select id="t-user" className="eoc-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select staff…</option>
              {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 170 }}>
            <label className="label" htmlFor="t-role">Role</label>
            <select id="t-role" className="eoc-select" value={role} onChange={(e) => setRole(e.target.value as OpportunityTeamRole)}>
              {TEAM_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-soft btn-sm" disabled={!userId || addMutation.isPending} onClick={() => addMutation.mutate(undefined)}>
            {addMutation.isPending ? <AppLoader size={16} /> : <Plus size={13} />} Add
          </button>
        </div>
      )}
    </section>
  );
}

export default TeamSection;
