import React from 'react';
import Link from 'next/link';
import { ShieldCheck, ChevronLeft } from 'lucide-react';

interface HeaderProps {
  title?: string;
  backHref?: string;
  subtitle?: string;
}

export default function Header({ title = 'SnagWalk', backHref, subtitle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 shadow-md flex items-center justify-between">
      <div className="flex items-center space-x-2">
        {backHref ? (
          <Link
            href={backHref}
            className="p-1 -ml-1 text-slate-300 hover:text-white rounded-lg active:bg-slate-800 transition"
            aria-label="Back"
          >
            <ChevronLeft className="w-6 h-6" />
          </Link>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
        )}
        <div>
          <h1 className="font-bold text-lg leading-tight tracking-tight text-white flex items-center gap-1.5">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-slate-400 truncate max-w-[240px]">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
        Vertex AI
      </div>
    </header>
  );
}
