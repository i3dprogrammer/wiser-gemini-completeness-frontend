// src/App.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import type { Job, Progress, JobStats } from './lib/api';
import {
  Pause,
  Play,
  FileDown,
  XCircle,
  Trash2,
  ChevronsUp,
  MoreVertical,
  Check,
  X,
  Info,
  RotateCcw,
  ArrowUpDown,
  BarChart3,
} from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';
import clsx from 'clsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/* ----------------------------- Helpers/Types ----------------------------- */

type ValidateSummary = {
  sizeBytes: number;
  total: number;
  valid: number;
  invalid: number;
  invalidSamples: string[];
  uniqueRefKeys: string[];
};
type InsertWhere = { mode: 'top' } | { mode: 'priority'; priority: number };
const STATUS_LIST = [
  'queued',
  'running',
  'pausing',
  'paused',
  'completed',
  'failed',
  'canceled',
] as const;
type StatusKey = (typeof STATUS_LIST)[number];

const LS_OWNERS = 'ownerFilter';
const LS_STATUSES = 'statusFilter';
const LS_PRIOS = 'prioFilter';
const LS_HIDE_COMPLETED = 'hideCompletedJobs';
const LS_MAP_HISTORY = 'mapping_history_v1';
const LS_PAGE_SIZE = 'jobsPageSize';

type SortKey = 'manual' | 'name' | 'created_at' | 'status' | 'priority';
type SortDir = 'asc' | 'desc';

/* ---------------------------- Toasts (simple) ---------------------------- */

type Toast = { id: string; type: 'success' | 'error' | 'info'; title: string; detail?: string };
const Toasts: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({
  toasts,
  onDismiss,
}) => (
  <div className="fixed top-3 right-3 z-50 space-y-2">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={clsx(
          'min-w-[260px] max-w-[420px] rounded-lg border shadow-soft px-3 py-2 text-sm',
          t.type === 'success' &&
            'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-100',
          t.type === 'error' &&
            'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-100',
          t.type === 'info' &&
            'bg-slate-50 border-slate-200 text-slate-900 dark:bg-slate-900/60 dark:border-slate-800 dark:text-slate-100'
        )}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5">
            {t.type === 'success' ? (
              <Check size={16} />
            ) : t.type === 'error' ? (
              <X size={16} />
            ) : (
              <Info size={16} />
            )}
          </div>
          <div className="flex-1">
            <div className="font-medium">{t.title}</div>
            {!!t.detail && <div className="text-xs opacity-80 whitespace-pre-wrap">{t.detail}</div>}
          </div>
          <button
            className="text-xs underline opacity-70 hover:opacity-100"
            onClick={() => onDismiss(t.id)}
          >
            Dismiss
          </button>
        </div>
      </div>
    ))}
  </div>
);

/* ----------------------------- Confirm Modal ----------------------------- */

function ConfirmModal({
  open,
  title,
  body,
  requireText = 'confirm',
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
  requireText?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [val, setVal] = React.useState('');
  React.useEffect(() => {
    if (open) setVal('');
  }, [open]);
  if (!open) return null;
  const ok = val.trim().toLowerCase() === requireText.toLowerCase();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,520px)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl">
        <div className="text-lg font-semibold mb-1">{title}</div>
        {!!body && (
          <div className="text-sm text-slate-600 dark:text-slate-300 mb-3 whitespace-pre-wrap">
            {body}
          </div>
        )}
        <div className="text-xs mb-2 text-slate-500">
          Type{' '}
          <span className="font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            confirm
          </span>{' '}
          to continue
        </div>
        <input
          className="input w-full mb-4"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={clsx(
              'btn',
              ok
                ? 'bg-brand-600 text-white border-transparent hover:bg-brand-700'
                : 'opacity-50 cursor-not-allowed'
            )}
            onClick={ok ? onConfirm : undefined}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameJobDialog({
  open,
  job,
  existingNames,
  onClose,
  onSubmit,
}: {
  open: boolean;
  job: Job | null;
  existingNames: Set<string>;
  onClose: () => void;
  onSubmit: (jobId: string, nextName: string) => Promise<void>;
}) {
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open && job) {
      setValue(job.name);
      setSubmitError(null);
    }
  }, [open, job]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open || !job) return null;

  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  const originalNormalized = job.name.trim().toLowerCase();

  let validation: string | null = null;
  if (!trimmed) validation = 'Name is required';
  else if (trimmed === job.name.trim()) validation = 'Enter a different name';
  else if (existingNames.has(normalized) && normalized !== originalNormalized)
    validation = 'That name is already in use';

  const canSave = !validation && !saving;

  const handleSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!job || validation) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit(job.id, trimmed);
      onClose();
    } catch (err: any) {
      setSubmitError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <form
        className="relative z-10 w-[min(92vw,420px)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl space-y-3"
        onSubmit={handleSubmit}
      >
        <div className="text-lg font-semibold">Rename job</div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="rename-job-input">
            New name
          </label>
          <input
            id="rename-job-input"
            className="input w-full"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            autoFocus
          />
          {(validation || submitError) && (
            <div className="text-sm text-rose-600 dark:text-rose-400">
              {submitError || validation}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            onClick={saving ? undefined : onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={clsx(
              'btn',
              canSave
                ? 'bg-brand-600 text-white border-transparent hover:bg-brand-700'
                : 'opacity-50 cursor-not-allowed'
            )}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
/* ----------------------------- Data Fetching ----------------------------- */

function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(false, ''),
    refetchInterval: 5000,
  });
}

/* ---------------------------------- App --------------------------------- */

export default function App() {
  const qc = useQueryClient();
  const { data: jobs = [], isFetching } = useJobs();

  // Filters (persisted)
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusKey[]>([]);
  const [prioFilter, setPrioFilter] = useState<number[]>([]);
  const [hideCompleted, setHideCompleted] = useState(false);
  // Free search (not persisted)
  const [q, setQ] = useState('');

  useEffect(() => {
    try {
      const o = JSON.parse(localStorage.getItem(LS_OWNERS) || '[]');
      const s = JSON.parse(localStorage.getItem(LS_STATUSES) || '[]');
      const p = JSON.parse(localStorage.getItem(LS_PRIOS) || '[]');
      const hide = localStorage.getItem(LS_HIDE_COMPLETED);
      setOwnerFilter(Array.isArray(o) ? o : []);
      setStatusFilter(Array.isArray(s) ? s : []);
      setPrioFilter(Array.isArray(p) ? p : []);
      setHideCompleted(hide === '1' || hide === 'true');
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_OWNERS, JSON.stringify(ownerFilter));
    } catch {}
  }, [ownerFilter]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_STATUSES, JSON.stringify(statusFilter));
    } catch {}
  }, [statusFilter]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_PRIOS, JSON.stringify(prioFilter));
    } catch {}
  }, [prioFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_HIDE_COMPLETED, hideCompleted ? '1' : '0');
    } catch {}
  }, [hideCompleted]);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const toast: Toast = { id, ...t };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  };

  const [announcement] = useState<string | null>(null);

  const [showModelStats, setShowModelStats] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />

      {/* Top bar */}
      <div className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-slate-950/70 border-b border-slate-200/60 dark:border-slate-800">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" className="h-6 w-6" />
            <div className="font-semibold">Gemini Based Completeness</div>
          </div>

          <div className="flex-1 flex justify-center">
            {announcement && (
              <div className="px-3 py-1 rounded-md border bg-slate-100 dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-sm">
                {announcement}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="container py-6 space-y-6">
        <UploadCard
          existingNames={useMemo(
            () => new Set(jobs.map((j) => j.name.trim().toLowerCase())),
            [jobs]
          )}
          onUploaded={async ({ job_id, insertWhere }) => {
            pushToast({ type: 'success', title: 'Task created' });
            await qc.invalidateQueries({ queryKey: ['jobs'] });
            if (insertWhere && job_id) {
              if (insertWhere.mode === 'top') {
                const all = (await qc.getQueryData<Job[]>(['jobs'])) || [];
                const currentOrder = all.map((j) => j.id);
                const idx = currentOrder.indexOf(job_id);
                if (idx !== -1) {
                  const nextOrder = currentOrder.slice();
                  nextOrder.splice(idx, 1);
                  nextOrder.unshift(job_id);
                  try {
                    await api.reorder(nextOrder);
                    pushToast({ type: 'success', title: 'Moved to top' });
                  } catch (e: any) {
                    pushToast({
                      type: 'error',
                      title: 'Failed to move to top',
                      detail: String(e?.message || e),
                    });
                  }
                  await qc.invalidateQueries({ queryKey: ['jobs'] });
                }
              }
              // if mode is 'priority', backend should pick it up from upload payload
            }
          }}
          pushToast={pushToast}
          onOpenModelStats={() => setShowModelStats(true)}
        />

        <QueueTable
          jobs={jobs}
          isFetching={isFetching}
          q={q}
          setQ={setQ}
          ownerFilter={ownerFilter}
          setOwnerFilter={setOwnerFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          prioFilter={prioFilter}
          setPrioFilter={setPrioFilter}
          hideCompleted={hideCompleted}
          setHideCompleted={setHideCompleted}
          pushToast={pushToast}
          onReorder={async (ids) => {
            try {
              await api.reorder(ids);
              pushToast({ type: 'success', title: 'Order saved' });
            } catch (e: any) {
              pushToast({
                type: 'error',
                title: 'Failed to save order',
                detail: String(e?.message || e),
              });
            }
          }}
          onPause={async (id) => {
            try {
              await api.pause(id);
              pushToast({ type: 'success', title: 'Paused' });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Pause failed', detail: String(e?.message || e) });
            }
          }}
          onResume={async (id) => {
            try {
              await api.resume(id);
              pushToast({ type: 'success', title: 'Resumed' });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Resume failed', detail: String(e?.message || e) });
            }
          }}
          onExport={async (id) => {
            try {
              const { export_id } = await api.export(id);
              pushToast({ type: 'info', title: 'Export started' });
              const timer = setInterval(async () => {
                try {
                  const st = await api.exportStatus(export_id);
                  if (st.status === 'ready') {
                    clearInterval(timer);
                    pushToast({ type: 'success', title: 'Export ready' });
                    window.location.href = api.exportDownloadUrl(export_id);
                  } else if (st.status === 'failed' || st.status === 'expired') {
                    clearInterval(timer);
                    pushToast({ type: 'error', title: `Export ${st.status}` });
                  }
                } catch (e: any) {
                  clearInterval(timer);
                  pushToast({
                    type: 'error',
                    title: 'Export failed',
                    detail: String(e?.message || e),
                  });
                }
              }, 3000);
            } catch (e: any) {
              pushToast({
                type: 'error',
                title: 'Export failed to start',
                detail: String(e?.message || e),
              });
            }
          }}
          onCancel={async (id) => {
            try {
              await api.cancel(id);
              pushToast({ type: 'success', title: 'Canceled' });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Cancel failed', detail: String(e?.message || e) });
            }
          }}
          onDelete={async (id) => {
            try {
              await api.delete(id);
              pushToast({ type: 'success', title: 'Deleted' });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Delete failed', detail: String(e?.message || e) });
            }
          }}
          onReset={async (id) => {
            try {
              await api.reset(id);
              pushToast({ type: 'success', title: 'Job reset' });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Reset failed', detail: String(e?.message || e) });
            }
          }}
          onResetFailed={async (id) => {
            try {
              await api.resetFailed(id);
              pushToast({ type: 'success', title: 'Failed tasks resetted' });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Reset failed', detail: String(e?.message || e) });
            }
          }}
          onRename={async (id, name) => {
            try {
              await api.renameJob(id, name);
              pushToast({ type: 'success', title: 'Name updated' });
              await qc.invalidateQueries({ queryKey: ['jobs'] });
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Rename failed', detail: String(e?.message || e) });
              throw e;
            }
          }}
        />
      </div>

      <footer className="container my-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Gemini Based Completeness
      </footer>

      <ModelStatsModal open={showModelStats} onClose={() => setShowModelStats(false)} />
    </div>
  );
}

function ModelStatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [data, setData] = React.useState<any>(null);

  // ⏱️ countdown to next 00:00 America/Los_Angeles
  const [resetIn, setResetIn] = React.useState<string>('--:--');
  React.useEffect(() => {
    if (!open) return;

    const tz = 'America/Los_Angeles';
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const calc = () => {
      // get LA time parts without converting dates
      const parts = fmt.formatToParts(new Date());
      const get = (t: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((p) => p.type === t)?.value ?? '0');
      const h = get('hour');
      const m = get('minute');
      const s = get('second');

      const elapsed = h * 3600 + m * 60 + s;
      const left = Math.max(0, 24 * 3600 - elapsed); // seconds until 24:00 LA time
      const hh = String(Math.floor(left / 3600)).padStart(2, '0');
      const mm = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
      setResetIn(`${hh}:${mm}`);
    };

    calc();
    const id = setInterval(calc, 30_000); // update every 30s; cheap and smooth
    return () => clearInterval(id);
  }, [open]);

  React.useEffect(() => {
    let alive = true;
    if (!open) return;
    setData(null);
    setErr(null);
    setLoading(true);
    (async () => {
      try {
        const d = await api.getModelStats();
        if (alive) setData(d);
      } catch (e: any) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  const L = ({
    k,
    v,
    mono = false,
    strong = false,
  }: {
    k: string;
    v: any;
    mono?: boolean;
    strong?: boolean;
  }) => (
    <div className="grid grid-cols-[240px_1fr] gap-2 items-start">
      <div className="text-sm text-slate-500">{k}</div>
      <div className={clsx('text-sm', mono && 'font-mono break-all', strong && 'font-semibold')}>
        {v ?? '–'}
      </div>
    </div>
  );

  const fmtNum = (n: any) => n?.toLocaleString?.() ?? n;
  const fmtUsd = (value: number | null | undefined) =>
    typeof value === 'number'
      ? value.toLocaleString(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })
      : '--';

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,920px)] max-h-[86vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Model Stats</div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <div className="text-sm text-slate-500">Loading…</div>}
        {err && <div className="text-sm text-rose-600">Error: {err}</div>}

        {!!data && (
          <div className="space-y-3">
            <div className="rounded-md border p-3 bg-slate-50 dark:bg-slate-900/50">
              <L k="Model name" v={data.model_name} strong />
              <L k="Total Requests" v={fmtNum(data.total_requests)} />
              <L k="Total Cost (USD)" v={fmtUsd(data.total_cost)} />
              <L
                k="Today's Requests"
                v={
                  <span className="font-mono">
                    {fmtNum(data.today_requests)} / {fmtNum(100000)}{' '}
                    <span className="text-slate-500">(resets in {resetIn})</span>
                  </span>
                }
              />
              <L
                k="Today's Cost (USD)"
                v={
                  <span className="font-mono">
                    {fmtUsd(data.today_cost)}{' '}
                    <span className="text-slate-500">(resets in {resetIn})</span>
                  </span>
                }
              />
            </div>

            <div className="rounded-md border p-3 space-y-2">
              <div>
                <div className="text-sm text-slate-500 mb-1">Google Agent prompt</div>
                <textarea className="input h-36" value={data.google_agent_prompt || ''} readOnly />
              </div>
              <div>
                <div className="text-sm text-slate-500 mb-1">Polaris Agent prompt</div>
                <textarea className="input h-36" value={data.polaris_agent_prompt || ''} readOnly />
              </div>
              <div>
                <div className="text-sm text-slate-500 mb-1">Image Agent prompt</div>
                <textarea className="input h-36" value={data.image_agent_prompt || ''} readOnly />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------- UploadCard ------------------------------ */

// --- REPLACE JUST THE UploadCard COMPONENT BELOW IN YOUR FILE ---

function UploadCard({
  onUploaded,
  existingNames,
  pushToast,
  onOpenModelStats,
}: {
  onUploaded: (r: { job_id?: string; insertWhere?: InsertWhere }) => void;
  existingNames: Set<string>;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  onOpenModelStats: () => void;
}) {
  type FileEntry = {
    id: string;
    file: File;
    taskName: string; // editable per-file
    summary: ValidateSummary | null; // filled after parse
  };

  const [files, setFiles] = React.useState<FileEntry[]>([]);

  // NEW: queue mode — 'top' or 'priority'
  const [queueMode, setQueueMode] = useState<'top' | 'priority'>('priority');
  const [priority, setPriority] = useState<number>(5);

  const [prompt, setPrompt] = useState('');
  const [validate, setValidate] = useState(false);
  const [validateGoogleMatches, setValidateGoogleMatches] = useState(false);
  const [allowMultipleFoundURLs, setAllowMultipleFoundURLs] = useState(false);
  const [skipGoogleSearch, setSkipGoogleSearch] = useState(false);
  const [busy, setBusy] = useState(false);

  // Mapping (union of keys across all files) + history
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const dragActive = dragDepth > 0;

  const loadHistory = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(LS_MAP_HISTORY) || '{}');
    } catch {
      return {};
    }
  };
  const saveHistory = (next: Record<string, string>) => {
    try {
      localStorage.setItem(LS_MAP_HISTORY, JSON.stringify(next));
    } catch {}
  };

  // Helper: parse a single file -> ValidateSummary
  const parseOne = async (f: File): Promise<ValidateSummary> => {
    try {
      const text = await f.text();
      const lines: any[] = [];
      let parsed: any = null;
      const nonEmpty = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      let jsonlOk = true;
      for (const l of nonEmpty) {
        try {
          parsed = JSON.parse(l);
        } catch {
          jsonlOk = false;
          break;
        }
        lines.push(parsed);
      }
      if (!jsonlOk) {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) lines.push(...obj);
        else lines.push(obj);
      }

      let valid = 0,
        invalid = 0;
      const invalidSamples: string[] = [];
      const keySet = new Set<string>();
      let lineNum = 0;
      for (const o of lines) {
        lineNum++;
        const ref = o?.referenceProduct?.referenceAttributes;
        const tgt = o?.targetMerchant?.targetName || o?.targetMerchant?.targetHomepage;
        const hasKeys = ref && typeof ref === 'object' && Object.keys(ref).length > 0;
        const hasTarget = typeof tgt === 'string' && tgt.trim().length > 0;
        if (hasKeys && hasTarget) {
          valid++;
          Object.keys(ref).forEach((k) => keySet.add(k));
        } else {
          invalid++;
          if (invalidSamples.length < 5) {
            const reason = !hasKeys
              ? 'Missing referenceAttributes keys [line ' + lineNum + ']'
              : 'Missing targetName/homepage [line ' + lineNum + ']';
            invalidSamples.push(reason);
          }
        }
      }

      return {
        sizeBytes: f.size,
        total: lines.length,
        valid,
        invalid,
        invalidSamples,
        uniqueRefKeys: Array.from(keySet).sort(),
      };
    } catch {
      return {
        sizeBytes: f.size,
        total: 0,
        valid: 0,
        invalid: 1,
        invalidSamples: ['File parse error'],
        uniqueRefKeys: [],
      };
    }
  };

  // Add files (from input, drop, or paste). Dedup by name+size+lastModified to avoid obvious dupes.
  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    const ok = arr.filter((f) => /\.(jsonl|json|txt|jsonb|ndjson)$/i.test(f.name));
    const dedupeKey = (f: File) => `${f.name}__${f.size}__${(f as any).lastModified || 0}`;
    const existingKeys = new Set(files.map((e) => dedupeKey(e.file)));
    const toAdd = ok.filter((f) => !existingKeys.has(dedupeKey(f)));
    if (toAdd.length === 0) return;

    // seed entries with filename as default taskName (trim extension)
    const entries: FileEntry[] = toAdd.map((f) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file: f,
      taskName: f.name.replace(/\.[^.]+$/, ''),
      summary: null,
    }));

    setFiles((prev) => [...prev, ...entries]);

    // parse newly added files
    (async () => {
      const parsedEntries = await Promise.all(
        entries.map(async (e) => ({ ...e, summary: await parseOne(e.file) }))
      );
      setFiles((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p] as const));
        parsedEntries.forEach((u) => byId.set(u.id, u));
        const next = Array.from(byId.values());
        return next;
      });

      // rebuild union mapping keys from all files, honoring history defaults
      const union = new Set<string>();
      parsedEntries.forEach((e) => e.summary?.uniqueRefKeys.forEach((k) => union.add(k)));
      files.forEach((e) => e.summary?.uniqueRefKeys.forEach((k) => union.add(k)));
      const hist = loadHistory();
      const nextMap: Record<string, string> = {};
      Array.from(union)
        .sort()
        .forEach((k) => (nextMap[k] = typeof hist[k] === 'string' && hist[k] ? hist[k] : k));
      setMapping(nextMap);
    })();
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((e) => e.id !== id));

  const updateTaskName = (id: string, name: string) =>
    setFiles((prev) => prev.map((e) => (e.id === id ? { ...e, taskName: name } : e)));

  // Validation gates
  const anyNameTaken = React.useMemo(() => {
    return files.some((e) => {
      const n = e.taskName.trim().toLowerCase();
      return !!n && existingNames.has(n);
    });
  }, [files, existingNames]);

  const allSummarized = files.length > 0 && files.every((e) => e.summary !== null);
  const allValid =
    allSummarized &&
    files.every((e) => {
      const s = e.summary!;
      return s.valid > 0 && s.invalid === 0;
    });

  const canUpload = files.length > 0 && allValid && !anyNameTaken && !busy;

  // Upload sequentially (one job per file)
  const doUploadAll = async () => {
    if (!canUpload) return;
    setBusy(true);
    try {
      const hist = loadHistory();
      const mergedHistory = { ...hist, ...mapping };
      saveHistory(mergedHistory);

      for (const entry of files) {
        const fd = new FormData();
        const name = entry.taskName.trim() || entry.file.name.replace(/\.[^.]+$/, '');
        fd.set('name', name);
        fd.set('additional_prompt', prompt);
        fd.set('validate_images', String(validate));
        fd.set('validate_google_matches_via_polaris', String(validateGoogleMatches));
        fd.set('allow_multiple_found_urls', String(allowMultipleFoundURLs));
        fd.set('skip_google_search', String(skipGoogleSearch));
        fd.set('worker_concurrency', String(50));
        fd.set('file', entry.file);
        fd.set('mapping', JSON.stringify(mapping));
        if (queueMode === 'priority') fd.set('priority', String(priority));
        if (queueMode === 'top') fd.set('priority', String(1));

        try {
          const result = await api.upload(fd);
          onUploaded({
            job_id: result?.job_id,
            insertWhere: queueMode === 'top' ? { mode: 'top' } : { mode: 'priority', priority },
          });
          pushToast({ type: 'success', title: `Created: ${name}` });
        } catch (e: any) {
          pushToast({
            type: 'error',
            title: `Upload failed: ${name}`,
            detail: String(e?.message || e),
          });
        }
      }

      // reset after attempting all
      setFiles([]);
      setPrompt('');
      setValidate(false);
      setValidateGoogleMatches(false);
      setAllowMultipleFoundURLs(false);
      setSkipGoogleSearch(false);
      setMapping({});
      setQueueMode('priority');
      setPriority(5);
    } finally {
      setBusy(false);
    }
  };

  const onMappingBlur = (k: string, v: string) => {
    const hist = loadHistory();
    hist[k] = v || k;
    saveHistory(hist);
  };

  // UI helpers
  const totalBytes = files.reduce((a, e) => a + (e.summary?.sizeBytes || e.file.size || 0), 0);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Create Tasks</h2>

        <button
          className="px-3 py-1 rounded border text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={onOpenModelStats}
        >
          Stats
        </button>
      </div>

      {/* Queue placement + Workers */}
      <div className="grid gap-3 mt-3 sm:grid-cols-3">
        <div>
          <label className="block text-sm mb-1">Queue Placement</label>
          <select
            className="input w-full"
            value={queueMode}
            onChange={(e) => setQueueMode(e.target.value as any)}
          >
            <option value="top">Top of Queue</option>
            <option value="priority">Priority</option>
          </select>
        </div>

        {queueMode === 'priority' && (
          <div>
            <label className="block text-sm mb-1">Priority</label>
            <select
              className="input w-full"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value || '5', 10))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  P{n}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm mb-1">Workers</label>
          <input className="input w-full" value={50} readOnly />
          <span className="text-xs text-slate-500 mt-1">Fixed to 50</span>
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-sm mb-1">Additional prompt (optional)</label>
        <textarea
          className="input h-24"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={validate}
              onChange={(e) => setValidate(e.target.checked)}
            />
            <span>Validate Images</span>
          </label>
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600/40 focus:ring-offset-1 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
            title="Enabling this will validate if found product image matches reference product image. This requires a reference product image to be find and a match product image to be found. Do note that this WILL not throw away results, it just adds another column called 'Images match' with whether the product images match or not but we're still getting all matches"
            aria-label="Enabling this will validate if found product image matches reference product image. This requires a reference product image to be find and a match product image to be found. Do note that this WILL not throw away results, it just adds another column called 'Images match' with whether the product images match or not but we're still getting all matches"
          >
            <Info size={14} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={validateGoogleMatches}
              onChange={(e) => setValidateGoogleMatches(e.target.checked)}
            />
            <span>Validate Google Matches</span>
          </label>
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600/40 focus:ring-offset-1 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
            title="Enabling this will validate if found product URLs via Google Search return any vital product information when passed to Polaris monitoring. This is going to slow workers down due to validating results, but it's good if you're finding a lot of invalid URLs via Google Search. Do note this will change 'Found Result' from True to False but it will keep invalidated URLs in the export. If Polaris is experiencing high blocking or high error rate for a certain domain enabling this can throw away valid matches"
            aria-label="Enabling this will validate if found product URLs via Google Search return any vital product information when passed to Polaris monitoring. This is going to slow workers down due to validating results, but it's good if you're finding a lot of invalid URLs via Google Search. Do note this will change 'Found Result' from True to False but it will keep invalidated URLs in the export. If Polaris is experiencing high blocking or high error rate for a certain domain enabling this can throw away valid matches"
          >
            <Info size={14} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              disabled={true}
              checked={allowMultipleFoundURLs}
              onChange={(e) => setAllowMultipleFoundURLs(e.target.checked)}
            />
            <span>Allow multiple found URLs</span>
          </label>
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600/40 focus:ring-offset-1 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
            title="Enabling this will allow multiple Found URLs in the export. FoundURL1, FoundURL2, FoundURL3, etc... This doesn't slow down the jobs, but usually results after first one is inaccurate use with caution."
            aria-label="Enabling this will allow multiple Found URLs in the export. FoundURL1, FoundURL2, FoundURL3, etc... This doesn't slow down the jobs, but usually results after first one is inaccurate use with caution."
          >
            <Info size={14} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox"
              checked={skipGoogleSearch}
              onChange={(e) => setSkipGoogleSearch(e.target.checked)}
            />
            <span>Skip Google Search</span>
          </label>
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600/40 focus:ring-offset-1 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
            title="Enabling this will skip Google Search agent and go directly to Polaris Domain Search. Useful if Google Search is finding bad/oos matches"
            aria-label="Enabling this will skip Google Search agent and go directly to Polaris Domain Search. Useful if Google Search is finding bad/oos matches"
          >
            <Info size={14} />
          </span>
        </div>
      </div>

      {/* File drop/select */}
      <div className="mt-3">
        <label className="block text-sm mb-1">
          Input files (.jsonl / .json / .txt / .jsonb / .ndjson)
        </label>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragDepth((d) => d + 1);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragDepth((d) => Math.max(0, d - 1));
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragDepth(0);
            const dt = e.dataTransfer;
            if (!dt?.files?.length) return;
            addFiles(dt.files);
          }}
          onPaste={(e) => {
            const list = e.clipboardData.files;
            if (list && list.length) addFiles(list);
          }}
          className={clsx(
            'rounded-lg border-2 border-dashed p-4 text-center cursor-pointer select-none',
            'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700',
            dragActive && 'border-brand-600 bg-brand-50/60 dark:bg-brand-950/30'
          )}
          title="Drop files here or click to browse"
        >
          {files.length ? (
            <div className="space-y-1">
              <div className="font-medium">{files.length} file(s) selected</div>
              <div className="text-xs text-slate-500">
                {(totalBytes / 1024).toFixed(1)} KB — click to add more, or drop more files
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="font-medium">Drop files here</div>
              <div className="text-xs text-slate-500">…or click to choose from your device</div>
            </div>
          )}
        </div>

        {/* Hidden real input for click-browse */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jsonl,.json,.txt,.ndjson,.jsonb,application/json,text/plain"
          className="hidden"
          onChange={(e) => {
            const list = e.target.files;
            if (list && list.length) addFiles(list);
            // reset value to allow re-selecting the same files later
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {/* Files table with per-file stats + editable job name */}
      {files.length > 0 && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-2">Selected Files</h3>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full table min-w-[860px]">
              <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                <tr>
                  <th className="w-[28ch]">Job name</th>
                  <th className="w-[28ch]">Filename</th>
                  <th className="w-28">Size</th>
                  <th className="w-24">Rows</th>
                  <th className="w-24 text-emerald-700 dark:text-emerald-400">Valid</th>
                  <th className="w-24 text-rose-600 dark:text-rose-400">Invalid</th>
                  <th>Notes</th>
                  <th className="w-16">Remove</th>
                </tr>
              </thead>
              <tbody>
                {files.map((e) => {
                  const s = e.summary;
                  const nameTaken = (() => {
                    const n = e.taskName.trim().toLowerCase();
                    return !!n && existingNames.has(n);
                  })();
                  return (
                    <tr key={e.id}>
                      <td className="align-top">
                        <input
                          className={clsx(
                            'input w-full',
                            nameTaken && 'border-rose-400 focus:ring-rose-300'
                          )}
                          value={e.taskName}
                          onChange={(ev) => updateTaskName(e.id, ev.target.value)}
                          placeholder="Job name"
                          title={nameTaken ? 'A task with this name already exists.' : ''}
                        />
                        {nameTaken && (
                          <div className="text-xs text-rose-600 mt-1">Name already exists.</div>
                        )}
                      </td>
                      <td className="text-slate-500 align-top break-words">{e.file.name}</td>
                      <td className="text-slate-500 align-top">
                        {((s?.sizeBytes ?? e.file.size) / 1024).toFixed(1)} KB
                      </td>
                      <td className="align-top">{s ? s.total : '…'}</td>
                      <td className="align-top">{s ? s.valid : '…'}</td>
                      <td className="align-top">{s ? s.invalid : '…'}</td>
                      <td className="text-xs text-slate-500 align-top">
                        {s && s.invalid > 0 && s.invalidSamples?.length
                          ? `Ex: ${s.invalidSamples.join(', ')}`
                          : ''}
                      </td>
                      <td className="align-top">
                        <button
                          className="px-2 py-1 rounded border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                          onClick={() => removeFile(e.id)}
                          aria-label={`Remove ${e.file.name}`}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            You can edit job names per file. Duplicate names will be flagged.
          </div>
        </div>
      )}

      {/* Mapping preview (union) */}
      {files.length > 0 && !!Object.keys(mapping).length && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-2">Reference Key Mapping (all files)</h3>
          <div className="border rounded-lg">
            <div className="overflow-x-auto">
              <div className="max-h=[60vh] md:max-h-[420px] overflow-y-auto">
                <table className="w-full table min-w-[720px]">
                  <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                    <tr>
                      <th className="w-1/2">Key</th>
                      <th className="w-1/2">Mapped name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(mapping).map(([k, v]) => (
                      <tr key={k}>
                        <td className="text-slate-500 align-top break-words max-w-[40ch]">{k}</td>
                        <td className="align-top">
                          <input
                            className="input w-full"
                            value={v}
                            onChange={(e) =>
                              setMapping((m) => ({ ...m, [k]: e.target.value || k }))
                            }
                            onBlur={(e) => onMappingBlur(k, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Header is sticky; scroll to see all keys.
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          disabled={!canUpload}
          className={clsx(
            'btn',
            canUpload
              ? 'bg-brand-600 hover:bg-brand-700 text-white border-transparent'
              : 'opacity-50 cursor-not-allowed'
          )}
          onClick={async () => {
            try {
              await doUploadAll();
            } catch (e: any) {
              pushToast({ type: 'error', title: 'Upload failed', detail: String(e?.message || e) });
            }
          }}
        >
          Upload {files.length ? `(${files.length})` : ''} & Create Task(s)
        </button>
        {files.length > 0 && (
          <button
            className="btn"
            onClick={() => {
              setFiles([]);
              setMapping({});
            }}
            disabled={busy}
            title="Clear selected files"
          >
            Clear files
          </button>
        )}
      </div>
    </div>
  );
}

// --- No changes required below this line in your file. Keep Stat() as-is. ---

// function Stat({ label, value, className }: { label: string; value: any; className?: string }) {
//   return (
//     <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60">
//       <div className="text-xs text-slate-500">{label}</div>
//       <div className={clsx('text-sm font-semibold', className)}>{value}</div>
//     </div>
//   );
// }

/* ----------------------------- Draggable Row ----------------------------- */

function DraggableRow({
  id,
  hueClass,
  dndEnabled,
  children,
}: {
  id: string;
  hueClass: string;
  dndEnabled: boolean;
  children: (dragListeners: any) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled: !dndEnabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <tr ref={setNodeRef} style={style} {...(dndEnabled ? attributes : {})} className={hueClass}>
      {children(dndEnabled ? listeners : {})}
    </tr>
  ) as any;
}

/* ------------------------------- QueueTable ------------------------------ */

function QueueTable({
  jobs,
  isFetching,
  q,
  setQ,
  ownerFilter,
  setOwnerFilter,
  statusFilter,
  setStatusFilter,
  prioFilter,
  setPrioFilter,
  hideCompleted,
  setHideCompleted,
  onReorder,
  onPause,
  onResume,
  onExport,
  onCancel,
  onDelete,
  onReset,
  onResetFailed,
  onRename,
  pushToast,
}: {
  jobs: Job[];
  isFetching: boolean;
  q: string;
  setQ: React.Dispatch<React.SetStateAction<string>>;
  ownerFilter: string[];
  setOwnerFilter: React.Dispatch<React.SetStateAction<string[]>>;
  statusFilter: StatusKey[];
  setStatusFilter: React.Dispatch<React.SetStateAction<StatusKey[]>>;
  prioFilter: number[];
  setPrioFilter: React.Dispatch<React.SetStateAction<number[]>>;
  hideCompleted: boolean;
  setHideCompleted: React.Dispatch<React.SetStateAction<boolean>>;
  onReorder: (ids: string[]) => Promise<void>;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReset: (id: string) => Promise<void>;
  onResetFailed: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  pushToast: (t: Omit<Toast, 'id'>) => void;
}) {
  // pagination (persist page size)
  const initialPageSize = (() => {
    const saved = localStorage.getItem(LS_PAGE_SIZE);
    const n = saved ? parseInt(saved, 10) : 25;
    return [10, 25, 50].includes(n) ? n : 25;
  })();
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [page, setPage] = useState<number>(1);
  useEffect(() => {
    try {
      localStorage.setItem(LS_PAGE_SIZE, String(pageSize));
    } catch {}
  }, [pageSize]);
  useEffect(() => setPage(1), [q, ownerFilter, statusFilter, prioFilter, hideCompleted]);

  const [prioOverrides, setPrioOverrides] = useState<Record<string, number>>({});
  const getPrio = (j: Job) => (j.id in prioOverrides ? prioOverrides[j.id] : (j.priority ?? 5));

  const formatLocal = (iso?: string | null) => {
    if (!iso) return '–';
    const d = new Date(iso);
    const pad = (n: number) => (n < 10 ? '0' : '') + n;
    const dd = pad(d.getDate());
    const mm = pad(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  };

  // sorting
  const [sortKey, setSortKey] = useState<SortKey>('manual');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const toggleSort = (key: SortKey) => {
    if (key === 'manual') {
      setSortKey('manual');
      return;
    }
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  };
  const isManual = sortKey === 'manual';
  const searchActive = q.trim().length > 0;
  const filtersApplied =
    ownerFilter.length > 0 || statusFilter.length > 0 || prioFilter.length > 0 || searchActive;
  const filtersActive = filtersApplied || hideCompleted;
  const manualReorderEnabled = isManual && !filtersActive;

  const ownerOptions = useMemo(() => Array.from(new Set(jobs.map((j) => j.owner))).sort(), [jobs]);
  const existingNameSet = useMemo(
    () => new Set(jobs.map((item) => item.name.trim().toLowerCase())),
    [jobs]
  );
  const [renameTarget, setRenameTarget] = useState<Job | null>(null);

  const [statsJob, setStatsJob] = useState<Job | null>(null);
  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const statsRequestSeq = useRef(0);

  const closeStatsModal = useCallback(() => {
    statsRequestSeq.current += 1;
    setStatsJob(null);
    setJobStats(null);
    setStatsError(null);
    setStatsLoading(false);
  }, []);

  const fetchJobStats = useCallback(async (jobId: string, resetData: boolean) => {
    const seq = ++statsRequestSeq.current;
    setStatsLoading(true);
    setStatsError(null);
    if (resetData) {
      setJobStats(null);
    }
    try {
      const res = await api.jobStats(jobId);
      if (statsRequestSeq.current === seq) {
        setJobStats(res);
      }
    } catch (err: any) {
      if (statsRequestSeq.current === seq) {
        setStatsError(String(err?.message || err));
      }
    } finally {
      if (statsRequestSeq.current === seq) {
        setStatsLoading(false);
      }
    }
  }, []);

  const statsJobId = statsJob?.id;

  useEffect(() => {
    if (!statsJobId) return;
    fetchJobStats(statsJobId, true);
  }, [statsJobId, fetchJobStats]);

  useEffect(() => {
    if (statsJob && !jobs.some((j) => j.id === statsJob.id)) {
      closeStatsModal();
    }
  }, [jobs, statsJob, closeStatsModal]);

  const retryStats = useCallback(() => {
    if (statsJobId) {
      fetchJobStats(statsJobId, false);
    }
  }, [fetchJobStats, statsJobId]);

  const handleShowStats = useCallback((job: Job) => {
    setStatsJob(job);
  }, []);
  // apply filters (but preserve original global order)
  const filteredAll = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const qParts = qn
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);

    return jobs.filter((j) => {
      const ownerOk = ownerFilter.length === 0 || ownerFilter.includes(j.owner);
      const statusOk = statusFilter.length === 0 || statusFilter.includes(j.status as StatusKey);
      const prioOk = prioFilter.length === 0 || prioFilter.includes(getPrio(j));
      const hideOk = !hideCompleted || j.status !== 'completed';

      const haystack = [
        j.name,
        j.owner,
        j.status,
        String(j.priority ?? ''),
        formatLocal(j.created_at),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const qOk = !qn || qParts.length === 0 || qParts.every((part) => haystack.includes(part));

      return ownerOk && statusOk && prioOk && hideOk && qOk;
    });
  }, [jobs, ownerFilter, statusFilter, prioFilter, q, hideCompleted]);

  const completedVisibleJobs = useMemo(
    () => filteredAll.filter((j) => j.status === 'completed').length,
    [filteredAll]
  );
  const pendingVisibleJobs = useMemo(
    () => filteredAll.filter((j) => j.status === 'queued' || j.status === 'running').length,
    [filteredAll]
  );

  const completedVisibleTasks = useMemo(
    () =>
      filteredAll.reduce(
        (sum, item) => sum + item.processed_rows + (item.error_rows ? item.error_rows : 0),
        0
      ),
    [filteredAll]
  );
  const pendingVisibleTasks = useMemo(
    () =>
      filteredAll.reduce(
        (sum, item) =>
          sum + (item.total_rows - (item.processed_rows + (item.error_rows ? item.error_rows : 0))),
        0
      ),
    [filteredAll]
  );

  // ordering state for manual drag
  const [rows, setRows] = useState<Job[]>(filteredAll);
  const [dirty, setDirty] = useState(false);
  const lastServerOrderRef = useRef<string[]>(filteredAll.map((j) => j.id));
  useEffect(() => {
    if (!dirty) {
      setRows(filteredAll);
      lastServerOrderRef.current = filteredAll.map((j) => j.id);
    } else {
      const byId = new Map(filteredAll.map((j) => [j.id, j]));
      setRows((prev) =>
        prev
          .filter((j) => byId.has(j.id))
          .map((j) => ({ ...j, ...byId.get(j.id)! }))
          .concat(filteredAll.filter((j) => !prev.some((p) => p.id === j.id)))
      );
    }
  }, [filteredAll, dirty]);

  // sorted base rows (manual uses current rows, others use sorted filteredAll)
  const baseRows: Job[] = useMemo(() => {
    if (isManual) return rows;
    const arr = [...filteredAll];
    const cmp = (a: Job, b: Job) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'name':
          av = a.name;
          bv = b.name;
          break;
        case 'created_at':
          av = a.created_at || '';
          bv = b.created_at || '';
          break;
        case 'status':
          av = a.status;
          bv = b.status;
          break;
        case 'priority':
          av = getPrio(a) ?? 99;
          bv = getPrio(b) ?? 99;
          break;
        default:
          av = 0;
          bv = 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      // tie-breaker by original order
      return jobs.findIndex((j) => j.id === a.id) - jobs.findIndex((j) => j.id === b.id);
    };
    arr.sort(cmp);
    return arr;
  }, [isManual, rows, filteredAll, sortKey, sortDir, jobs]);

  // page slice
  const pageCount = Math.max(1, Math.ceil(baseRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  const paged = baseRows.slice(start, end);

  // progress polling only running/pausing
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  useEffect(() => {
    let stop = false;
    let cursor = 0;
    const BATCH = 25;
    const tick = async () => {
      const idsAll = baseRows
        .filter((r) => ['running', 'pausing'].includes(r.status))
        .map((r) => r.id);
      if (!idsAll.length) {
        if (!stop) setProgressMap({});
        return;
      }
      if (cursor >= idsAll.length) cursor = 0;
      const slice = idsAll.slice(cursor, cursor + BATCH);
      cursor = (cursor + BATCH) % idsAll.length;
      const entries = await Promise.all(
        slice.map(async (id) => {
          try {
            return [id, await api.jobProgress(id)] as const;
          } catch {
            return [id, undefined] as const;
          }
        })
      );
      if (!stop) {
        setProgressMap((prev) => {
          const next = { ...prev };
          for (const [id, p] of entries) if (p) next[id] = p;
          for (const k of Object.keys(next)) {
            const row = baseRows.find((r) => r.id === k);
            if (!row || !['running', 'pausing'].includes(row.status)) delete next[k];
          }
          return next;
        });
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [baseRows]);

  // DnD on current page (reorder full list) — only when manual
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const pageIds = paged.map((r) => r.id);
  const onDragEnd = (event: any) => {
    if (!manualReorderEnabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = rows.findIndex((r) => r.id === active.id);
    const b = rows.findIndex((r) => r.id === over.id);
    if (a === -1 || b === -1) return;
    const next = arrayMove(rows, a, b);
    setRows(next);
    setDirty(next.map((j) => j.id).join('|') !== lastServerOrderRef.current.join('|'));
  };

  // selection (now global across all filtered rows)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedIds([]);
  }, [ownerFilter, statusFilter, prioFilter, q, pageSize, hideCompleted]);
  const selected = new Set(selectedIds);
  const allFilteredIds = filteredAll.map((r) => r.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const toggleAllFiltered = (checked: boolean) => setSelectedIds(checked ? allFilteredIds : []);
  const toggleOne = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // bulk actions (pause/resume/cancel/delete). Delete includes confirm.
  const doBulk = async (kind: 'pause' | 'resume' | 'cancel' | 'delete') => {
    const can = (j: Job) => {
      if (kind === 'pause') return ['running', 'queued'].includes(j.status);
      if (kind === 'resume') return ['paused', 'pausing'].includes(j.status);
      if (kind === 'cancel') return j.status === 'running';
      if (kind === 'delete') return j.status !== 'running' && j.status !== 'pausing';
      return false;
    };
    const targets = filteredAll.filter((r) => selected.has(r.id) && can(r)).map((r) => r.id);
    if (!targets.length) return;
    try {
      if (kind === 'pause') await Promise.all(targets.map(onPause));
      else if (kind === 'resume') await Promise.all(targets.map(onResume));
      else if (kind === 'cancel') await Promise.all(targets.map(onCancel));
      else await Promise.all(targets.map(onDelete));
      const label =
        kind === 'pause'
          ? 'Paused'
          : kind === 'resume'
            ? 'Resumed'
            : kind === 'cancel'
              ? 'Canceled'
              : 'Deleted';
      pushToast({ type: 'success', title: `${label} ${targets.length} job(s)` });
      if (kind === 'delete') setSelectedIds([]); // clear selection after delete
    } catch (e: any) {
      pushToast({ type: 'error', title: 'Bulk action failed', detail: String(e?.message || e) });
    }
  };

  // ordering helpers (manual only)
  const toTop = async (id: string) => {
    if (!manualReorderEnabled) return;
    const nextOrderIds = [id, ...rows.filter((r) => r.id !== id).map((r) => r.id)];
    setRows((prev) => {
      const job = prev.find((j) => j.id === id);
      if (!job) return prev;
      const others = prev.filter((j) => j.id !== id);
      return [job, ...others];
    });
    try {
      await onReorder(nextOrderIds);
      await api.updatePriority(id, 1);
      pushToast({ type: 'success', title: 'Moved to top' });
    } catch (e: any) {
      pushToast({ type: 'error', title: 'Failed to move to top', detail: String(e?.message || e) });
    }
    setDirty(false);
    lastServerOrderRef.current = nextOrderIds;
  };
  const moveUp = (id: string) => {
    if (!manualReorderEnabled) return;
    const i = rows.findIndex((r) => r.id === id);
    if (i <= 0) return;
    const next = arrayMove(rows, i, i - 1);
    setRows(next);
    setDirty(true);
  };
  const moveDown = (id: string) => {
    if (!manualReorderEnabled) return;
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1 || i === rows.length - 1) return;
    const next = arrayMove(rows, i, i + 1);
    setRows(next);
    setDirty(true);
  };
  const saveOrder = async () => {
    if (!manualReorderEnabled) return;
    const order = rows.map((r) => r.id);
    try {
      await onReorder(order);
    } finally {
      setDirty(false);
      lastServerOrderRef.current = order;
    }
  };
  const hasOrderChanged = rows.map((j) => j.id).join('|') !== lastServerOrderRef.current.join('|');

  // row coloring
  const rowHue = (s: StatusKey) => {
    switch (s) {
      case 'failed':
        return 'bg-rose-50 dark:bg-rose-950/30';
      case 'canceled':
        return 'bg-orange-50 dark:bg-orange-950/30';
      case 'completed':
        return 'bg-slate-50 dark:bg-slate-900/40';
      case 'running':
      case 'queued':
      case 'pausing':
      case 'paused':
        return 'bg-emerald-50/50 dark:bg-emerald-950/30';
      default:
        return '';
    }
  };

  // pagination buttons model: 1 … cur cur+1 cur+2 … last
  const pageButtons = React.useMemo<(number | 'dots')[]>(() => {
    const total = Math.max(1, Math.ceil(baseRows.length / pageSize));
    const cur = Math.min(safePage, total);
    const set = new Set<number>();
    set.add(1);
    set.add(total);
    set.add(cur);
    set.add(cur + 1);
    set.add(cur + 2);
    const nums = Array.from(set)
      .filter((n) => n >= 1 && n <= total)
      .sort((a, b) => a - b);
    const out: (number | 'dots')[] = [];
    for (let i = 0; i < nums.length; i++) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) out.push('dots');
      out.push(nums[i]);
    }
    return out;
  }, [baseRows.length, safePage, pageSize]);

  // confirm modal (for bulk delete)
  const [confirm, setConfirm] = React.useState<{
    open: boolean;
    title: string;
    body: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    body: '',
    onConfirm: () => {},
  });
  const askConfirm = (title: string, body: string, action: () => Promise<void>) => {
    setConfirm({
      open: true,
      title,
      body,
      onConfirm: async () => {
        try {
          await action();
        } finally {
          setConfirm((c) => ({ ...c, open: false }));
        }
      },
    });
  };

  const Chip = ({
    checked,
    label,
    onChange,
  }: {
    checked: boolean;
    label: string;
    onChange: (v: boolean) => void;
  }) => (
    <label
      className={clsx(
        'px-2 py-1 rounded border text-sm cursor-pointer',
        checked
          ? 'bg-brand-600 text-white border-transparent'
          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
      )}
    >
      <input
        type="checkbox"
        className="hidden"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );

  const headerSortBtn = (label: string, key: SortKey, extra?: string) => (
    <button
      className={clsx('inline-flex items-center gap-1', extra)}
      onClick={() => toggleSort(key)}
      title={key === 'manual' ? 'Manual order' : `Sort by ${label}`}
    >
      <span>{label}</span>
      {key !== 'manual' && (
        <ArrowUpDown size={14} className={clsx(sortKey === key ? 'opacity-100' : 'opacity-40')} />
      )}
      {sortKey === key && <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );

  // global order index for “#” column (stable even with filters)
  const globalIndex = (id: string) => jobs.findIndex((j) => j.id === id) + 1;

  return (
    <div className="card p-3">
      {/* Row 1: Search + fetching state */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[280px]">
          <input
            className="input w-full max-w-[380px]"
            placeholder="Search jobs (name, owner, status, priority)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="text-sm underline text-slate-500" onClick={() => setQ('')}>
              Clear
            </button>
          )}
        </div>
        <span className="text-sm text-slate-500 shrink-0">
          {isFetching ? 'Refreshing…' : 'Up to date'}
          <span className="ml-3">
            Completed: <span className="font-semibold">{completedVisibleJobs}</span> (
            {completedVisibleTasks} tasks)
          </span>
          <span className="ml-3">
            Pending: <span className="font-semibold">{pendingVisibleJobs}</span> (
            {pendingVisibleTasks} tasks)
          </span>
        </span>
      </div>

      {/* Row 2: Owners + Statuses + Priority */}
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">Owners:</span>
          <div className="flex flex-wrap gap-2">
            {ownerOptions.map((o) => (
              <Chip
                key={o}
                checked={ownerFilter.includes(o)}
                label={o}
                onChange={(on) =>
                  setOwnerFilter((prev: string[]) =>
                    on ? [...prev, o] : prev.filter((x: string) => x !== o)
                  )
                }
              />
            ))}
            <button className="text-xs underline text-slate-500" onClick={() => setOwnerFilter([])}>
              Clear
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">Statuses:</span>
          <div className="flex flex-wrap gap-2">
            {STATUS_LIST.map((s) => (
              <Chip
                key={s}
                checked={statusFilter.includes(s)}
                label={s}
                onChange={(on) =>
                  setStatusFilter((prev: StatusKey[]) =>
                    on ? [...prev, s] : prev.filter((x: StatusKey) => x !== s)
                  )
                }
              />
            ))}
            <button
              className="text-xs underline text-slate-500"
              onClick={() => setStatusFilter([])}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">View:</span>
          <Chip
            checked={hideCompleted}
            label="Hide Completed"
            onChange={(on) => setHideCompleted(on)}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">Priority:</span>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((p) => (
              <Chip
                key={p}
                checked={prioFilter.includes(p)}
                label={`P${p}`}
                onChange={(on) =>
                  setPrioFilter((prev: number[]) =>
                    on ? [...prev, p] : prev.filter((x) => x !== p)
                  )
                }
              />
            ))}
            <button className="text-xs underline text-slate-500" onClick={() => setPrioFilter([])}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Bulk + Save Order */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-amber-600 text-white border-transparent hover:bg-amber-700"
            onClick={() => doBulk('pause')}
          >
            <Pause size={14} /> Pause
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-emerald-600 text-white border-transparent hover:bg-emerald-700"
            onClick={() => doBulk('resume')}
          >
            <Play size={14} /> Resume
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-rose-600 text-white border-transparent hover:bg-rose-700"
            onClick={() => doBulk('cancel')}
          >
            <XCircle size={14} /> Cancel
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-rose-700 text-white border-transparent hover:bg-rose-800"
            onClick={() =>
              askConfirm(
                'Delete selected jobs?',
                'This will permanently remove all selected jobs that are not running.\nType "confirm" to continue.',
                async () => doBulk('delete')
              )
            }
          >
            <Trash2 size={14} /> Delete
          </button>

          <div className="ml-3 text-xs text-slate-500 hidden sm:block">
            {isManual
              ? manualReorderEnabled
                ? 'Drag rows to reorder.'
                : 'Clear filters or disable Hide Completed to reorder.'
              : `Sorted by ${sortKey} (${sortDir}). Disable sorting to drag.`}
          </div>
        </div>

        <div>
          <button
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-1 rounded border text-sm',
              manualReorderEnabled && hasOrderChanged
                ? 'bg-brand-600 text-white border-transparent hover:bg-brand-700'
                : 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
            )}
            onClick={manualReorderEnabled && hasOrderChanged ? saveOrder : undefined}
            title={!isManual
              ? 'Disable sorting to save manual order'
              : filtersActive
                ? 'Clear filters or disable Hide Completed to save order'
                : hasOrderChanged
                  ? 'Save manual order'
                  : 'No changes to save'}
          >
            Save Order
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto mt-3">
        <table className="w-full table">
          <colgroup>
            <col className="w-8" /> {/* checkbox */}
            <col className="w-20" /> {/* # */}
            <col className="w-[260px] sm:w-[320px]" /> {/* Name */}
            <col className="w-24" /> {/* Priority */}
            <col className="w-36" /> {/* Owner */}
            <col className="w-40" /> {/* Created */}
            <col className="w-28" /> {/* Status */}
            <col /> {/* Progress */}
            <col className="w-12" /> {/* Actions menu */}
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAllFiltered(e.target.checked)}
                  aria-label="Select all filtered"
                  title="Select all filtered jobs"
                />
              </th>
              <th>{headerSortBtn('#', 'manual')}</th>
              <th>{headerSortBtn('Name', 'name')}</th>
              <th>{headerSortBtn('Priority', 'priority')}</th>
              <th>Owner</th>
              <th>{headerSortBtn('Created', 'created_at')}</th>
              <th>{headerSortBtn('Status', 'status')}</th>
              <th>Progress</th>
              <th></th>
            </tr>
          </thead>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pageIds} strategy={verticalListSortingStrategy}>
              <tbody>
                {paged.map((j) => {
                  const p = progressMap[j.id];
                  const total = (p?.total ?? j.total_rows) || 0;
                  const processed = (p?.done ?? j.processed_rows) || 0;
                  const errors = (p?.error ?? j.error_rows) || 0;
                  const doneInclErrors = processed + errors;
                  const pct = total ? Math.min(100, Math.floor((doneInclErrors / total) * 100)) : 0;

                  const hue = rowHue(j.status as StatusKey);
                  const isSelected = selected.has(j.id);
                  const displayName = j.name.length > 60 ? j.name.slice(0, 57) + '…' : j.name;
                  const createdAt = j.created_at as string | undefined;
                  const gIndex = globalIndex(j.id);

                  return (
                    <DraggableRow
                      key={j.id}
                      id={j.id}
                      hueClass={clsx(hue, isSelected && 'ring-2 ring-brand-600/50')}
                      dndEnabled={manualReorderEnabled}
                    >
                      {(dragListeners: any) => (
                        <>
                          <td className="align-top">
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={isSelected}
                              onChange={() => toggleOne(j.id)}
                              aria-label={`Select ${j.name}`}
                            />
                          </td>

                          <td className="align-top">
                            <div className="flex items-center gap-2">
                              <button
                                className={clsx(
                                  'inline-flex items-center justify-center h-7 w-7 rounded border border-slate-300 dark:border-slate-700',
                                  manualReorderEnabled
                                    ? 'text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900'
                                    : 'opacity-40 cursor-not-allowed'
                                )}
                                title={manualReorderEnabled
                                  ? 'Drag to reorder'
                                  : !isManual
                                    ? 'Disable sorting to drag'
                                    : 'Clear filters or disable Hide Completed to reorder'}
                                {...(manualReorderEnabled ? dragListeners : {})}
                              >
                                ≡
                              </button>
                              <span className="text-slate-500">{gIndex}</span>
                            </div>
                          </td>

                          <td className="font-medium align-top" title={j.name}>
                            <button
                              type="button"
                              className="block w-full truncate whitespace-nowrap text-left text-slate-900 dark:text-slate-100 focus:outline-none"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setRenameTarget(j)}
                            >
                              {displayName}
                            </button>
                          </td>

                          <td className="align-top">
                            <PriorityCell
                              jobId={j.id}
                              value={getPrio(j)}
                              onChangeLocal={(next) =>
                                setPrioOverrides((m) => ({ ...m, [j.id]: next }))
                              }
                              onSaved={() => {
                                // nothing required; polling will reconcile; leave override so UI stays correct
                              }}
                              onError={(err) => {
                                // revert local override on failure
                                setPrioOverrides((m) => {
                                  const { [j.id]: _, ...rest } = m;
                                  return rest;
                                });
                                pushToast({
                                  type: 'error',
                                  title: 'Failed to update priority',
                                  detail: String(err?.message || err),
                                });
                              }}
                            />
                          </td>

                          <td className="text-slate-500 truncate align-top">{j.owner}</td>
                          <td className="text-slate-500 align-top">{formatLocal(createdAt)}</td>
                          <td className="align-top">
                            <span className="px-2 py-0.5 rounded-full border text-xs">
                              {j.status}
                            </span>
                          </td>

                          <td className="align-top">
                            <div className="w-full">
                              <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-600"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {`${doneInclErrors}/${total}`} ({pct}%)
                                {errors > 0 && (
                                  <span className="ml-1">
                                    <span className="opacity-70">[</span>
                                    <span className="font-semibold">
                                      {errors} error{errors !== 1 ? 's' : ''}
                                    </span>
                                    <span className="opacity-70">]</span>
                                  </span>
                                )}
                                {j.matches_found ? (
                                  <span className="font-semibold">
                                    , {j.matches_found} matches found
                                  </span>
                                ) : (
                                  ''
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="align-top">
                            <RowActions
                              job={j}
                              onResume={() => onResume(j.id)}
                              onPause={() => onPause(j.id)}
                              onCancel={() =>
                                askConfirm(
                                  'Cancel job?',
                                  `This will stop the running job.\n\nJob: ${j.name}`,
                                  () => onCancel(j.id)
                                )
                              }
                              onDelete={() =>
                                askConfirm(
                                  'Delete job?',
                                  `This will permanently remove the job and its results.\n\nJob: ${j.name}`,
                                  () => onDelete(j.id)
                                )
                              }
                              onReset={() =>
                                askConfirm(
                                  'Reset job?',
                                  `This will set the job status to "queued" and all row states to "pending".\n\nJob: ${j.name}`,
                                  () => onReset(j.id)
                                )
                              }
                              onResetFailed={() =>
                                askConfirm(
                                  'Reset failed tasks?',
                                  `This will set the job status to "queued" and all failed task states to "pending".\n\nJob: ${j.name}`,
                                  () => onResetFailed(j.id)
                                )
                              }
                              onShowStats={() => handleShowStats(j)}
                              onExport={() => onExport(j.id)}
                              onTop={() => (manualReorderEnabled ? toTop(j.id) : undefined)}
                              onUp={() => (manualReorderEnabled ? moveUp(j.id) : undefined)}
                              onDown={() => (manualReorderEnabled ? moveDown(j.id) : undefined)}
                              menuDisabledTip={
                                manualReorderEnabled
                                  ? undefined
                                  : !isManual
                                    ? 'Move actions disabled while sorted'
                                    : 'Clear filters or disable Hide Completed to move'
                              }
                            />
                          </td>
                        </>
                      )}
                    </DraggableRow>
                  );
                })}

                {!paged.length && (
                  <tr>
                    <td colSpan={9} className="text-center py-6 text-slate-500">
                      No jobs
                    </td>
                  </tr>
                )}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* Pagination (bottom) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          Page {safePage} / {pageCount} — showing{' '}
          {baseRows.length ? `${start + 1}-${Math.min(end, baseRows.length)}` : '0'} of{' '}
          {baseRows.length}
        </div>
        <div className="flex items-center gap-2">
          {safePage > 1 && (
            <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </button>
          )}
          <div className="flex items-center gap-1">
            {pageButtons.map((p, idx) =>
              p === 'dots' ? (
                <span key={`dots-${idx}`} className="px-2 text-slate-500">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  className={clsx(
                    'px-2 h-8 min-w-8 rounded border text-sm',
                    p === safePage
                      ? 'bg-brand-600 text-white border-transparent'
                      : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                  )}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              )
            )}
          </div>
          {safePage < pageCount && (
            <button className="btn" onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              Next
            </button>
          )}
          <select
            className="input ml-2"
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value || '25', 10))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
        </div>
      </div>

      <StatsModal
        open={!!statsJob}
        jobName={statsJob?.name || ''}
        stats={jobStats}
        loading={statsLoading}
        error={statsError}
        onClose={closeStatsModal}
        onRetry={retryStats}
      />
      <RenameJobDialog
        open={!!renameTarget}
        job={renameTarget}
        existingNames={existingNameSet}
        onClose={() => setRenameTarget(null)}
        onSubmit={onRename}
      />

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        body={confirm.body}
        onClose={() => setConfirm((c) => ({ ...c, open: false }))}
        onConfirm={confirm.onConfirm}
      />
    </div>
  );
}

type StatsModalProps = {
  open: boolean;
  jobName: string;
  stats: JobStats | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
};

function StatsModal({ open, jobName, stats, loading, error, onClose, onRetry }: StatsModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const displayName = stats?.jobName || jobName;
  const summary = stats?.summary;
  const tableError = stats?.tableError;

  const formatInt = (value: number) => (Number.isFinite(value) ? value.toLocaleString() : '-');
  const formatPercent = (value: number) =>
    Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '-';
  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '-';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const dd = pad(date.getDate());
    const mm = pad(date.getMonth() + 1);
    const yyyy = date.getFullYear();
    const hh = pad(date.getHours());
    const mi = pad(date.getMinutes());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  };
  const formatDuration = (seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds)) return '-';
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (!hours && !minutes) {
      return `${secs}s`;
    }
    const parts: string[] = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (!hours && secs) parts.push(`${secs}s`);
    return parts.join(' ') || '0s';
  };
  const formatCost = (value: number) =>
    Number.isFinite(value)
      ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
      : '-';

  const hasStats = Boolean(stats);
  const domains = stats?.domains ?? [];
  const hasDomains = domains.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[min(960px,94vw)] max-h-[85vh] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <div className="text-lg font-semibold">Job stats</div>
            <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
              {displayName || 'Unnamed job'}
            </div>
          </div>
          <button
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={onClose}
            aria-label="Close stats"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[calc(85vh-72px)] overflow-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500">Loading stats...</div>
          ) : error ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-300 bg-amber-100/70 dark:border-amber-600 dark:bg-amber-900/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
                {error}
              </div>
              <div className="flex justify-end">
                <button className="btn" onClick={onRetry}>
                  Retry
                </button>
              </div>
            </div>
          ) : !hasStats ? (
            <div className="py-10 text-center text-sm text-slate-500">No stats available yet.</div>
          ) : (
            <div className="space-y-6">
              {tableError ? (
                <div className="rounded-md border border-amber-300 bg-amber-100/70 dark:border-amber-600 dark:bg-amber-900/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
                  {tableError}
                </div>
              ) : hasDomains ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border border-slate-200 dark:border-slate-700">
                    <thead className="bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium border-b border-slate-200 dark:border-slate-700">
                          Domain
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Catalog
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Matched
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Unmatched
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Sampled
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Found
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          DQ MR %
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Potential matches
                        </th>
                        <th className="px-3 py-2 text-right font-medium border-b border-slate-200 dark:border-slate-700">
                          Completeness %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map((row) => {
                        const completenessClasses = clsx(
                          'inline-flex items-center rounded px-2 py-1 text-xs font-semibold',
                          row.completeness >= 0.92
                            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
                            : 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                        );

                        return (
                          <tr
                            key={row.domain}
                            className="border-b border-slate-200 dark:border-slate-700 last:border-b-0"
                          >
                            <td className="px-3 py-2 align-top font-medium">
                              {row.domain || 'N/A'}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatInt(row.catalog)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatInt(row.matched)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatInt(row.unmatched)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatInt(row.sampled)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatInt(row.found)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatPercent(row.dqMr)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              {formatInt(row.potentialMatches)}
                            </td>
                            <td className="px-3 py-2 align-top text-right">
                              <span className={completenessClasses}>
                                {formatPercent(row.completeness)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-slate-500">
                  No stats available yet.
                </div>
              )}

              {summary && (
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <div className="text-sm font-semibold mb-3">Job totals</div>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Created
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatDateTime(summary.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Started
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatDateTime(summary.startedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Finished
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatDateTime(summary.finishedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Total time
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatDuration(summary.totalDurationSeconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Total cost
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatCost(summary.totalCost)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Total Gemini requests
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatInt(summary.totalGeminiRequests)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Found via Google
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatInt(summary.foundViaGoogle)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Found via Polaris
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100">
                        {formatInt(summary.foundViaPolaris)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
/* ------------------------------ RowActions ------------------------------ */

function RowActions({
  job,
  onResume,
  onPause,
  onCancel,
  onDelete,
  onExport,
  onShowStats,
  onTop,
  onUp,
  onDown,
  onReset,
  onResetFailed,
  menuDisabledTip,
}: {
  job: Job;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onExport: () => void;
  onShowStats: () => void;
  onTop?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onReset: () => void;
  onResetFailed: () => void;
  menuDisabledTip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; up: boolean }>({
    x: 0,
    y: 0,
    up: false,
  });
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const canShowStats = job.processed_rows > 0;

  // open menu as portal, fixed positioning to avoid clipping
  const openMenu = () => {
    if (!btnRef.current) {
      setOpen((o) => !o);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 220;
    setCoords({ x: r.right - 192, y: up ? r.top - 8 : r.bottom + 8, up });
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // only close if click is outside the menu AND the toggle button
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const PortalMenu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] w-48 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg text-slate-900 dark:text-slate-100"
          style={{ left: coords.x, top: coords.y }}
        >
          <ul className="py-1 text-sm">
            {onTop && (
              <li>
                <button
                  className="menu-item"
                  onClick={() => {
                    setOpen(false);
                    onTop();
                  }}
                >
                  <ChevronsUp size={14} className="mr-2" /> To top
                </button>
              </li>
            )}

            {['running', 'queued'].includes(job.status) ? (
              <li>
                <button
                  className="menu-item"
                  onClick={() => {
                    setOpen(false);
                    onPause();
                  }}
                >
                  <Pause size={14} className="mr-2" /> Pause
                </button>
              </li>
            ) : (
              <li>
                <button
                  disabled={!['queued', 'paused', 'pausing'].includes(job.status)}
                  className="menu-item disabled:opacity-50"
                  onClick={() => {
                    setOpen(false);
                    onResume();
                  }}
                >
                  <Play size={14} className="mr-2" /> Resume
                </button>
              </li>
            )}

            <li>
              <button
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onExport();
                }}
              >
                <FileDown size={14} className="mr-2" /> Export
              </button>
            </li>
            <li>
              <button
                disabled={['running', 'pausing'].includes(job.status)}
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onReset();
                }}
              >
                <RotateCcw size={14} className="mr-2" /> Reset job
              </button>
            </li>

            <li>
              <button
                disabled={['running', 'pausing'].includes(job.status)}
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onResetFailed();
                }}
              >
                <RotateCcw size={14} className="mr-2" /> Reset failed tasks
              </button>
            </li>

            <li>
              <button
                disabled={job.status !== 'running'}
                className="menu-item !text-amber-700 dark:!text-amber-400 disabled:opacity-50"
                onClick={() => {
                  setOpen(false);
                  onCancel();
                }}
              >
                <XCircle size={14} className="mr-2" /> Cancel
              </button>
            </li>

            <li>
              <button
                disabled={job.status === 'running' || job.status === 'pausing'}
                className="menu-item !text-rose-600 dark:!text-rose-400 disabled:opacity-50"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <Trash2 size={14} className="mr-2" /> Delete
              </button>
            </li>

            {(onUp || onDown) && (
              <>
                <li>
                  <hr className="my-1 border-slate-200 dark:border-slate-700" />
                </li>
                <li>
                  <button
                    disabled={!onUp}
                    className="menu-item disabled:opacity-50"
                    onClick={() => {
                      setOpen(false);
                      onUp && onUp();
                    }}
                  >
                    Move up
                  </button>
                </li>
                <li>
                  <button
                    disabled={!onDown}
                    className="menu-item disabled:opacity-50"
                    onClick={() => {
                      setOpen(false);
                      onDown && onDown();
                    }}
                  >
                    Move down
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="flex items-center gap-2">
      <button
        className={clsx(
          'inline-flex h-8 items-center gap-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800',
          !canShowStats && 'opacity-50 cursor-not-allowed'
        )}
        onClick={() => {
          if (!canShowStats) return;
          onShowStats();
        }}
        disabled={!canShowStats}
        aria-label="Show stats"
        title={canShowStats ? 'Show stats' : 'Stats available after some tasks are processed'}
      >
        <BarChart3 size={14} />
      </button>
      <div className="relative">
        <button
          ref={btnRef}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          onClick={openMenu}
          aria-label="More actions"
          title={menuDisabledTip}
        >
          <MoreVertical size={16} />
        </button>
        {PortalMenu}
      </div>
    </div>
  );
}

function PriorityCell({
  jobId,
  value,
  onChangeLocal,
  onSaved,
  onError,
}: {
  jobId: string;
  value: number;
  onChangeLocal: (v: number) => void;
  onSaved: () => void;
  onError: (e: any) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = React.useState<{ x: number; y: number; up: boolean }>({
    x: 0,
    y: 0,
    up: false,
  });

  React.useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) {
      setOpen((o) => !o);
      return;
    }
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 160;
    setCoords({ x: r.left, y: up ? r.top - 8 : r.bottom + 8, up });
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const doSave = async () => {
    try {
      setSaving(true);
      onChangeLocal(draft); // optimistic
      await api.updatePriority(jobId, draft);
      onSaved();
      setOpen(false);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        className="px-2 py-0.5 rounded-full border text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
        onClick={openMenu}
        title="Edit priority"
      >
        P{value}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] w-56 max-w-[92vw] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-2"
            style={{ left: coords.x, top: coords.y }}
          >
            <div className="flex items-center gap-2">
              <select
                className="input w-full"
                value={draft}
                onChange={(e) => setDraft(parseInt(e.target.value || '3', 10))}
                disabled={saving}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    P{n}
                  </option>
                ))}
              </select>
              <button
                className={clsx(
                  'px-2 py-1 rounded border text-xs',
                  saving
                    ? 'opacity-50 cursor-not-allowed'
                    : 'bg-brand-600 text-white border-transparent hover:bg-brand-700'
                )}
                onClick={saving ? undefined : doSave}
              >
                OK
              </button>
              <button
                className="px-2 py-1 rounded border text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
