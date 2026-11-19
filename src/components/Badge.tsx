import React from 'react';

interface SeverityBadgeProps {
  severity: 'minor' | 'major' | 'critical' | string;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const s = severity?.toLowerCase();
  if (s === 'critical') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
        Critical
      </span>
    );
  }
  if (s === 'major') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
        Major
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
      Minor
    </span>
  );
}

interface CategoryBadgeProps {
  category: string;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const formatted = category?.replace(/_/g, ' ') || 'other';
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 capitalize">
      {formatted}
    </span>
  );
}
