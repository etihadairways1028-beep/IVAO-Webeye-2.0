import { useState, type ReactNode } from 'react';
import { IconX } from './Icons';

export function Panel({ side, title, sub, icon, onClose, children, actions, className = '', label }: { side: 'left' | 'right'; title: ReactNode; sub?: ReactNode; icon?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; className?: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={`panel panel-${side} glass ${expanded ? 'expanded' : ''} ${className}`} aria-label={label}>
      <button className="sheet-handle" aria-label={expanded ? 'Collapse panel' : 'Expand panel'} onClick={() => setExpanded((e) => !e)}>
        <span />
      </button>
      <header className="panel-head">
        {icon && <div className="panel-icon">{icon}</div>}
        <div className="panel-titles">
          <div className="panel-title">{title}</div>
          {sub && <div className="panel-sub">{sub}</div>}
        </div>
        <button className="icon-btn small" aria-label="Close panel" onClick={onClose}>
          <IconX size={16} />
        </button>
      </header>
      {actions && <div className="panel-actions">{actions}</div>}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Section({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section">
      <div className="section-head">
        {icon}
        <h3>{title}</h3>
        {aside && <div className="section-aside">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

export function KV({ k, v, mono = true, note, wide, optional }: { k: string; v: ReactNode; mono?: boolean; note?: string; wide?: boolean; optional?: boolean }) {
  // Optional fields the pilot didn't file are left out rather than shown as a dash.
  if (optional && (v == null || v === '' || v === '—')) return null;
  return (
    <div className={`kv ${wide ? 'wide' : ''}`} title={note}>
      <div className="kv-k">
        {k}
        {note && <span className="kv-note">{note.startsWith('Derived') || note.startsWith('Estimated') ? 'calc' : 'i'}</span>}
      </div>
      <div className={`kv-v ${mono ? 'mono' : ''}`}>{v}</div>
    </div>
  );
}

export function Badge({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'blue' | 'amber' | 'teal' | 'red' | 'demo'; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <label className="toggle">
      {icon && <span className="toggle-ic">{icon}</span>}
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-ic">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}
