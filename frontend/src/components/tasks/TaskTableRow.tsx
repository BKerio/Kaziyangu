import type { CSSProperties } from 'react';
import { Eye, Pencil as PencilSimple, Trash2, Paperclip } from 'lucide-react';
import { WorkTask } from '@/types/api';
import { statusPillClass } from '@/utils/taskStatus';
import { CustomerGroupInfo } from '@/utils/customerSequence';
import { fmtDate } from '@/lib/datetime';

interface TaskTableRowProps {
  task: WorkTask;
  /** This row's position in the full result set (1-based) - the leftmost "#" column. */
  taskNumber: number;
  customerGroups: Map<string, CustomerGroupInfo>;
  verticalLabel: (v: string) => string;
  categoryLabel: (c: string) => string;
  statusLabel: (s: string) => string;
  /** Team Tasks shows who logged it; My Tasks doesn't need to (it's always "me"). */
  showPerson?: boolean;
  onView: (task: WorkTask) => void;
  onEdit: (task: WorkTask) => void;
  onDelete: (task: WorkTask) => void;
}

const cell: CSSProperties = { padding: '12px 14px' };

/**
 * One row of the shared task table look, used by both My Tasks and Team
 * Tasks so the two never visually drift apart. Vertical+Category are
 * combined into a single "Work" cell; Customer/Project renders as a colored
 * initials avatar + "N of M today" badge when it's part of a same-day thread
 * (see utils/customerSequence.ts), with a matching colored rail on the row
 * number so the whole thread reads as one group at a glance; % complete
 * renders as a small progress bar instead of bare text.
 */
function TaskTableRow({
  task: t, taskNumber, customerGroups, verticalLabel, categoryLabel, statusLabel, showPerson, onView, onEdit, onDelete,
}: TaskTableRowProps) {
  const group = customerGroups.get(t.id);

  return (
    <tr className="table-row-hover" style={{ borderBottom: '1px solid var(--border)' }}>
      <td
        style={{
          ...cell,
          color: 'var(--muted-2)',
          fontWeight: 600,
          ...(group ? { boxShadow: `inset 3px 0 0 var(--${group.hue})` } : {}),
        }}
      >
        {taskNumber}
      </td>

      <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDate(t.date)}</td>

      {showPerson && <td style={{ ...cell, fontWeight: 600 }}>{t.user.name}</td>}

      <td style={cell}>
        <div className="col" style={{ gap: 3 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{verticalLabel(t.vertical)}</span>
          <span className="tag-soft" style={{ alignSelf: 'flex-start' }}>{categoryLabel(t.category)}</span>
        </div>
      </td>

      <td style={cell}>
        {t.customerProject ? (
          group ? (
            <div className="flex items-center gap-2">
              <span className="customer-avatar" style={{ background: `var(--${group.hue}-soft)`, color: `var(--${group.hue})` }}>
                {group.initials}
              </span>
              <div className="col" style={{ gap: 2 }}>
                <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{t.customerProject}</span>
                <span className="tag-soft" style={{ color: `var(--${group.hue})`, background: `var(--${group.hue}-soft)` }}>
                  {group.position} of {group.total} today
                </span>
              </div>
            </div>
          ) : (
            <span className="tag-soft">{t.customerProject}</span>
          )
        ) : (
          <span style={{ color: 'var(--muted-2)' }}>-</span>
        )}
      </td>

      <td style={{ ...cell, maxWidth: 280, color: 'var(--ink)' }}>{t.description}</td>

      <td style={{ ...cell, whiteSpace: 'nowrap' }} className="mono tnum">{t.hoursSpent}h</td>

      <td style={cell}><span className={statusPillClass(t.status)}>{statusLabel(t.status)}</span></td>

      <td style={cell}>
        <div className="flex items-center gap-2">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, t.percentComplete))}%` }} />
          </div>
          <span className="mono tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{t.percentComplete}%</span>
        </div>
      </td>

      <td style={cell}>
        {t._count?.attachments ? (
          <button
            className="pill"
            title="View attached files"
            onClick={() => onView(t)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer' }}
          >
            <Paperclip size={12} /> {t._count.attachments}
          </button>
        ) : (
          <span style={{ color: 'var(--muted-2)' }}>—</span>
        )}
      </td>

      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
        <div className="flex gap-2">
          <button className="icon-btn" title="View task" onClick={() => onView(t)}><Eye size={14} /></button>
          <button className="icon-btn" title="Update task" onClick={() => onEdit(t)}><PencilSimple size={14} /></button>
          <button className="icon-btn" title="Delete task" onClick={() => onDelete(t)}><Trash2 size={14} /></button>
        </div>
      </td>
    </tr>
  );
}

export default TaskTableRow;
