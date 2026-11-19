'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import {
  Home,
  CheckCircle2,
  Circle,
  Camera,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RefreshCw,
  PlusCircle,
  Building,
} from 'lucide-react';

interface Room {
  id: string;
  walk_id: string;
  room_name: string;
  room_type: string;
  checklist: any[];
  snag_count: number;
}

interface Walk {
  id: string;
  buyer_name: string;
  builder: string;
  project: string;
  tower: string;
  flat_number: string;
  bhk: string;
  possession_date: string;
}

export default function RoomByRoomWalkPage() {
  const params = useParams();
  const router = useRouter();
  const walkId = params?.walkId as string;

  const [walk, setWalk] = useState<Walk | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [checklistLoading, setChecklistLoading] = useState<string | null>(null);

  useEffect(() => {
    if (walkId && walkId !== 'undefined') {
      fetchWalkDetails();
    }
  }, [walkId]);

  async function fetchWalkDetails() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/walks/${walkId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load walk details');
      }
      setWalk(data.walk);
      setRooms(data.rooms || []);
      if (data.rooms?.length > 0 && !expandedRoomId) {
        setExpandedRoomId(data.rooms[0].id);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to load walk details');
    } finally {
      setLoading(false);
    }
  }

  // Load or regenerate Gemini checklist
  async function loadRoomChecklist(roomId: string, forceRegenerate = false) {
    if (!roomId) return;
    setChecklistLoading(roomId);
    try {
      const method = forceRegenerate ? 'POST' : 'GET';
      const res = await fetch(`/api/rooms/${roomId}/checklist`, { method });
      const data = await res.json();
      if (res.ok) {
        const items = data.checklist || data.room?.checklist || [];
        setRooms((prev) =>
          prev.map((r) => (r.id === roomId ? { ...r, checklist: items } : r))
        );
      } else {
        alert(data.error || 'Could not load checklist');
      }
    } catch (err) {
      console.error('Checklist error:', err);
    } finally {
      setChecklistLoading(null);
    }
  }

  // Toggle checklist item checked status
  async function toggleChecklistItem(roomId: string, itemId: string) {
    const room = rooms.find((r) => r.id === roomId);
    if (!room || !room.checklist) return;

    const updatedChecklist = room.checklist.map((item: any) =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );

    // Optimistic UI update
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, checklist: updatedChecklist } : r))
    );

    try {
      await fetch(`/api/rooms/${roomId}/checklist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist: updatedChecklist }),
      });
    } catch (err) {
      console.error('Failed to sync checklist update:', err);
    }
  }

  const totalSnags = rooms.reduce((acc, r) => acc + (r.snag_count || 0), 0);

  if (loading) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center p-6 text-slate-500">
        <svg className="animate-spin h-8 w-8 text-emerald-600 mb-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-sm font-medium">Loading possession inspection rooms...</p>
      </div>
    );
  }

  if (errorMsg || !walk) {
    return (
      <div className="p-6 text-center text-slate-600 space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold">
          !
        </div>
        <h3 className="font-bold text-base text-slate-800">Possession Walk Notice</h3>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          {errorMsg || 'Walk details could not be found.'}
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={fetchWalkDetails}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
          >
            Retry Loading
          </button>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold"
          >
            Create New Walk
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 pb-24">
      <Header
        title="Room-by-Room Walk"
        backHref="/"
        subtitle={`${walk.project} • Flat ${walk.flat_number}`}
      />

      {/* Flat Summary Card */}
      <div className="bg-slate-900 text-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">
              Flat {walk.flat_number}, {walk.tower}
            </div>
            <div className="text-xs text-slate-300 mt-0.5">
              {walk.project} • {walk.builder}
            </div>
            <div className="text-xs text-emerald-400 mt-1 font-medium">
              Buyer: {walk.buyer_name} ({walk.bhk})
            </div>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
              <AlertTriangle className="w-3.5 h-3.5" />
              {totalSnags} {totalSnags === 1 ? 'Snag' : 'Snags'}
            </span>
            <div className="text-[10px] text-slate-400 mt-1">
              {rooms.length} Rooms
            </div>
          </div>
        </div>
      </div>

      {/* Guide Note */}
      <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-xs text-slate-600 flex items-center justify-between">
        <span className="font-semibold text-slate-700">Select a room to inspect & capture snags:</span>
        <span className="text-[11px] text-slate-500">Tap to expand</span>
      </div>

      {/* Rooms List */}
      <div className="p-4 space-y-3">
        {rooms.map((room) => {
          const isExpanded = expandedRoomId === room.id;
          const checklist = room.checklist || [];
          const checkedCount = checklist.filter((i) => i.checked).length;

          return (
            <div
              key={room.id}
              className={`bg-white rounded-xl border transition-all duration-200 overflow-hidden shadow-sm ${
                isExpanded ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-200'
              }`}
            >
              {/* Room Header Accordion Button (Large Tap Target) */}
              <button
                type="button"
                onClick={() => {
                  if (isExpanded) {
                    setExpandedRoomId(null);
                  } else {
                    setExpandedRoomId(room.id);
                    if (!room.checklist || room.checklist.length === 0) {
                      loadRoomChecklist(room.id);
                    }
                  }
                }}
                className="w-full min-h-[58px] p-3 text-left flex items-center justify-between hover:bg-slate-50 active:bg-slate-100 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0 border border-slate-200">
                    <Home className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 leading-tight">
                      {room.room_name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {checklist.length > 0
                        ? `${checkedCount} of ${checklist.length} checklist items verified`
                        : 'Tap to view AI checklist'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {room.snag_count > 0 && (
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                      {room.snag_count} {room.snag_count === 1 ? 'snag' : 'snags'}
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </button>

              {/* Expanded Checklist & Action Area */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-3 bg-slate-50/50">
                  {/* Gemini Checklist Header */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      Gemini Inspection Checklist
                    </span>
                    <button
                      type="button"
                      disabled={checklistLoading === room.id}
                      onClick={() => loadRoomChecklist(room.id, true)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1 active:opacity-70"
                    >
                      <RefreshCw className={`w-3 h-3 ${checklistLoading === room.id ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>

                  {/* Checklist Items */}
                  {checklistLoading === room.id ? (
                    <div className="py-4 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4 text-emerald-600" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Generating checklist from Vertex AI...
                    </div>
                  ) : checklist.length === 0 ? (
                    <div className="py-2 text-center text-xs text-slate-500">
                      <button
                        type="button"
                        onClick={() => loadRoomChecklist(room.id)}
                        className="text-emerald-600 font-semibold underline"
                      >
                        Generate checklist with Gemini
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {checklist.map((item: any) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => toggleChecklistItem(room.id, item.id)}
                          className={`w-full min-h-[44px] px-3 py-2 text-left rounded-lg border text-xs flex items-center gap-2.5 transition active:scale-[0.99] ${
                            item.checked
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 line-through'
                              : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
                          }`}
                        >
                          {item.checked ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className="leading-tight">{item.item}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Room Snag Action Button (Large Touch Target) */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/walks/${walkId}/rooms/${room.id}/snag`)}
                      className="w-full h-12 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition"
                    >
                      <Camera className="w-4 h-4 text-emerald-400" />
                      <span>Capture Snag Photo in {room.room_name}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky Bottom Primary Action: Generate Letter (Screen 2 -> Screen 4) */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-xl z-20">
        <button
          type="button"
          onClick={() => router.push(`/walks/${walkId}/letter`)}
          className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl font-bold text-base shadow-lg shadow-emerald-700/20 flex items-center justify-center gap-2 transition"
        >
          <FileText className="w-5 h-5" />
          <span>Finish & Write Builder Letter ({totalSnags} {totalSnags === 1 ? 'Snag' : 'Snags'})</span>
        </button>
      </div>
    </div>
  );
}
