import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Field, ErrorMessage } from '../components/Feedback.jsx';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldErrors = error?.fieldErrors ?? {};

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(form);
      const target = location.state?.from ?? (user.role === 'admin' ? '/admin' : '/dashboard');
      navigate(target, { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-form" onSubmit={handleSubmit} noValidate>
        <h1>Sign in</h1>
        <p className="auth-form__intro">
          Sign in to report items, review your candidate matches and manage your claims.
        </p>

        <ErrorMessage error={error} />

        <Field id="login-email" label="Email address" required error={fieldErrors.email}>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            aria-invalid={Boolean(fieldErrors.email)}
          />
        </Field>

        <Field id="login-password" label="Password" required error={fieldErrors.password}>
          <input
            id="login-password"
            type="password"
            required
            autoComplete="current-password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            aria-invalid={Boolean(fieldErrors.password)}
          />
        </Field>

        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-form__footer">
          No account yet? <Link to="/register">Create one</Link>.
        </p>
      </form>

      <aside className="card auth-form__demo">
        <h2>Demo accounts</h2>
        <p>
          After running <code>npm run db:seed</code>, these development accounts exist. They contain fictional data
          only.
        </p>
        <ul>
          <li>
            <strong>Student:</strong> ada@campus.test
          </li>
          <li>
            <strong>Student:</strong> alan@campus.test
          </li>
          <li>
            <strong>Administrator:</strong> admin@campus.test
          </li>
        </ul>
        <p>
          Password for all seeded accounts: <code>Password123</code>
        </p>
      </aside>
    </div>
  );
}

export default LoginPage;
