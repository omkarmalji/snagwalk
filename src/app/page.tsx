'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import {
  Building2,
  Calendar,
  Home,
  User,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  ClipboardList,
} from 'lucide-react';

export default function NewWalkPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [recentWalks, setRecentWalks] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    buyer_name: '',
    builder: '',
    project: '',
    tower: '',
    flat_number: '',
    bhk: '2 BHK',
    possession_date: new Date().toISOString().split('T')[0],
  });

  const bhkOptions = ['1 BHK', '2 BHK', '2.5 BHK', '3 BHK', '4 BHK', 'Villa / Duplex'];

  useEffect(() => {
    fetchRecentWalks();
  }, []);

  async function fetchRecentWalks() {
    try {
      const res = await fetch('/api/walks');
      if (res.ok) {
        const data = await res.json();
        setRecentWalks(data.walks || []);
      }
    } catch (e) {
      console.warn('Could not load recent walks:', e);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (
      !formData.buyer_name ||
      !formData.builder ||
      !formData.project ||
      !formData.tower ||
      !formData.flat_number
    ) {
      alert('Please fill in all flat and builder details to start.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/walks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initialize walk');
      }

      // Navigate directly to Screen 2 (Room-by-Room Walk)
      router.push(`/walks/${data.walk.id}`);
    } catch (err: any) {
      alert(err.message || 'Error creating possession walk');
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 pb-10">
      <Header title="SnagWalk" subtitle="Possession Handover Inspection" />

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white p-5 rounded-b-2xl shadow-md">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold mb-2 border border-emerald-500/30">
          <Sparkles className="w-3.5 h-3.5" />
          AlloyDB & Vertex AI Flash
        </div>
        <h2 className="text-xl font-bold tracking-tight">New Possession Walk</h2>
        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
          Inspect room-by-room, capture photo snags analyzed by Gemini, and generate your official builder snag letter in minutes.
        </p>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Buyer Info */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-emerald-600" />
            Home Buyer Details
          </label>
          <div>
            <span className="text-xs font-semibold text-slate-700">Buyer Full Name</span>
            <input
              type="text"
              required
              placeholder="e.g. Rahul Sharma"
              value={formData.buyer_name}
              onChange={(e) => setFormData({ ...formData, buyer_name: e.target.value })}
              className="mt-1 w-full h-12 px-3 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
            />
          </div>
        </div>

        {/* Builder & Project Info */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-emerald-600" />
            Developer & Project
          </label>
          <div>
            <span className="text-xs font-semibold text-slate-700">Builder / Developer Name</span>
            <input
              type="text"
              required
              placeholder="e.g. Prestige Estates / Godrej Properties"
              value={formData.builder}
              onChange={(e) => setFormData({ ...formData, builder: e.target.value })}
              className="mt-1 w-full h-12 px-3 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
            />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-700">Project / Society Name</span>
            <input
              type="text"
              required
              placeholder="e.g. Prestige Falcon City"
              value={formData.project}
              onChange={(e) => setFormData({ ...formData, project: e.target.value })}
              className="mt-1 w-full h-12 px-3 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
            />
          </div>
        </div>

        {/* Unit & Flat Details */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5 text-emerald-600" />
            Unit Configuration
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-700">Tower / Wing</span>
              <input
                type="text"
                required
                placeholder="e.g. Tower 3"
                value={formData.tower}
                onChange={(e) => setFormData({ ...formData, tower: e.target.value })}
                className="mt-1 w-full h-12 px-3 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
              />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-700">Flat / Unit Number</span>
              <input
                type="text"
                required
                placeholder="e.g. 1402"
                value={formData.flat_number}
                onChange={(e) => setFormData({ ...formData, flat_number: e.target.value })}
                className="mt-1 w-full h-12 px-3 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
              />
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-700">BHK Type</span>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {bhkOptions.map((opt) => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => setFormData({ ...formData, bhk: opt })}
                  className={`h-11 rounded-lg text-xs font-semibold border transition ${
                    formData.bhk === opt
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              Possession / Inspection Date
            </span>
            <input
              type="date"
              required
              value={formData.possession_date}
              onChange={(e) => setFormData({ ...formData, possession_date: e.target.value })}
              className="mt-1 w-full h-12 px-3 text-base rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50"
            />
          </div>
        </div>

        {/* Default Rooms Preview Notice */}
        <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Default inspection rooms will be created:</span>
            <p className="text-[11px] text-emerald-800 mt-0.5">
              Living Room, Kitchen, Bedroom 1, Bedroom 2, Bathrooms, and Balcony.
            </p>
          </div>
        </div>

        {/* PRIMARY ACTION BUTTON (Rule: Mobile-first, one primary action per screen, large tap targets) */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl font-bold text-base shadow-lg shadow-emerald-700/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Creating Walk in AlloyDB...
              </span>
            ) : (
              <>
                <span>Start Possession Walk</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Recent Walks List (Quick Resume) */}
      {recentWalks.length > 0 && (
        <div className="px-4 mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 text-slate-400" />
            Resume Existing Possession Walk
          </h3>
          <div className="space-y-2">
            {recentWalks.slice(0, 3).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => router.push(`/walks/${w.id}`)}
                className="w-full text-left p-3 rounded-xl bg-white border border-slate-200 shadow-sm hover:border-emerald-300 transition flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-sm text-slate-800">
                    Flat {w.flat_number}, {w.tower} - {w.project}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {w.buyer_name} • {w.bhk} • {w.builder}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
