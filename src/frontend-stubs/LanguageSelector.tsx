/**
 * LanguageSelector — the farmer profile control that sets which of the four
 * SPOKEN languages the app talks in. This changes the *audio* layer only: the
 * visual UI stays English everywhere (see MandiPriceCard / the design spec).
 * It drives every Listen button, the escrow audit drawer, and the voice
 * assistant's reply language via `AuthUser.preferredLanguage`.
 *
 * Each option is shown by its English name AND its own native script so a
 * non-reader recognizes their language at a glance; picking one is a single
 * large tap target.
 */
import { useAuth } from './auth/AuthContext';
import type { PreferredLanguage } from './types';

interface LanguageOption {
  code: PreferredLanguage;
  english: string;
  native: string;
}

const LANGUAGES: readonly LanguageOption[] = [
  { code: 'KASHMIRI', english: 'Kashmiri', native: 'کٲشُر' },
  { code: 'URDU', english: 'Urdu', native: 'اردو' },
  { code: 'HINDI', english: 'Hindi', native: 'हिन्दी' },
  { code: 'ENGLISH', english: 'English', native: 'English' },
];

interface LanguageSelectorProps {
  /**
   * Controlled value; defaults to the signed-in user's preference. Pass with
   * `onChange` to drive it externally (e.g. a standalone settings form).
   */
  value?: PreferredLanguage;
  /** Called with the chosen language; defaults to updating the auth context. */
  onChange?: (language: PreferredLanguage) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const { user, setPreferredLanguage } = useAuth();
  const selected = value ?? user?.preferredLanguage ?? 'KASHMIRI';
  const commit = onChange ?? setPreferredLanguage;

  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Spoken language</legend>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 12px' }}>
        Choose the language you want to hear. Screen text stays in English.
      </p>

      <div role="radiogroup" aria-label="Spoken language" style={gridStyle}>
        {LANGUAGES.map((lang) => {
          const isSelected = lang.code === selected;
          return (
            <button
              key={lang.code}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => commit(lang.code)}
              style={{
                ...optionStyle,
                borderColor: isSelected ? '#1f7a3d' : '#cbd5e1',
                background: isSelected ? '#eaf6ee' : '#fff',
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 700 }}>{lang.native}</span>
              <span style={{ fontSize: 14, color: '#64748b' }}>{lang.english}</span>
              {isSelected ? (
                <span aria-hidden style={{ position: 'absolute', top: 8, right: 10, color: '#1f7a3d' }}>
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 16,
  padding: 20,
  maxWidth: 480,
};

const legendStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#0f172a',
  padding: '0 6px',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const optionStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  minHeight: 72,
  padding: '12px 16px',
  borderRadius: 14,
  borderStyle: 'solid',
  borderWidth: 2,
  cursor: 'pointer',
  textAlign: 'left',
};
