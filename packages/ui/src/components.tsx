/** CocoaCanvas components reproduced for React. Visual rules live in styles.css; see DESIGN_SYSTEM.md §4. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── Buttons ──

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost'; size?: 'md' | 'sm' };
export function Button({ variant = 'default', size = 'md', className, type = 'button', ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={cx('cw-btn', variant === 'primary' && 'pri', variant === 'ghost' && 'ghost', size === 'sm' && 'sm', className)}
      {...rest}
    />
  );
}

export function IconButton({ icon, label, className, ...rest }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('cw-btn cw-ic', className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function ToolButton({ icon, label, active, shortcut, ...rest }: { icon: IconName; label: string; active?: boolean; shortcut?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!!active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx('cw-tool', active && 'on')}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export const Divider = () => <div className="cw-vs" role="separator" />;
export const Spacer = () => <div className="cw-sp" />;

// ── Menus ──

export type MenuEntry = { label: string; shortcut?: string; disabled?: boolean; onSelect: () => void } | 'separator';

function MenuItems({ items, close }: { items: MenuEntry[]; close: () => void }) {
  return (
    <>
      {items.map((it, i) =>
        it === 'separator' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              close();
              it.onSelect();
            }}
          >
            {it.label}
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </>
  );
}

/** Top-bar menu ("File", "Edit", …). Opening one menu and hovering another switches, like a native menu bar. */
export function MenuBar({ menus }: { menus: { label: string; items: MenuEntry[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="cw-menus" ref={ref} role="menubar">
      {menus.map((m, i) => (
        <div key={m.label} className={cx('cw-mn', open === i && 'on')}>
          <button
            type="button"
            className="cw-mt"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="cw-dd" role="menu">
              <MenuItems items={m.items} close={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Right-click menu at the pointer, kept inside the window. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="cw-ctx" role="menu" style={{ left: pos.x, top: pos.y }}>
      <MenuItems items={items} close={onClose} />
    </div>
  );
}

// ── Panels and fields ──

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cw-ph">
      <span>{title}</span>
      {children}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <>
      <div className="cw-sec">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cw-f">
      <span>{label}</span>
      {children}
    </label>
  );
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * Number input with a draggable label (CocoaCanvas `.nf`). Dragging the label scrubs the value;
 * `onChange` fires live while scrubbing, `onCommit` once when the gesture or edit ends.
 */
export function NumberField({
  value,
  label,
  axis,
  step = 1,
  ariaLabel,
  onChange,
  onCommit,
  onBegin,
}: {
  value: number;
  label: string;
  axis?: 'x' | 'y' | 'z';
  step?: number;
  ariaLabel: string;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
  onBegin?: () => void;
}) {
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);

  // Blur and Enter can both reach commit before React re-renders; remember what was last committed.
  const lastCommitted = useRef(value);
  useEffect(() => {
    lastCommitted.current = value;
  }, [value]);
  const commitText = () => {
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n) && n !== lastCommitted.current) {
      lastCommitted.current = n;
      onCommit(n);
    } else if (!Number.isFinite(n)) setText(fmt(value));
  };

  const scrub = (e: RPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const start = e.clientX;
    const v0 = value;
    let last = v0;
    onBegin?.();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      last = v0 + Math.round((ev.clientX - start) / 2) * step * mult;
      onChange?.(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onCommit(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <span className={cx('cw-nf', axis)}>
      <span onPointerDown={scrub} aria-hidden="true">
        {label}
      </span>
      <input
        className="cw-input"
        aria-label={ariaLabel}
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            setFocused(false);
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cw-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx(o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="cw-sw">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </span>
  );
}

// ── Dialog and toast ──

export function Dialog({ title, children, onClose, width }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="cw-modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cw-box" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Shows `message` for 2.4 s. Change `nonce` to show the same message again. */
export function Toast({ message, nonce = 0 }: { message: string | null; nonce?: number }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    setShown(message);
    const t = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(t);
  }, [message, nonce]);
  return (
    <div className={cx('cw-toast', shown && 'on')} role="status" aria-live="polite">
      {shown}
    </div>
  );
}
