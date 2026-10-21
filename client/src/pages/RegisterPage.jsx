import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Field, ErrorMessage } from '../components/Feedback.jsx';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const fieldErrors = error?.fieldErrors ?? {};

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError(null);
    setError(null);

    if (form.password !== form.confirm) {
      setLocalError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register({ fullName: form.fullName, email: form.email, password: form.password });
      navigate('/dashboard', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card auth-form" onSubmit={handleSubmit} noValidate>
      <h1>Create an account</h1>
      <p className="auth-form__intro">
        Your email address is stored in lower case so that duplicate accounts cannot be created.
      </p>

      {localError ? (
        <div className="state state--error" role="alert">
          {localError}
        </div>
      ) : null}
      <ErrorMessage error={error} />

      <Field id="register-name" label="Full name" required error={fieldErrors.fullName}>
        <input
          id="register-name"
          type="text"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          aria-invalid={Boolean(fieldErrors.fullName)}
        />
      </Field>

      <Field id="register-email" label="Email address" required error={fieldErrors.email}>
        <input
          id="register-email"
          type="email"
          required
          autoComplete="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          aria-invalid={Boolean(fieldErrors.email)}
        />
      </Field>

      <Field
        id="register-password"
        label="Password"
        required
        hint="At least 8 characters, including a letter and a number."
        error={fieldErrors.password}
      >
        <input
          id="register-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          aria-invalid={Boolean(fieldErrors.password)}
        />
      </Field>

      <Field id="register-confirm" label="Confirm password" required>
        <input
          id="register-confirm"
          type="password"
          required
          autoComplete="new-password"
          value={form.confirm}
          onChange={(event) => setForm({ ...form, confirm: event.target.value })}
        />
      </Field>

      <button type="submit" className="button" disabled={submitting}>
        {submitting ? 'Creating your account…' : 'Create account'}
      </button>

      <p className="auth-form__footer">
        Already registered? <Link to="/login">Sign in</Link>.
      </p>
    </form>
  );
}

export default RegisterPage;
