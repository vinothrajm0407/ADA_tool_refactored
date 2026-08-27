import { Globe, Play, AlertTriangle } from 'lucide-react';
import GlowInput from '../ui/GlowInput';
import Toggle from './Toggle';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400">
        {label}
        {hint && <span className="ml-1 normal-case font-normal text-body dark:text-gray-500">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 dark:border-white/[0.06]" />;
}

export default function CrawlForm({
  crawlUrl,
  onUrlChange,
  maxPages,
  onMaxPagesChange,
  maxDepth,
  onMaxDepthChange,
  fullSite,
  onFullSiteChange,
  notifyEmail,
  onNotifyEmailChange,
  crawlLoading,
  onStartCrawl,
}) {
  return (
    <>
      <section className="pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-body dark:text-gray-400 mb-3">
          Root URL
        </p>
        <GlowInput
          large
          icon={Globe}
          type="url"
          value={crawlUrl}
          onChange={e => onUrlChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !crawlLoading && onStartCrawl()}
          placeholder="https://example.com"
          disabled={crawlLoading}
        />
      </section>

      <Divider />

      <section className="pt-5 pb-1">
        <p className="font-heading font-semibold text-lg text-ink dark:text-white mb-1">Crawl Options</p>
        <p className="text-sm text-body dark:text-gray-500 mb-3">
          Configure how deep and wide the crawler explores your site.
        </p>

        {!fullSite && (
          <div className="grid grid-cols-2 gap-4 mb-2">
            <Field label="Max Pages">
              <GlowInput
                type="number"
                value={maxPages}
                onChange={e => onMaxPagesChange(Math.max(1, Math.min(500, Number(e.target.value))))}
                min={1}
                max={500}
                disabled={crawlLoading}
              />
            </Field>
            <Field label="Max Depth">
              <GlowInput
                type="number"
                value={maxDepth}
                onChange={e => onMaxDepthChange(Math.max(1, Math.min(10, Number(e.target.value))))}
                min={1}
                max={10}
                disabled={crawlLoading}
              />
            </Field>
            <p className="col-span-2 text-xs text-body dark:text-gray-500 -mt-2">
              Crawls up to <strong className="text-ink dark:text-gray-300">{maxPages} pages</strong> from the root URL,
              following links up to depth <strong className="text-ink dark:text-gray-300">{maxDepth}</strong>.
            </p>
          </div>
        )}

        <div className="flex items-start justify-between gap-8 py-3 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink dark:text-white">Full Site Crawl</p>
            <p className="text-sm text-body dark:text-gray-400 mt-1 leading-relaxed">
              No page limit — crawls the entire site (up to 10,000 pages).
            </p>
          </div>
          <div className="flex-shrink-0 pt-0.5">
            <Toggle
              id="full-site"
              checked={fullSite}
              onChange={e => onFullSiteChange(e.target.checked)}
              disabled={crawlLoading}
            />
          </div>
        </div>

        {fullSite && (
          <div className="flex items-start gap-2.5 bg-amber/10 px-4 py-3 rounded-xl mt-3">
            <AlertTriangle className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber leading-relaxed">
              Full site crawl enabled. This may take several hours for large sites.
              The crawl runs in the background — you can close this page anytime.
            </p>
          </div>
        )}
      </section>

      <Divider />

      <section className="pt-3 pb-5">
        <p className="font-heading font-semibold text-lg text-ink dark:text-white mb-1">Notifications</p>
        <p className="text-sm text-body dark:text-gray-500 mb-3">
          Receive an email report when the crawl completes.
        </p>
        <Field label="Email Address" hint="(optional)">
          <GlowInput
            type="email"
            value={notifyEmail}
            onChange={e => onNotifyEmailChange(e.target.value)}
            placeholder="you@example.com"
            disabled={crawlLoading}
          />
        </Field>
      </section>

      <Divider />

      <div className="pt-5">
        <button
          onClick={onStartCrawl}
          disabled={crawlLoading || !crawlUrl.trim()}
          className="btn-primary w-full justify-center py-4 text-base font-semibold"
        >
          {crawlLoading
            ? <><span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Starting Crawl…</>
            : <><Play className="w-5 h-5" /> Start Site Crawl</>
          }
        </button>
      </div>
    </>
  );
}
