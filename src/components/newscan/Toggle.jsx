export default function Toggle({ id, checked, onChange, disabled }) {
  return (
    <label
      htmlFor={id}
      className={`relative inline-flex items-center flex-shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input id={id} type="checkbox" className="sr-only" checked={checked} onChange={onChange} disabled={disabled} />
      <div
        className={[
          'relative w-11 h-6 rounded-full transition-all duration-200',
          checked
            ? 'bg-teal shadow-[0_0_0_2px_rgba(15,118,110,0.25)]'
            : 'bg-gray-300 dark:bg-gray-500 shadow-[inset_0_1px_3px_rgba(0,0,0,0.18)]',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </div>
    </label>
  );
}
