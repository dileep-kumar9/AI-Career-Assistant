export function Card({ title, children, className = "" }) {
  return (
    <div className={`animate-fade-in rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/50 transition hover:shadow-md hover:shadow-slate-200/70 ${className}`}>
      {title && <h2 className="mb-3 text-lg font-semibold tracking-tight text-slate-800">{title}</h2>}
      {children}
    </div>
  );
}

export function Button({ children, loading, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";
  const styles = {
    primary: "bg-indigo-600 text-white shadow-sm shadow-indigo-900/20 hover:bg-indigo-700 hover:shadow-md",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function TextArea(props) {
  return (
    <textarea
      className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      {...props}
    />
  );
}

export function Input(props) {
  return (
    <input
      className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      {...props}
    />
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{message}</div>;
}

export function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    indigo: "bg-indigo-100 text-indigo-700",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
