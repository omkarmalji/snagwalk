'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CircleNotch } from '@phosphor-icons/react';

export function cn(...args: Parameters<typeof clsx>) {
  return twMerge(clsx(args));
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';
type Size = 'lg' | 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium select-none ' +
  'transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-out ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]',
  secondary: 'bg-surface text-ink border border-line hover:border-ink-3',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-crit text-bg hover:bg-crit/90',
  ink: 'bg-ink text-bg hover:bg-ink/90',
};

const sizes: Record<Size, string> = {
  lg: 'h-14 px-7 text-[16px]',
  md: 'h-11 px-5 text-[15px]',
  sm: 'h-9 px-3.5 text-[14px]',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <CircleNotch className="size-[1.15em] animate-spin" weight="bold" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

const sevStyles: Record<string, string> = {
  critical: 'bg-crit-soft text-crit',
  major: 'bg-major-soft text-major',
  minor: 'bg-surface-2 text-ink-2',
};

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const s = sevStyles[severity] ? severity : 'minor';
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold capitalize',
        sevStyles[s],
        className
      )}
    >
      {s}
    </span>
  );
}

export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('rounded-card border border-line bg-surface', className)} {...rest} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-field', className)} aria-hidden />;
}

/** Small honest label for where an AI result came from. */
export function SourceTag({ source, className }: { source: string | null | undefined; className?: string }) {
  if (!source || source === 'saved') return null;
  const live = source === 'gemini';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        live ? 'bg-accent-soft text-accent' : 'bg-major-soft text-major',
        className
      )}
    >
      {live ? 'Gemini' : 'Offline template'}
    </span>
  );
}
