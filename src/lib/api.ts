// src/lib/api.ts
export type JobStatus =
  | 'queued'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

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
  matches_found?: number;
};

export type QuotaAnnouncement = {
  limitType: 'PerMinute' | 'PerDay';
  hitAt: string;
  resetAt: string;
  message: string;
};

type RawQuotaAnnouncement = {
  limit_type: QuotaAnnouncement['limitType'];
  hit_at: string;
  reset_at: string;
  message: string;
};

export type ListJobsResponse = {
  jobs: Job[];
  quotaAnnouncement: QuotaAnnouncement | null;
};

type RawListJobsResponse = {
  jobs?: Job[];
  quota_announcement?: RawQuotaAnnouncement | null;
};

export type Progress = {
  pending: number;
  processing: number;
  done: number;
  error: number;
  total: number;
};

export type ModelStats = {
  model_name: string;
  google_agent_prompt: string;
  polaris_agent_prompt: string;
  image_agent_prompt: string;
  total_requests: number;
  today_requests: number;
  total_cost: number;
  today_cost: number;
};


export type JobDomainStat = {
  domain: string;
  catalog: number;
  matched: number;
  unmatched: number;
  sampled: number;
  processed: number;
  found: number;
  dqMr: number;
  potentialMatches: number;
  completeness: number;
};
export type JobStatsSummary = {
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  totalDurationSeconds: number | null;
  totalCost: number;
  totalGeminiRequests: number;
  foundViaGoogle: number;
  foundViaPolaris: number;
};


export type JobStats = {
  jobId: string;
  jobName: string;
  domains: JobDomainStat[];
  summary: JobStatsSummary;
  tableError?: string | null;
};

type RawJobDomainStat = Omit<JobDomainStat, 'dqMr' | 'potentialMatches'> & {
  dq_mr: JobDomainStat['dqMr'];
  potential_matches: JobDomainStat['potentialMatches'];
};

type RawJobStatsSummary = {
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  total_duration_seconds: number | null;
  total_cost: number;
  total_gemini_requests: number;
  found_via_google: number;
  found_via_polaris: number;
};

type RawJobStatsResponse = {
  job_id: string;
  job_name: string;
  domains: RawJobDomainStat[];
  summary: RawJobStatsSummary;
  table_error?: string | null;
};

export type UploadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

const json = async <T = any>(res: Response): Promise<T> => {
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return res.json();
};

export const api = {
  async listJobs(onlyMine: boolean, status: string): Promise<ListJobsResponse> {
    const params = new URLSearchParams();
    if (onlyMine) params.set('only_mine', 'true');
    if (status) params.set('status', status);

    const raw = await json<RawListJobsResponse | Job[]>(await fetch(`/api/jobs?${params.toString()}`));

    if (Array.isArray(raw)) {
      return { jobs: raw, quotaAnnouncement: null };
    }

    const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
    const quota = raw.quota_announcement;
    const quotaAnnouncement =
      quota && typeof quota === 'object'
        ? {
            limitType: quota.limit_type,
            hitAt: quota.hit_at,
            resetAt: quota.reset_at,
            message: quota.message,
          }
        : null;

    return { jobs, quotaAnnouncement };
  },

  async reorder(ids: string[]) {
    return json(
      await fetch('/api/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids),
      })
    );
  },

  async pause(id: string) {
    return json(await fetch(`/api/job/${id}/pause`, { method: 'POST' }));
  },

  async resume(id: string) {
    return json(await fetch(`/api/job/${id}/resume`, { method: 'POST' }));
  },

  async cancel(id: string) {
    return json(await fetch(`/api/job/${id}/cancel`, { method: 'POST' }));
  },

  async delete(id: string) {
    return json(await fetch(`/api/job/${id}`, { method: 'DELETE' }));
  },

  async reset(id: string) {
    return json(await fetch(`/api/job/${id}/reset`, { method: 'POST' }));
  },

  async resetFailed(id: string) {
    return json(await fetch(`/api/job/${id}/reset_failed`, { method: 'POST' }));
  },

  async export(jobId: string) {
    return json<{ export_id: string; expires_at: string }>(
      await fetch(`/api/export?job_id=${jobId}`)
    );
  },

  async exportStatus(export_id: string) {
    return json<{ status: 'creating' | 'ready' | 'expired' | 'failed' }>(
      await fetch(`/api/export/${export_id}`)
    );
  },

  exportDownloadUrl(export_id: string) {
    return `/api/export/${export_id}/download`;
  },

  async jobProgress(id: string): Promise<Progress> {
    return json(await fetch(`/api/job/${id}/rows/progress`));
  },

  async jobStats(jobId: string): Promise<JobStats> {
    const res = await json<RawJobStatsResponse>(await fetch(`/api/job/${jobId}/stats`));
    return {
      jobId: res.job_id,
      jobName: res.job_name,
      domains: res.domains.map((d) => ({
        domain: d.domain,
        catalog: d.catalog,
        matched: d.matched,
        unmatched: d.unmatched,
        sampled: d.sampled,
        processed: d.processed,
        found: d.found,
        dqMr: d.dq_mr,
        potentialMatches: d.potential_matches,
        completeness: d.completeness,
      })),
      summary: {
        createdAt: res.summary?.created_at ?? null,
        startedAt: res.summary?.started_at ?? null,
        finishedAt: res.summary?.finished_at ?? null,
        totalDurationSeconds: res.summary?.total_duration_seconds ?? null,
        totalCost: res.summary?.total_cost ?? 0,
        totalGeminiRequests: res.summary?.total_gemini_requests ?? 0,
        foundViaGoogle: res.summary?.found_via_google ?? 0,
        foundViaPolaris: res.summary?.found_via_polaris ?? 0,
      },
      tableError: res.table_error ?? null,
    };
  },
  async upload(fd: FormData, opts?: UploadOptions) {
    if (!opts?.onProgress) {
      return json(
        await fetch('/api/upload', { method: 'POST', body: fd, signal: opts?.signal })
      );
    }

    return new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      let aborted = false;
      let abortListener: (() => void) | null = null;
      const cleanup = () => {
        if (opts?.signal && abortListener) {
          opts.signal.removeEventListener('abort', abortListener);
        }
      };
      xhr.upload.onprogress = (event) => {
        opts.onProgress?.({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : null,
          percent:
            event.lengthComputable && event.total > 0
              ? Math.min(1, Math.max(0, event.loaded / event.total))
              : null,
        });
      };
      xhr.onerror = () => {
        cleanup();
        if (aborted) return;
        reject(new Error('Network error during upload'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new Error('Upload aborted'));
      };
      xhr.onload = () => {
        cleanup();
        if (aborted) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const text = xhr.responseText ?? '';
            resolve(JSON.parse(text));
          } catch (err) {
            reject(err);
          }
        } else {
          const message = xhr.responseText || `${xhr.status} ${xhr.statusText}`;
          reject(new Error(message));
        }
      };

      if (opts?.signal) {
        if (opts.signal.aborted) {
          aborted = true;
          cleanup();
          reject(new Error('Upload aborted'));
          return;
        }
        abortListener = () => {
          aborted = true;
          xhr.abort();
        };
        opts.signal.addEventListener('abort', abortListener);
      }

      xhr.send(fd);
    });
  },

  async updateMapping(jobId: string, mapping: Record<string, string>) {
    return json(
      await fetch(`/api/job/${jobId}/mapping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapping),
      })
    );
  },
  async renameJob(jobId: string, name: string) {
    return json(
      await fetch(`/api/job/${jobId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    );
  },
  async updatePriority(jobId: string, priority: number) {
    return json(
      await fetch(`/api/job/${jobId}/priority?priority=${priority}`, {
        method: 'PATCH',
      })
    );
  },

  async getModelStats(): Promise<ModelStats> {
    return json(await fetch('/api/stats/models'));
  },
};

















