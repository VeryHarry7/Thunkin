import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import s from "./ui.module.css";

/**
 * The primitives the vertical slice needs, and no more.
 *
 * AGENT-01's full pass adds Sheet, Tabs, Tooltip, Toast, Dialog, Progress,
 * EmptyState and MediaLightbox, plus the kitchen-sink route. Everything here
 * reads its colours from the token layer — no component defines a hex value.
 */

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ============================== Button ============================== */

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: "primary" | "ghost" | "quiet";
  size?: "md" | "lg";
  loading?: boolean;
  /**
   * Why the button is unavailable, shown beneath it.
   *
   * A disabled control with no stated reason is a dead end, and "never a dead
   * end" is a product principle — so passing this is how you disable a button.
   */
  disabledReason?: string;
}

export function Button({
  variant = "ghost",
  size = "md",
  loading = false,
  disabledReason,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading || Boolean(disabledReason);

  const button = (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(s.button, s[variant], s[size], className)}
    >
      {loading && <span className={s.spinner} aria-hidden="true" />}
      {children}
    </button>
  );

  if (!disabledReason) return button;

  return (
    <span>
      {button}
      <span className={s.reason}>{disabledReason}</span>
    </span>
  );
}

/* ============================== Field =============================== */

interface FieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Field({ label, error, id, className, ...rest }: FieldProps) {
  const errorId = error && id ? `${id}-error` : undefined;

  return (
    <div className={s.field}>
      {label && (
        <label className={s.label} htmlFor={id}>
          {label}
        </label>
      )}
      <textarea
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={cx(s.control, error && s.invalid, className)}
      />
      {error && (
        <span className={s.error} id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

/* =============================== Chip =============================== */

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, children, className, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={selected}
      className={cx(s.chip, selected && s.chipOn, className)}
    >
      {children}
    </button>
  );
}

/* ============================ MediaTile ============================= */

interface MediaTileProps {
  src?: string | null;
  /** Tiny base64 shown until the real bytes land. */
  blur?: string | null;
  alt: string;
  /** Width / height. Locked before paint so arriving media never shifts layout. */
  ratio?: number;
  kind?: "image" | "video";
  /** Renders the shimmer instead of media. */
  pending?: boolean;
  /** Overlaid on a pending tile — elapsed time, queue position, an action. */
  overlay?: ReactNode;
  className?: string;
}

export function MediaTile({
  src,
  blur,
  alt,
  ratio = 1,
  kind = "image",
  pending = false,
  overlay,
  className,
}: MediaTileProps) {
  return (
    <div
      className={cx(s.tile, className)}
      style={{ ["--tile-ratio" as string]: String(ratio) }}
    >
      {blur && !pending && (
        // eslint-disable-next-line @next/next/no-img-element -- inline base64, no optimization to do
        <img src={blur} alt="" aria-hidden="true" className={s.tileBlur} />
      )}

      {pending && <div className={cx(s.tileSkeleton, "thunkin-shimmer")} />}

      {!pending && src && kind === "video" && (
        <video
          className={cx(s.tileMedia, "thunkin-reveal")}
          src={src}
          {...(blur ? { poster: blur } : {})}
          muted
          loop
          playsInline
          autoPlay
          aria-label={alt}
        />
      )}

      {!pending && src && kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- served from our own asset route, already sized
        <img className={cx(s.tileMedia, "thunkin-reveal")} src={src} alt={alt} />
      )}

      {overlay}
    </div>
  );
}

/* ============================ Skeleton ============================== */

export function Skeleton({
  height = 16,
  width = "100%",
  className,
}: {
  height?: number | string;
  width?: number | string;
  className?: string;
}) {
  return (
    <div
      className={cx(s.skeleton, "thunkin-shimmer", className)}
      style={{ height, width }}
      aria-hidden="true"
    />
  );
}

/* =========================== ErrorState ============================= */

interface ErrorStateProps {
  title: string;
  body: string;
  /** Exactly one recovery action. More than one is a decision the visitor should not have to make. */
  action?: { label: string; onClick: () => void };
}

export function ErrorState({ title, body, action }: ErrorStateProps) {
  return (
    <div className={s.errorState} role="alert">
      <span className={s.errorTitle}>{title}</span>
      <p className={s.errorBody}>{body}</p>
      {action && (
        <Button variant="ghost" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
