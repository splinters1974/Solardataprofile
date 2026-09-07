import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

interface Props {
  onUpload: (file: File) => void;
  loading: boolean;
}

export default function FileUpload({ onUpload, loading }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) {
        setFileName(accepted[0].name);
        onUpload(accepted[0]);
      }
    },
    [onUpload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'text/plain': ['.txt'],
    },
    multiple: false,
    disabled: loading,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
        ${isDragActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 hover:border-emerald-400 bg-white'}
        ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        <svg className="w-12 h-12 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {loading ? (
          <p className="text-slate-600 font-medium">Parsing data…</p>
        ) : fileName ? (
          <p className="text-emerald-700 font-medium">{fileName}</p>
        ) : (
          <>
            <p className="text-slate-700 font-medium">
              {isDragActive ? 'Drop your HH data file here' : 'Drag & drop your HH Excel file here'}
            </p>
            <p className="text-slate-400 text-sm">or click to browse — .xlsx, .xlsm, .xls, .csv accepted</p>
          </>
        )}
      </div>
    </div>
  );
}
