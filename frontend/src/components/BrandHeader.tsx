import { useState } from 'react';

/**
 * The app's logo.
 *
 * Drop the artwork at `frontend/public/logo.png` and it appears here; the
 * wordmark is part of the image, so no separate title is drawn alongside it.
 * Until that file exists, this falls back to a mark and text rather than a
 * broken image, so a missing asset never leaves the header empty.
 */
export default function BrandHeader() {
  const [logoFailed, setLogoFailed] = useState(false);

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
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <div>
        <h1 className="text-lg font-bold text-slate-800 leading-tight">
          Energy Usage Analyser
        </h1>
        <p className="text-xs text-slate-400">
          Half hourly data analysis &amp; solar sizing
        </p>
      </div>
    </div>
  );
}
