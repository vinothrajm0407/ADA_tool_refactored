import GlowInput from '../ui/GlowInput';
import Toggle from './Toggle';

export const EMPTY_LOGIN = { enabled: false, url: '', username: '', password: '', usernameSelector: '', passwordSelector: '', compare: false };

export function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-widest text-body">
        {label}
        {hint && <span className="ml-1 normal-case font-normal text-body">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** "Site needs login" — shared by Site crawl and Page audit. `children`: extra
    options under the fields (the crawl's "also crawl signed out"). */
export default function LoginPanel({ id, login, onChange, disabled, description, children }) {
  return (
    <div className="p-4 rounded-xl border border-solid border-gray-200 bg-white mt-3">
      <div className="flex items-start justify-between gap-8">
        <div className="flex-1 min-w-0">
          <p id={`${id}-label`} className="text-sm font-semibold text-ink m-0">Site needs login</p>
          <p className="text-sm text-body mt-1 mb-0 leading-relaxed">{description}</p>
        </div>
        <div className="flex-shrink-0 pt-0.5">
          <Toggle
            id={id}
            checked={!!login?.enabled}
            onChange={e => onChange({ ...login, enabled: e.target.checked })}
            disabled={disabled}
            ariaLabelledBy={`${id}-label`}
          />
        </div>
      </div>
      {login?.enabled && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="col-span-2">
            <Field label="Login page URL">
              <GlowInput type="url" aria-label="Login page URL" value={login.url} placeholder="https://example.com/login" disabled={disabled}
                onChange={e => onChange({ ...login, url: e.target.value })} />
            </Field>
          </div>
          <Field label="Username / email">
            <GlowInput type="text" autoComplete="off" aria-label="Login username or email" value={login.username} disabled={disabled}
              onChange={e => onChange({ ...login, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <GlowInput type="password" autoComplete="new-password" aria-label="Login password" value={login.password} disabled={disabled}
              onChange={e => onChange({ ...login, password: e.target.value })} />
          </Field>
          <Field label="Username field" hint="(optional CSS selector)">
            <GlowInput type="text" aria-label="Username field selector" value={login.usernameSelector} placeholder="#email" disabled={disabled}
              onChange={e => onChange({ ...login, usernameSelector: e.target.value })} />
          </Field>
          <Field label="Password field" hint="(optional CSS selector)">
            <GlowInput type="text" aria-label="Password field selector" value={login.passwordSelector} placeholder="#password" disabled={disabled}
              onChange={e => onChange({ ...login, passwordSelector: e.target.value })} />
          </Field>
          {children}
        </div>
      )}
    </div>
  );
}
