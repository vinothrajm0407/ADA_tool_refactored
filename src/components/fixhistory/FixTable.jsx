import { ChevronUp, ChevronDown, Image } from 'lucide-react';
import { prStateOf, isFailed, groupBySite, approvalOf, isReviewable, waitingDays, REMINDER_DAYS } from './fixHistoryUtils';

export function formatDate(iso, withTime = true) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, withTime
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

const PR_BADGE = {
  open:   ['Awaiting approval', 'text-amber bg-amber/10'],
  merged: ['Merged', 'text-sage bg-sage/10'],
  closed: ['Closed', 'text-body bg-gray-100'],
  none:   ['No PR', 'text-gray-400 bg-gray-50'],
};

export function StatusBadge({ fix }) {
  const failed = isFailed(fix);
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
      failed ? 'text-coral bg-coral/10' : 'text-sage bg-sage/10'}`}>
      {failed ? 'Failed' : fix.status === 'partial' ? 'Partial' : 'Verified'}
    </span>
  );
}

export function PrBadge({ fix }) {
  let [label, cls] = PR_BADGE[prStateOf(fix)];
  const approval = approvalOf(fix);
  if (approval === 'rejected') [label, cls] = ['Rejected', 'text-coral bg-coral/10'];
  else if (approval === 'changes_requested' && prStateOf(fix) === 'open') [label, cls] = ['Changes requested', 'text-ink bg-amber/25'];
  else if (approval === 'approved' && prStateOf(fix) === 'merged') label = 'Approved & merged';
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{label}</span>;
}

// "Waiting 5 days" under the badge once a fix has waited REMINDER_DAYS for the Approver.
export function WaitingNote({ fix }) {
  const d = waitingDays(fix);
  if (d === null || d < REMINDER_DAYS) return null;
  return <p className="text-[10.5px] font-semibold text-coral mt-0.5 whitespace-nowrap">Waiting {d} days</p>;
}

const COLUMNS = [
  ['rule', 'Rule'], ['page', 'Page'], ['fixedBy', 'Fixed by'], ['status', 'Status'], ['pr', 'PR / approval'],
  ['approved', 'Approved by'], ['merged', 'Merged'], ['date', 'Fixed on'],
];

function pagePath(url) {
  try { const u = new URL(url); return u.pathname === '/' ? u.hostname : u.pathname; } catch { return url; }
}

function Rows({ fixes, onOpen, selectedId, showFixedBy, picked }) {
  return fixes.map(f => (
    <tr key={f.id} onClick={() => onOpen(f)}
      className={`cursor-pointer border-t border-gray-100 hover:bg-teal-50 ${selectedId === f.id ? 'bg-teal-50' : ''}`}>
      {picked && (
        <td className="pl-3 py-2.5 w-8" onClick={e => e.stopPropagation()}>
          {isReviewable(f) && (
            <input type="checkbox" className="accent-teal w-4 h-4 cursor-pointer" checked={picked.ids.has(f.id)}
              onChange={() => picked.toggle(f)} aria-label={`Select ${f.rule_id} fix ${f.id} for a bulk decision`} />
          )}
        </td>
      )}
      <td className="px-3 py-2.5">
        <button type="button" onClick={e => { e.stopPropagation(); onOpen(f); }}
          className="font-mono text-[11.5px] font-semibold text-ink hover:text-teal hover:underline text-left"
          aria-label={`Open details for ${f.rule_id} fix ${f.id}`}>
          {f.rule_id}
        </button>
        {f.has_proof && <Image size={11} className="inline ml-1.5 text-teal" aria-label="has before/after proof" />}
        {f.source_pages && <p className="text-[10.5px] font-semibold text-teal whitespace-nowrap">At the source · {f.source_pages} pages</p>}
      </td>
      <td className="px-3 py-2.5 max-w-[220px]">
        <p className="text-[12px] text-ink truncate" title={f.page_url}>{pagePath(f.page_url)}</p>
        {f.selector && <p className="font-mono text-[10.5px] text-body truncate" title={f.selector}>{f.selector}</p>}
      </td>
      {showFixedBy && <td className="px-3 py-2.5 text-[12px] text-ink whitespace-nowrap">{f.fixed_by || '—'}</td>}
      <td className="px-3 py-2.5"><StatusBadge fix={f} /></td>
      <td className="px-3 py-2.5"><PrBadge fix={f} /><WaitingNote fix={f} /></td>
      <td className="px-3 py-2.5 text-[12px] text-ink">{f.approved_by?.length ? f.approved_by.join(', ') : <span className="text-gray-400">—</span>}</td>
      <td className="px-3 py-2.5 text-[12px] text-ink whitespace-nowrap">
        {prStateOf(f) === 'merged' ? <>{formatDate(f.merged_at, false)}{f.merged_by && <p className="text-[10.5px] text-body">by {f.merged_by}</p>}</> : <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2.5 text-[12px] text-body whitespace-nowrap">{formatDate(f.created_at)}</td>
    </tr>
  ));
}

function SiteHeader({ group, colSpan }) {
  const { summary: s } = group;
  const bar = [
    ['Merged', s.merged, 'bg-sage'],
    ['Awaiting approval', s.awaiting, 'bg-amber'],
    ['Verified, no PR / closed', s.verified - s.merged - s.awaiting, 'bg-teal-300'],
    ['Failed', s.failed, 'bg-coral'],
  ].filter(([, n]) => n > 0);
  return (
    <tr className="bg-gray-50 border-t border-gray-200">
      <td colSpan={colSpan} className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12.5px] font-semibold text-ink">{group.site}
            <span className="font-normal text-body"> · {s.total} fix{s.total !== 1 ? 'es' : ''}</span></p>
          <p className="text-[11.5px] text-body">
            <b className="text-sage">{s.merged}</b> merged · <b className="text-amber">{s.awaiting}</b> awaiting approval
            · <b className="text-ink">{s.verified}</b> verified · <b className="text-coral">{s.failed}</b> failed
          </p>
        </div>
        <div className="flex h-1.5 mt-2 rounded-full overflow-hidden gap-[2px] bg-gray-100" role="img"
          aria-label={bar.map(([l, n]) => `${n} ${l}`).join(', ')}>
          {bar.map(([label, n, cls]) => <span key={label} className={cls} style={{ width: `${(n / s.total) * 100}%` }} />)}
        </div>
      </td>
    </tr>
  );
}

// picked (Approver only): { ids: Set, toggle(fix), toggleAll(fixes) } — checkboxes for bulk decisions.
export default function FixTable({ fixes, sort, onSort, grouped, onOpen, selectedId, showFixedBy = false, picked = null }) {
  const columns = COLUMNS.filter(([key]) => showFixedBy || key !== 'fixedBy');
  const reviewable = picked ? fixes.filter(isReviewable) : [];
  const allPicked = reviewable.length > 0 && reviewable.every(f => picked.ids.has(f.id));
  const header = (
    <thead>
      <tr className="text-left">
        {picked && (
          <th scope="col" className="pl-3 py-2 w-8">
            <input type="checkbox" className="accent-teal w-4 h-4 cursor-pointer" checked={allPicked} disabled={!reviewable.length}
              onChange={() => picked.toggleAll(reviewable)} aria-label="Select every fix waiting for approval" />
          </th>
        )}
        {columns.map(([key, label]) => {
          const active = sort.key === key;
          const Icon = active && sort.dir === 'asc' ? ChevronUp : ChevronDown;
          return (
            <th key={key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-body whitespace-nowrap">
              <button type="button" onClick={() => onSort(key)} className="inline-flex items-center gap-1 hover:text-ink">
                {label} <Icon size={11} className={active ? 'text-ink' : 'text-gray-300'} aria-hidden="true" />
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <caption className="sr-only">Auto-Fix attempts — select a row for full details</caption>
        {header}
        <tbody>
          {grouped
            ? groupBySite(fixes).map(g => [
                <SiteHeader key={`h-${g.site}`} group={g} colSpan={columns.length + (picked ? 1 : 0)} />,
                <Rows key={`r-${g.site}`} fixes={g.fixes} onOpen={onOpen} selectedId={selectedId} showFixedBy={showFixedBy} picked={picked} />,
              ])
            : <Rows fixes={fixes} onOpen={onOpen} selectedId={selectedId} showFixedBy={showFixedBy} picked={picked} />}
        </tbody>
      </table>
    </div>
  );
}

