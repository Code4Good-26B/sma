// src/pages/StatsPage.jsx
import { useMemo } from 'react';


const STATUS_META = {
  not_reviewed: { label: 'ממתינות לאישור', color: '#94a3b8' },
  needs_edit:   { label: 'טיוטות',         color: '#f59e0b' },
  approved:     { label: 'אושרו',           color: '#22c55e' },
  irrelevant:   { label: 'נדחו',            color: '#ef4444' },
};

const MONTHS_HE = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יונ׳','יול׳','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (d >= 1) return `לפני ${d} ${d === 1 ? 'יום' : 'ימים'}`;
  if (h >= 1) return `לפני ${h} ${h === 1 ? 'שעה' : 'שעות'}`;
  return `לפני ${Math.max(m, 1)} דק׳`;
}

export default function StatsPage({ articles }) {
  const now = new Date();
  const curM = now.getMonth();
  const curY = now.getFullYear();

  const counts = useMemo(() => {
    const c = { not_reviewed: 0, needs_edit: 0, approved: 0, irrelevant: 0 };
    articles.forEach(a => { if (c[a.review_status] !== undefined) c[a.review_status]++; });
    return c;
  }, [articles]);

  const collectedThisMonth = useMemo(() =>
    articles.filter(a => {
      const d = new Date(a.created_at);
      return d.getMonth() === curM && d.getFullYear() === curY;
    }).length, [articles, curM, curY]);

  const publishedWebsite = useMemo(() =>
    articles.filter(a => a.review_status === 'approved' && (a.publish_target === 'website' || a.publish_target === 'both')).length,
    [articles]);

  const publishedNewsletter = useMemo(() =>
    articles.filter(a => a.review_status === 'approved' && (a.publish_target === 'newsletter' || a.publish_target === 'both')).length,
    [articles]);

  const approvalRate = articles.length
    ? Math.round((counts.approved / articles.length) * 100)
    : 0;

  // Source breakdown — derived dynamically from articles
  const bySource = useMemo(() => {
    const map = {};
    articles.forEach(a => {
      const k = (a.source_name || '').trim();
      if (k) map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [articles]);
  const maxSrc = Math.max(...bySource.map(s => s.count), 1);

  // Monthly trend (last 6 months)
  const monthlyTrend = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = new Date(curY, curM - (5 - i), 1);
      const m = d.getMonth(), y = d.getFullYear();
      const count = articles.filter(a => {
        const ad = new Date(a.created_at);
        return ad.getMonth() === m && ad.getFullYear() === y;
      }).length;
      return { label: MONTHS_HE[m], count };
    }), [articles, curM, curY]);
  const maxMonth = Math.max(...monthlyTrend.map(m => m.count), 1);
  const avgMonth = (monthlyTrend.reduce((s, m) => s + m.count, 0) / 6).toFixed(1);

  // Status breakdown
  const totalArt = articles.length || 1;
  const statusRows = ['not_reviewed', 'needs_edit', 'approved', 'irrelevant'].map(s => ({
    ...STATUS_META[s],
    count: counts[s],
    pct: Math.round((counts[s] / totalArt) * 100),
  }));

  // Channel split (approved only)
  const approved = articles.filter(a => a.review_status === 'approved');
  const websiteOnly    = approved.filter(a => a.publish_target === 'website').length;
  const newsletterOnly = approved.filter(a => a.publish_target === 'newsletter').length;
  const both           = approved.filter(a => a.publish_target === 'both').length;

  // Activity log
  const recentActivity = useMemo(() =>
    [...articles]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5),
    [articles]);

  return (
    <section>
      <h3 style={{ marginBottom: '24px' }}>סטטיסטיקות</h3>

      {/* KPI Row 1 */}
      <div style={kpiGridStyle}>
        {['not_reviewed', 'needs_edit', 'approved', 'irrelevant'].map(key => (
          <div key={key} style={kpiCardStyle}>
            <div style={{ ...kpiNumStyle, color: STATUS_META[key].color }}>{counts[key]}</div>
            <div style={kpiLabelStyle}>{STATUS_META[key].label}</div>
          </div>
        ))}
      </div>

      {/* KPI Row 2 */}
      <div style={{ ...kpiGridStyle, marginTop: '12px' }}>
        {[
          { value: collectedThisMonth, label: 'נאספו החודש' },
          { value: publishedWebsite,   label: 'פורסמו לאתר' },
          { value: publishedNewsletter,label: 'נשלחו בניוזלטר' },
          { value: `${approvalRate}%`, label: 'שיעור אישור' },
        ].map(({ value, label }) => (
          <div key={label} style={{ ...kpiCardStyle, background: 'var(--secondary-bg)', border: '1px solid rgba(74,191,176,0.3)' }}>
            <div style={{ ...kpiNumStyle, color: 'var(--secondary)' }}>{value}</div>
            <div style={kpiLabelStyle}>{label}</div>
          </div>
        ))}
      </div>

      {/* 2-column sections */}
      <div style={grid2Style}>

        {/* Items by source */}
        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>כתבות לפי מקור</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {bySource.map(({ label, count }) => (
              <div key={label}>
                <div style={barLabelRowStyle}>
                  <span style={{ color: 'var(--text-h)', fontSize: '0.85rem' }}>{label}</span>
                  <span style={{ color: 'var(--text)', fontSize: '0.85rem' }}>{count}</span>
                </div>
                <div style={barTrackStyle}>
                  <div style={{ ...barFillStyle, width: `${(count / maxSrc) * 100}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly trend */}
        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>מגמה חודשית — 6 חודשים אחרונים</h4>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', height: '110px' }}>
            {monthlyTrend.map(({ label, count }) => (
              <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '0.68rem', color: 'var(--text)', minHeight: '14px' }}>{count > 0 ? count : ''}</span>
                <div style={{
                  width: '100%',
                  height: count > 0 ? `${Math.max((count / maxMonth) * 80, 4)}px` : '2px',
                  background: count > 0 ? 'var(--accent)' : 'var(--border)',
                  borderRadius: '3px 3px 0 0',
                  opacity: count > 0 ? 0.85 : 1,
                }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--text)', marginTop: '4px' }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center' }}>
            <span style={pillStyle}>ממוצע: {avgMonth} ידיעות/חודש</span>
          </div>
        </div>

        {/* Status breakdown */}
        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>פילוח סטטוסים</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {statusRows.map(({ label, color, count, pct }) => (
              <div key={label}>
                <div style={barLabelRowStyle}>
                  <span style={{ color: 'var(--text-h)', fontSize: '0.85rem' }}>{label}</span>
                  <span style={{ color: 'var(--text)', fontSize: '0.85rem' }}>{count} ({pct}%)</span>
                </div>
                <div style={barTrackStyle}>
                  <div style={{ ...barFillStyle, width: `${pct}%`, background: color }} />
                </div>
              </div>
            ))}
          </div>

          <div style={dividerStyle} />

          <p style={subTitleStyle}>ערוצי פרסום (מאושרות בלבד)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { label: 'אתר בלבד',      count: websiteOnly },
              { label: 'ניוזלטר בלבד',  count: newsletterOnly },
              { label: 'אתר + ניוזלטר', count: both },
            ].map(({ label, count }) => (
              <div key={label} style={barLabelRowStyle}>
                <span style={{ color: 'var(--text-h)', fontSize: '0.85rem' }}>{label}</span>
                <span style={{ color: 'var(--text)', fontSize: '0.85rem' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div style={cardStyle}>
          <h4 style={cardTitleStyle}>פעילות אחרונה</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentActivity.map(a => (
              <div key={a.id} style={activityRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-h)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.reviewed_title_he ?? a.title_he ?? ''}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text)', marginTop: '2px' }}>
                    {a.source_name} · {timeAgo(a.created_at)}
                  </div>
                </div>
                <span style={{ ...badgeStyle, background: STATUS_META[a.review_status]?.color }}>
                  {STATUS_META[a.review_status]?.label}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}

const kpiGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '12px',
};

const kpiCardStyle = {
  background: 'var(--accent-bg)',
  border: '1px solid var(--accent-border)',
  borderRadius: '12px',
  padding: '20px 16px',
  textAlign: 'center',
};

const kpiNumStyle = {
  fontSize: '2rem',
  fontWeight: 700,
  color: 'var(--accent)',
  lineHeight: 1,
  marginBottom: '6px',
};

const kpiLabelStyle = {
  fontSize: '0.82rem',
  color: 'var(--text)',
};

const grid2Style = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '16px',
  marginTop: '20px',
};

const cardStyle = {
  background: 'var(--bg)',
  border: '0.5px solid var(--border)',
  borderRadius: '12px',
  padding: '20px 22px',
};

const cardTitleStyle = {
  margin: '0 0 16px 0',
  fontSize: '0.9rem',
  fontWeight: 700,
  color: 'var(--text-h)',
};

const barLabelRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '5px',
};

const barTrackStyle = {
  height: '6px',
  background: 'var(--bg-secondary)',
  borderRadius: '999px',
  overflow: 'hidden',
};

const barFillStyle = {
  height: '100%',
  borderRadius: '999px',
  transition: 'width 0.3s ease',
};

const pillStyle = {
  display: 'inline-block',
  background: 'var(--accent-bg)',
  border: '1px solid var(--accent-border)',
  borderRadius: '999px',
  padding: '3px 12px',
  fontSize: '0.78rem',
  color: 'var(--accent)',
  fontWeight: 600,
};

const dividerStyle = {
  borderTop: '1px solid var(--border)',
  margin: '16px 0',
};

const subTitleStyle = {
  margin: '0 0 10px 0',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const activityRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const badgeStyle = {
  flexShrink: 0,
  borderRadius: '999px',
  fontSize: '0.72rem',
  fontWeight: 700,
  padding: '2px 8px',
  color: '#fff',
};
