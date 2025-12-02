'use client';

import { useCallback, useState } from 'react';

interface FileUploadProps {
  onFileLoaded: (data: unknown, fileName: string) => void;
}

export function FileUpload({ onFileLoaded }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setIsLoading(true);

      if (!file.name.endsWith('.json')) {
        setError('Please upload a JSON file');
        setIsLoading(false);
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        onFileLoaded(data, file.name);
      } catch {
        setError('Invalid JSON file');
      } finally {
        setIsLoading(false);
      }
    },
    [onFileLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
      className={`
        relative rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all bg-white
        ${isDragOver 
          ? 'border-indigo-400 bg-indigo-50/50 scale-[1.02] shadow-lg shadow-indigo-500/10' 
          : 'border-stone-200 hover:border-stone-300 shadow-sm hover:shadow-md active:shadow-sm'
        }
      `}
    >
      <label className="cursor-pointer block">
        <div className="flex flex-col items-center">
          {/* Icon */}
          <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center mb-5 sm:mb-6 transition-all ${
            isDragOver ? 'bg-indigo-100' : 'bg-stone-100'
          }`}>
            {isLoading ? (
              <svg className="w-7 h-7 sm:w-8 sm:h-8 text-stone-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className={`w-7 h-7 sm:w-8 sm:h-8 transition-colors ${isDragOver ? 'text-indigo-500' : 'text-stone-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
            )}
          </div>
          
          {/* Primary text - Action-oriented */}
          <p className="text-lg sm:text-xl font-semibold text-stone-700 mb-2">
            {isDragOver ? 'Drop to upload' : isLoading ? 'Processing...' : 'Drop your file here'}
          </p>
          
          {/* Secondary text - Instruction */}
          <p className="text-base sm:text-lg text-stone-400">
            or <span className="text-indigo-500 hover:text-indigo-600 active:text-indigo-700 font-medium">browse</span> to select
          </p>
        </div>
        <input
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          disabled={isLoading}
        />
      </label>
      
      {/* Error - Distinct but not alarming */}
      {error && (
        <p className="mt-5 text-sm sm:text-base text-red-600 bg-red-50 px-4 py-2.5 rounded-lg font-medium animate-fade-in">{error}</p>
      )}
    </div>
  );
}
