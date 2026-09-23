// Renders the state produced by computeCollectorHealth. All decision logic
// lives there (src/lib/computeCollectorHealth.js) — this file only turns a
// state object into Hebrew text and a colour. No technical language: no
// status codes, no English, no table or column names, and deliberately no
// named contact person — the date is the signal, not a person to escalate to.

function formatDateTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `היום, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `אתמול, ${time}`;
  return `${d.toLocaleDateString('he-IL')}, ${time}`;
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
}

export default function HealthBanner({ health }) {
  if (!health) return null;

  if (health.status === 'healthy') {
    return (
      <div style={quietLineStyle}>
        עודכן לאחרונה: {formatDateTime(health.lastFinishedAt)}
      </div>
    );
  }

  if (health.status === 'source_failing') {
    // Every currently-configured source is checked individually (see
    // computeCollectorHealth), so this lists ALL of them that are failing —
    // never just the first — and only claims the rest are fine when the
    // code actually confirmed that (i.e. it isn't literally every source).
    const clauses = health.failingSources.map((fs) =>
      fs.lastOkAt ? `${fs.name} (מאז ${formatDay(fs.lastOkAt)})` : `${fs.name} (בבדיקות האחרונות)`
    );
    const allFailing = health.failingSources.length >= health.totalSourceCount;
    const message =
      `לא התקבלו ידיעות מ: ${clauses.join(', ')}.` +
      (allFailing ? '' : ' שאר המקורות תקינים.');
    return <div style={{ ...bannerStyle, ...amberStyle }}>{message}</div>;
  }

  if (health.status === 'stale') {
    const message = health.lastFinishedAt
      ? `המערכת לא אספה ידיעות חדשות מאז ${formatDay(health.lastFinishedAt)}.`
      : 'המערכת לא סיימה איסוף ידיעות בבדיקות האחרונות.';
    return <div style={{ ...bannerStyle, ...redStyle }}>{message}</div>;
  }

  // 'unknown'
  return (
    <div style={{ ...bannerStyle, ...redStyle }}>
      לא ניתן לבדוק כרגע את מצב המערכת.
    </div>
  );
}

const quietLineStyle = {
  padding: '6px 30px',
  fontSize: '0.78rem',
  color: 'var(--text)',
  opacity: 0.7,
};

const bannerStyle = {
  padding: '10px 30px',
  fontSize: '0.88rem',
  fontWeight: 600,
  textAlign: 'center',
};

const amberStyle = {
  background: 'rgba(245, 158, 11, 0.12)',
  color: '#b45309',
  borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
};

const redStyle = {
  background: 'rgba(239, 68, 68, 0.12)',
  color: '#b91c1c',
  borderBottom: '1px solid rgba(239, 68, 68, 0.35)',
};
