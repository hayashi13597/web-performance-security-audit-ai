// ===== Hợp đồng dữ liệu dùng chung toàn hệ thống =====

export type Severity = 'critical' | 'warning' | 'info';

export type Category = 'performance' | 'bundle' | 'rerender' | 'memory' | 'security' | 'seo';

export const CATEGORY_LABELS: Record<Category, string> = {
  performance: 'Hiệu năng',
  bundle: 'Bundle size',
  rerender: 'Re-render lãng phí',
  memory: 'Rò rỉ bộ nhớ',
  security: 'Bảo mật',
  seo: 'SEO',
};

/** Tệp nguồn liên quan đến một finding (chỉ có khi quét được source). */
export interface FileRef {
  path: string;
  line?: number;
  snippet?: string;
}

/** Một vấn đề phát hiện được. `fixHint` là gợi ý ngắn dùng để hiển thị và làm đầu vào cho AI. */
export interface Finding {
  id: string;
  category: Category;
  detector: string;
  title: string;
  detail: string;
  severity: Severity;
  /** Ước lượng tác động, ví dụ "tiết kiệm ~120KB gzip". */
  impact?: string;
  files?: FileRef[];
  metrics?: Record<string, number | string>;
  fixHint?: string;
  /** true nếu module AI có thể sinh code fix cho finding này (cần có source code). */
  aiFixable: boolean;
}

/** Core Web Vitals + điểm Lighthouse (thang 0-100). Thời gian tính bằng ms, CLS là số vô hướng. */
export interface CWVMetrics {
  ttfb?: number;
  fcp?: number;
  lcp?: number;
  cls?: number;
  tbt?: number;
  speedIndex?: number;
  performanceScore?: number;
  seoScore?: number;
  bestPracticesScore?: number;
}

export type ScanStage =
  | 'fetch-source'
  | 'lighthouse'
  | 'security'
  | 'rerender'
  | 'memory'
  | 'bundle'
  | 'done';

export interface StageState {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  message?: string;
}

export type RepoSource =
  | { kind: 'github'; repoUrl: string; token?: string }
  | { kind: 'local'; path: string };

export type ScanRequest =
  | {
      mode: 'url';
      url: string;
      formFactor: 'mobile' | 'desktop';
      memoryRounds: number;
    }
  | {
      mode: 'repo';
      source: RepoSource;
      /** URL live (preview/deploy) để chạy các detector runtime; thiếu thì chỉ quét tĩnh. */
      liveUrl?: string;
      formFactor: 'mobile' | 'desktop';
      memoryRounds: number;
    };

export interface RepoInfo {
  owner: string;
  name: string;
  branch: string;
}

export interface ScanReport {
  id: string;
  scannedAt: string;
  durationMs: number;
  url?: string;
  repo?: RepoInfo;
  sourceDir?: string;
  cwv?: CWVMetrics;
  findings: Finding[];
  /** Component → số lần render (từ detector re-render), dùng để vẽ bảng trên UI. */
  rerenderCommits?: Record<string, number>;
}

// ===== Sinh code fix bằng AI =====

export type FixAction = 'modify' | 'create';

export interface FixSuggestion {
  /** id của finding mà fix này xử lý. */
  findingId: string;
  file: string;
  action: FixAction;
  /** Nội dung file sau khi fix (full content). */
  content: string;
  rationale: string;
  /** Diff hiển thị (tính khi đã có nội dung cũ). */
  diff?: string;
}

export interface FixPlan {
  fixes: FixSuggestion[];
  summary: string;
}

// ===== Tạo PR GitHub =====

export interface PRRequest {
  /** Repo đích: "owner/name". Nếu scan nguồn local, bắt buộc khai báo repo GitHub đích. */
  repo: string;
  token: string;
  baseBranch?: string;
  title?: string;
  /** Chỉ tạo PR cho các finding này (mặc định: tất cả finding aiFixable). */
  findingIds?: string[];
}

export interface PRResult {
  prUrl: string;
  branch: string;
  commitSha: string;
  filesChanged: number;
}
