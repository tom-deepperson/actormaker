import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Modal dialog built on <dialog>. Rendered only while open. */
export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <div class="dlg">
        <h2>{props.title}</h2>
        {props.children}
        <div class="actions">{props.actions ?? <button onClick={props.onClose}>Close</button>}</div>
      </div>
    </dialog>
  );
}

export function Card(props: { title?: string; id?: string; children: ComponentChildren; right?: ComponentChildren }) {
  return (
    <section class="card" id={props.id}>
      {props.title && (
        <div class="row between">
          <h2 style={{ margin: '0 0 8px', fontSize: '1.02rem' }}>{props.title}</h2>
          {props.right}
        </div>
      )}
      {props.children}
    </section>
  );
}

/** Number input that only commits on blur/enter and accepts blank as null. */
export function NumberField(props: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: string }) {
  const [text, setText] = useState(props.value == null ? '' : String(props.value));
  useEffect(() => setText(props.value == null ? '' : String(props.value)), [props.value]);
  return (
    <label class="field">
      {props.label}
      <input
        inputMode={props.step ? 'decimal' : 'numeric'}
        value={text}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          const n = v.trim() === '' ? null : Number(v);
          if (n === null || Number.isFinite(n)) props.onChange(n);
        }}
      />
    </label>
  );
}

export function TextField(props: { label: string; value: string; onInput: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <label class="field">
      {props.label}
      {props.multiline ? (
        <textarea value={props.value} placeholder={props.placeholder} onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)} />
      ) : (
        <input value={props.value} placeholder={props.placeholder} onInput={(e) => props.onInput((e.target as HTMLInputElement).value)} />
      )}
    </label>
  );
}

/** Tappable name that opens the full rules text. */
export function RulesLink(props: { name: string; text?: string | null; meta?: string }) {
  const [open, setOpen] = useState(false);
  if (!props.text || !props.text.trim()) return <span class="strong">{props.name}</span>;
  return (
    <>
      <button class="link" onClick={() => setOpen(true)}>
        {props.name}
      </button>
      {open && (
        <Dialog title={props.name} onClose={() => setOpen(false)}>
          {props.meta && <div class="muted small">{props.meta}</div>}
          <div class="pre">{props.text}</div>
        </Dialog>
      )}
    </>
  );
}

/** Spinner, elapsed time and Cancel, so a long AI call (web search plus a large reply) doesn't look frozen. */
export function WorkingRow({ label, onCancel }: { label?: string | null; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div class="working" role="status">
      <span class="spinner" aria-hidden="true" />
      <div class="grow">
        <div>{label ?? 'Working'}…</div>
        <div class="tiny muted">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · searching can take a minute or two</div>
      </div>
      <button class="small ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
