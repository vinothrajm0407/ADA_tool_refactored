export default function PageHeader({ title, description, badge, actions, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 flex-wrap ${className}`}>
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-[1.75rem] font-bold text-ink mt-0 mb-1">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="text-body text-[0.9375rem]">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
