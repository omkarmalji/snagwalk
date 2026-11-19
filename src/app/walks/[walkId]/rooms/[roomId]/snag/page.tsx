'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { SeverityBadge, CategoryBadge } from '@/components/Badge';
import {
  Camera,
  Upload,
  Sparkles,
  Check,
  Edit2,
  Trash2,
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Save,
} from 'lucide-react';

interface Snag {
  id: string;
  walk_id: string;
  room_id: string;
  category: string;
  severity: string;
  description: string;
  location_note: string | null;
  photo_url: string;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: 'wall_paint', label: 'Wall Paint' },
  { value: 'tiles', label: 'Tiles' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'doors_windows', label: 'Doors & Windows' },
  { value: 'woodwork', label: 'Woodwork' },
  { value: 'ceiling', label: 'Ceiling' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'other', label: 'Other' },
];

const SEVERITIES = [
  { value: 'minor', label: 'Minor', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  { value: 'major', label: 'Major', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  { value: 'critical', label: 'Critical', color: 'bg-rose-100 text-rose-800 border-rose-300' },
];

export default function SnagCapturePage() {
  const params = useParams();
  const router = useRouter();
  const walkId = params.walkId as string;
  const roomId = params.roomId as string;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [roomName, setRoomName] = useState('Room');
  const [existingSnags, setExistingSnags] = useState<Snag[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Active snag being edited/saved
  const [editingSnag, setEditingSnag] = useState<{
    id?: string;
    photo_url: string;
    category: string;
    severity: string;
    description: string;
    location_note: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchRoomAndSnags();
  }, [roomId]);

  async function fetchRoomAndSnags() {
    try {
      // Fetch room name
      const walkRes = await fetch(`/api/walks/${walkId}`);
      if (walkRes.ok) {
        const walkData = await walkRes.json();
        const found = walkData.rooms?.find((r: any) => r.id === roomId);
        if (found) setRoomName(found.room_name || found.room_type || 'Room');
      }

      // Fetch existing snags in this room
      const snagsRes = await fetch(`/api/rooms/${roomId}/snags`);
      if (snagsRes.ok) {
        const snagsData = await snagsRes.json();
        setExistingSnags(snagsData.snags || []);
      }
    } catch (e) {
      console.error(e);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setEditingSnag(null);
    setStatusMessage(null);

    // Auto-trigger analysis immediately upon selecting photo
    processPhotoWithGemini(file);
  }

  async function processPhotoWithGemini(file: File) {
    setAnalyzing(true);
    setStatusMessage(null);

    try {
      const formData = new FormData();
      formData.append('photo', file);

      // Uploads to GCS gs://snagwalk-photos-515212, analyzes with Gemini Flash on Vertex AI, saves to snags table
      const res = await fetch(`/api/rooms/${roomId}/snags`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze photo');
      }

      // Show it with an edit option (Requirement 3)
      setEditingSnag({
        id: data.snag.id,
        photo_url: data.snag.photo_url,
        category: data.snag.category,
        severity: data.snag.severity,
        description: data.snag.description,
        location_note: data.snag.location_note || roomName,
      });

      setStatusMessage({
        text: 'Snag analyzed by Gemini Flash on Vertex AI. You can edit any details below.',
        type: 'success',
      });

      // Refresh snag list
      fetchRoomAndSnags();
    } catch (err: any) {
      setStatusMessage({
        text: err.message || 'Error uploading or analyzing photo.',
        type: 'error',
      });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSaveEditedSnag(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSnag || !editingSnag.id) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/snags/${editingSnag.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: editingSnag.category,
          severity: editingSnag.severity,
          description: editingSnag.description,
          location_note: editingSnag.location_note,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update snag');

      setStatusMessage({
        text: 'Snag verified and updated successfully in AlloyDB!',
        type: 'success',
      });

      // Clear current edit form and refresh
      setSelectedFile(null);
      setPreviewUrl(null);
      setEditingSnag(null);
      fetchRoomAndSnags();
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSnag(snagId: string) {
    if (!confirm('Are you sure you want to delete this snag?')) return;
    try {
      await fetch(`/api/snags/${snagId}`, { method: 'DELETE' });
      fetchRoomAndSnags();
    } catch (e) {
      console.error(e);
    }
  }

  function startEditingExisting(snag: Snag) {
    setEditingSnag({
      id: snag.id,
      photo_url: snag.photo_url,
      category: snag.category,
      severity: snag.severity,
      description: snag.description,
      location_note: snag.location_note || '',
    });
    setPreviewUrl(snag.photo_url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="flex flex-col flex-1 pb-16">
      <Header
        title="Snag Capture"
        backHref={`/walks/${walkId}`}
        subtitle={`Inspecting: ${roomName}`}
      />

      {/* Hidden file inputs for Camera and Gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Room Badge */}
      <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-300">Room</span>
        <span className="text-xs font-bold text-emerald-400">{roomName}</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Status Notification */}
        {statusMessage && (
          <div
            className={`p-3 rounded-xl text-xs font-medium flex items-start gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : 'bg-rose-50 text-rose-900 border border-rose-200'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Camera / Photo Trigger Buttons (Large Tap Targets) */}
        {!previewUrl && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-full h-20 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-2xl font-bold text-base shadow-lg shadow-emerald-700/20 flex items-center justify-center gap-3 transition"
            >
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <Camera className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <div className="leading-tight">Take Defect Photo</div>
                <div className="text-xs text-emerald-100 font-normal mt-0.5">
                  Opens camera instantly
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-14 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 border-2 border-dashed border-slate-300 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition"
            >
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Or Upload Photo from Library</span>
            </button>
          </div>
        )}

        {/* Loading / Vision Analysis State */}
        {analyzing && (
          <div className="bg-white rounded-2xl p-6 border border-emerald-200 shadow-md text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-emerald-600 animate-pulse" />
            </div>
            <h3 className="font-bold text-sm text-slate-900">
              Vertex AI Gemini Flash Analysis
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
              Uploading to <code className="text-slate-700">gs://snagwalk-photos-515212</code> and detecting category, severity, and civil defect details...
            </p>
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full w-2/3 animate-[pulse_1s_ease-in-out_infinite]" />
            </div>
          </div>
        )}

        {/* Snag Edit Form (Requirement 3: "save the JSON result to the snags table, and show it with an edit option") */}
        {editingSnag && !analyzing && (
          <form
            onSubmit={handleSaveEditedSnag}
            className="bg-white rounded-2xl p-4 border border-slate-200 shadow-md space-y-4"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Edit2 className="w-3.5 h-3.5 text-emerald-600" />
                Review & Edit Snag
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setPreviewUrl(null);
                  setEditingSnag(null);
                }}
                className="text-xs text-slate-500 hover:text-slate-800 font-medium"
              >
                Cancel
              </button>
            </div>

            {/* Photo Thumbnail */}
            {previewUrl && (
              <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-900 border border-slate-200">
                <img
                  src={previewUrl}
                  alt="Defect Preview"
                  className="w-full h-full object-contain"
                />
                <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono bg-black/60 text-white backdrop-blur-sm">
                  gs://snagwalk-photos-515212
                </span>
              </div>
            )}

            {/* Severity Selection (Large Touch Targets) */}
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1.5 block">
                Severity Level
              </label>
              <div className="grid grid-cols-3 gap-2">
                {SEVERITIES.map((s) => (
                  <button
                    type="button"
                    key={s.value}
                    onClick={() => setEditingSnag({ ...editingSnag, severity: s.value })}
                    className={`h-11 rounded-xl text-xs font-bold border transition ${
                      editingSnag.severity === s.value
                        ? `${s.color} ring-2 ring-offset-1 ring-slate-400 shadow-sm`
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Dropdown (Strict Guardrail Categories) */}
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1 block">
                Defect Category
              </label>
              <select
                value={editingSnag.category}
                onChange={(e) => setEditingSnag({ ...editingSnag, category: e.target.value })}
                className="w-full h-12 px-3 text-sm rounded-xl border border-slate-300 bg-slate-50 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Description Textarea */}
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1 block">
                Defect Description (Civil / Finish)
              </label>
              <textarea
                rows={3}
                required
                value={editingSnag.description}
                onChange={(e) => setEditingSnag({ ...editingSnag, description: e.target.value })}
                className="w-full p-3 text-sm rounded-xl border border-slate-300 bg-slate-50 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                placeholder="Describe the issue observed in the flat..."
              />
            </div>

            {/* Location Note Input */}
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1 block">
                Location in Room
              </label>
              <input
                type="text"
                value={editingSnag.location_note}
                onChange={(e) => setEditingSnag({ ...editingSnag, location_note: e.target.value })}
                className="w-full h-12 px-3 text-sm rounded-xl border border-slate-300 bg-slate-50 font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                placeholder="e.g. North wall next to switchboard, under sink..."
              />
            </div>

            {/* Primary Action Button (Large Touch Target) */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl font-bold text-base shadow-lg shadow-emerald-700/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {saving ? (
                  <span>Saving to AlloyDB...</span>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    <span>Confirm & Save Snag</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Existing Snags in This Room */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Logged Snags in {roomName} ({existingSnags.length})
            </h3>
            {previewUrl && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setPreviewUrl(null);
                  setEditingSnag(null);
                }}
                className="text-xs text-emerald-600 font-semibold"
              >
                + Capture Another
              </button>
            )}
          </div>

          {existingSnags.length === 0 ? (
            <div className="bg-white rounded-xl p-4 border border-dashed border-slate-200 text-center text-xs text-slate-400">
              No snags logged in this room yet. Take a photo above if defects are found.
            </div>
          ) : (
            <div className="space-y-3">
              {existingSnags.map((snag, idx) => (
                <div
                  key={snag.id}
                  className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm flex gap-3 items-start"
                >
                  <img
                    src={snag.photo_url}
                    alt="Snag photo"
                    className="w-16 h-16 rounded-lg object-cover bg-slate-100 shrink-0 border border-slate-200"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <SeverityBadge severity={snag.severity} />
                      <CategoryBadge category={snag.category} />
                    </div>
                    <p className="text-xs text-slate-800 font-medium mt-1 line-clamp-2">
                      {snag.description}
                    </p>
                    {snag.location_note && (
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                        📍 {snag.location_note}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditingExisting(snag)}
                      className="p-1.5 text-slate-500 hover:text-emerald-600 active:bg-slate-100 rounded"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSnag(snag.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 active:bg-slate-100 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Back Button */}
        <div className="pt-4">
          <button
            type="button"
            onClick={() => router.push(`/walks/${walkId}`)}
            className="w-full h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Done with this Room • Back to Walk</span>
          </button>
        </div>
      </div>
    </div>
  );
}
