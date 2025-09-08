// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import type { Job, Progress } from "./lib/api";
import { Pause, Play, FileDown, XCircle, Trash2, ChevronsUp, MoreVertical, Check, X, Info, RotateCcw, ArrowUpDown } from "lucide-react";
import ThemeToggle from "./components/ThemeToggle";
import clsx from "clsx";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ----------------------------- Helpers/Types ----------------------------- */

type ValidateSummary = {
  sizeBytes: number;
  total: number;
  valid: number;
  invalid: number;
  invalidSamples: string[];
  uniqueRefKeys: string[];
};
type InsertWhere = { mode: "top" } | { mode: "priority"; priority: number };
const STATUS_LIST = ["queued", "running", "pausing", "paused", "completed", "failed", "canceled"] as const;
type StatusKey = (typeof STATUS_LIST)[number];

const LS_OWNERS = "ownerFilter";
const LS_STATUSES = "statusFilter";
const LS_PRIOS = "prioFilter";
const LS_MAP_HISTORY = "mapping_history_v1";
const LS_PAGE_SIZE = "jobsPageSize";

type SortKey = "manual" | "name" | "created_at" | "status" | "priority";
type SortDir = "asc" | "desc";

/* ---------------------------- Toasts (simple) ---------------------------- */

type Toast = { id: string; type: "success" | "error" | "info"; title: string; detail?: string };
const Toasts: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => (
  <div className="fixed top-3 right-3 z-50 space-y-2">
    {toasts.map((t) => (
      <div
        key={t.id}
        className={clsx(
          "min-w-[260px] max-w-[420px] rounded-lg border shadow-soft px-3 py-2 text-sm",
          t.type === "success" &&
            "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-100",
          t.type === "error" && "bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-100",
          t.type === "info" && "bg-slate-50 border-slate-200 text-slate-900 dark:bg-slate-900/60 dark:border-slate-800 dark:text-slate-100"
        )}
      >
        <div className="flex items-start gap-2">
          <div className="mt-0.5">{t.type === "success" ? <Check size={16} /> : t.type === "error" ? <X size={16} /> : <Info size={16} />}</div>
          <div className="flex-1">
            <div className="font-medium">{t.title}</div>
            {!!t.detail && <div className="text-xs opacity-80 whitespace-pre-wrap">{t.detail}</div>}
          </div>
          <button className="text-xs underline opacity-70 hover:opacity-100" onClick={() => onDismiss(t.id)}>
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
  requireText = "confirm",
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
  const [val, setVal] = React.useState("");
  React.useEffect(() => {
    if (open) setVal("");
  }, [open]);
  if (!open) return null;
  const ok = val.trim().toLowerCase() === requireText.toLowerCase();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,520px)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xl">
        <div className="text-lg font-semibold mb-1">{title}</div>
        {!!body && <div className="text-sm text-slate-600 dark:text-slate-300 mb-3 whitespace-pre-wrap">{body}</div>}
        <div className="text-xs mb-2 text-slate-500">
          Type{" "}
          <span className="font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">confirm</span>{" "}
          to continue
        </div>
        <input className="input w-full mb-4" value={val} onChange={(e) => setVal(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={clsx("btn", ok ? "bg-brand-600 text-white border-transparent hover:bg-brand-700" : "opacity-50 cursor-not-allowed")}
            onClick={ok ? onConfirm : undefined}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Data Fetching ----------------------------- */

function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: () => api.listJobs(false, ""),
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
  // Free search (not persisted)
  const [q, setQ] = useState("");

  useEffect(() => {
    try {
      const o = JSON.parse(localStorage.getItem(LS_OWNERS) || "[]");
      const s = JSON.parse(localStorage.getItem(LS_STATUSES) || "[]");
      const p = JSON.parse(localStorage.getItem(LS_PRIOS) || "[]");
      setOwnerFilter(Array.isArray(o) ? o : []);
      setStatusFilter(Array.isArray(s) ? s : []);
      setPrioFilter(Array.isArray(p) ? p : []);
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

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (t: Omit<Toast, "id">) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const toast: Toast = { id, ...t };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  };

  const [announcement] = useState<string | null>(null);

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
          existingNames={useMemo(() => new Set(jobs.map((j) => j.name.trim().toLowerCase())), [jobs])}
          onUploaded={async ({ job_id, insertWhere }) => {
            pushToast({ type: "success", title: "Task created" });
            await qc.invalidateQueries({ queryKey: ["jobs"] });
            if (insertWhere && job_id) {
              if (insertWhere.mode === "top") {
                const all = (await qc.getQueryData<Job[]>(["jobs"])) || [];
                const currentOrder = all.map((j) => j.id);
                const idx = currentOrder.indexOf(job_id);
                if (idx !== -1) {
                  const nextOrder = currentOrder.slice();
                  nextOrder.splice(idx, 1);
                  nextOrder.unshift(job_id);
                  try {
                    await api.reorder(nextOrder);
                    pushToast({ type: "success", title: "Moved to top" });
                  } catch (e: any) {
                    pushToast({ type: "error", title: "Failed to move to top", detail: String(e?.message || e) });
                  }
                  await qc.invalidateQueries({ queryKey: ["jobs"] });
                }
              }
              // if mode is 'priority', backend should pick it up from upload payload
            }
          }}
          pushToast={pushToast}
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
          pushToast={pushToast}
          onReorder={async (ids) => {
            try {
              await api.reorder(ids);
              pushToast({ type: "success", title: "Order saved" });
            } catch (e: any) {
              pushToast({ type: "error", title: "Failed to save order", detail: String(e?.message || e) });
            }
          }}
          onPause={async (id) => {
            try {
              await api.pause(id);
              pushToast({ type: "success", title: "Paused" });
            } catch (e: any) {
              pushToast({ type: "error", title: "Pause failed", detail: String(e?.message || e) });
            }
          }}
          onResume={async (id) => {
            try {
              await api.resume(id);
              pushToast({ type: "success", title: "Resumed" });
            } catch (e: any) {
              pushToast({ type: "error", title: "Resume failed", detail: String(e?.message || e) });
            }
          }}
          onExport={async (id) => {
            try {
              const { export_id } = await api.export(id);
              pushToast({ type: "info", title: "Export started" });
              const timer = setInterval(async () => {
                try {
                  const st = await api.exportStatus(export_id);
                  if (st.status === "ready") {
                    clearInterval(timer);
                    pushToast({ type: "success", title: "Export ready" });
                    window.location.href = api.exportDownloadUrl(export_id);
                  } else if (st.status === "failed" || st.status === "expired") {
                    clearInterval(timer);
                    pushToast({ type: "error", title: `Export ${st.status}` });
                  }
                } catch (e: any) {
                  clearInterval(timer);
                  pushToast({ type: "error", title: "Export failed", detail: String(e?.message || e) });
                }
              }, 3000);
            } catch (e: any) {
              pushToast({ type: "error", title: "Export failed to start", detail: String(e?.message || e) });
            }
          }}
          onCancel={async (id) => {
            try {
              await api.cancel(id);
              pushToast({ type: "success", title: "Canceled" });
            } catch (e: any) {
              pushToast({ type: "error", title: "Cancel failed", detail: String(e?.message || e) });
            }
          }}
          onDelete={async (id) => {
            try {
              await api.delete(id);
              pushToast({ type: "success", title: "Deleted" });
            } catch (e: any) {
              pushToast({ type: "error", title: "Delete failed", detail: String(e?.message || e) });
            }
          }}
          onReset={async (id) => {
            try {
              await api.reset(id);
              pushToast({ type: "success", title: "Job reset" });
            } catch (e: any) {
              pushToast({ type: "error", title: "Reset failed", detail: String(e?.message || e) });
            }
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------- UploadCard ------------------------------ */

function UploadCard({
  onUploaded,
  existingNames,
  pushToast,
}: {
  onUploaded: (r: { job_id?: string; insertWhere?: InsertWhere }) => void;
  existingNames: Set<string>;
  pushToast: (t: Omit<Toast, "id">) => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [validate, setValidate] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  // NEW: queue mode — 'top' or 'priority'
  const [queueMode, setQueueMode] = useState<"top" | "priority">("priority");
  const [priority, setPriority] = useState<number>(5);

  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ValidateSummary | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const nameTaken = useMemo(() => {
    const n = name.trim().toLowerCase();
    return !!n && existingNames.has(n);
  }, [name, existingNames]);

  const canUpload = !!name && !nameTaken && !!file && !!summary && summary.valid > 0 && summary.invalid === 0 && !busy;

  // mapping history helpers
  const loadHistory = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(LS_MAP_HISTORY) || "{}");
    } catch {
      return {};
    }
  };
  const saveHistory = (next: Record<string, string>) => {
    try {
      localStorage.setItem(LS_MAP_HISTORY, JSON.stringify(next));
    } catch {}
  };

  // Validate file + build mapping preview
  useEffect(() => {
    if (!file) {
      setSummary(null);
      setMapping({});
      return;
    }

    (async () => {
      try {
        const text = await file.text();
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
        for (const o of lines) {
          const ref = o?.referenceProduct?.referenceAttributes;
          const tgt = o?.targetMerchant?.targetName || o?.targetMerchant?.targetHomepage;
          const hasKeys = ref && typeof ref === "object" && Object.keys(ref).length > 0;
          const hasTarget = typeof tgt === "string" && tgt.trim().length > 0;
          if (hasKeys && hasTarget) {
            valid++;
            Object.keys(ref).forEach((k) => keySet.add(k));
          } else {
            invalid++;
            if (invalidSamples.length < 5) {
              const reason = !hasKeys ? "Missing referenceAttributes keys" : "Missing targetName/homepage";
              invalidSamples.push(reason);
            }
          }
        }

        const sum: ValidateSummary = {
          sizeBytes: file.size,
          total: lines.length,
          valid,
          invalid,
          invalidSamples,
          uniqueRefKeys: Array.from(keySet).sort(),
        };
        setSummary(sum);

        const history = loadHistory();
        const map: Record<string, string> = {};
        sum.uniqueRefKeys.forEach((k) => (map[k] = typeof history[k] === "string" && history[k] ? history[k] : k));
        setMapping(map);
      } catch {
        setSummary({
          sizeBytes: file.size,
          total: 0,
          valid: 0,
          invalid: 1,
          invalidSamples: ["File parse error"],
          uniqueRefKeys: [],
        });
        setMapping({});
      }
    })();
  }, [file]);

  // Upload handler
  const doUpload = async () => {
    if (!file || !summary) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("additional_prompt", prompt);
      fd.set("validate_images", String(validate));
      fd.set("worker_concurrency", String(10)); // fixed
      fd.set("file", file);
      fd.set("mapping", JSON.stringify(mapping));
      if (queueMode === "priority") fd.set("priority", String(priority)); // <-- backend should read this
      if (queueMode === "top") fd.set("priority", String(1)); // if 'top', set to highest priority to push it up quickly
      const result = await api.upload(fd);

      // Save mapping history (merge)
      const hist = loadHistory();
      const merged = { ...hist, ...mapping };
      saveHistory(merged);

      onUploaded({
        job_id: result?.job_id,
        insertWhere: queueMode === "top" ? { mode: "top" } : { mode: "priority", priority },
      });

      // reset
      setName("");
      setPrompt("");
      setValidate(false);
      setFile(null);
      setSummary(null);
      setMapping({});
      setQueueMode("priority");
      setPriority(5);
    } catch (e: any) {
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Create Task</h2>
      </div>

      {/* Name + Queue placement + Workers */}
      <div className="grid gap-3 mt-3 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <label className="block text-sm mb-1">Task name</label>
          <input
            className={clsx("input", nameTaken && "border-rose-400 focus:ring-rose-300")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {nameTaken && <div className="text-xs text-rose-600 mt-1">A task with this name already exists.</div>}
        </div>

        <div>
          <label className="block text-sm mb-1">Queue Placement</label>
          <div className="flex items-center gap-2">
            <select className="input w-44" value={queueMode} onChange={(e) => setQueueMode(e.target.value as any)}>
              <option value="top">Top of Queue</option>
              <option value="priority">Priority</option>
            </select>
            {queueMode === "priority" && (
              <select className="input w-24" value={priority} onChange={(e) => setPriority(parseInt(e.target.value || "3", 10))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    P{n}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">Workers</label>
          <input className="input w-28" value={10} readOnly />
          <div className="text-xs text-slate-500 mt-1">Fixed to 10</div>
        </div>

        <div className="sm:col-span-3">
          <label className="block text-sm mb-1">Additional prompt (optional)</label>
          <textarea className="input h-24" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
      </div>

      <div className="mt-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} />
          <span>Validate Images</span>
        </label>
      </div>

      <div className="mt-3">
        <label className="block text-sm mb-1">Input file (.jsonl / .json / .txt / .jsonb)</label>
        <input className="input" type="file" accept=".jsonl,.json,.txt,.jsonb" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </div>

      {/* Stats */}
      {summary && (
        <div className="mt-3 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="File size" value={`${(summary.sizeBytes / 1024).toFixed(1)} KB`} />
            <Stat label="Total rows" value={summary.total} />
            <Stat label="Valid" value={summary.valid} className="text-emerald-600 dark:text-emerald-400" />
            <Stat label="Invalid" value={summary.invalid} className="text-rose-600 dark:text-rose-400" />
          </div>
          {!!summary.invalidSamples.length && (
            <div className="text-xs text-rose-600 dark:text-rose-400 mt-1">Examples: {summary.invalidSamples.join(", ")}</div>
          )}
        </div>
      )}

      {/* Mapping preview */}
      {!!Object.keys(mapping).length && (
        <div className="mt-4">
          <h3 className="text-md font-semibold mb-2">Reference Key Mapping (preview)</h3>
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
                            onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value || k }))}
                            onBlur={(e) => {
                              const hist = (() => {
                                try {
                                  return JSON.parse(localStorage.getItem(LS_MAP_HISTORY) || "{}");
                                } catch {
                                  return {};
                                }
                              })();
                              hist[k] = e.target.value || k;
                              try {
                                localStorage.setItem(LS_MAP_HISTORY, JSON.stringify(hist));
                              } catch {}
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-1">Header is sticky; scroll to see all keys.</div>
        </div>
      )}

      <div className="mt-4">
        <button
          disabled={!canUpload}
          className={clsx("btn", canUpload ? "bg-brand-600 hover:bg-brand-700 text-white border-transparent" : "opacity-50 cursor-not-allowed")}
          onClick={async () => {
            try {
              await doUpload();
            } catch (e: any) {
              pushToast({ type: "error", title: "Upload failed", detail: String(e?.message || e) });
            }
          }}
        >
          Upload & Create Task
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: any; className?: string }) {
  return (
    <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={clsx("text-sm font-semibold", className)}>{value}</div>
    </div>
  );
}

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
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id, disabled: !dndEnabled });
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
  onReorder,
  onPause,
  onResume,
  onExport,
  onCancel,
  onDelete,
  onReset,
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
  onReorder: (ids: string[]) => Promise<void>;
  onPause: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReset: (id: string) => Promise<void>;
  pushToast: (t: Omit<Toast, "id">) => void;
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
  useEffect(() => setPage(1), [q, ownerFilter, statusFilter, prioFilter]);

  const [prioOverrides, setPrioOverrides] = useState<Record<string, number>>({});
  const getPrio = (j: Job) => (j.id in prioOverrides ? prioOverrides[j.id] : j.priority ?? 5);

  // sorting
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const toggleSort = (key: SortKey) => {
    if (key === "manual") {
      setSortKey("manual");
      return;
    }
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  };
  const isManual = sortKey === "manual";

  const ownerOptions = useMemo(() => Array.from(new Set(jobs.map((j) => j.owner))).sort(), [jobs]);

  // apply filters (but preserve original global order)
  const filteredAll = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return jobs.filter((j) => {
      const ownerOk = ownerFilter.length === 0 || ownerFilter.includes(j.owner);
      const statusOk = statusFilter.length === 0 || statusFilter.includes(j.status as StatusKey);
      const prioOk = prioFilter.length === 0 || prioFilter.includes(getPrio(j));
      const qOk = !qn || [j.name, j.owner, j.status, String(j.priority ?? "")].some((v) => v?.toLowerCase().includes(qn));
      return ownerOk && statusOk && prioOk && qOk;
    });
  }, [jobs, ownerFilter, statusFilter, prioFilter, q]);

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
        case "name":
          av = a.name;
          bv = b.name;
          break;
        case "created_at":
          av = a.created_at || "";
          bv = b.created_at || "";
          break;
        case "status":
          av = a.status;
          bv = b.status;
          break;
        case "priority":
          av = getPrio(a) ?? 99;
          bv = getPrio(b) ?? 99;
          break;
        default:
          av = 0;
          bv = 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
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
      const idsAll = baseRows.filter((r) => ["running", "pausing"].includes(r.status)).map((r) => r.id);
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
            if (!row || !["running", "pausing"].includes(row.status)) delete next[k];
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
    if (!isManual) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = rows.findIndex((r) => r.id === active.id);
    const b = rows.findIndex((r) => r.id === over.id);
    if (a === -1 || b === -1) return;
    const next = arrayMove(rows, a, b);
    setRows(next);
    setDirty(next.map((j) => j.id).join("|") !== lastServerOrderRef.current.join("|"));
  };

  // selection (now global across all filtered rows)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedIds([]);
  }, [ownerFilter, statusFilter, prioFilter, q, pageSize]);
  const selected = new Set(selectedIds);
  const allFilteredIds = filteredAll.map((r) => r.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const toggleAllFiltered = (checked: boolean) => setSelectedIds(checked ? allFilteredIds : []);
  const toggleOne = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // bulk actions (pause/resume/cancel/delete). Delete includes confirm.
  const doBulk = async (kind: "pause" | "resume" | "cancel" | "delete") => {
    const can = (j: Job) => {
      if (kind === "pause") return ["running", "queued"].includes(j.status);
      if (kind === "resume") return ["paused", "pausing"].includes(j.status);
      if (kind === "cancel") return j.status === "running";
      if (kind === "delete") return j.status !== "running" && j.status !== "pausing";
      return false;
    };
    const targets = filteredAll.filter((r) => selected.has(r.id) && can(r)).map((r) => r.id);
    if (!targets.length) return;
    try {
      if (kind === "pause") await Promise.all(targets.map(onPause));
      else if (kind === "resume") await Promise.all(targets.map(onResume));
      else if (kind === "cancel") await Promise.all(targets.map(onCancel));
      else await Promise.all(targets.map(onDelete));
      const label = kind === "pause" ? "Paused" : kind === "resume" ? "Resumed" : kind === "cancel" ? "Canceled" : "Deleted";
      pushToast({ type: "success", title: `${label} ${targets.length} job(s)` });
      if (kind === "delete") setSelectedIds([]); // clear selection after delete
    } catch (e: any) {
      pushToast({ type: "error", title: "Bulk action failed", detail: String(e?.message || e) });
    }
  };

  // ordering helpers (manual only)
  const toTop = async (id: string) => {
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
      pushToast({ type: "success", title: "Moved to top" });
    } catch (e: any) {
      pushToast({ type: "error", title: "Failed to move to top", detail: String(e?.message || e) });
    }
    setDirty(false);
    lastServerOrderRef.current = nextOrderIds;
  };
  const moveUp = (id: string) => {
    if (!isManual) return;
    const i = rows.findIndex((r) => r.id === id);
    if (i <= 0) return;
    const next = arrayMove(rows, i, i - 1);
    setRows(next);
    setDirty(true);
  };
  const moveDown = (id: string) => {
    if (!isManual) return;
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1 || i === rows.length - 1) return;
    const next = arrayMove(rows, i, i + 1);
    setRows(next);
    setDirty(true);
  };
  const saveOrder = async () => {
    const order = rows.map((r) => r.id);
    try {
      await onReorder(order);
    } finally {
      setDirty(false);
      lastServerOrderRef.current = order;
    }
  };
  const orderChanged = isManual && rows.map((j) => j.id).join("|") !== lastServerOrderRef.current.join("|");

  // row coloring
  const rowHue = (s: StatusKey) => {
    switch (s) {
      case "failed":
        return "bg-rose-50 dark:bg-rose-950/30";
      case "canceled":
        return "bg-orange-50 dark:bg-orange-950/30";
      case "completed":
        return "bg-slate-50 dark:bg-slate-900/40";
      case "running":
      case "queued":
      case "pausing":
      case "paused":
        return "bg-emerald-50/50 dark:bg-emerald-950/30";
      default:
        return "";
    }
  };
  const formatLocal = (iso?: string | null) => {
    if (!iso) return "–";
    const d = new Date(iso);
    const pad = (n: number) => (n < 10 ? "0" : "") + n;
    const dd = pad(d.getDate());
    const mm = pad(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  };

  // pagination buttons model: 1 … cur cur+1 cur+2 … last
  const pageButtons = React.useMemo<(number | "dots")[]>(() => {
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
    const out: (number | "dots")[] = [];
    for (let i = 0; i < nums.length; i++) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("dots");
      out.push(nums[i]);
    }
    return out;
  }, [baseRows.length, safePage, pageSize]);

  // confirm modal (for bulk delete)
  const [confirm, setConfirm] = React.useState<{ open: boolean; title: string; body: string; onConfirm: () => void }>({
    open: false,
    title: "",
    body: "",
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

  const Chip = ({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) => (
    <label
      className={clsx(
        "px-2 py-1 rounded border text-sm cursor-pointer",
        checked ? "bg-brand-600 text-white border-transparent" : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
      )}
    >
      <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  const headerSortBtn = (label: string, key: SortKey, extra?: string) => (
    <button
      className={clsx("inline-flex items-center gap-1", extra)}
      onClick={() => toggleSort(key)}
      title={key === "manual" ? "Manual order" : `Sort by ${label}`}
    >
      <span>{label}</span>
      {key !== "manual" && <ArrowUpDown size={14} className={clsx(sortKey === key ? "opacity-100" : "opacity-40")} />}
      {sortKey === key && <span className="text-xs">{sortDir === "asc" ? "↑" : "↓"}</span>}
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
            <button className="text-sm underline text-slate-500" onClick={() => setQ("")}>
              Clear
            </button>
          )}
        </div>
        <span className="text-sm text-slate-500 shrink-0">{isFetching ? "Refreshing…" : "Up to date"}</span>
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
                onChange={(on) => setOwnerFilter((prev: string[]) => (on ? [...prev, o] : prev.filter((x: string) => x !== o)))}
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
                onChange={(on) => setStatusFilter((prev: StatusKey[]) => (on ? [...prev, s] : prev.filter((x: StatusKey) => x !== s)))}
              />
            ))}
            <button className="text-xs underline text-slate-500" onClick={() => setStatusFilter([])}>
              Clear
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">Priority:</span>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((p) => (
              <Chip
                key={p}
                checked={prioFilter.includes(p)}
                label={`P${p}`}
                onChange={(on) => setPrioFilter((prev: number[]) => (on ? [...prev, p] : prev.filter((x) => x !== p)))}
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
            onClick={() => doBulk("pause")}
          >
            <Pause size={14} /> Pause
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-emerald-600 text-white border-transparent hover:bg-emerald-700"
            onClick={() => doBulk("resume")}
          >
            <Play size={14} /> Resume
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-rose-600 text-white border-transparent hover:bg-rose-700"
            onClick={() => doBulk("cancel")}
          >
            <XCircle size={14} /> Cancel
          </button>
          <button
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm bg-rose-700 text-white border-transparent hover:bg-rose-800"
            onClick={() =>
              askConfirm(
                "Delete selected jobs?",
                'This will permanently remove all selected jobs that are not running.\nType "confirm" to continue.',
                async () => doBulk("delete")
              )
            }
          >
            <Trash2 size={14} /> Delete
          </button>

          <div className="ml-3 text-xs text-slate-500 hidden sm:block">
            {isManual ? "Drag rows to reorder." : `Sorted by ${sortKey} (${sortDir}). Disable sorting to drag.`}
          </div>
        </div>

        <div>
          <button
            className={clsx(
              "inline-flex items-center gap-1 px-2 py-1 rounded border text-sm",
              isManual && orderChanged
                ? "bg-brand-600 text-white border-transparent hover:bg-brand-700"
                : "opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700"
            )}
            onClick={isManual && orderChanged ? saveOrder : undefined}
            title={isManual ? "Save manual order" : "Disable sorting to save manual order"}
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
              <th>{headerSortBtn("#", "manual")}</th>
              <th>{headerSortBtn("Name", "name")}</th>
              <th>{headerSortBtn("Priority", "priority")}</th>
              <th>Owner</th>
              <th>{headerSortBtn("Created", "created_at")}</th>
              <th>{headerSortBtn("Status", "status")}</th>
              <th>Progress</th>
              <th></th>
            </tr>
          </thead>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pageIds} strategy={verticalListSortingStrategy}>
              <tbody>
                {paged.map((j) => {
                  const p = progressMap[j.id];
                  const pct = p?.total
                    ? Math.floor((p.done / p.total) * 100)
                    : j.total_rows
                    ? Math.floor((j.processed_rows / j.total_rows) * 100)
                    : 0;
                  const hue = rowHue(j.status as StatusKey);
                  const isSelected = selected.has(j.id);
                  const displayName = j.name.length > 60 ? j.name.slice(0, 57) + "…" : j.name;
                  const createdAt = j.created_at as string | undefined;
                  const gIndex = globalIndex(j.id);

                  return (
                    <DraggableRow key={j.id} id={j.id} hueClass={clsx(hue, isSelected && "ring-2 ring-brand-600/50")} dndEnabled={isManual}>
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
                                  "inline-flex items-center justify-center h-7 w-7 rounded border border-slate-300 dark:border-slate-700",
                                  isManual ? "text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900" : "opacity-40 cursor-not-allowed"
                                )}
                                title={isManual ? "Drag to reorder" : "Disable sorting to drag"}
                                {...(isManual ? dragListeners : {})}
                              >
                                ≡
                              </button>
                              <span className="text-slate-500">{gIndex}</span>
                            </div>
                          </td>

                          <td className="font-medium truncate whitespace-nowrap align-top" title={j.name}>
                            {displayName}
                          </td>

                          <td className="align-top">
                            <PriorityCell
                              jobId={j.id}
                              value={getPrio(j)}
                              onChangeLocal={(next) => setPrioOverrides((m) => ({ ...m, [j.id]: next }))}
                              onSaved={() => {
                                // nothing required; polling will reconcile; leave override so UI stays correct
                              }}
                              onError={(err) => {
                                // revert local override on failure
                                setPrioOverrides((m) => {
                                  const { [j.id]: _, ...rest } = m;
                                  return rest;
                                });
                                pushToast({ type: "error", title: "Failed to update priority", detail: String(err?.message || err) });
                              }}
                            />
                          </td>

                          <td className="text-slate-500 truncate align-top">{j.owner}</td>
                          <td className="text-slate-500 align-top">{formatLocal(createdAt)}</td>
                          <td className="align-top">
                            <span className="px-2 py-0.5 rounded-full border text-xs">{j.status}</span>
                          </td>

                          <td className="align-top">
                            <div className="w-full">
                              <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {p ? `${p.done}/${p.total}` : `${j.processed_rows}/${j.total_rows}`} ({pct}%)
                              </div>
                            </div>
                          </td>

                          <td className="align-top">
                            <RowActions
                              job={j}
                              onResume={() => onResume(j.id)}
                              onPause={() => onPause(j.id)}
                              onCancel={() => askConfirm("Cancel job?", `This will stop the running job.\n\nJob: ${j.name}`, () => onCancel(j.id))}
                              onDelete={() =>
                                askConfirm("Delete job?", `This will permanently remove the job and its results.\n\nJob: ${j.name}`, () =>
                                  onDelete(j.id)
                                )
                              }
                              onReset={() =>
                                askConfirm(
                                  "Reset job?",
                                  `This will set the job status to "queued" and all row states to "pending".\n\nJob: ${j.name}`,
                                  () => onReset(j.id)
                                )
                              }
                              onExport={() => onExport(j.id)}
                              onTop={() => (isManual ? toTop(j.id) : undefined)}
                              onUp={() => (isManual ? moveUp(j.id) : undefined)}
                              onDown={() => (isManual ? moveDown(j.id) : undefined)}
                              menuDisabledTip={!isManual ? "Move actions disabled while sorted" : undefined}
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
          Page {safePage} / {pageCount} — showing {baseRows.length ? `${start + 1}-${Math.min(end, baseRows.length)}` : "0"} of {baseRows.length}
        </div>
        <div className="flex items-center gap-2">
          {safePage > 1 && (
            <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </button>
          )}
          <div className="flex items-center gap-1">
            {pageButtons.map((p, idx) =>
              p === "dots" ? (
                <span key={`dots-${idx}`} className="px-2 text-slate-500">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  className={clsx(
                    "px-2 h-8 min-w-8 rounded border text-sm",
                    p === safePage
                      ? "bg-brand-600 text-white border-transparent"
                      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
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
          <select className="input ml-2" value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value || "25", 10))}>
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
        </div>
      </div>

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

/* ------------------------------ RowActions ------------------------------ */

function RowActions({
  job,
  onResume,
  onPause,
  onCancel,
  onDelete,
  onExport,
  onTop,
  onUp,
  onDown,
  onReset,
  menuDisabledTip,
}: {
  job: Job;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onExport: () => void;
  onTop?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onReset: () => void;
  menuDisabledTip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; up: boolean }>({ x: 0, y: 0, up: false });
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

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
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
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

            {["running", "queued"].includes(job.status) ? (
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
                  disabled={!["queued", "paused", "pausing"].includes(job.status)}
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
                disabled={job.status !== "running"}
                className="menu-item text-amber-700 disabled:opacity-50"
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
                disabled={job.status === "running" || job.status === "pausing"}
                className="menu-item text-rose-600 disabled:opacity-50"
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
    <div className="relative">
      <button
        ref={btnRef}
        className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        onClick={openMenu}
        aria-label="Actions"
        title={menuDisabledTip}
      >
        <MoreVertical size={16} />
      </button>
      {PortalMenu}
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
  const [coords, setCoords] = React.useState<{ x: number; y: number; up: boolean }>({ x: 0, y: 0, up: false });

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
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
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
              <select className="input w-full" value={draft} onChange={(e) => setDraft(parseInt(e.target.value || "3", 10))} disabled={saving}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    P{n}
                  </option>
                ))}
              </select>
              <button
                className={clsx(
                  "px-2 py-1 rounded border text-xs",
                  saving ? "opacity-50 cursor-not-allowed" : "bg-brand-600 text-white border-transparent hover:bg-brand-700"
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
