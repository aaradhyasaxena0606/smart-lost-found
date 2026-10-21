import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>Page not found</h1>
        <p>The page you asked for does not exist. It may have been moved or the address may be wrong.</p>
        <div className="button-row">
          <Link className="button" to="/items">
            Browse reports
          </Link>
          <Link className="button button--secondary" to="/dashboard">
            Go to my dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;
