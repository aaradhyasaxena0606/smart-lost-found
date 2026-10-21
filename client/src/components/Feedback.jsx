/**
 * Shared presentational building blocks: loading, empty, error, field, confirm.
 *
 * They exist so every page renders the required loading / empty / success / error
 * states consistently (NFR-11) and so form controls always have a visible label
 * and an accessible association to their error message (NFR-10).
 */
import { useEffect, useRef } from 'react';

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="state state--empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

/**
 * Renders an API error. Field-level details are listed so validation failures are
 * never a mystery to the user.
 */
export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;

  const details = Array.isArray(error.details) ? error.details : [];

  return (
    <div className="state state--error" role="alert">
      <strong>{error.message ?? 'Something went wrong.'}</strong>
      {details.length > 0 ? (
        <ul className="error-details">
          {details.map((detail, index) => (
            <li key={`${detail.field ?? 'error'}-${index}`}>
              {detail.field ? <span className="error-field">{detail.field}: </span> : null}
              {detail.message}
            </li>
          ))}
        </ul>
      ) : null}
      {onRetry ? (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function SuccessMessage({ children }) {
  if (!children) return null;
  return (
    <div className="state state--success" role="status">
      {children}
    </div>
  );
}

/**
 * Labelled form control.
 *
 * @param {{ id: string, label: string, error?: string, hint?: string, required?: boolean, children: React.ReactNode }} props
 */
export function Field({ id, label, error, hint, required = false, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Confirmation dialog used before destructive or irreversible actions (spec 15).
 * Implemented with a native <dialog> so focus handling and Esc work for free.
 */
export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', onConfirm, onCancel, busy }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const handleCancel = (event) => {
      event.preventDefault();
      onCancel?.();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onCancel]);

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      {description ? <p>{description}</p> : null}
      <div className="dialog__actions">
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button button--danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export default { Loading, EmptyState, ErrorMessage, SuccessMessage, Field, ConfirmDialog };
