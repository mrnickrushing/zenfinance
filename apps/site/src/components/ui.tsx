import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-card font-medium transition-colors duration-standard ease-out-zen disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary-600 text-white shadow-glow hover:bg-primary-700',
        secondary:
          'border border-ledger-border bg-ledger-panel text-ledger-ink hover:border-primary-500 dark:border-ledger-borderDark dark:bg-ledger-panelDark dark:text-ledger-warm',
        ghost: 'text-ledger-muted hover:text-primary-700 dark:text-slate-300 dark:hover:text-primary-300',
      },
      size: {
        md: 'h-11 px-6 text-sm',
        lg: 'h-14 px-8 py-3.5 text-base',
        sm: 'h-9 px-4 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export function Button({
  variant,
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { className?: string }) {
  return <button className={`${button({ variant, size })} ${className ?? ''}`} {...props} />;
}

const field =
  'w-full rounded-card border border-ledger-border bg-ledger-panel px-4 py-3 text-sm text-ledger-ink placeholder:text-slate-400 focus:border-primary-500 dark:border-ledger-borderDark dark:bg-ledger-panelDark dark:text-ledger-warm';

export function TextInput({
  label,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; className?: string }) {
  return (
    <label htmlFor={id} className={`block ${className ?? ''}`}>
      <span className="mb-1.5 block text-sm font-medium text-ledger-muted dark:text-slate-300">
        {label}
      </span>
      <input id={id} className={field} {...props} />
    </label>
  );
}

export function TextArea({
  label,
  id,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string; className?: string }) {
  return (
    <label htmlFor={id} className={`block ${className ?? ''}`}>
      <span className="mb-1.5 block text-sm font-medium text-ledger-muted dark:text-slate-300">
        {label}
      </span>
      <textarea id={id} className={`${field} min-h-32`} {...props} />
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-card border border-ledger-border bg-ledger-panel p-6 shadow-soft dark:border-ledger-borderDark dark:bg-ledger-panelDark ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

const badge = cva('inline-flex items-center rounded-card px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      open: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
      neutral: 'bg-primary-50 text-ledger-muted dark:bg-ledger-panelDark dark:text-slate-300',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({
  tone,
  children,
}: VariantProps<typeof badge> & { children: ReactNode }) {
  return <span className={badge({ tone })}>{children}</span>;
}
