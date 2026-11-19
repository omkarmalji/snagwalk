'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { SeverityBadge, CategoryBadge } from '@/components/Badge';
import {
  Download,
  Copy,
  Sparkles,
  RefreshCw,
  Check,
  FileText,
  Clock,
  AlertTriangle,
  ArrowLeft,
  Share2,
} from 'lucide-react';

interface Snag {
  id: string;
  room_id: string;
  room_name: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  photo_url: string;
  photo_number: number;
}

export default function SnagLetterPage() {
  const params = useParams();
  const router = useRouter();
  const walkId = params.walkId as string;

  const letterContainerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [walk, setWalk] = useState<any>(null);
  const [snags, setSnags] = useState<Snag[]>([]);
  const [letterContent, setLetterContent] = useState<string>('');

  useEffect(() => {
    fetchDataAndGenerate();
  }, [walkId]);

  async function fetchDataAndGenerate() {
    setLoading(true);
    try {
      // 1. Fetch walk info and all snags from the snags table
      const res = await fetch(`/api/walks/${walkId}/snags`);
      const data = await res.json();
      setSnags(data.all_snags || []);

      const walkRes = await fetch(`/api/walks/${walkId}`);
      const walkData = await walkRes.json();
      setWalk(walkData.walk);

      // 2. Load existing letter from walks table or generate via Gemini
      if (walkData.walk?.letter_text) {
        setLetterContent(walkData.walk.letter_text);
      } else {
        await triggerLetterGeneration();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function triggerLetterGeneration() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/walks/${walkId}/letter`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate letter');
      setLetterContent(data.letter);
    } catch (e: any) {
      console.error(e);
      setLetterContent('Error generating snag letter from Gemini. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  function handleCopyText() {
    if (!letterContent) return;
    navigator.clipboard.writeText(letterContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleDownloadPdf() {
    if (!letterContainerRef.current) return;
    setDownloading(true);

    try {
      // Dynamic import of jspdf and html2canvas for browser client-side generation
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const element = letterContainerRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      let position = 0;
      let heightLeft = pdfHeight;
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }

      const flatName = walk ? `Flat_${walk.flat_number}_${walk.tower}` : 'SnagList';
      pdf.save(`SnagWalk_Notice_${flatName}.pdf`);
    } catch (err) {
      console.error('PDF generation error, opening browser print window:', err);
      window.print();
    } finally {
      setDownloading(false);
    }
  }

  const criticalCount = snags.filter((s) => s.severity === 'critical').length;
  const majorCount = snags.filter((s) => s.severity === 'major').length;
  const minorCount = snags.filter((s) => s.severity === 'minor').length;

  return (
    <div className="flex flex-col flex-1 pb-28">
      <Header
        title="Builder Snag Letter"
        backHref={`/walks/${walkId}`}
        subtitle={walk ? `Flat ${walk.flat_number} • ${walk.builder}` : ''}
      />

      {/* Top Banner & 15-Day Notice Badge */}
      <div className="bg-slate-900 text-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400">Formal Rectification Notice</span>
            <h2 className="text-base font-bold text-white">
              {walk?.builder || 'Builder'} • {walk?.project || 'Project'}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>15-Day Fix Timeline</span>
          </div>
        </div>

        {/* Severity Metrics Bar */}
        <div className="grid grid-cols-4 gap-2 pt-1 text-center">
          <div className="bg-slate-800 p-2 rounded-xl border border-slate-700">
            <div className="text-base font-bold text-white">{snags.length}</div>
            <div className="text-[10px] text-slate-400">Total Defects</div>
          </div>
          <div className="bg-rose-950/50 p-2 rounded-xl border border-rose-800/40">
            <div className="text-base font-bold text-rose-400">{criticalCount}</div>
            <div className="text-[10px] text-rose-300">Critical</div>
          </div>
          <div className="bg-amber-950/50 p-2 rounded-xl border border-amber-800/40">
            <div className="text-base font-bold text-amber-400">{majorCount}</div>
            <div className="text-[10px] text-amber-300">Major</div>
          </div>
          <div className="bg-emerald-950/50 p-2 rounded-xl border border-emerald-800/40">
            <div className="text-base font-bold text-emerald-400">{minorCount}</div>
            <div className="text-[10px] text-emerald-300">Minor</div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Quick Actions (Regenerate / Copy) */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={generating}
            onClick={triggerLetterGeneration}
            className="flex-1 h-11 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-sm active:bg-slate-100 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Regenerate Letter</span>
          </button>

          <button
            type="button"
            onClick={handleCopyText}
            className="flex-1 h-11 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-sm active:bg-slate-100 transition"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-bold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-600" />
                <span>Copy Text</span>
              </>
            )}
          </button>
        </div>

        {/* Printable/Exportable Letter Document */}
        <div
          ref={letterContainerRef}
          className="bg-white rounded-2xl p-5 border border-slate-200 shadow-md text-slate-900 space-y-4"
        >
          {generating ? (
            <div className="py-12 text-center text-slate-500 space-y-3">
              <Sparkles className="w-8 h-8 text-emerald-600 mx-auto animate-pulse" />
              <p className="text-sm font-semibold text-slate-800">
                Gemini on Vertex AI is drafting the formal snag letter...
              </p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Strictly enforcing tone, grouping defects by room, referencing photos, and mandating a 15-day timeline.
              </p>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none text-xs leading-relaxed space-y-3">
              {/* Formatted Markdown Display */}
              <div className="whitespace-pre-wrap font-sans text-slate-800 text-xs leading-relaxed bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                {letterContent}
              </div>
            </div>
          )}

          {/* Photographic Evidence Attachment Section (Referenced in Letter) */}
          {snags.length > 0 && !generating && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Photographic Evidence Annexure ({snags.length} Photos)
                </h4>
                <span className="text-[10px] text-slate-500 font-mono">
                  gs://snagwalk-photos-515212
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {snags.map((snag) => (
                  <div
                    key={snag.id}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col"
                  >
                    <div className="relative aspect-square bg-slate-100">
                      <img
                        src={snag.photo_url}
                        alt={`Photo #${snag.photo_number}`}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900/80 text-white shadow">
                        Photo #{snag.photo_number}
                      </span>
                    </div>
                    <div className="p-2 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-bold text-slate-800 truncate">
                          {snag.room_name}
                        </span>
                        <SeverityBadge severity={snag.severity} />
                      </div>
                      <p className="text-[11px] text-slate-700 line-clamp-2 leading-tight">
                        {snag.description}
                      </p>
                      {snag.location_note && (
                        <p className="text-[10px] text-slate-500 truncate">
                          📍 {snag.location_note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Back Link */}
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => router.push(`/walks/${walkId}`)}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Room Walk</span>
          </button>
        </div>
      </div>

      {/* STICKY BOTTOM PRIMARY ACTION: DOWNLOAD PDF (Requirement 4 & Mobile-First Rule) */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-xl z-20">
        <button
          type="button"
          disabled={downloading || generating}
          onClick={handleDownloadPdf}
          className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl font-bold text-base shadow-lg shadow-emerald-700/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          {downloading ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Preparing PDF Document...
            </span>
          ) : (
            <>
              <Download className="w-5 h-5" />
              <span>Download Official Snag Letter (PDF)</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
