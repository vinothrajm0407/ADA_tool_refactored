import { XCircle, CheckCircle, Code } from 'lucide-react';

export function IconButton({ onClick, label, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-10 h-10 rounded-xl flex items-center justify-center hover:bg-ivory transition-colors border-0 bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}

export function CodeBlock({ title, code, tone = 'neutral' }) {
  const headerConfig = {
    before: {
      className:'bg-coral/10 text-coral-700 border-b border-coral/20',
      Icon: XCircle,
    },
    after: {
      className:'bg-sage/10 text-sage-700 border-b border-sage/20',
      Icon: CheckCircle,
    },
    neutral: {
      className:'bg-gray-100 text-body border-b border-gray-200',
      Icon: Code,
    },
  };

  const { className: headerClass, Icon } = headerConfig[tone] ?? headerConfig.neutral;

  return (
    <div className="rounded-2xl overflow-hidden">
      <div className={`px-4 py-3 flex items-center gap-2 font-heading font-semibold text-sm ${headerClass}`}>
        <Icon size={16} />
        {title}
      </div>
      <div className="bg-gray-900 p-4 overflow-x-auto">
        <pre>
          <code className="text-sm text-gray-200 font-mono leading-relaxed whitespace-pre">
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}

export default CodeBlock;
