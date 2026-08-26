import { useState, useRef, useEffect } from 'react';
import { Search as MagnifyingGlass, Plus, Check } from 'lucide-react';

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onCreateOption?: (value: string) => Promise<void> | void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function CreatableCombobox({
  options, value, onChange, onCreateOption,
  placeholder = 'Select or type to add…', disabled = false, className = '',
}: Props) {
  const [query, setQuery]       = useState('');
  const [open, setOpen]         = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered   = query.trim()
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const exactMatch = options.some(o => o.toLowerCase() === query.trim().toLowerCase());
  const canCreate  = !!onCreateOption && query.trim().length >= 2 && !exactMatch;

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    try {
      await onCreateOption!(query.trim());
      onChange(query.trim());
      setOpen(false);
      setQuery('');
    } finally {
      setCreating(false);
    }
  }

  function handleSelect(opt: string) {
    onChange(opt);
    setOpen(false);
    setQuery('');
  }

  const displayValue = open ? query : value;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger input */}
      <div
        className={`flex items-center h-11 border rounded-lg transition-all ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        style={{
          background: 'var(--surface)',
          borderColor: open ? 'var(--green)' : 'var(--border)',
          boxShadow: open ? '0 0 0 2px var(--ring)' : undefined,
        }}
      >
        <MagnifyingGlass size={15} className="ml-3 shrink-0" style={{ color: 'var(--muted-2)' }} />
        <input
          ref={inputRef}
          className="flex-1 px-2.5 text-sm font-medium bg-transparent outline-none"
          style={{ color: 'var(--ink)' }}
          placeholder={value || placeholder}
          value={displayValue}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (canCreate) handleCreate(); else if (filtered[0]) handleSelect(filtered[0]); }
            if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          }}
          disabled={disabled}
        />
        {value && !open && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); }}
            className="mr-2 text-xs px-1 transition-colors"
            style={{ color: 'var(--muted-2)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--muted)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-2)')}
          >✕</button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl shadow-xl overflow-hidden border"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {/* Current selection indicator */}
          {value && (
            <div
              className="px-4 py-2 border-b flex items-center gap-2"
              style={{ background: 'var(--green-light)', borderColor: 'var(--border)' }}
            >
              <Check size={12} className="text-brand-green" />
              <span className="text-xs font-bold text-brand-green">{value}</span>
            </div>
          )}

          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && !canCreate && (
              <p className="px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>No matches</p>
            )}
            {filtered.map(opt => (
              <button
                key={opt}
                type="button"
                onMouseDown={() => handleSelect(opt)}
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-between`}
                style={{ color: opt === value ? 'var(--green)' : 'var(--ink)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span className={opt === value ? 'font-bold' : ''}>{opt}</span>
                {opt === value && <Check size={14} className="text-brand-green" />}
              </button>
            ))}
          </div>

          {/* Create new option */}
          {canCreate && (
            <button
              type="button"
              onMouseDown={handleCreate}
              disabled={creating}
              className="w-full text-left px-4 py-2.5 text-sm font-bold text-brand-green flex items-center gap-2 transition-colors disabled:opacity-50 border-t"
              style={{ borderColor: 'var(--border)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--green-light)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <Plus size={14} />
              {creating ? 'Adding…' : `Add "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CreatableCombobox;
