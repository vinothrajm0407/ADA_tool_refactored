import { apiFetch } from '../utils/api';
import { useState, useCallback } from 'react';
import { Globe, Search, FileCode } from 'lucide-react';
import { useApp } from '../context/AppContext';
import './NewScanPage.css';
import SingleScanForm from '../components/newscan/SingleScanForm';
import CrawlForm from '../components/newscan/CrawlForm';
import ScanProgress from '../components/newscan/ScanProgress';
import ScanResults from '../components/newscan/ScanResults';

const TABS = [
  { id: 'single', label: 'Single Page Scan', icon: Search   },
  { id: 'html',   label: 'HTML Validation',  icon: FileCode },
  { id: 'crawl',  label: 'Site Crawl',       icon: Globe    },
];

export default function NewScanPage() {
  const { navigate, setCrawlId } = useApp();

  const [activeTab, setActiveTab] = useState('single');

  // single scan state
  const [scanUrl, setScanUrl]                           = useState('');
  const [includeBestPractices, setIncludeBestPractices] = useState(false);
  const [scanPhase, setScanPhase]                       = useState('idle');
  const [scanResult, setScanResult]                     = useState(null);
  const [scanError, setScanError]                       = useState('');

  // crawl state
  const [crawlUrl, setCrawlUrl]         = useState('');
  const [maxPages, setMaxPages]         = useState(50);
  const [maxDepth, setMaxDepth]         = useState(3);
  const [fullSite, setFullSite]         = useState(false);
  const [notifyEmail, setNotifyEmail]   = useState('');
  const [crawlLoading, setCrawlLoading] = useState(false);

  const resetScan = useCallback(() => {
    setScanPhase('idle');
    setScanResult(null);
    setScanError('');
    setScanUrl('');
  }, []);

  const pollScan = useCallback((jobId) => {
    const iv = setInterval(async () => {
      try {
        const res  = await apiFetch(`/api/scan/${jobId}`);
        const data = await res.json();
        if (!data.ok) { clearInterval(iv); setScanPhase('failed'); setScanError('Could not retrieve scan status.'); return; }
        const s = data.job?.status;
        if (s === 'completed') { clearInterval(iv); setScanPhase('done'); setScanResult(data.job?.result ?? null); }
        else if (s === 'failed') { clearInterval(iv); setScanPhase('failed'); setScanError('Scan failed. Please check the URL and try again.'); }
      } catch { clearInterval(iv); setScanPhase('failed'); setScanError('Network error while polling scan status.'); }
    }, 2500);
  }, []);

  const handleStartScan = useCallback(async () => {
    const url = scanUrl.trim();
    if (!url) return;
    setScanPhase('scanning'); setScanResult(null); setScanError('');
    try {
      const res  = await apiFetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, includeBestPractices }),
      });
      const data = await res.json();
      if (!data.ok) { setScanPhase('failed'); setScanError(data.message ?? 'Failed to start scan.'); return; }
      pollScan(data.jobId);
    } catch { setScanPhase('failed'); setScanError('Network error. Please try again.'); }
  }, [scanUrl, includeBestPractices, pollScan]);

  const handleStartCrawl = useCallback(async () => {
    const url = crawlUrl.trim();
    if (!url) return;
    setCrawlLoading(true);
    try {
      const res  = await apiFetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages, maxDepth, fullSite, notifyEmail: notifyEmail.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) { setCrawlLoading(false); return; }
      setCrawlId(data.crawl_id);
      navigate('crawl-results');
    } catch { setCrawlLoading(false); }
  }, [crawlUrl, maxPages, maxDepth, fullSite, notifyEmail, setCrawlId, navigate]);

  const violations = scanResult?.axeResult?.violations ?? [];
  const incomplete = scanResult?.axeResult?.incomplete  ?? [];
  const passes     = scanResult?.axeResult?.passes      ?? [];
  const scanRan    = passes.length > 0 || violations.length > 0 || incomplete.length > 0;

  return (
    <div className="flex-1 overflow-auto bg-ivory dark:bg-night">
      <div className="px-8 py-8 lg:px-12">

        <div className="mb-8">
          <h1 className="font-heading font-bold text-3xl text-ink dark:text-white mb-2">New Scan</h1>
          <p className="text-base text-body dark:text-gray-400">
            Run accessibility audits, site crawls, and validation checks across your websites.
          </p>
        </div>

        <div className="inline-flex bg-gray-100 dark:bg-charcoal/80 rounded-xl p-1 gap-0.5 mb-8 border border-gray-200 dark:border-white/[0.06]">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                if (id === 'single' && scanPhase === 'done') resetScan();
                setActiveTab(id);
              }}
              className={[
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                activeTab === id
                  ? 'bg-white dark:bg-night shadow-sm text-teal font-semibold'
                  : 'text-gray-500 dark:text-gray-400 hover:text-ink dark:hover:text-white hover:bg-white/60 dark:hover:bg-white/5',
              ].join(' ')}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* Single Page Scan */}
        {activeTab === 'single' && (
          <>
            {scanPhase !== 'done' && (
              <div className="bg-white dark:bg-charcoal rounded-2xl border border-gray-100 dark:border-white/[0.06] shadow-soft">
                {scanPhase === 'scanning' ? (
                  <ScanProgress bare url={scanUrl} />
                ) : (
                  <div className="px-6 py-5">
                    <SingleScanForm
                      scanUrl={scanUrl}
                      onUrlChange={setScanUrl}
                      includeBestPractices={includeBestPractices}
                      onBestPracticesChange={setIncludeBestPractices}
                      scanPhase={scanPhase}
                      scanError={scanError}
                      onStartScan={handleStartScan}
                    />
                  </div>
                )}
              </div>
            )}
            {scanPhase === 'done' && (
              <ScanResults
                violations={violations}
                incomplete={incomplete}
                passes={passes}
                scanRan={scanRan}
                scanUrl={scanUrl}
                onReset={resetScan}
                screenshot={scanResult?.axeResult?.screenshot}
                screenshotType={scanResult?.axeResult?.screenshotType}
              />
            )}
          </>
        )}

        {/* HTML Validation */}
        {activeTab === 'html' && (
          <div className="py-20 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-teal/10 flex items-center justify-center mb-4">
              <FileCode className="w-8 h-8 text-teal" />
            </div>
            <p className="font-heading font-bold text-xl text-ink dark:text-white">HTML Validation</p>
            <p className="text-sm text-body dark:text-gray-400 mt-2 max-w-xs leading-relaxed">
              Upload an HTML file for offline accessibility validation. Coming in the next release.
            </p>
            <span className="inline-block mt-5 text-xs font-semibold text-teal bg-teal/10 px-3 py-1.5 rounded-full">Coming Soon</span>
          </div>
        )}

        {/* Site Crawl */}
        {activeTab === 'crawl' && (
          <CrawlForm
            crawlUrl={crawlUrl}
            onUrlChange={setCrawlUrl}
            maxPages={maxPages}
            onMaxPagesChange={setMaxPages}
            maxDepth={maxDepth}
            onMaxDepthChange={setMaxDepth}
            fullSite={fullSite}
            onFullSiteChange={setFullSite}
            notifyEmail={notifyEmail}
            onNotifyEmailChange={setNotifyEmail}
            crawlLoading={crawlLoading}
            onStartCrawl={handleStartCrawl}
          />
        )}

      </div>
    </div>
  );
}
