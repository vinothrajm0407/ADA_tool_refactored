import { Play, AlertTriangle } from 'lucide-react';
import GlowInput from '../ui/GlowInput';
import Toggle from './Toggle';
import LoginPanel, { Field } from './LoginPanel';

function Divider() {
  return <div className="border-t border-gray-100"/>;
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
  assisted,
  onAssistedChange,
  login,
  onLoginChange,
  notifyEmail,
  onNotifyEmailChange,
  crawlLoading,
  crawlError,
  onStartCrawl,
  hideUrlField,
  hideActions,
}) {
  return (
    <>
      {!hideUrlField && (
        <>
          <section className="pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-body mb-3">
              Root URL
            </p>
            <input
              type="url"
              value={crawlUrl}
              onChange={e => onUrlChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !crawlLoading && onStartCrawl()}
              placeholder="https://example.com"
              disabled={crawlLoading}
              className="w-full border-2 border-teal rounded-lg px-4 py-2.5 text-sm text-ink placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal/20 focus:ring-offset-1 transition-shadow disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </section>

          <Divider />
        </>
      )}

      <section className="pt-5 pb-1">
        <p className="font-heading font-semibold text-lg text-ink mb-1">Crawl Options</p>
        <p className="text-sm text-body mb-3">
          Configure how deep and wide the crawler explores your site.
        </p>

        {!fullSite && (
          <div className="grid grid-cols-2 gap-4 mb-2">
            <Field label="Max Pages">
              <GlowInput
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={maxPages}
                onChange={e => {
                  const digits = e.target.value.replace(/\D/g, '');
                  onMaxPagesChange(digits === '' ? '' : Number(digits));
                }}
                onBlur={() => onMaxPagesChange(Math.max(1, Math.min(500, Number(maxPages) || 1)))}
                disabled={crawlLoading}
              />
            </Field>
            <Field label="Max Depth">
              <GlowInput
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={maxDepth}
                onChange={e => {
                  const digits = e.target.value.replace(/\D/g, '');
                  onMaxDepthChange(digits === '' ? '' : Number(digits));
                }}
                onBlur={() => onMaxDepthChange(Math.max(1, Math.min(100, Number(maxDepth) || 1)))}
                disabled={crawlLoading}
              />
            </Field>
            <p className="col-span-2 text-xs text-body -mt-2">
              Crawls up to <strong className="text-ink">{maxPages} pages</strong> from the root URL,
              following links up to depth <strong className="text-ink">{maxDepth}</strong>.
            </p>
          </div>
        )}

        <div className="flex items-start justify-between gap-8 p-4 rounded-xl border border-solid border-gray-200 bg-white">
          <div className="flex-1 min-w-0">
            <p id="full-site-label" className="text-sm font-semibold text-ink m-0">Full Site Crawl</p>
            <p className="text-sm text-body mt-1 mb-0 leading-relaxed">
              No page limit — crawls the entire site (up to 10,000 pages).
            </p>
          </div>
          <div className="flex-shrink-0 pt-0.5">
            <Toggle
              id="full-site"
              checked={fullSite}
              onChange={e => onFullSiteChange(e.target.checked)}
              disabled={crawlLoading}
              ariaLabelledBy="full-site-label"
            />
          </div>
        </div>

        {onAssistedChange && (
          <div className="flex items-start justify-between gap-8 p-4 rounded-xl border border-solid border-gray-200 bg-white mt-3">
            <div className="flex-1 min-w-0">
              <p id="crawl-assisted-label" className="text-sm font-semibold text-ink m-0">Use a visible browser</p>
              <p className="text-sm text-body mt-1 mb-0 leading-relaxed">
                For sites with bot protection (e.g. Cloudflare). A browser window opens on this computer and stays open
                for the whole crawl — if the site asks you to verify you're human, complete it there.
              </p>
            </div>
            <div className="flex-shrink-0 pt-0.5">
              <Toggle
                id="crawl-assisted"
                checked={!!assisted}
                onChange={e => onAssistedChange(e.target.checked)}
                disabled={crawlLoading}
                ariaLabelledBy="crawl-assisted-label"
              />
            </div>
          </div>
        )}

        {onLoginChange && (
          <LoginPanel
            id="crawl-login"
            login={login}
            onChange={onLoginChange}
            disabled={crawlLoading}
            description="Signs in once, then crawls the pages behind the login. The password is used for this crawl only and
              is never saved. If the site asks for something only a person can do (a robot check, OTP, or
              Google/Microsoft sign-in), a browser window opens on this computer for you to finish it. You can also
              leave the password empty and sign in yourself in that window."
          >
            <label className="col-span-2 flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 w-4 h-4 accent-teal" checked={!!login.compare} disabled={crawlLoading}
                onChange={e => onLoginChange({ ...login, compare: e.target.checked })} />
              <span className="text-sm">
                <span className="font-semibold text-ink">Also crawl signed out, to compare</span>
                <span className="block text-body">Runs a second crawl as a visitor at the same time, then shows each page signed out vs logged in. About twice the work for the site.</span>
              </span>
            </label>
          </LoginPanel>
        )}


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
        <p className="font-heading font-semibold text-lg text-ink mb-1">Notifications</p>
        <p className="text-sm text-body mb-3">
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

      {!hideActions && (<>
      <Divider />

      <div className="pt-5">
        {crawlError && (
          <div className="flex items-center gap-2.5 bg-coral/10 text-coral px-4 py-3 rounded-xl text-sm mb-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {crawlError}
          </div>
        )}
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
      </>)}
    </>
  );
}
