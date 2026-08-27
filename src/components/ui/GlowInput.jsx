export default function GlowInput({ icon: Icon, type = 'text', disabled, large, ...props }) {
  return (
    <div className={`glow-input-wrapper${large ? ' glow-input-wrapper--large' : ''}${disabled ? ' opacity-60' : ''}`}>
      {Icon && (
        <Icon
          className={
            large
              ? 'absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-400 pointer-events-none z-10'
              : 'absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-400 pointer-events-none z-10'
          }
        />
      )}
      <input
        type={type}
        disabled={disabled}
        className={`glow-input${Icon ? ' has-left-icon' : ''}${large ? ' glow-input--large-text' : ''}`}
        {...props}
      />
    </div>
  );
}
