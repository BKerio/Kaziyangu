import { useState } from 'react';
import { Pencil, Pin, PinOff, Send, Trash2 } from 'lucide-react';
import api from '@/api/client';
import AppLoader from '@/components/shared/AppLoader';
import { useAuthStore } from '@/stores/authStore';
import { confirmDialog } from '@/lib/alert';
import { Opportunity } from '@/types/api';
import { SectionHeading, rowCardStyle, sectionStyle, useOpportunityMutation } from './shared';

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Free-form running notes on the deal. Pinned notes stay on top. */
function NotesSection({ opportunity }: { opportunity: Opportunity }) {
  const id = opportunity.id;
  const notes = opportunity.notes ?? [];
  const me = useAuthStore((s) => s.user);
  const isManager = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const addMutation = useOpportunityMutation(
    () => api.post(`/opportunities/${id}/notes`, { body }),
    { success: 'Note added', error: 'Could not add note' },
    () => setBody(''),
  );
  const updateMutation = useOpportunityMutation(
    (v: { noteId: string; body?: string; isPinned?: boolean }) => api.patch(`/opportunities/${id}/notes/${v.noteId}`, { body: v.body, isPinned: v.isPinned }),
    { success: 'Note updated', error: 'Could not update note' },
    () => setEditingId(null),
  );
  const deleteMutation = useOpportunityMutation(
    (noteId: string) => api.delete(`/opportunities/${id}/notes/${noteId}`),
    { success: 'Note deleted', error: 'Could not delete note' },
  );

  const remove = async (noteId: string) => {
    if (await confirmDialog({ title: 'Delete note', text: "This can't be undone.", confirmLabel: 'Delete', danger: true })) {
      deleteMutation.mutate(noteId);
    }
  };

  return (
    <section className="col" style={sectionStyle}>
      <SectionHeading>Notes {notes.length > 0 && `(${notes.length})`}</SectionHeading>

      <div className="col" style={{ gap: 6 }}>
        <textarea
          className="eoc-textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note: meeting outcome, client concern, next step… (Ctrl+Enter to save)"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) addMutation.mutate(undefined); }}
        />
        <div className="flex" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-soft btn-sm" disabled={!body.trim() || addMutation.isPending} onClick={() => addMutation.mutate(undefined)}>
            {addMutation.isPending ? <AppLoader size={16} /> : <Send size={13} />} Add note
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>No notes yet.</p>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {notes.map((n) => {
            const canEdit = n.authorId === me?.id || isManager;
            return (
              <div
                key={n.id} className="col"
                style={{ ...rowCardStyle, gap: 4, borderLeft: n.isPinned ? '3px solid var(--gold)' : '3px solid transparent' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                    <b style={{ color: 'var(--ink-2)' }}>{n.author.name}</b> · {when(n.createdAt)}
                    {n.isPinned && ' · pinned'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button" className="icon-btn" title={n.isPinned ? 'Unpin' : 'Pin to top'}
                      onClick={() => updateMutation.mutate({ noteId: n.id, isPinned: !n.isPinned })}
                    >
                      {n.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>
                    {canEdit && (
                      <>
                        <button type="button" className="icon-btn" title="Edit" onClick={() => { setEditingId(n.id); setEditBody(n.body); }}>
                          <Pencil size={12} />
                        </button>
                        <button type="button" className="icon-btn" title="Delete" onClick={() => remove(n.id)}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editingId === n.id ? (
                  <div className="col" style={{ gap: 6 }}>
                    <textarea className="eoc-textarea" rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      <button
                        type="button" className="btn btn-primary btn-sm" disabled={!editBody.trim() || updateMutation.isPending}
                        onClick={() => updateMutation.mutate({ noteId: n.id, body: editBody })}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{n.body}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default NotesSection;
