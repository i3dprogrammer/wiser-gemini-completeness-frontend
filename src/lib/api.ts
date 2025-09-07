// src/lib/api.ts
export type JobStatus = "queued" | "running" | "pausing" | "paused" | "completed" | "failed" | "canceled";

export type Job = {
  id: string;
  name: string;
  owner: string;
  status: JobStatus;
  position?: number;
  priority?: number; // 1 (highest) .. 5 (lowest)
  total_rows: number;
  processed_rows: number;
  error_rows?: number;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type Progress = {
  pending: number;
  processing: number;
  done: number;
  error: number;
  total: number;
};

const json = async <T = any>(res: Response): Promise<T> => {
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return res.json();
};

export const api = {
  async listJobs(onlyMine: boolean, status: string): Promise<Job[]> {
    const params = new URLSearchParams();
    if (onlyMine) params.set("only_mine", "true");
    if (status) params.set("status", status);
    return json(await fetch(`/api/jobs?${params.toString()}`));
  },

  async reorder(ids: string[]) {
    return json(
      await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      })
    );
  },

  async pause(id: string) {
    return json(await fetch(`/api/job/${id}/pause`, { method: "POST" }));
  },

  async resume(id: string) {
    return json(await fetch(`/api/job/${id}/resume`, { method: "POST" }));
  },

  async cancel(id: string) {
    return json(await fetch(`/api/job/${id}/cancel`, { method: "POST" }));
  },

  async delete(id: string) {
    return json(await fetch(`/api/job/${id}`, { method: "DELETE" }));
  },

  async reset(id: string) {
    return json(await fetch(`/api/job/${id}/reset`, { method: "POST" }));
  },

  async export(jobId: string) {
    return json<{ export_id: string; expires_at: string }>(
      await fetch(`/api/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      })
    );
  },

  async exportStatus(export_id: string) {
    return json<{ status: "creating" | "ready" | "expired" | "failed" }>(await fetch(`/api/export/${export_id}`));
  },

  exportDownloadUrl(export_id: string) {
    return `/api/export/${export_id}/download`;
  },

  async jobProgress(id: string): Promise<Progress> {
    return json(await fetch(`/api/job/${id}/rows/progress`));
  },

  async upload(fd: FormData) {
    return json(await fetch("/api/upload", { method: "POST", body: fd }));
  },

  async updateMapping(jobId: string, mapping: Record<string, string>) {
    return json(
      await fetch(`/api/job/${jobId}/mapping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mapping),
      })
    );
  },
};
