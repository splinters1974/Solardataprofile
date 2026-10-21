import { useState } from 'react';
import { AMERESCO_LOGO } from '../local/brand';

/**
 * The app's logo.
 *
 * Drop the artwork at `frontend/public/logo.png` and it appears here; the
 * wordmark is part of the image, so no separate title is drawn alongside it.
 * Until that file exists, this falls back to the Ameresco UK logo and the
 * product name rather than a broken image.
 */
export default function BrandHeader() {
  // A logo.png beside the hosted build still wins; otherwise the Ameresco UK
  // logo (embedded, so it also works offline) and the product name.
  const [logoFailed, setLogoFailed] = useState(import.meta.env.MODE === 'standalone');

  if (!logoFailed) {
    return (
      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt="Energy Usage Analyser"
        onError={() => setLogoFailed(true)}
        className="h-11 w-auto"
      />
    );
  }

  return (
    <div className="flex items-center gap-4">
      <img src={AMERESCO_LOGO} alt="Ameresco UK" className="h-10 w-auto" />
      <span className="h-9 w-px bg-slate-200" aria-hidden />
      <div>
        <h1 className="text-lg font-bold text-slate-800 leading-tight">
          Energy Usage Analyser
        </h1>
        <p className="text-xs text-slate-400">
          {import.meta.env.MODE === 'standalone'
            ? 'Half hourly data analysis'
            : <>Half hourly data analysis &amp; solar sizing</>}
        </p>
      </div>
    </div>
  );
}
