// DigiLite Hub UI kit — small, consistent building blocks. Use these in every
// screen rather than one-off styles so the app stays coherent.

import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { BagStatus } from "@digilite/shared";
import { STATUS_COLOR, STATUS_LABEL } from "@digilite/shared";
import { initials } from "@/lib/format";

export { clsx as cx };

// ── Buttons ───────────────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-navy text-white hover:bg-navy-2 border border-navy",
  secondary: "bg-white text-ink border border-line hover:bg-paper",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-paper-2",
  danger: "bg-white text-red-ink border border-red-line hover:bg-red-bg",
  quiet: "bg-paper-2 text-ink border border-transparent hover:bg-rule",
};
// Phones get 44px touch targets (max-md) whatever the size.
const sizes: Record<Size, string> = {
  sm: "h-8 max-md:h-11 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-10 max-md:h-11 px-4 text-sm rounded-[10px] gap-2",
  lg: "h-12 px-5 text-[15px] rounded-xl gap-2",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return clsx(
    "inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors disabled:opacity-50 no-underline",
    variants[variant],
    sizes[size],
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({
  to,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}

// ── Surfaces ──────────────────────────────────────────────────────────────────
export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article"; "aria-label"?: string }) {
  return (
    <As className={clsx("card", className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, sub, action, className }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="m-0 font-display text-lg font-semibold">{title}</h2>
        {sub && <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  crumbs,
  actions,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5 text-caption">/</span>}
              {c.to ? (
                <Link to={c.to} className="text-accent no-underline hover:underline">
                  {c.label}
                </Link>
              ) : (
                c.label
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">{title}</h1>
          {sub && <p className="m-0 mt-1.5 text-sm text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

const pageWidths = { narrow: "max-w-[880px]", default: "max-w-[1320px]", wide: "max-w-[1600px]" };

/** Use `width` for the max width (a max-w class in `className` can't override it). */
export function Page({
  children,
  className,
  wide,
  width,
}: {
  children: ReactNode;
  className?: string;
  /** Same as width="wide" */
  wide?: boolean;
  width?: keyof typeof pageWidths;
}) {
  return (
    <div className={clsx("mx-auto flex w-full flex-col gap-5 px-4 py-5 md:px-8 md:py-7", pageWidths[width ?? (wide ? "wide" : "default")], className)}>
      {children}
    </div>
  );
}

// ── Pills, chips, tags ────────────────────────────────────────────────────────
export type Tone = "neutral" | "green" | "amber" | "red" | "info" | "navy" | "estimate";
const tones: Record<Tone, string> = {
  neutral: "bg-paper-2 text-ink-2",
  green: "bg-green-bg text-green-ink",
  amber: "bg-amber-bg text-amber-ink",
  red: "bg-red-bg text-red-ink",
  info: "bg-info-bg text-info-ink",
  navy: "bg-navy text-white",
  estimate: "bg-estimate-bg text-amber-ink border border-dashed border-estimate-line",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Chip({
  active,
  onClick,
  children,
  tone,
  count,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tone?: "amber" | "red";
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "inline-flex h-8 max-md:h-11 items-center gap-1.5 rounded-full border px-3 max-md:px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors",
        active
          ? "border-navy bg-navy text-white"
          : tone === "amber"
            ? "border-amber-line bg-amber-bg text-amber-ink"
            : tone === "red"
              ? "border-red-line bg-red-bg text-red-ink"
              : "border-line bg-white text-ink hover:bg-paper",
        className,
      )}
    >
      {children}
      {count !== undefined && <span className={clsx("num", active ? "text-white/80" : "text-muted")}>{count}</span>}
    </button>
  );
}

// ── Status (colour + shape, never colour alone) ───────────────────────────────
export function StatusIcon({ status, size = 18 }: { status: BagStatus; size?: number }) {
  const c = STATUS_COLOR[status];
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      {status === "now" && (
        <>
          <circle cx="9" cy="9" r="8" fill={c} fillOpacity="0.18" />
          <circle cx="9" cy="9" r="4.5" fill={c} stroke="#fff" strokeWidth="1.5" />
        </>
      )}
      {status === "day" && <circle cx="9" cy="9" r="4.5" fill={c} stroke="#fff" strokeWidth="1.5" />}
      {status === "idle" && <circle cx="9" cy="9" r="4.5" fill="#fff" stroke={c} strokeWidth="2.5" />}
      {status === "gone" && <rect x="4.5" y="4.5" width="9" height="9" rx="1.5" fill={c} />}
    </svg>
  );
}

export function StatusLabel({ status, text }: { status: BagStatus; text?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <StatusIcon status={status} size={16} />
      <span>{text ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

// ── Numbers ───────────────────────────────────────────────────────────────────
export function Stat({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "amber" | "red" | "green"; className?: string }) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-0.5 rounded-xl bg-paper px-3.5 py-3", className)}>
      <span className="text-xs text-muted">{label}</span>
      <span
        className={clsx(
          "num font-display text-xl font-semibold leading-tight",
          tone === "amber" && "text-amber-ink",
          tone === "red" && "text-red-ink",
          tone === "green" && "text-green-ink",
        )}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

/** Estimated (modelled) figures are always visually separate from measured ones. */
export function EstimateBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-2xl border border-dashed border-estimate-line bg-estimate-bg p-4", className)}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-ink">Estimated</div>
      {children}
    </div>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────────
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex flex-col gap-1.5 text-[13px] font-semibold text-ink", className)}>
      {label}
      {children}
      {hint && !error && <span className="text-xs font-normal text-muted">{hint}</span>}
      {error && <span className="text-xs font-medium text-red-ink">{error}</span>}
    </label>
  );
}

const inputBase =
  "h-10 max-md:h-11 w-full rounded-[10px] border border-line bg-white px-3 text-sm max-md:text-base font-normal text-ink placeholder:text-caption outline-none focus:border-navy";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputBase, className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(inputBase, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputBase, "h-auto min-h-24 py-2", className)} {...rest} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("inline-flex items-center gap-3 text-sm max-md:min-h-11", disabled && "opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-navy" : "bg-line")}
      >
        <span className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-[10px] bg-paper-2 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "inline-flex h-8 max-md:h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold",
            o.value === value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="flex gap-6 overflow-x-auto border-b border-rule">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px shrink-0 border-b-2 pb-3 max-md:pt-3 text-sm",
            t.value === value ? "border-navy font-semibold text-ink" : "border-transparent font-medium text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────────────
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-caption">{icon}</div>}
      <p className="m-0 font-display text-lg font-semibold">{title}</p>
      {body && <p className="m-0 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-line bg-red-bg p-4 text-sm text-red-ink">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{msg}</div>
      {retry && (
        <button onClick={retry} className="font-semibold underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children, action, icon }: { tone?: "info" | "amber" | "red" | "green"; children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  const t = { info: "bg-info-bg text-info-ink", amber: "bg-amber-bg text-amber-ink", red: "bg-red-bg text-red-ink", green: "bg-green-bg text-green-ink" }[tone];
  return (
    <div className={clsx("flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-xl px-3.5 py-2.5 text-[13px] md:flex-nowrap", t)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className={clsx("shrink-0 max-md:basis-full", icon && "max-md:pl-[26px]")}>{action}</div>}
    </div>
  );
}

// ── People & screens ──────────────────────────────────────────────────────────
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-tint font-semibold text-navy", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/**
 * A bag's LED screen (160 × 120) as a dark 4:3 frame. `fit="contain"` shows an
 * image of another shape whole instead of cropping it to fill the frame.
 */
export function ScreenFrame({
  children,
  className,
  src,
  alt,
  fit = "cover",
}: {
  children?: ReactNode;
  className?: string;
  src?: string | null;
  alt?: string;
  fit?: "cover" | "contain";
}) {
  return (
    <div className={clsx("relative aspect-[4/3] overflow-hidden rounded-lg bg-ink p-[6%]", className)}>
      <div className="flex size-full items-center justify-center overflow-hidden rounded-sm bg-[#1d2436]">
        {src ? (
          <img src={src} alt={alt ?? ""} className={clsx("size-full", fit === "contain" ? "object-contain" : "object-cover")} style={{ imageRendering: "pixelated" }} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
