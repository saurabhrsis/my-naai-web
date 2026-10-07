import React from 'react';
import { RotateCw } from 'lucide-react';

// The last line of defence against a blank screen.
//
// When a render throws, React unmounts everything below the failure — so a
// crash anywhere in the tree used to leave a visitor staring at an empty white
// page with no hint of what happened. That is the worst possible failure for a
// salon owner mid-booking, and it is exactly how a broken preview looks too.
//
// This boundary is mounted above <App />, so a crash shows what broke and how
// to get out of it (reload, or call support) instead of nothing at all. It never
// tries to be clever with recovery: one honest message, one button.
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the real stack in the console — the screen only shows the message,
    // and support will need the rest.
    console.error('My Naai could not render:', error, info?.componentStack || '');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <span className="crash-badge">My Naai</span>
        <h1>Something went wrong</h1>
        <p>My Naai could not finish drawing this screen. Nothing you did was lost — a reload brings it back.</p>
        <pre className="crash-detail">{String(error?.message || error)}</pre>
        <button type="button" className="crash-reload" onClick={() => window.location.reload()}>
          <RotateCw size={16} /> Reload the page
        </button>
        <p className="crash-note">
          Still blank after a reload? Call <a href="tel:8380017393">8380017393</a> and tell us the line above.
        </p>
      </div>
    );
  }
}

export default AppErrorBoundary;
