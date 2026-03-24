"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import styles from "./chat-app.module.css";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              text?: string;
              shape?: string;
              logo_alignment?: string;
              width?: number;
            },
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

type Message = {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};

type DocumentItem = {
  id: number;
  name: string;
  created_at: string;
  chunk_count: number;
};

type WorkspaceDocumentItem = DocumentItem & {
  conversation_id: string;
  conversation_title: string;
};

type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
  document_count: number;
};

type ConversationDetail = {
  id: string;
  title: string;
  updated_at: string;
  messages: Message[];
  documents: DocumentItem[];
};

type User = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
};

type AuthResponse = {
  token: string;
  user: User;
};

type AuthProviderStatus = {
  enabled: boolean;
  label: string;
  description: string;
  reason?: string | null;
};

type AuthProvidersResponse = {
  email_password: AuthProviderStatus;
  google: AuthProviderStatus;
};

type AnalyticsOverview = {
  conversation_count: number;
  document_count: number;
  message_count: number;
  assistant_message_count: number;
  total_chunks: number;
  total_usage_events: number;
  estimated_total_tokens: number;
  estimated_prompt_tokens: number;
  estimated_completion_tokens: number;
  estimated_total_cost_usd: number;
  estimated_prompt_cost_usd: number;
  estimated_completion_cost_usd: number;
  chats_sent: number;
  documents_uploaded: number;
};

type AdminUserAnalytics = {
  email: string;
  name: string;
  conversation_count: number;
  document_count: number;
  estimated_total_tokens: number;
  estimated_total_cost_usd: number;
};

type AdminAnalyticsOverview = {
  user_count: number;
  conversation_count: number;
  document_count: number;
  message_count: number;
  usage_event_count: number;
  estimated_total_tokens: number;
  estimated_total_cost_usd: number;
  top_users: AdminUserAnalytics[];
};

type WorkspaceSummary = {
  id: string;
  name: string;
  role: string;
  member_count: number;
};

type WorkspaceMember = {
  email: string;
  name: string;
  role: string;
  department?: string | null;
  cost_center?: string | null;
};

type WorkspaceDetail = {
  id: string;
  name: string;
  role: string;
  members: WorkspaceMember[];
};

type WorkspaceBillingSummary = {
  workspace_id: string;
  workspace_name: string;
  member_count: number;
  estimated_total_tokens: number;
  estimated_total_cost_usd: number;
  chats_sent: number;
  documents_uploaded: number;
};

type AuditLogItem = {
  id: number;
  action: string;
  target_type: string;
  target_value: string;
  metadata_json: string;
  metadata: Record<string, unknown>;
  actor_email?: string | null;
  created_at: string;
};

type WorkspaceSubscriptionSummary = {
  workspace_id: string;
  provider: string;
  plan_name: string;
  status: string;
  current_period_end: string;
  seats_in_use: number;
  seats_included: number;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  cancel_at_period_end: boolean;
  monthly_token_quota: number;
  monthly_document_quota: number;
  quota_tokens_used: number;
  quota_documents_used: number;
  estimated_monthly_cost_usd: number;
};

type WorkspaceInviteItem = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: string;
  status: string;
  token: string;
  accept_url: string;
  created_at: string;
};

type WorkspaceMemberUsage = {
  email: string;
  name: string;
  role: string;
  department?: string | null;
  cost_center?: string | null;
  estimated_total_tokens: number;
  estimated_total_cost_usd: number;
  chats_sent: number;
  documents_uploaded: number;
};

type WorkspaceSettings = {
  workspace_id: string;
  workspace_name: string;
  plan_name: string;
  seats_included: number;
  base_price_usd: number;
  seat_price_usd: number;
  monthly_token_quota: number;
  monthly_document_quota: number;
  smtp_enabled: boolean;
  department_budgets: WorkspaceDepartmentBudget[];
};

type WorkspaceDepartmentBudget = {
  id: string;
  department: string;
  monthly_budget_usd: number;
  alert_threshold_ratio: number;
  created_at: string;
  updated_at: string;
};

type EmailDeliveryJob = {
  id: string;
  recipient_email: string;
  email_type: string;
  status: string;
  attempt_count: number;
  subject: string;
  error_message?: string | null;
  sent_at?: string | null;
  processing_started_at?: string | null;
  processed_at?: string | null;
  worker_name?: string | null;
  created_at: string;
};

type WorkspaceApiKey = {
  id: string;
  label: string;
  key_prefix: string;
  status: string;
  last_used_at?: string | null;
  created_at: string;
};

type WorkspaceApiKeyCreateResponse = {
  api_key: string;
  item: WorkspaceApiKey;
};

type WorkspaceApiKeyUsage = {
  id: string;
  label: string;
  key_prefix: string;
  status: string;
  request_count: number;
  billable_request_count: number;
  estimated_tokens: number;
  estimated_cost_usd: number;
  last_used_at?: string | null;
  last_path?: string | null;
  top_paths: string[];
};

type WorkspaceObservability = {
  workspace_id: string;
  total_requests: number;
  error_requests: number;
  avg_duration_ms: number;
  last_request_at?: string | null;
  top_paths: string[];
  auth_mode_breakdown: Record<string, number>;
  recent_errors: string[];
};

const tokenStorageKey = "chat-ai-auth-token";
const requestLogFiltersStorageKey = "chat-ai-request-log-filters";

type EmailWorkerStatus = {
  worker_enabled: boolean;
  worker_running: boolean;
  queue_depth: number;
  processing_jobs: number;
  failed_jobs: number;
  last_processed_at?: string | null;
};

type RequestLogEntry = {
  id: number;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  auth_mode?: string | null;
  user_email?: string | null;
  api_key_label?: string | null;
  created_at: string;
};

type RequestLogPage = {
  items: RequestLogEntry[];
  total: number;
  limit: number;
  offset: number;
  next_offset?: number | null;
  previous_offset?: number | null;
};

type WorkspaceInvoiceLineItem = {
  label: string;
  amount_usd: number;
  quantity: number;
  unit: string;
};

type WorkspaceInvoiceMember = {
  email: string;
  name: string;
  role: string;
  department?: string | null;
  cost_center?: string | null;
  token_usage: number;
  estimated_usage_cost_usd: number;
  chats_sent: number;
  documents_uploaded: number;
};

type WorkspaceInvoiceSummary = {
  workspace_id: string;
  workspace_name: string;
  period_label: string;
  period_start: string;
  period_end: string;
  currency: string;
  seats_in_use: number;
  seats_included: number;
  token_usage: number;
  document_uploads: number;
  request_count: number;
  api_key_request_count: number;
  estimated_usage_cost_usd: number;
  subtotal_usd: number;
  total_usd: number;
  line_items: WorkspaceInvoiceLineItem[];
  member_breakdown: WorkspaceInvoiceMember[];
  department_alerts: WorkspaceDepartmentBudgetAlert[];
};

type WorkspaceDepartmentBudgetAlert = {
  department: string;
  monthly_budget_usd: number;
  spend_usd: number;
  utilization_ratio: number;
  member_count: number;
  status: string;
  alert_threshold_ratio: number;
};

function formatMetadataEntries(metadata: Record<string, unknown>) {
  return Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined);
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.googleMark}>
      <path
        d="M21.35 12.23c0-.72-.06-1.25-.19-1.8H12v3.41h5.38c-.11.85-.72 2.13-2.08 2.99l-.02.11 3.02 2.29.21.02c1.91-1.73 3-4.27 3-7.02Z"
        fill="#4285F4"
      />
      <path
        d="M12 21.62c2.64 0 4.85-.85 6.47-2.31l-3.21-2.42c-.85.58-1.99.99-3.26.99-2.58 0-4.77-1.68-5.55-4l-.1.01-3.14 2.38-.04.1A9.8 9.8 0 0 0 12 21.62Z"
        fill="#34A853"
      />
      <path
        d="M6.45 13.88A5.94 5.94 0 0 1 6.14 12c0-.65.11-1.27.29-1.88l-.01-.13-3.17-2.42-.1.05A9.52 9.52 0 0 0 2.1 12c0 1.57.38 3.06 1.05 4.38l3.3-2.5Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.11c1.6 0 2.68.68 3.3 1.25l2.4-2.29C16.84 4.28 14.64 3.38 12 3.38a9.8 9.8 0 0 0-8.85 5.24l3.28 2.5c.8-2.32 2.99-4.01 5.57-4.01Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function ChatApp() {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [authProviders, setAuthProviders] = useState<AuthProvidersResponse | null>(null);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationDetail | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [adminAnalytics, setAdminAnalytics] = useState<AdminAnalyticsOverview | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceDetail | null>(null);
  const [workspaceBilling, setWorkspaceBilling] = useState<WorkspaceBillingSummary | null>(null);
  const [workspaceSubscription, setWorkspaceSubscription] =
    useState<WorkspaceSubscriptionSummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInviteItem[]>([]);
  const [workspaceDocuments, setWorkspaceDocuments] = useState<WorkspaceDocumentItem[]>([]);
  const [memberUsage, setMemberUsage] = useState<WorkspaceMemberUsage[]>([]);
  const [emailJobs, setEmailJobs] = useState<EmailDeliveryJob[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [workspaceApiKeys, setWorkspaceApiKeys] = useState<WorkspaceApiKey[]>([]);
  const [workspaceApiKeyUsage, setWorkspaceApiKeyUsage] = useState<WorkspaceApiKeyUsage[]>([]);
  const [workspaceObservability, setWorkspaceObservability] =
    useState<WorkspaceObservability | null>(null);
  const [emailWorkerStatus, setEmailWorkerStatus] = useState<EmailWorkerStatus | null>(null);
  const [requestLogs, setRequestLogs] = useState<RequestLogEntry[]>([]);
  const [requestLogTotal, setRequestLogTotal] = useState(0);
  const [requestLogOffset, setRequestLogOffset] = useState(0);
  const [requestLogLimit] = useState(40);
  const [requestLogPreviousOffset, setRequestLogPreviousOffset] = useState<number | null>(null);
  const [requestLogNextOffset, setRequestLogNextOffset] = useState<number | null>(null);
  const [invoiceSummary, setInvoiceSummary] = useState<WorkspaceInvoiceSummary | null>(null);
  const [invoiceHistory, setInvoiceHistory] = useState<WorkspaceInvoiceSummary[]>([]);
  const [requestLogQuery, setRequestLogQuery] = useState("");
  const [requestLogAuthMode, setRequestLogAuthMode] = useState("");
  const [requestLogStatusCode, setRequestLogStatusCode] = useState("");
  const [memberDepartmentDrafts, setMemberDepartmentDrafts] = useState<Record<string, string>>({});
  const [memberCostCenterDrafts, setMemberCostCenterDrafts] = useState<Record<string, string>>({});
  const [departmentBudgetName, setDepartmentBudgetName] = useState("");
  const [departmentBudgetUsd, setDepartmentBudgetUsd] = useState("250");
  const [departmentBudgetThreshold, setDepartmentBudgetThreshold] = useState("0.8");
  const [newApiKeyLabel, setNewApiKeyLabel] = useState("");
  const [latestApiKey, setLatestApiKey] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [planName, setPlanName] = useState("");
  const [seatsIncluded, setSeatsIncluded] = useState("1");
  const [basePriceUsd, setBasePriceUsd] = useState("19");
  const [seatPriceUsd, setSeatPriceUsd] = useState("12");
  const [monthlyTokenQuota, setMonthlyTokenQuota] = useState("200000");
  const [monthlyDocumentQuota, setMonthlyDocumentQuota] = useState("200");
  const [input, setInput] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<"live" | "demo" | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleInitializedRef = useRef(false);
  const [isGoogleScriptReady, setIsGoogleScriptReady] = useState(false);
  const [showGoogleDevHint, setShowGoogleDevHint] = useState(false);
  const isSimpleWorkspaceMode = true;
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const isRegisterMode = authMode === "register";
  const authTitle = isRegisterMode ? "Buat akun reviewer" : "Masuk ke review proyek";
  const authCopy = isRegisterMode
    ? "Buat akun untuk mulai mengelola proyek, unggah plan, dan jalankan review AI berbasis kode bangunan."
    : "Masuk ke proyek yang sudah ada. Email dan Google akan mengarah ke akun yang sama bila alamatnya cocok.";
  const emailSubmitLabel = isRegisterMode ? "Buat akun dengan email" : "Masuk dengan email";
  const googleSubmitLabel = isRegisterMode ? "Daftar dengan Google" : "Masuk dengan Google";
  const googleProvider = authProviders?.google ?? null;
  const googleReady = Boolean(googleClientId && googleProvider?.enabled);
  const googleHelperText = googleProvider?.enabled
    ? googleProvider.description
    : googleProvider?.reason ??
      (googleClientId
        ? "Google login masih dipersiapkan."
        : "Google login belum dikonfigurasi di frontend.");

  const quickPrompts = [
    "Baca plan ini dan identifikasi ruang, fixture, dan area yang butuh review MEP.",
    "Susun checklist FBC dan NEC yang paling relevan untuk proyek ini.",
    "Ubah temuan review ini menjadi action items yang bisa dipakai engineer lapangan.",
    "Ringkas dokumen referensi ini untuk reviewer yang baru join ke proyek.",
    "Jelaskan alur Vision -> Code -> Routing untuk plan ini secara praktis.",
    "Jawab dulu secara umum, lalu tandai bagian yang masih butuh dokumen proyek atau referensi kode.",
  ];
  const proofCards = [
    {
      label: "Pengguna utama",
      title: "Tim arsitektur, MEP, dan reviewer kode",
      copy: "Dipakai oleh tim yang perlu membaca plan, memuat referensi FBC atau NEC, lalu menyusun temuan review dan tindak lanjut tanpa bolak-balik antar file.",
    },
    {
      label: "Masalah utama",
      title: "Review plan dan lookup kode masih manual",
      copy: "Workflow blueprint, code lookup, dan handoff ke engineer biasanya terpisah. App ini menyatukannya dalam satu dashboard proyek yang lebih utuh.",
    },
    {
      label: "Alur inti",
      title: "Intake plan, cocokkan kode, siapkan handoff",
      copy: "User unggah plan dan referensi, minta AI menyusun checklist review, lalu ubah temuan menjadi catatan yang siap diteruskan ke tim desain atau lapangan.",
    },
  ];
  const trustSignals = [
    "Vision intake untuk plan dan file referensi",
    "Code-aware review dengan basis FBC dan NEC",
    "Audit trail, request log, dan usage tracking",
    "PostgreSQL, migrasi, dan deploy path siap",
  ];
  const recruiterSignals = [
    {
      title: "Cara pikir produk",
      copy: "Masalah, target user, dan alur kerja building-plan review terlihat jelas sejak landing sampai proyek aktif.",
    },
    {
      title: "Eksekusi end-to-end",
      copy: "App ini menunjukkan dashboard, auth, data layer, upload, review AI, dan observabilitas dalam satu produk yang utuh.",
    },
    {
      title: "Kesiapan operasional",
      copy: "Ada proyek, dokumen referensi, run log, audit trail, quota signals, dan fallback demo untuk presentasi yang tetap stabil.",
    },
  ];
  const demoScenarios = [
    {
      title: "Intake plan",
      prompt: "Baca plan ini dan identifikasi ruang, fixture, dan area yang butuh review MEP.",
    },
    {
      title: "Checklist code",
      prompt: "Susun checklist FBC dan NEC yang paling relevan untuk proyek ini.",
    },
    {
      title: "Handoff engineer",
      prompt: "Ubah temuan review ini menjadi action items yang bisa dipakai engineer lapangan.",
    },
  ];

  function handleSwitchAuthMode(nextMode: "login" | "register") {
    setAuthMode(nextMode);
    setError(null);
  }
  const starterFlows = [
    {
      title: "Review plan cepat",
      description: "Mulai dari plan atau gambar yang baru diunggah lalu minta AI mengidentifikasi ruang dan area review.",
      prompt: "Baca plan ini dan identifikasi ruang, fixture, dan area yang butuh review MEP.",
    },
    {
      title: "Checklist kode bangunan",
      description: "Gunakan AI untuk menyusun poin review yang relevan dari FBC, NEC, atau dokumen referensi proyek.",
      prompt: "Susun checklist FBC dan NEC yang paling relevan untuk proyek ini.",
    },
    {
      title: "Action items MEP",
      description: "Ubah temuan review menjadi daftar tindak lanjut yang siap diteruskan ke engineer atau drafter.",
      prompt: "Ubah temuan review ini menjadi action items yang bisa dipakai engineer lapangan.",
    },
  ];
  const projectPlanDocuments = workspaceDocuments.filter((document) =>
    /(plan|floor|layout|arch|mep|blueprint|drawing|elevation|section)/i.test(document.name),
  );
  const codeReferenceDocuments = workspaceDocuments.filter((document) =>
    /(fbc|nec|code|spec|standard|manual|reference)/i.test(document.name),
  );
  const projectReadiness = [
    {
      label: "Proyek aktif",
      value: activeWorkspace?.name ?? "Belum dipilih",
      ready: Boolean(activeWorkspace),
    },
    {
      label: "File plan",
      value:
        projectPlanDocuments.length > 0
          ? `${projectPlanDocuments.length} file terdeteksi`
          : "Belum ada plan",
      ready: projectPlanDocuments.length > 0,
    },
    {
      label: "Referensi kode",
      value:
        codeReferenceDocuments.length > 0
          ? `${codeReferenceDocuments.length} referensi aktif`
          : "Belum ada FBC / NEC",
      ready: codeReferenceDocuments.length > 0,
    },
    {
      label: "Sesi review",
      value: activeConversation ? `${activeConversation.messages.length} catatan aktif` : "Belum ada sesi",
      ready: Boolean(activeConversation),
    },
  ];

  async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Permintaan gagal.");
    }
    return (await response.json()) as T;
  }

  const apiFetch = useCallback(async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (activeWorkspace?.id) {
      headers.set("X-Workspace-Id", activeWorkspace.id);
    }
    return fetch(input, {
      ...init,
      headers,
      cache: "no-store",
    });
  }, [activeWorkspace?.id, token]);

  const fetchConversationSummaries = useCallback(async () => {
    const response = await apiFetch("/api/backend/conversations");
    const data = await readJson<ConversationSummary[]>(response);
    setConversations(data);
    return data;
  }, [apiFetch]);

  const fetchAnalytics = useCallback(async () => {
    const response = await apiFetch("/api/backend/analytics/overview");
    const data = await readJson<AnalyticsOverview>(response);
    setAnalytics(data);
    return data;
  }, [apiFetch]);

  const fetchAdminAnalytics = useCallback(async () => {
    if (isSimpleWorkspaceMode) {
      setAdminAnalytics(null);
      return null;
    }
    const response = await apiFetch("/api/backend/admin/analytics");
    if (response.status === 403) {
      setAdminAnalytics(null);
      return null;
    }
    const data = await readJson<AdminAnalyticsOverview>(response);
    setAdminAnalytics(data);
    return data;
  }, [apiFetch, isSimpleWorkspaceMode]);

  const fetchEmailWorkerStatus = useCallback(async () => {
    if (isSimpleWorkspaceMode) {
      setEmailWorkerStatus(null);
      return null;
    }
    const response = await apiFetch("/api/backend/system/email-worker-status");
    if (response.status === 403) {
      setEmailWorkerStatus(null);
      return null;
    }
    const data = await readJson<EmailWorkerStatus>(response);
    setEmailWorkerStatus(data);
    return data;
  }, [apiFetch, isSimpleWorkspaceMode]);

  const fetchWorkspaces = useCallback(async () => {
    const response = await apiFetch("/api/backend/workspaces");
    const data = await readJson<WorkspaceSummary[]>(response);
    setWorkspaces(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceDetail = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}`);
    const data = await readJson<WorkspaceDetail>(response);
    setActiveWorkspace(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceBilling = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/billing`);
    const data = await readJson<WorkspaceBillingSummary>(response);
    setWorkspaceBilling(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceSubscription = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/subscription`);
    const data = await readJson<WorkspaceSubscriptionSummary>(response);
    setWorkspaceSubscription(data);
    return data;
  }, [apiFetch]);

  const fetchAuditLogs = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/audit-logs`);
    if (response.status === 403) {
      setAuditLogs([]);
      return [];
    }
    const data = await readJson<AuditLogItem[]>(response);
    setAuditLogs(data);
    return data;
  }, [apiFetch]);

  const fetchPendingInvites = useCallback(async () => {
    const response = await apiFetch("/api/backend/workspace-invitations");
    const data = await readJson<WorkspaceInviteItem[]>(response);
    setPendingInvites(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceDocuments = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/documents`);
    const data = await readJson<WorkspaceDocumentItem[]>(response);
    setWorkspaceDocuments(data);
    return data;
  }, [apiFetch]);

  const fetchMemberUsage = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/usage-by-member`);
    if (response.status === 403) {
      setMemberUsage([]);
      return [];
    }
    const data = await readJson<WorkspaceMemberUsage[]>(response);
    setMemberUsage(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceSettings = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/settings`);
    if (response.status === 403) {
      setWorkspaceSettings(null);
      return null;
    }
    const data = await readJson<WorkspaceSettings>(response);
    setWorkspaceSettings(data);
    setPlanName(data.plan_name);
    setSeatsIncluded(String(data.seats_included));
    setBasePriceUsd(String(data.base_price_usd));
    setSeatPriceUsd(String(data.seat_price_usd));
    setMonthlyTokenQuota(String(data.monthly_token_quota));
    setMonthlyDocumentQuota(String(data.monthly_document_quota));
    return data;
  }, [apiFetch]);

  const fetchEmailJobs = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/email-jobs`);
    if (response.status === 403) {
      setEmailJobs([]);
      return [];
    }
    const data = await readJson<EmailDeliveryJob[]>(response);
    setEmailJobs(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceApiKeys = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/api-keys`);
    if (response.status === 403) {
      setWorkspaceApiKeys([]);
      return [];
    }
    const data = await readJson<WorkspaceApiKey[]>(response);
    setWorkspaceApiKeys(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceApiKeyUsage = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/api-keys/usage`);
    if (response.status === 403) {
      setWorkspaceApiKeyUsage([]);
      return [];
    }
    const data = await readJson<WorkspaceApiKeyUsage[]>(response);
    setWorkspaceApiKeyUsage(data);
    return data;
  }, [apiFetch]);

  const fetchWorkspaceObservability = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/observability`);
    if (response.status === 403) {
      setWorkspaceObservability(null);
      return null;
    }
    const data = await readJson<WorkspaceObservability>(response);
    setWorkspaceObservability(data);
    return data;
  }, [apiFetch]);

  const fetchRequestLogs = useCallback(async (
    workspaceId: string,
    options?: { offset?: number; limit?: number },
  ) => {
    const query = new URLSearchParams({
      limit: String(options?.limit ?? requestLogLimit),
      offset: String(options?.offset ?? 0),
    });
    if (requestLogQuery.trim()) {
      query.set("path_query", requestLogQuery.trim());
    }
    if (requestLogAuthMode) {
      query.set("auth_mode", requestLogAuthMode);
    }
    if (requestLogStatusCode) {
      query.set("status_code", requestLogStatusCode);
    }
    const response = await apiFetch(
      `/api/backend/workspaces/${workspaceId}/request-logs?${query.toString()}`,
    );
    if (response.status === 403) {
      setRequestLogs([]);
      return [];
    }
    const data = await readJson<RequestLogPage>(response);
    setRequestLogs(data.items);
    setRequestLogTotal(data.total);
    setRequestLogPreviousOffset(data.previous_offset ?? null);
    setRequestLogNextOffset(data.next_offset ?? null);
    return data;
  }, [apiFetch, requestLogAuthMode, requestLogLimit, requestLogQuery, requestLogStatusCode]);

  const fetchInvoiceSummary = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/invoices/current`);
    if (response.status === 403) {
      setInvoiceSummary(null);
      return null;
    }
    const data = await readJson<WorkspaceInvoiceSummary>(response);
    setInvoiceSummary(data);
    return data;
  }, [apiFetch]);

  const fetchInvoiceHistory = useCallback(async (workspaceId: string) => {
    const response = await apiFetch(`/api/backend/workspaces/${workspaceId}/invoices/history?months=6`);
    if (response.status === 403) {
      setInvoiceHistory([]);
      return [];
    }
    const data = await readJson<WorkspaceInvoiceSummary[]>(response);
    setInvoiceHistory(data);
    return data;
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;

    async function loadPublicAuthState() {
      try {
        const [healthResponse, providerResponse] = await Promise.all([
          fetch("/api/backend/health", { cache: "no-store" }),
          fetch("/api/backend/auth/providers", { cache: "no-store" }),
        ]);
        if (cancelled) {
          return;
        }
        setBackendStatus(healthResponse.ok ? "online" : "offline");
        if (providerResponse.ok) {
          const providerData = await readJson<AuthProvidersResponse>(providerResponse);
          if (!cancelled) {
            setAuthProviders(providerData);
          }
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
        }
      }
    }

    void loadPublicAuthState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const hostname = window.location.hostname;
    setShowGoogleDevHint(hostname === "localhost" || hostname === "127.0.0.1");
  }, []);

  useEffect(() => {
    const savedToken = window.localStorage.getItem(tokenStorageKey);
    if (!savedToken) {
      setIsBooting(false);
      return;
    }

    let cancelled = false;

    async function restoreSession() {
      try {
        setToken(savedToken);
        const response = await fetch("/api/backend/auth/me", {
          headers: {
            Authorization: `Bearer ${savedToken}`,
          },
          cache: "no-store",
        });
        const me = await readJson<User>(response);
        if (cancelled) {
          return;
        }
        setUser(me);
      } catch {
        window.localStorage.removeItem(tokenStorageKey);
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(requestLogFiltersStorageKey);
    if (!raw) {
      return;
    }
    try {
      const saved = JSON.parse(raw) as {
        query?: string;
        authMode?: string;
        statusCode?: string;
      };
      setRequestLogQuery(saved.query ?? "");
      setRequestLogAuthMode(saved.authMode ?? "");
      setRequestLogStatusCode(saved.statusCode ?? "");
    } catch {
      window.localStorage.removeItem(requestLogFiltersStorageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      requestLogFiltersStorageKey,
      JSON.stringify({
        query: requestLogQuery,
        authMode: requestLogAuthMode,
        statusCode: requestLogStatusCode,
      }),
    );
  }, [requestLogAuthMode, requestLogQuery, requestLogStatusCode]);

  useEffect(() => {
    if (!token || !user) {
      setConversations([]);
      setActiveConversation(null);
      return;
    }

    let cancelled = false;

    async function bootWorkspace() {
      try {
        setError(null);
        setIsBooting(true);
        const workspaceList = await fetchWorkspaces();

        if (cancelled) {
          return;
        }

        if (workspaceList.length > 0) {
          const workspaceDetail = await fetchWorkspaceDetail(workspaceList[0].id);
          if (!cancelled) {
            setActiveWorkspace(workspaceDetail);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat workspace.");
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    void bootWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    apiFetch,
    fetchAdminAnalytics,
    fetchAnalytics,
    fetchWorkspaceBilling,
    fetchWorkspaceDetail,
    fetchWorkspaces,
    token,
    user,
  ]);

  useEffect(() => {
    if (!activeWorkspace || !token || !user) {
      return;
    }

    const workspaceId = activeWorkspace.id;
    let cancelled = false;

    async function loadWorkspaceData() {
      try {
        const [list, analyticsData] = await Promise.all([
          fetchConversationSummaries(),
          fetchAnalytics(),
        ]);
        await Promise.all([
          fetchWorkspaceBilling(workspaceId),
          fetchWorkspaceSubscription(workspaceId),
          fetchAuditLogs(workspaceId),
          fetchWorkspaceDocuments(workspaceId),
          fetchPendingInvites(),
          fetchMemberUsage(workspaceId),
          fetchWorkspaceSettings(workspaceId),
          fetchEmailJobs(workspaceId),
          fetchWorkspaceApiKeys(workspaceId),
          fetchWorkspaceApiKeyUsage(workspaceId),
          fetchWorkspaceObservability(workspaceId),
          fetchRequestLogs(workspaceId, { offset: requestLogOffset, limit: requestLogLimit }),
          fetchInvoiceSummary(workspaceId),
          fetchInvoiceHistory(workspaceId),
          fetchAdminAnalytics(),
          fetchEmailWorkerStatus(),
        ]);

        if (cancelled) {
          return;
        }

        if (list.length > 0) {
          const detailResponse = await apiFetch(`/api/backend/conversations/${list[0].id}`);
          const detail = await readJson<ConversationDetail>(detailResponse);
          if (!cancelled) {
            setActiveConversation(detail);
            setConversations(list);
          }
        } else {
          setActiveConversation(null);
        }

        setAnalytics(analyticsData);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat data workspace.");
        }
      }
    }

    void loadWorkspaceData();

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspace,
    apiFetch,
    fetchAdminAnalytics,
    fetchEmailWorkerStatus,
    fetchAuditLogs,
    fetchEmailJobs,
    fetchAnalytics,
    fetchConversationSummaries,
    fetchMemberUsage,
    fetchWorkspaceApiKeys,
    fetchWorkspaceApiKeyUsage,
    fetchWorkspaceObservability,
    fetchWorkspaceBilling,
    fetchPendingInvites,
    fetchRequestLogs,
    requestLogLimit,
    requestLogOffset,
    fetchInvoiceHistory,
    fetchWorkspaceSubscription,
    fetchWorkspaceSettings,
    fetchWorkspaceDocuments,
    fetchInvoiceSummary,
    token,
    user,
  ]);

  useEffect(() => {
    setRequestLogOffset(0);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!activeWorkspace) {
      setMemberDepartmentDrafts({});
      setMemberCostCenterDrafts({});
      return;
    }
    const nextDepartments: Record<string, string> = {};
    const nextCostCenters: Record<string, string> = {};
    for (const member of activeWorkspace.members) {
      nextDepartments[member.email] = member.department ?? "";
      nextCostCenters[member.email] = member.cost_center ?? "";
    }
    setMemberDepartmentDrafts(nextDepartments);
    setMemberCostCenterDrafts(nextCostCenters);
  }, [activeWorkspace]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeConversation?.messages]);

  async function loadConversation(
    conversationId: string,
    nextSummaries?: ConversationSummary[],
  ) {
    const response = await apiFetch(`/api/backend/conversations/${conversationId}`);
    const detail = await readJson<ConversationDetail>(response);
    setActiveConversation(detail);

    if (nextSummaries) {
      setConversations(nextSummaries);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setError(null);
      setIsAuthenticating(true);
      const endpoint =
        authMode === "register" ? "/api/backend/auth/register" : "/api/backend/auth/login";
      const payload = {
        name: authMode === "register" ? authName : undefined,
        email: authEmail,
        password: authPassword,
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await readJson<AuthResponse>(response);
      window.localStorage.setItem(tokenStorageKey, data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Autentikasi gagal.");
    } finally {
      setIsAuthenticating(false);
    }
  }

  const handleGoogleLogin = useCallback(async (credential: string) => {
    try {
      setError(null);
      setIsAuthenticating(true);
      const response = await fetch("/api/backend/auth/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ credential }),
      });
      const data = await readJson<AuthResponse>(response);
      window.localStorage.setItem(tokenStorageKey, data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google login gagal.");
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  useEffect(() => {
    if (user || !googleReady || !isGoogleScriptReady || !window.google || !googleButtonRef.current) {
      return;
    }

    if (!googleInitializedRef.current) {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          if (response.credential) {
            void handleGoogleLogin(response.credential);
          }
        },
      });
      googleInitializedRef.current = true;
    }
    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      text: isRegisterMode ? "signup_with" : "signin_with",
      shape: "pill",
      logo_alignment: "left",
      width: 320,
    });
  }, [googleReady, googleClientId, handleGoogleLogin, isGoogleScriptReady, isRegisterMode, user]);

  async function handlePasswordResetRequest() {
    if (!authEmail.trim()) {
      setError("Isi email dulu untuk kirim reset password.");
      return;
    }

    try {
      setError(null);
      const response = await fetch("/api/backend/auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: authEmail }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal kirim reset password.");
      }
      setError("Link reset password sudah diproses. Cek inbox atau email queue.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal kirim reset password.");
    }
  }

  function handleLogout() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    window.localStorage.removeItem(tokenStorageKey);
    setToken(null);
    setUser(null);
    setConversations([]);
    setActiveConversation(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
    setWorkspaceBilling(null);
    setWorkspaceSubscription(null);
    setAuditLogs([]);
    setPendingInvites([]);
    setWorkspaceDocuments([]);
    setMemberUsage([]);
    setEmailJobs([]);
    setWorkspaceSettings(null);
    setWorkspaceApiKeys([]);
    setWorkspaceApiKeyUsage([]);
    setWorkspaceObservability(null);
    setEmailWorkerStatus(null);
    setRequestLogs([]);
    setRequestLogTotal(0);
    setRequestLogOffset(0);
    setRequestLogPreviousOffset(null);
    setRequestLogNextOffset(null);
    setInvoiceSummary(null);
    setInvoiceHistory([]);
    setMemberDepartmentDrafts({});
    setMemberCostCenterDrafts({});
    setLatestApiKey(null);
    setError(null);
    setInput("");
  }

  async function handleSelectWorkspace(workspaceId: string) {
    try {
      setError(null);
      await fetchWorkspaceDetail(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat workspace.");
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceName.trim()) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch("/api/backend/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: workspaceName }),
      });
      const created = await readJson<WorkspaceDetail>(response);
      const list = await fetchWorkspaces();
      setActiveWorkspace(created);
      setWorkspaces(list);
      setWorkspaceName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat workspace.");
    }
  }

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace || !inviteEmail.trim()) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(`/api/backend/workspaces/${activeWorkspace.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: inviteEmail, role: "member" }),
      });
      const detail = await readJson<WorkspaceDetail>(response);
      setActiveWorkspace(detail);
      const list = await fetchWorkspaces();
      setWorkspaces(list);
      await fetchWorkspaceBilling(activeWorkspace.id);
      await fetchWorkspaceSubscription(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
      await fetchPendingInvites();
      await fetchEmailJobs(activeWorkspace.id);
      await fetchEmailWorkerStatus();
      setInviteEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah member.");
    }
  }

  async function handleRemoveMember(memberEmail: string) {
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/members/${encodeURIComponent(memberEmail)}`,
        {
          method: "DELETE",
        },
      );
      const detail = await readJson<WorkspaceDetail>(response);
      setActiveWorkspace(detail);
      const list = await fetchWorkspaces();
      setWorkspaces(list);
      await fetchWorkspaceBilling(activeWorkspace.id);
      await fetchWorkspaceSubscription(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
      await fetchPendingInvites();
      await fetchMemberUsage(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus member.");
    }
  }

  async function handleSaveMemberMetadata(memberEmail: string) {
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/members/${encodeURIComponent(memberEmail)}/metadata`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            department: memberDepartmentDrafts[memberEmail] ?? "",
            cost_center: memberCostCenterDrafts[memberEmail] ?? "",
          }),
        },
      );
      const detail = await readJson<WorkspaceDetail>(response);
      setActiveWorkspace(detail);
      await fetchAuditLogs(activeWorkspace.id);
      await fetchMemberUsage(activeWorkspace.id);
      await fetchInvoiceSummary(activeWorkspace.id);
      await fetchInvoiceHistory(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan metadata member.");
    }
  }

  async function handleInvitationDecision(tokenValue: string, action: "accept" | "reject") {
    try {
      setError(null);
      const response = await apiFetch(`/api/backend/workspace-invitations/${tokenValue}/${action}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal memproses undangan.");
      }

      await fetchPendingInvites();
      const workspacesList = await fetchWorkspaces();
      if (action === "accept") {
        const acceptedInvite = pendingInvites.find((invite) => invite.token === tokenValue);
        const targetWorkspaceId = acceptedInvite?.workspace_id ?? workspacesList[0]?.id;
        if (targetWorkspaceId) {
          await fetchWorkspaceDetail(targetWorkspaceId);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses undangan.");
    }
  }

  async function handleMockCheckout() {
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/subscription/checkout-mock`,
        {
          method: "POST",
        },
      );
      const data = await readJson<WorkspaceSubscriptionSummary>(response);
      setWorkspaceSubscription(data);
      await fetchAuditLogs(activeWorkspace.id);
      await fetchWorkspaceSettings(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat mock checkout.");
    }
  }

  async function handleSaveWorkspaceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(`/api/backend/workspaces/${activeWorkspace.id}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan_name: planName,
          seats_included: Number(seatsIncluded),
          base_price_usd: Number(basePriceUsd),
          seat_price_usd: Number(seatPriceUsd),
          monthly_token_quota: Number(monthlyTokenQuota),
          monthly_document_quota: Number(monthlyDocumentQuota),
        }),
      });
      const data = await readJson<WorkspaceSettings>(response);
      setWorkspaceSettings(data);
      await fetchWorkspaceSubscription(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan workspace settings.");
    }
  }

  async function handleSaveDepartmentBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/department-budgets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            department: departmentBudgetName,
            monthly_budget_usd: Number(departmentBudgetUsd),
            alert_threshold_ratio: Number(departmentBudgetThreshold),
          }),
        },
      );
      const budgets = await readJson<WorkspaceDepartmentBudget[]>(response);
      setWorkspaceSettings((current) =>
        current
          ? {
              ...current,
              department_budgets: budgets,
            }
          : current,
      );
      setDepartmentBudgetName("");
      setDepartmentBudgetUsd("250");
      setDepartmentBudgetThreshold("0.8");
      await fetchInvoiceSummary(activeWorkspace.id);
      await fetchInvoiceHistory(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan budget department.");
    }
  }

  async function handleDeleteDepartmentBudget(budgetId: string) {
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/department-budgets/${budgetId}`,
        {
          method: "DELETE",
        },
      );
      const budgets = await readJson<WorkspaceDepartmentBudget[]>(response);
      setWorkspaceSettings((current) =>
        current
          ? {
              ...current,
              department_budgets: budgets,
            }
          : current,
      );
      await fetchInvoiceSummary(activeWorkspace.id);
      await fetchInvoiceHistory(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus budget department.");
    }
  }

  async function handleRetryEmailJob(jobId: string) {
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/email-jobs/${jobId}/retry`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal retry email.");
      }
      await fetchEmailJobs(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
      await fetchEmailWorkerStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal retry email.");
    }
  }

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace || !newApiKeyLabel.trim()) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(`/api/backend/workspaces/${activeWorkspace.id}/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: newApiKeyLabel }),
      });
      const data = await readJson<WorkspaceApiKeyCreateResponse>(response);
      setLatestApiKey(data.api_key);
      setNewApiKeyLabel("");
      await fetchWorkspaceApiKeys(activeWorkspace.id);
      await fetchWorkspaceApiKeyUsage(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat API key.");
    }
  }

  async function downloadProtectedFile(path: string, filename: string) {
    const response = await apiFetch(path);
    if (!response.ok) {
      throw new Error((await response.text()) || "Gagal mengunduh file.");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  async function handleExportRequestLogsCsv() {
    if (!activeWorkspace) {
      return;
    }
    try {
      setError(null);
      const query = new URLSearchParams({ limit: "200" });
      if (requestLogQuery.trim()) {
        query.set("path_query", requestLogQuery.trim());
      }
      if (requestLogAuthMode) {
        query.set("auth_mode", requestLogAuthMode);
      }
      if (requestLogStatusCode) {
        query.set("status_code", requestLogStatusCode);
      }
      await downloadProtectedFile(
        `/api/backend/workspaces/${activeWorkspace.id}/request-logs.csv?${query.toString()}`,
        `workspace-${activeWorkspace.id}-request-logs.csv`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunduh request log.");
    }
  }

  async function handleApplyRequestLogFilters() {
    if (!activeWorkspace) {
      return;
    }
    try {
      setError(null);
      setRequestLogOffset(0);
      await fetchRequestLogs(activeWorkspace.id, { offset: 0, limit: requestLogLimit });
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat request log.");
    }
  }

  async function handleRequestLogPage(nextOffset: number) {
    if (!activeWorkspace) {
      return;
    }
    try {
      setError(null);
      setRequestLogOffset(nextOffset);
      await fetchRequestLogs(activeWorkspace.id, { offset: nextOffset, limit: requestLogLimit });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal pindah halaman request log.");
    }
  }

  async function handleExportInvoiceCsv() {
    if (!activeWorkspace) {
      return;
    }
    try {
      setError(null);
      await downloadProtectedFile(
        `/api/backend/workspaces/${activeWorkspace.id}/invoices/current.csv`,
        `workspace-${activeWorkspace.id}-invoice-current.csv`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal export invoice.");
    }
  }

  async function handleRevokeApiKey(apiKeyId: string) {
    if (!activeWorkspace) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/workspaces/${activeWorkspace.id}/api-keys/${apiKeyId}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal revoke API key.");
      }
      await fetchWorkspaceApiKeys(activeWorkspace.id);
      await fetchWorkspaceApiKeyUsage(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal revoke API key.");
    }
  }

  async function handleCopyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setError("Gagal menyalin invite link.");
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  }

  async function handleNewChat() {
    if (isLoading) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch("/api/backend/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const conversation = await readJson<ConversationDetail>(response);
      const list = await fetchConversationSummaries();
      await fetchAnalytics();
      await fetchAdminAnalytics();
      setActiveConversation(conversation);
      setConversations(list);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat sesi review baru.");
    }
  }

  async function handleSelectConversation(conversationId: string) {
    if (isLoading) {
      return;
    }

    try {
      setError(null);
      await loadConversation(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat sesi review.");
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    if (isLoading || conversations.length === 1) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(`/api/backend/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal menghapus sesi review.");
      }

      const nextList = await fetchConversationSummaries();
      const nextActiveId =
        activeConversation?.id === conversationId ? nextList[0]?.id : activeConversation?.id;

      if (nextActiveId) {
        await loadConversation(nextActiveId, nextList);
      } else {
        setActiveConversation(null);
      }
      await fetchAnalytics();
      await fetchAdminAnalytics();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus sesi review.");
    }
  }

  async function handleReset() {
    if (!activeConversation || isLoading) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(
        `/api/backend/conversations/${activeConversation.id}/reset`,
        {
          method: "POST",
        },
      );
      const conversation = await readJson<ConversationDetail>(response);
      setActiveConversation(conversation);
      await fetchConversationSummaries();
      await fetchAnalytics();
      await fetchAdminAnalytics();
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal reset sesi review.");
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!activeConversation) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setError(null);
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      const response = await apiFetch(
        `/api/backend/conversations/${activeConversation.id}/documents`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error((await response.text()) || "Upload dokumen gagal.");
      }

      await loadConversation(activeConversation.id);
      await fetchConversationSummaries();
      await fetchAnalytics();
      await fetchAdminAnalytics();
      if (activeWorkspace?.id) {
        await fetchWorkspaceDocuments(activeWorkspace.id);
      }
      event.target.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal upload dokumen.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteDocument(documentId: number) {
    if (!activeConversation || isLoading) {
      return;
    }

    try {
      setError(null);
      const response = await apiFetch(`/api/backend/documents/${documentId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal menghapus dokumen.");
      }

      await loadConversation(activeConversation.id);
      await fetchConversationSummaries();
      await fetchAnalytics();
      await fetchAdminAnalytics();
      if (activeWorkspace?.id) {
        await fetchWorkspaceDocuments(activeWorkspace.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus dokumen.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeConversation) {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const tempUser: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const tempAssistant: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
    };

    setActiveConversation((current) =>
      current
        ? {
            ...current,
            title:
              current.title === "Chat baru" || current.title === "Review baru"
                ? trimmed.slice(0, 48) || "Review baru"
                : current.title,
            messages: [...current.messages, tempUser, tempAssistant],
          }
        : current,
    );
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await apiFetch(`/api/backend/conversations/${activeConversation.id}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          content: trimmed,
        }),
      });
      const modeHeader = response.headers.get("x-ai-mode");
      if (modeHeader === "demo" || modeHeader === "live") {
        setAiMode(modeHeader);
      }

      if (!response.ok) {
        throw new Error((await response.text()) || "Gagal mendapatkan jawaban.");
      }

      if (!response.body) {
        throw new Error("Stream dari server tidak tersedia.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        fullReply += decoder.decode(value, { stream: true });
        setActiveConversation((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === tempAssistant.id ? { ...message, content: fullReply } : message,
                ),
              }
            : current,
        );
      }

      fullReply += decoder.decode();
      if (!fullReply.trim()) {
        throw new Error("Model tidak mengembalikan jawaban.");
      }

      const summaries = await fetchConversationSummaries();
      await fetchAnalytics();
      await fetchAdminAnalytics();
      await loadConversation(activeConversation.id, summaries);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setActiveConversation((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === tempAssistant.id
                    ? { ...message, content: message.content || "Jawaban dihentikan." }
                    : message,
                ),
              }
            : current,
        );
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "Terjadi kesalahan saat menghubungi model AI.";
        setActiveConversation((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === tempAssistant.id
                    ? {
                        ...message,
                        content:
                          message.content ||
                          `Maaf, saya belum bisa menjawab sekarang. ${errorMessage}`,
                      }
                    : message,
                ),
              }
            : current,
        );
        setError(errorMessage);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }

  function handleQuickPrompt(prompt: string) {
    setInput(prompt);
    promptInputRef.current?.focus();
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  if (!user) {
    return (
      <main className={styles.page}>
        {googleClientId ? (
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onLoad={() => setIsGoogleScriptReady(true)}
          />
        ) : null}
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Building Plan Automation MVP</p>
          <h1>Platform AI untuk intake plan, basis kode bangunan, dan koordinasi review MEP.</h1>
          <p className={styles.subcopy}>
            Produk ini menunjukkan bagaimana satu dashboard bisa dipakai untuk membaca plan, memuat
            referensi FBC atau NEC, menyusun checklist review, dan menyiapkan handoff kerja ke engineer
            tanpa memecah alur ke banyak tool yang terpisah.
          </p>
          <div className={styles.recruiterStrip}>
            <span className={styles.recruiterStripLabel}>Yang Ditunjukkan App Ini</span>
            <strong>AI review workflow, reasoning berbasis kode, dan eksekusi full-stack end-to-end.</strong>
          </div>
          <div className={styles.statusStrip}>
            <article className={styles.statusCard}>
              <span className={styles.statusLabel}>Backend</span>
              <strong>{backendStatus === "online" ? "Aktif" : backendStatus === "offline" ? "Tidak aktif" : "Mengecek"}</strong>
              <p>{backendStatus === "online" ? "API lokal siap dipakai." : "Koneksi backend sedang dicek."}</p>
            </article>
            <article className={styles.statusCard}>
              <span className={styles.statusLabel}>Data layer</span>
              <strong>Siap PostgreSQL</strong>
              <p>Schema, migration, dan data proyek sudah disiapkan untuk alur yang lebih siap produksi.</p>
            </article>
            <article className={styles.statusCard}>
              <span className={styles.statusLabel}>Jalur AI</span>
              <strong>{aiMode === "demo" ? "Mode demo stabil" : "Hybrid siap"}</strong>
              <p>Vision intake, retrieval referensi kode, dan fallback demo tersedia dalam satu alur produk.</p>
            </article>
          </div>
          <div className={styles.proofGrid}>
            {proofCards.map((card) => (
              <article key={card.title} className={styles.proofCard}>
                <span className={styles.statusLabel}>{card.label}</span>
                <strong>{card.title}</strong>
                <p>{card.copy}</p>
              </article>
            ))}
          </div>
          <div className={styles.trustBar}>
            {trustSignals.map((signal) => (
              <span key={signal} className={styles.trustChip}>
                {signal}
              </span>
            ))}
          </div>
          <div className={styles.recruiterPanel}>
            <div className={styles.recruiterHeader}>
              <div>
                <p className={styles.statusLabel}>Untuk Recruiter</p>
                <strong className={styles.recruiterTitle}>Yang ditunjukkan app ini tentang cara kerja saya</strong>
              </div>
              <p className={styles.recruiterCopy}>
                Fokus utamanya bukan cuma membuat chat AI, tetapi membangun workflow review plan yang
                usable, stabil, dan punya pijakan produk yang jelas untuk tim desain atau MEP.
              </p>
            </div>
            <div className={styles.recruiterGrid}>
              {recruiterSignals.map((item) => (
                <article key={item.title} className={styles.recruiterCard}>
                  <strong>{item.title}</strong>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
          <div className={styles.demoFlowPanel}>
            <div className={styles.demoFlowHeader}>
              <div>
                <p className={styles.statusLabel}>Alur demo yang disarankan</p>
                <strong className={styles.demoFlowTitle}>Tiga langkah untuk menunjukkan value produk</strong>
              </div>
              <p className={styles.demoFlowCopy}>
                Buka app, buat proyek, unggah plan dan referensi kode, lalu tunjukkan bagaimana review AI
                berubah menjadi checklist dan tindak lanjut yang konkret.
              </p>
            </div>
            <div className={styles.demoFlowGrid}>
              <article className={styles.demoStepCard}>
                <span className={styles.demoStepNumber}>01</span>
                <strong>Mulai dari intake plan</strong>
                <p>Tunjukkan bahwa plan atau layout bisa masuk sebagai konteks awal untuk identifikasi ruang dan fixture.</p>
              </article>
              <article className={styles.demoStepCard}>
                <span className={styles.demoStepNumber}>02</span>
                <strong>Muat FBC atau NEC</strong>
                <p>Tunjukkan bahwa referensi kode bangunan bisa dipakai untuk menyusun checklist review yang relevan.</p>
              </article>
              <article className={styles.demoStepCard}>
                <span className={styles.demoStepNumber}>03</span>
                <strong>Ubah jadi handoff kerja</strong>
                <p>Tutup dengan action items, catatan review, dan log produk supaya alurnya terasa siap diteruskan ke tim.</p>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.authShell}>
          <div className={styles.authPanel}>
            <div className={styles.authHeader}>
              <strong className={styles.authTitle}>{authTitle}</strong>
              <p className={styles.authCopy}>{authCopy}</p>
            </div>

            <div className={styles.authTabs}>
              <button
                className={`${styles.authTab} ${authMode === "register" ? styles.authTabActive : ""}`}
                type="button"
                onClick={() => handleSwitchAuthMode("register")}
              >
                Buat akun
              </button>
              <button
                className={`${styles.authTab} ${authMode === "login" ? styles.authTabActive : ""}`}
                type="button"
                onClick={() => handleSwitchAuthMode("login")}
              >
                Masuk
              </button>
            </div>

            <form className={styles.authForm} onSubmit={handleAuthSubmit}>
              <p className={styles.authSectionNote}>
                {isRegisterMode
                  ? "Pakai email dan password kalau kamu mau membuat akun proyek baru secara manual."
                  : "Masuk manual dengan email dan password yang sudah terhubung ke proyek review ini."}
              </p>
              {authMode === "register" ? (
                <label className={styles.label}>
                  Nama
                  <input
                    className={styles.authInput}
                    autoComplete="name"
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    placeholder="Nama kamu"
                  />
                </label>
              ) : null}

              <label className={styles.label}>
                Email
                <input
                  className={styles.authInput}
                  type="email"
                  autoComplete="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="nama@perusahaan.com"
                />
              </label>

              <label className={styles.label}>
                Password
                <input
                  className={styles.authInput}
                  type="password"
                  autoComplete={isRegisterMode ? "new-password" : "current-password"}
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Minimal 8 karakter"
                />
              </label>

              <button className={styles.button} type="submit" disabled={isAuthenticating || isBooting}>
                {isAuthenticating ? "Memproses..." : emailSubmitLabel}
              </button>

              {authMode === "login" ? (
                <button className={styles.ghostButton} type="button" onClick={handlePasswordResetRequest}>
                  Saya lupa password
                </button>
              ) : null}
            </form>

            {googleReady ? (
              <>
                <div className={styles.authDivider}>
                  <span>{isRegisterMode ? "atau daftar lebih cepat" : "atau lanjut dengan Google"}</span>
                </div>
                <div className={styles.googleAuthRow}>
                  <div ref={googleButtonRef} />
                </div>
                <p className={styles.authHint}>{googleHelperText}</p>
                {showGoogleDevHint ? (
                  <p className={styles.authHint}>
                    Kalau tombol Google belum merespons di lokal, pastikan origin browser ini sudah didaftarkan
                    di Google Cloud OAuth.
                  </p>
                ) : null}
              </>
            ) : (
            <div className={styles.googleFallbackShell}>
                <button className={styles.googleFallbackButton} type="button" disabled>
                  <GoogleMark />
                  <span>{googleSubmitLabel}</span>
                </button>
                <p className={styles.authHint}>{googleHelperText}</p>
              </div>
            )}

            {error ? <p className={styles.error}>{error}</p> : null}
          </div>
        </section>
      </main>
    );
  }

  const activeConversationId = activeConversation?.id ?? null;
  const canManageMembers =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const canViewAuditLogs =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const canViewWorkspaceOps =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const canEditWorkspaceSettings = activeWorkspace?.role === "owner";
  const showAdvancedWorkspaceOps = canViewWorkspaceOps && !isSimpleWorkspaceMode;
  const showAdminConsole = Boolean(adminAnalytics) && !isSimpleWorkspaceMode;
  const showDetailedBilling = !isSimpleWorkspaceMode;
  const tokenQuotaRatio = workspaceSubscription
    ? workspaceSubscription.quota_tokens_used / Math.max(workspaceSubscription.monthly_token_quota, 1)
    : 0;
  const documentQuotaRatio = workspaceSubscription
    ? workspaceSubscription.quota_documents_used / Math.max(workspaceSubscription.monthly_document_quota, 1)
    : 0;
  const departmentBudgetSignal =
    invoiceSummary?.department_alerts.find((item) => item.status === "exceeded") ??
    invoiceSummary?.department_alerts.find((item) => item.status === "warning") ??
    null;
  const quotaWarning =
    tokenQuotaRatio >= 0.95 || documentQuotaRatio >= 0.95
      ? "Kuota proyek hampir habis. Saatnya naikkan paket atau reset kuota."
      : tokenQuotaRatio >= 0.75 || documentQuotaRatio >= 0.75
        ? "Pemakaian proyek sudah tinggi. Pantau kuota biar review dan upload tidak mentok."
        : null;
  const budgetWarning = departmentBudgetSignal
    ? departmentBudgetSignal.status === "exceeded"
      ? `Anggaran departemen ${departmentBudgetSignal.department} sudah melewati batas bulanan.`
      : `Anggaran departemen ${departmentBudgetSignal.department} mendekati batas bulanan.`
    : null;
  const showStarterFlows = Boolean(activeConversation && (activeConversation.messages?.length ?? 0) <= 1);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTopline}>
          <div>
            <p className={styles.eyebrow}>Building Plan Automation MVP</p>
            <h1>Workspace AI untuk intake plan, basis FBC/NEC, dan review MEP.</h1>
          </div>
          <div className={styles.accountCard}>
            <p className={styles.accountName}>{user.name}</p>
            <p className={styles.accountMeta}>{user.email}</p>
            <p className={styles.accountMeta}>
              {user.email_verified ? "Email terverifikasi" : "Email belum diverifikasi"}
            </p>
            <button className={styles.ghostButton} type="button" onClick={handleLogout}>
              Keluar
            </button>
          </div>
        </div>

        <p className={styles.subcopy}>
          Tujuan produk ini adalah menyatukan intake drawing, referensi kode bangunan, dan sesi review AI
          dalam satu dashboard yang bisa dipakai untuk menyusun checklist, temuan, dan handoff teknis.
          Recruiter harus langsung melihat bahwa ini adalah workflow review proyek, bukan chat UI generik.
        </p>
        <div className={styles.statusStrip}>
          <article className={styles.statusCard}>
            <span className={styles.statusLabel}>Backend</span>
            <strong>{backendStatus === "online" ? "Aktif" : backendStatus === "offline" ? "Tidak aktif" : "Mengecek"}</strong>
            <p>{backendStatus === "online" ? "Server lokal aktif dan siap menerima request." : "Status backend sedang dicek."}</p>
          </article>
          <article className={styles.statusCard}>
            <span className={styles.statusLabel}>Mode AI</span>
            <strong>{aiMode === "demo" ? "Mode demo stabil" : aiMode === "live" ? "Mode AI live" : "Hybrid siap"}</strong>
            <p>
              {aiMode === "demo"
                ? "Review AI tetap bisa didemokan meski provider live belum aktif."
                : "Jalur chat siap untuk plan review, code lookup, dan catatan teknis."}
            </p>
          </article>
          <article className={styles.statusCard}>
            <span className={styles.statusLabel}>Proyek aktif</span>
            <strong>{activeWorkspace ? activeWorkspace.name : "Belum pilih proyek"}</strong>
            <p>{workspaces.length} proyek terhubung dengan file referensi, sesi review, dan pelacakan pemakaian.</p>
          </article>
        </div>
        <div className={styles.trustBar}>
          <span className={styles.trustChip}>Vision intake untuk plan dan gambar</span>
          <span className={styles.trustChip}>Checklist review berbasis FBC dan NEC</span>
          <span className={styles.trustChip}>Audit trail dan request log aktif</span>
          <span className={styles.trustChip}>Jalur demo stabil tersedia</span>
        </div>

        {quotaWarning || budgetWarning ? (
          <div className={styles.warningBanner}>
            <strong>{budgetWarning ? "Sinyal biaya" : "Sinyal kuota"}</strong>
            <span>{budgetWarning ?? quotaWarning}</span>
          </div>
        ) : null}

        {pendingInvites.length > 0 ? (
          <div className={styles.auditPanel}>
            <div className={styles.teamHeader}>
              <div>
                <p className={styles.analyticsLabel}>Undangan tertunda</p>
                <h2 className={styles.adminTitle}>Undangan proyek masuk</h2>
              </div>
            </div>

            <div className={styles.memberList}>
              {pendingInvites.map((invite) => (
                <article key={invite.id} className={styles.memberCard}>
                  <strong>{invite.workspace_name}</strong>
                  <span>
                    Undangan dibuat {new Date(invite.created_at).toLocaleString("id-ID")}
                  </span>
                  <span>{invite.accept_url}</span>
                  <div className={styles.memberActions}>
                    <button
                      className={styles.ghostButton}
                      type="button"
                      onClick={() => handleCopyInviteLink(invite.accept_url)}
                    >
                      Salin link
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => handleInvitationDecision(invite.token, "accept")}
                    >
                      Terima
                    </button>
                    <button
                      className={styles.deleteButton}
                      type="button"
                      onClick={() => handleInvitationDecision(invite.token, "reject")}
                    >
                      Tolak
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.teamGrid}>
          <section className={styles.teamPanel}>
            <div className={styles.teamHeader}>
              <div>
                <p className={styles.analyticsLabel}>Portofolio proyek</p>
                <h2 className={styles.adminTitle}>Ruang proyek dan basis review</h2>
              </div>
            </div>

            <form className={styles.inlineForm} onSubmit={handleCreateWorkspace}>
              <input
                className={styles.authInput}
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="Nama proyek baru"
              />
              <button className={styles.button} type="submit">
                Buat proyek
              </button>
            </form>

            <div className={styles.workspaceList}>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  className={`${styles.workspaceCard} ${
                    activeWorkspace?.id === workspace.id ? styles.workspaceCardActive : ""
                  }`}
                  type="button"
                  onClick={() => handleSelectWorkspace(workspace.id)}
                >
                  <strong>{workspace.name}</strong>
                  <span>
                    {workspace.member_count} kolaborator aktif
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.teamPanel}>
            <div className={styles.teamHeader}>
              <div>
                <p className={styles.analyticsLabel}>Ringkasan proyek</p>
                <h2 className={styles.adminTitle}>
                  {workspaceBilling?.workspace_name ?? "Pilih proyek"}
                </h2>
              </div>
            </div>

            {workspaceBilling ? (
              <>
                {workspaceSubscription ? (
                  <div className={styles.subscriptionPanel}>
                    <div>
                      <p className={styles.subscriptionTitle}>Ringkasan proyek aktif</p>
                      <p className={styles.subscriptionMeta}>
                        {workspaceSubscription.seats_in_use} kolaborator aktif • status {workspaceSubscription.status}
                        • reset periode{" "}
                        {new Date(workspaceSubscription.current_period_end).toLocaleDateString("id-ID")}
                      </p>
                      <p className={styles.subscriptionMeta}>
                        token AI {workspaceSubscription.quota_tokens_used.toLocaleString("id-ID")} /{" "}
                        {workspaceSubscription.monthly_token_quota.toLocaleString("id-ID")} • file{" "}
                        {workspaceSubscription.quota_documents_used} / {workspaceSubscription.monthly_document_quota}
                      </p>
                    </div>
                    <p className={styles.subscriptionPrice}>
                      {workspaceSubscription.plan_name}
                      <span>paket aktif</span>
                    </p>
                  </div>
                ) : null}

                {canManageMembers && showDetailedBilling ? (
                  <div className={styles.memberActions}>
                    <button className={styles.button} type="button" onClick={handleMockCheckout}>
                      Simulasi Stripe Checkout
                    </button>
                  </div>
                ) : null}

                <div className={styles.billingGrid}>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>Kolaborator</span>
                    <strong>{workspaceBilling.member_count}</strong>
                    <p>Total orang di proyek ini</p>
                  </article>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>Token AI</span>
                    <strong>{workspaceBilling.estimated_total_tokens.toLocaleString("id-ID")}</strong>
                    <p>Estimasi token untuk review</p>
                  </article>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>Sesi review</span>
                    <strong>{workspaceBilling.chats_sent}</strong>
                    <p>Total interaksi review terkirim</p>
                  </article>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>File</span>
                    <strong>{workspaceBilling.documents_uploaded}</strong>
                    <p>Plan dan referensi terunggah</p>
                  </article>
                </div>

                {showDetailedBilling && invoiceSummary ? (
                  <div className={styles.auditPanel}>
                    <div className={styles.teamHeader}>
                      <div>
                        <p className={styles.analyticsLabel}>Estimasi biaya</p>
                        <h3 className={styles.subscriptionTitle}>Estimasi periode berjalan</h3>
                      </div>
                      {canManageMembers ? (
                        <button className={styles.ghostButton} type="button" onClick={handleExportInvoiceCsv}>
                          Unduh invoice CSV
                        </button>
                      ) : null}
                    </div>

                    <div className={styles.billingGrid}>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Subtotal</span>
                        <strong>${invoiceSummary.subtotal_usd.toFixed(2)}</strong>
                        <p>
                          {invoiceSummary.seats_in_use}/{invoiceSummary.seats_included} seats
                        </p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Pemakaian</span>
                        <strong>${invoiceSummary.estimated_usage_cost_usd.toFixed(4)}</strong>
                        <p>{invoiceSummary.token_usage.toLocaleString("id-ID")} estimasi token</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Request</span>
                        <strong>{invoiceSummary.request_count}</strong>
                        <p>{invoiceSummary.api_key_request_count} lewat API key</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Total</span>
                        <strong>${invoiceSummary.total_usd.toFixed(2)}</strong>
                        <p>
                          {new Date(invoiceSummary.period_start).toLocaleDateString("id-ID")} -{" "}
                          {new Date(invoiceSummary.period_end).toLocaleDateString("id-ID")}
                        </p>
                      </article>
                    </div>

                    <div className={styles.auditList}>
                      {invoiceSummary.line_items.map((item) => (
                        <article key={item.label} className={styles.auditItem}>
                          <strong>{item.label}</strong>
                          <span>
                            {item.quantity} {item.unit}
                          </span>
                          <span>${item.amount_usd.toFixed(4)}</span>
                        </article>
                      ))}
                    </div>

                    {invoiceSummary.member_breakdown.length > 0 ? (
                      <div className={styles.auditPanel}>
                        <div className={styles.teamHeader}>
                          <div>
                            <p className={styles.analyticsLabel}>Ringkasan member</p>
                            <h3 className={styles.subscriptionTitle}>Pemakaian per member</h3>
                          </div>
                        </div>
                        <div className={styles.auditList}>
                          {invoiceSummary.member_breakdown.map((member) => (
                            <article key={`${invoiceSummary.workspace_id}-${member.email}`} className={styles.auditItem}>
                              <strong>{member.name}</strong>
                              <span>{member.email}</span>
                              <span>
                                departemen {member.department ?? "-"} • pusat biaya {member.cost_center ?? "-"}
                              </span>
                              <span>
                                {member.token_usage.toLocaleString("id-ID")} token • $
                                {member.estimated_usage_cost_usd.toFixed(4)}
                              </span>
                              <span>
                                {member.chats_sent} chat • {member.documents_uploaded} dokumen
                              </span>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {invoiceSummary.department_alerts.length > 0 ? (
                      <div className={styles.auditPanel}>
                        <div className={styles.teamHeader}>
                          <div>
                            <p className={styles.analyticsLabel}>Anggaran departemen</p>
                            <h3 className={styles.subscriptionTitle}>Sinyal batas anggaran</h3>
                          </div>
                        </div>
                        <div className={styles.auditList}>
                          {invoiceSummary.department_alerts.map((item) => (
                            <article key={`${invoiceSummary.workspace_id}-${item.department}`} className={styles.auditItem}>
                              <strong>
                                {item.department} • {item.status}
                              </strong>
                              <span>
                                spend ${item.spend_usd.toFixed(4)} / budget $
                                {item.monthly_budget_usd.toFixed(2)}
                              </span>
                              <span>
                                utilisasi {(item.utilization_ratio * 100).toFixed(1)}% • peringatan di{" "}
                                {(item.alert_threshold_ratio * 100).toFixed(0)}%
                              </span>
                              <span>{item.member_count} member ditandai ke departemen ini</span>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {invoiceHistory.length > 0 ? (
                      <div className={styles.auditPanel}>
                        <div className={styles.teamHeader}>
                          <div>
                            <p className={styles.analyticsLabel}>Riwayat invoice</p>
                            <h3 className={styles.subscriptionTitle}>6 bulan terakhir</h3>
                          </div>
                        </div>
                        <div className={styles.auditList}>
                          {invoiceHistory.map((invoice) => (
                            <article key={`${invoice.workspace_id}-${invoice.period_start}`} className={styles.auditItem}>
                              <strong>{invoice.period_label}</strong>
                              <span>
                                total ${invoice.total_usd.toFixed(2)} • token{" "}
                                {invoice.token_usage.toLocaleString("id-ID")}
                              </span>
                              <span>
                                request {invoice.request_count} • dokumen {invoice.document_uploads}
                              </span>
                              <span>
                                {new Date(invoice.period_start).toLocaleDateString("id-ID")} -{" "}
                                {new Date(invoice.period_end).toLocaleDateString("id-ID")}
                              </span>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {activeWorkspace ? (
              <>
                {canManageMembers ? (
                  <form className={styles.inlineForm} onSubmit={handleInviteMember}>
                    <input
                      className={styles.authInput}
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="Tambah kolaborator lewat email"
                    />
                    <button className={styles.button} type="submit">
                      Tambahkan
                    </button>
                  </form>
                ) : null}

                <div className={styles.memberList}>
                  {activeWorkspace.members.map((member) => (
                    <article key={member.email} className={styles.memberCard}>
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                      <span>
                        fungsi {member.department ?? "-"} • pusat biaya {member.cost_center ?? "-"}
                      </span>
                      {canManageMembers ? (
                        <div className={styles.filterRow}>
                          <input
                            className={styles.authInput}
                            value={memberDepartmentDrafts[member.email] ?? ""}
                            onChange={(event) =>
                              setMemberDepartmentDrafts((current) => ({
                                ...current,
                                [member.email]: event.target.value,
                              }))
                            }
                            placeholder="Departemen"
                          />
                    <input
                      className={styles.authInput}
                      value={memberCostCenterDrafts[member.email] ?? ""}
                            onChange={(event) =>
                              setMemberCostCenterDrafts((current) => ({
                                ...current,
                                [member.email]: event.target.value,
                              }))
                            }
                      placeholder="Pusat biaya"
                    />
                          <div />
                          <button
                            className={styles.ghostButton}
                            type="button"
                            onClick={() => handleSaveMemberMetadata(member.email)}
                          >
                            Simpan tag
                          </button>
                        </div>
                      ) : null}
                      {canManageMembers && member.role !== "owner" ? (
                        <div className={styles.memberActions}>
                          <button
                            className={styles.deleteButton}
                            type="button"
                            onClick={() => handleRemoveMember(member.email)}
                          >
                            Hapus member
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                {canViewAuditLogs && !isSimpleWorkspaceMode ? (
                  <div className={styles.auditPanel}>
                    <div className={styles.teamHeader}>
                      <div>
                        <p className={styles.analyticsLabel}>Audit trail</p>
                        <h3 className={styles.subscriptionTitle}>Jejak aktivitas workspace</h3>
                      </div>
                    </div>

                    <div className={styles.auditList}>
                      {auditLogs.length > 0 ? (
                        auditLogs.map((log) => (
                          <article key={log.id} className={styles.auditItem}>
                            <strong>{log.action.replaceAll("_", " ")}</strong>
                            <span>
                              {log.target_type}: {log.target_value}
                            </span>
                            {log.actor_email ? <span>aktor {log.actor_email}</span> : null}
                            {formatMetadataEntries(log.metadata).length > 0 ? (
                              <div className={styles.metadataList}>
                                {formatMetadataEntries(log.metadata).map(([key, value]) => (
                                  <span key={`${log.id}-${key}`} className={styles.metadataTag}>
                                    {key}:{" "}
                                    {typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                                      ? String(value)
                                      : JSON.stringify(value)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <span>{new Date(log.created_at).toLocaleString("id-ID")}</span>
                          </article>
                        ))
                      ) : (
                        <p className={styles.emptyText}>Belum ada audit log untuk workspace ini.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        </div>

        {showAdvancedWorkspaceOps ? (
          <div className={styles.teamGrid}>
            <section className={styles.teamPanel}>
              <div className={styles.teamHeader}>
                <div>
                  <p className={styles.analyticsLabel}>Pemakaian workspace</p>
                  <h2 className={styles.adminTitle}>Meter pemakaian per member</h2>
                </div>
              </div>

              <div className={styles.memberList}>
                {memberUsage.map((entry) => (
                  <article key={entry.email} className={styles.memberCard}>
                    <strong>{entry.name}</strong>
                    <span>{entry.email}</span>
                    <span>
                      {entry.estimated_total_tokens.toLocaleString("id-ID")} token • $
                      {entry.estimated_total_cost_usd.toFixed(4)}
                    </span>
                    <span>
                      {entry.chats_sent} chat • {entry.documents_uploaded} dokumen
                    </span>
                  </article>
                ))}
                {memberUsage.length === 0 ? (
                  <p className={styles.emptyText}>Belum ada meter pemakaian yang bisa ditampilkan.</p>
                ) : null}
              </div>
            </section>

            <section className={styles.teamPanel}>
              <div className={styles.teamHeader}>
                <div>
                  <p className={styles.analyticsLabel}>Pengaturan workspace</p>
                  <h2 className={styles.adminTitle}>Paket, kuota, dan operasional email</h2>
                </div>
              </div>

              {workspaceSettings ? (
                <form className={styles.settingsGrid} onSubmit={handleSaveWorkspaceSettings}>
                  <label className={styles.label}>
                    Nama paket
                    <input
                      className={styles.authInput}
                      value={planName}
                      onChange={(event) => setPlanName(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Seat yang termasuk
                    <input
                      className={styles.authInput}
                      type="number"
                      value={seatsIncluded}
                      onChange={(event) => setSeatsIncluded(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Harga dasar USD
                    <input
                      className={styles.authInput}
                      type="number"
                      step="0.01"
                      value={basePriceUsd}
                      onChange={(event) => setBasePriceUsd(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Harga per seat USD
                    <input
                      className={styles.authInput}
                      type="number"
                      step="0.01"
                      value={seatPriceUsd}
                      onChange={(event) => setSeatPriceUsd(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Kuota token bulanan
                    <input
                      className={styles.authInput}
                      type="number"
                      value={monthlyTokenQuota}
                      onChange={(event) => setMonthlyTokenQuota(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Kuota dokumen bulanan
                    <input
                      className={styles.authInput}
                      type="number"
                      value={monthlyDocumentQuota}
                      onChange={(event) => setMonthlyDocumentQuota(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>SMTP</span>
                    <strong>{workspaceSettings.smtp_enabled ? "Siap" : "Nonaktif"}</strong>
                    <p>{workspaceSettings.smtp_enabled ? "Invite email aktif" : "Konfigurasi SMTP belum ada"}</p>
                  </article>
                  <div className={styles.settingsActions}>
                    <button
                      className={styles.button}
                      type="submit"
                      disabled={!canEditWorkspaceSettings}
                    >
                      Simpan pengaturan
                    </button>
                  </div>
                </form>
              ) : (
                <p className={styles.emptyText}>Pengaturan workspace belum tersedia untuk akses ini.</p>
              )}

              {workspaceSettings ? (
                <div className={styles.auditPanel}>
                  <div className={styles.teamHeader}>
                    <div>
                      <p className={styles.analyticsLabel}>Anggaran departemen</p>
                      <h3 className={styles.subscriptionTitle}>Batas biaya per departemen</h3>
                    </div>
                  </div>

                  {canManageMembers ? (
                    <form className={styles.filterRow} onSubmit={handleSaveDepartmentBudget}>
                      <input
                        className={styles.authInput}
                        value={departmentBudgetName}
                        onChange={(event) => setDepartmentBudgetName(event.target.value)}
                        placeholder="Nama departemen"
                      />
                      <input
                        className={styles.authInput}
                        type="number"
                        step="0.01"
                        value={departmentBudgetUsd}
                        onChange={(event) => setDepartmentBudgetUsd(event.target.value)}
                        placeholder="Anggaran bulanan USD"
                      />
                      <input
                        className={styles.authInput}
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="1"
                        value={departmentBudgetThreshold}
                        onChange={(event) => setDepartmentBudgetThreshold(event.target.value)}
                        placeholder="Rasio peringatan"
                      />
                      <button className={styles.button} type="submit">
                        Simpan anggaran
                      </button>
                    </form>
                  ) : null}

                  {workspaceSettings.department_budgets.length > 0 ? (
                    <div className={styles.auditList}>
                      {workspaceSettings.department_budgets.map((budget) => {
                        const alert = invoiceSummary?.department_alerts.find(
                          (item) => item.department === budget.department,
                        );
                        return (
                          <article key={budget.id} className={styles.auditItem}>
                            <strong>
                              {budget.department} {alert ? `• ${alert.status}` : ""}
                            </strong>
                            <span>
                              anggaran ${budget.monthly_budget_usd.toFixed(2)} • peringatan di{" "}
                              {(budget.alert_threshold_ratio * 100).toFixed(0)}%
                            </span>
                            <span>
                              pemakaian sekarang ${alert?.spend_usd.toFixed(4) ?? "0.0000"} • utilisasi{" "}
                              {alert ? `${(alert.utilization_ratio * 100).toFixed(1)}%` : "0.0%"}
                            </span>
                            <span>{alert?.member_count ?? 0} member ditag ke department ini</span>
                            {canManageMembers ? (
                              <div className={styles.memberActions}>
                                <button
                                  className={styles.deleteButton}
                                  type="button"
                                  onClick={() => handleDeleteDepartmentBudget(budget.id)}
                                >
                                  Hapus budget
                                </button>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={styles.emptyText}>
                      Belum ada anggaran departemen. Tambahkan batas biaya supaya billing bisa kasih peringatan lebih awal.
                    </p>
                  )}
                </div>
              ) : null}

              <div className={styles.auditPanel}>
                <div className={styles.teamHeader}>
                  <div>
                    <p className={styles.analyticsLabel}>Observability</p>
                    <h3 className={styles.subscriptionTitle}>Ringkasan request log</h3>
                  </div>
                </div>

                {workspaceObservability ? (
                  <>
                    <div className={styles.filterRow}>
                      <input
                        className={styles.authInput}
                        value={requestLogQuery}
                        onChange={(event) => setRequestLogQuery(event.target.value)}
                        placeholder="Cari path, mis. /conversations"
                      />
                      <select
                        className={styles.authInput}
                        value={requestLogAuthMode}
                        onChange={(event) => setRequestLogAuthMode(event.target.value)}
                      >
                        <option value="">Semua auth</option>
                        <option value="session">session</option>
                        <option value="api_key">api_key</option>
                      </select>
                      <select
                        className={styles.authInput}
                        value={requestLogStatusCode}
                        onChange={(event) => setRequestLogStatusCode(event.target.value)}
                      >
                        <option value="">Semua status</option>
                        <option value="200">200</option>
                        <option value="401">401</option>
                        <option value="403">403</option>
                        <option value="404">404</option>
                        <option value="500">500</option>
                      </select>
                      <button className={styles.button} type="button" onClick={handleApplyRequestLogFilters}>
                        Terapkan
                      </button>
                    </div>

                    <div className={styles.memberActions}>
                      <button className={styles.ghostButton} type="button" onClick={handleExportRequestLogsCsv}>
                        Unduh request log CSV
                      </button>
                      <span className={styles.emptyText}>
                        {requestLogTotal} log total • halaman {Math.floor(requestLogOffset / requestLogLimit) + 1}
                      </span>
                    </div>

                    <div className={styles.billingGrid}>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Request</span>
                        <strong>{workspaceObservability.total_requests}</strong>
                        <p>Total request tercatat</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Error</span>
                        <strong>{workspaceObservability.error_requests}</strong>
                        <p>HTTP 4xx/5xx</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Latensi</span>
                        <strong>{workspaceObservability.avg_duration_ms} ms</strong>
                        <p>Durasi rata-rata</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Terakhir terlihat</span>
                        <strong>
                          {workspaceObservability.last_request_at
                            ? new Date(workspaceObservability.last_request_at).toLocaleDateString("id-ID")
                            : "-"}
                        </strong>
                        <p>
                          {workspaceObservability.top_paths.length > 0
                            ? workspaceObservability.top_paths.join(" • ")
                            : "Belum ada path dominan"}
                        </p>
                      </article>
                    </div>

                    <div className={styles.metadataList}>
                      {Object.entries(workspaceObservability.auth_mode_breakdown).map(([mode, count]) => (
                        <span key={mode} className={styles.metadataTag}>
                          {mode}: {count}
                        </span>
                      ))}
                    </div>

                    {workspaceObservability.recent_errors.length > 0 ? (
                      <div className={styles.auditList}>
                        {workspaceObservability.recent_errors.map((entry) => (
                          <article key={entry} className={styles.auditItem}>
                            <strong>Error terbaru</strong>
                            <span>{entry}</span>
                          </article>
                        ))}
                      </div>
                    ) : null}

                    <div className={styles.auditList}>
                      {requestLogs.map((log) => (
                        <article key={log.id} className={styles.auditItem}>
                          <strong>
                            {log.method} {log.path}
                          </strong>
                          <span>
                            status {log.status_code} • {log.duration_ms} ms • {log.auth_mode ?? "unknown"}
                          </span>
                          <span>
                            {log.user_email ?? "no-user"} • {log.api_key_label ?? "no-api-key"}
                          </span>
                          <span>{new Date(log.created_at).toLocaleString("id-ID")}</span>
                        </article>
                      ))}
                      {requestLogs.length === 0 ? (
                        <p className={styles.emptyText}>Belum ada request log detail untuk workspace ini.</p>
                      ) : null}
                    </div>

                    {requestLogTotal > requestLogLimit ? (
                      <div className={styles.memberActions}>
                        <button
                          className={styles.ghostButton}
                          type="button"
                          disabled={requestLogPreviousOffset === null}
                          onClick={() =>
                            handleRequestLogPage(
                              requestLogPreviousOffset ?? Math.max(requestLogOffset - requestLogLimit, 0),
                            )
                          }
                        >
                          Halaman sebelumnya
                        </button>
                        <button
                          className={styles.ghostButton}
                          type="button"
                          disabled={requestLogNextOffset === null}
                          onClick={() =>
                            handleRequestLogPage(
                              requestLogNextOffset ?? requestLogOffset + requestLogLimit,
                            )
                          }
                        >
                          Halaman berikutnya
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.emptyText}>Observability belum tersedia untuk akses ini.</p>
                )}
              </div>

              <div className={styles.auditPanel}>
                <div className={styles.teamHeader}>
                  <div>
                    <p className={styles.analyticsLabel}>API key workspace</p>
                    <h3 className={styles.subscriptionTitle}>Akses integrasi</h3>
                  </div>
                </div>

                <form className={styles.inlineForm} onSubmit={handleCreateApiKey}>
                  <input
                    className={styles.authInput}
                    value={newApiKeyLabel}
                    onChange={(event) => setNewApiKeyLabel(event.target.value)}
                    placeholder="Label API key"
                    disabled={!canManageMembers}
                  />
                  <button className={styles.button} type="submit" disabled={!canManageMembers}>
                    Buat key
                  </button>
                </form>

                {latestApiKey ? (
                  <article className={styles.auditItem}>
                    <strong>API key baru</strong>
                    <span>{latestApiKey}</span>
                    <span>Simpan sekarang. Setelah ini key mentah tidak akan ditampilkan lagi.</span>
                  </article>
                ) : null}

                <div className={styles.auditList}>
                  {workspaceApiKeys.map((item) => (
                    <article key={item.id} className={styles.auditItem}>
                      <strong>{item.label}</strong>
                      <span>
                        {item.key_prefix}... • status {item.status}
                      </span>
                      <span>
                        {item.last_used_at
                          ? `terakhir dipakai ${new Date(item.last_used_at).toLocaleString("id-ID")}`
                          : `dibuat ${new Date(item.created_at).toLocaleString("id-ID")}`}
                      </span>
                      {item.status === "active" ? (
                        <div className={styles.memberActions}>
                          <button
                            className={styles.deleteButton}
                            type="button"
                            onClick={() => handleRevokeApiKey(item.id)}
                          >
                            Cabut akses
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {workspaceApiKeys.length === 0 ? (
                    <p className={styles.emptyText}>Belum ada API key untuk workspace ini.</p>
                  ) : null}
                </div>

                <div className={styles.auditList}>
                  {workspaceApiKeyUsage.map((item) => (
                    <article key={item.id} className={styles.auditItem}>
                      <strong>{item.label}</strong>
                      <span>
                        {item.key_prefix}... • {item.request_count} request • status {item.status}
                      </span>
                      <span>
                        {item.billable_request_count} request tertagih • $
                        {item.estimated_cost_usd.toFixed(4)} •{" "}
                        {item.estimated_tokens.toLocaleString("id-ID")} token
                      </span>
                      <span>
                        {item.last_used_at
                          ? `terakhir dipakai ${new Date(item.last_used_at).toLocaleString("id-ID")}`
                          : "belum pernah dipakai"}
                      </span>
                      <span>{item.last_path ? `path terakhir ${item.last_path}` : "belum ada path tercatat"}</span>
                      {item.top_paths.length > 0 ? (
                        <div className={styles.metadataList}>
                          {item.top_paths.map((path) => (
                            <span key={`${item.id}-${path}`} className={styles.metadataTag}>
                              {path}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {workspaceApiKeyUsage.length === 0 ? (
                    <p className={styles.emptyText}>Belum ada pemakaian API key yang tercatat.</p>
                  ) : null}
                </div>
              </div>

              <div className={styles.auditPanel}>
                <div className={styles.teamHeader}>
                  <div>
                    <p className={styles.analyticsLabel}>Antrian email</p>
                    <h3 className={styles.subscriptionTitle}>Status pengiriman undangan</h3>
                  </div>
                </div>
                <div className={styles.auditList}>
                  {emailJobs.map((job) => (
                    <article key={job.id} className={styles.auditItem}>
                      <strong>{job.subject}</strong>
                      <span>
                        {job.recipient_email} • status {job.status}
                      </span>
                        <span>
                        percobaan {job.attempt_count} • worker {job.worker_name ?? "-"}
                        </span>
                      <span>
                        {job.sent_at
                          ? `terkirim ${new Date(job.sent_at).toLocaleString("id-ID")}`
                          : `masuk antrean ${new Date(job.created_at).toLocaleString("id-ID")}`}
                      </span>
                      {job.processing_started_at ? (
                        <span>
                          diproses {new Date(job.processing_started_at).toLocaleString("id-ID")}
                        </span>
                      ) : null}
                      {job.error_message ? <span>{job.error_message}</span> : null}
                      {job.status !== "sent" ? (
                        <div className={styles.memberActions}>
                          <button
                            className={styles.ghostButton}
                            type="button"
                            onClick={() => handleRetryEmailJob(job.id)}
                          >
                            Coba kirim lagi
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {emailJobs.length === 0 ? (
                    <p className={styles.emptyText}>Belum ada email job untuk workspace ini.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {analytics ? (
          <div className={styles.analyticsGrid}>
            <article className={styles.analyticsCard}>
              <span className={styles.analyticsLabel}>Sesi review</span>
              <strong>{analytics.conversation_count}</strong>
              <p>{analytics.chats_sent} sesi review dikirim</p>
            </article>
            <article className={styles.analyticsCard}>
              <span className={styles.analyticsLabel}>File referensi</span>
              <strong>{analytics.document_count}</strong>
              <p>{analytics.total_chunks} potongan referensi terindeks</p>
            </article>
            <article className={styles.analyticsCard}>
              <span className={styles.analyticsLabel}>Catatan AI</span>
              <strong>{analytics.message_count}</strong>
              <p>{analytics.assistant_message_count} balasan AI</p>
            </article>
            {!isSimpleWorkspaceMode ? (
              <>
                <article className={styles.analyticsCard}>
                  <span className={styles.analyticsLabel}>Estimasi token</span>
                  <strong>{analytics.estimated_total_tokens.toLocaleString("id-ID")}</strong>
                  <p>
                    prompt {analytics.estimated_prompt_tokens.toLocaleString("id-ID")} • completion{" "}
                    {analytics.estimated_completion_tokens.toLocaleString("id-ID")}
                  </p>
                </article>
                <article className={styles.analyticsCard}>
                  <span className={styles.analyticsLabel}>Estimasi biaya</span>
                  <strong>${analytics.estimated_total_cost_usd.toFixed(4)}</strong>
                  <p>
                    prompt ${analytics.estimated_prompt_cost_usd.toFixed(4)} • completion $
                    {analytics.estimated_completion_cost_usd.toFixed(4)}
                  </p>
                </article>
              </>
            ) : null}
          </div>
        ) : null}

        {showAdminConsole && adminAnalytics ? (
          <div className={styles.adminPanel}>
            <div className={styles.adminHeader}>
              <div>
                <p className={styles.analyticsLabel}>Analitik admin</p>
                <h2 className={styles.adminTitle}>Ringkasan semua workspace</h2>
              </div>
              <p className={styles.adminSummary}>
                {adminAnalytics.user_count} user • {adminAnalytics.usage_event_count} event penggunaan • $
                {adminAnalytics.estimated_total_cost_usd.toFixed(4)}
              </p>
            </div>

            <div className={styles.adminMetrics}>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.conversation_count}</strong>
                <span>Total percakapan</span>
              </div>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.document_count}</strong>
                <span>Total dokumen</span>
              </div>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.message_count}</strong>
                <span>Total pesan</span>
              </div>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.estimated_total_tokens.toLocaleString("id-ID")}</strong>
                <span>Total estimasi token</span>
              </div>
            </div>

            {emailWorkerStatus ? (
              <div className={styles.metadataList}>
                <span className={styles.metadataTag}>
                  worker {emailWorkerStatus.worker_enabled ? "aktif" : "manual"}
                </span>
                <span className={styles.metadataTag}>
                  berjalan {emailWorkerStatus.worker_running ? "ya" : "tidak"}
                </span>
                <span className={styles.metadataTag}>
                  antrean {emailWorkerStatus.queue_depth}
                </span>
                <span className={styles.metadataTag}>
                  diproses {emailWorkerStatus.processing_jobs}
                </span>
                <span className={styles.metadataTag}>
                  gagal {emailWorkerStatus.failed_jobs}
                </span>
                {emailWorkerStatus.last_processed_at ? (
                  <span className={styles.metadataTag}>
                    proses terakhir {new Date(emailWorkerStatus.last_processed_at).toLocaleString("id-ID")}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className={styles.topUsers}>
              {adminAnalytics.top_users.map((entry) => (
                <article key={entry.email} className={styles.topUserCard}>
                  <p className={styles.topUserName}>{entry.name}</p>
                  <p className={styles.topUserMeta}>{entry.email}</p>
                  <p className={styles.topUserMeta}>
                    {entry.conversation_count} chat • {entry.document_count} dokumen
                  </p>
                  <p className={styles.topUserCost}>
                    ${entry.estimated_total_cost_usd.toFixed(4)} •{" "}
                    {entry.estimated_total_tokens.toLocaleString("id-ID")} token
                  </p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <button className={styles.newChatButton} type="button" onClick={handleNewChat}>
            Review baru
          </button>

          <div className={styles.conversationList}>
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`${styles.conversationItem} ${
                  conversation.id === activeConversationId ? styles.activeConversation : ""
                }`}
              >
                <button
                  className={styles.conversationButton}
                  type="button"
                  onClick={() => handleSelectConversation(conversation.id)}
                  disabled={isLoading}
                >
                  <span className={styles.conversationTitle}>{conversation.title}</span>
                  <span className={styles.conversationMeta}>
                    {conversation.document_count} file • {conversation.message_count} catatan
                  </span>
                  <span className={styles.conversationMeta}>
                    {new Date(conversation.updated_at).toLocaleString("id-ID", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </button>

                <button
                  className={styles.deleteButton}
                  type="button"
                  onClick={() => handleDeleteConversation(conversation.id)}
                  disabled={isLoading || conversations.length === 1}
                >
                  Hapus
                </button>
              </div>
            ))}
            {conversations.length === 0 ? (
              <div className={styles.sidebarEmptyCard}>
                <span className={styles.statusLabel}>Mulai di sini</span>
                <strong>Belum ada sesi review aktif</strong>
                <p>Buat review baru untuk mulai membaca plan, memuat referensi kode, atau mendiskusikan temuan proyek.</p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={styles.shell}>
          <div className={styles.knowledgeBar}>
            <div>
              <p className={styles.knowledgeEyebrow}>Plan intake dan code knowledge</p>
              <h2 className={styles.knowledgeTitle}>
                {workspaceDocuments.length} file proyek dan referensi
              </h2>
              <p className={styles.documentMeta}>
                {activeConversation?.documents.length ?? 0} file terhubung langsung ke sesi review ini
              </p>
            </div>

            <div className={styles.knowledgeActions}>
              <input
                ref={fileInputRef}
                className={styles.hiddenInput}
                type="file"
                accept=".pdf,.txt,.md"
                onChange={handleUpload}
              />
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!activeConversation || isUploading}
              >
                {isUploading ? "Mengunggah..." : "Unggah plan / code"}
              </button>
              <button className={styles.ghostButton} type="button" onClick={handleReset}>
                Reset sesi
              </button>
            </div>
          </div>

          <div className={styles.planOpsBoard}>
            <div className={styles.planOpsHeader}>
              <div>
                <p className={styles.knowledgeEyebrow}>Pipeline MVP</p>
                <h3 className={styles.planOpsTitle}>Mata - Otak - Tangan</h3>
                <p className={styles.planOpsCopy}>
                  Gunakan dashboard ini untuk intake drawing, memuat basis aturan FBC atau NEC,
                  lalu mengubah hasil review menjadi checklist dan handoff teknis yang lebih siap dieksekusi.
                </p>
              </div>
              <div className={styles.planStageRow}>
                <span className={styles.planStageChip}>Mata: baca plan dan fixture</span>
                <span className={styles.planStageChip}>Otak: cocokkan dengan kode</span>
                <span className={styles.planStageChip}>Tangan: siapkan routing dan tindak lanjut</span>
              </div>
            </div>

            <div className={styles.planOpsGrid}>
              {projectReadiness.map((item) => (
                <article key={item.label} className={styles.planOpsCard}>
                  <span className={styles.analyticsLabel}>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p>{item.ready ? "Siap dipakai dalam alur review aktif." : "Masih perlu dilengkapi agar pipeline terasa utuh."}</p>
                </article>
              ))}
            </div>

            <div className={styles.planActionRow}>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => handleQuickPrompt("Baca plan ini dan identifikasi ruang, fixture, dan area yang butuh review MEP.")}
              >
                Mulai intake plan
              </button>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => handleQuickPrompt("Susun checklist FBC dan NEC yang paling relevan untuk proyek ini.")}
              >
                Minta checklist code
              </button>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => handleQuickPrompt("Ubah temuan review ini menjadi action items yang bisa dipakai engineer lapangan.")}
              >
                Siapkan handoff engineer
              </button>
            </div>
          </div>

          <div className={styles.documentStrip}>
            {workspaceDocuments.length ? (
              workspaceDocuments.map((document) => (
                <div key={document.id} className={styles.documentCard}>
                  <div>
                    <p className={styles.documentName}>{document.name}</p>
                    <p className={styles.documentMeta}>
                      {document.chunk_count} potongan •{" "}
                      {new Date(document.created_at).toLocaleString("id-ID", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                    <p className={styles.documentMeta}>sesi: {document.conversation_title}</p>
                  </div>
                  <button
                    className={styles.deleteButton}
                    type="button"
                    onClick={() => handleDeleteDocument(document.id)}
                  >
                    Hapus
                  </button>
                </div>
              ))
            ) : (
              <p className={styles.emptyText}>
                Belum ada file proyek. Anda bisa mulai dari pertanyaan umum, lalu unggah plan, referensi FBC atau NEC, atau spesifikasi proyek untuk review yang lebih tajam.
              </p>
            )}
          </div>

          <div className={styles.workspaceMain}>
            <div className={styles.chatColumn}>
              <div className={styles.messages} ref={messagesRef}>
                {isBooting ? (
                  <article className={`${styles.message} ${styles.assistantMessage}`}>
                    <span className={styles.messageRole}>System</span>
                    <p>Menyiapkan proyek review...</p>
                  </article>
                ) : null}

                {showStarterFlows ? (
                  <section className={styles.starterPanel}>
                    <div className={styles.starterHeader}>
                      <span className={styles.statusLabel}>Saran titik mulai</span>
                      <strong>Mulai dari skenario review yang paling gampang didemokan</strong>
                    </div>
                    <div className={styles.starterGrid}>
                      {starterFlows.map((flow) => (
                        <button
                          key={flow.title}
                          className={styles.starterCard}
                          type="button"
                          onClick={() => handleQuickPrompt(flow.prompt)}
                        >
                          <strong>{flow.title}</strong>
                          <p>{flow.description}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeConversation?.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`${styles.message} ${
                      message.role === "user" ? styles.userMessage : styles.assistantMessage
                    }`}
                  >
                    <span className={styles.messageRole}>
                      {message.role === "user" ? "Kamu" : "AI"}
                    </span>
                    <p>{message.content}</p>
                  </article>
                ))}
              </div>

              <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.label} htmlFor="prompt">
                  Tulis instruksi review
                </label>

                <textarea
                  ref={promptInputRef}
                  id="prompt"
                  className={styles.input}
                  rows={4}
                  placeholder="Contoh: baca plan ini lalu buat checklist NEC untuk bathroom dan kitchen, atau ubah temuan review menjadi tindak lanjut"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={!activeConversation}
                />

                <div className={styles.formFooter}>
                  <p className={styles.hint}>
                    Arsitektur: Next.js UI, FastAPI backend, PostgreSQL, retrieval referensi, dan chat review.
                  </p>
                  <div className={styles.actions}>
                    {isLoading ? (
                      <button className={styles.stopButton} type="button" onClick={handleStop}>
                        Hentikan
                      </button>
                    ) : null}
                    <button className={styles.button} type="submit" disabled={isLoading || !activeConversation}>
                      {isLoading ? "Mengalir..." : "Kirim"}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <aside className={styles.assistantRail}>
              <div className={styles.assistantRailHeader}>
                <p className={styles.analyticsLabel}>Asisten</p>
                <h3 className={styles.subscriptionTitle}>Copilot review building plan</h3>
                {aiMode === "demo" ? (
                  <span className={styles.demoBadge}>Mode demo aktif</span>
                ) : null}
                <p className={styles.assistantCopy}>
                  Gunakan AI ini untuk membaca plan, memuat referensi kode, menulis temuan review, dan menyiapkan handoff teknis dalam satu tempat.
                </p>
                {aiMode === "demo" ? (
                  <p className={styles.demoHint}>
                    Respons saat ini memakai fallback simulasi yang tetap cocok untuk presentasi workflow proyek dan uji alur.
                  </p>
                ) : null}
              </div>

              <div className={styles.assistantSection}>
                <p className={styles.assistantSectionTitle}>Tugas cepat</p>
                <div className={styles.quickPromptList}>
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      className={styles.quickPromptButton}
                      type="button"
                      onClick={() => handleQuickPrompt(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.assistantSection}>
                <p className={styles.assistantSectionTitle}>Skenario demo</p>
                <div className={styles.demoScenarioList}>
                  {demoScenarios.map((scenario) => (
                    <button
                      key={scenario.title}
                      className={styles.demoScenarioCard}
                      type="button"
                      onClick={() => handleQuickPrompt(scenario.prompt)}
                    >
                      <span>{scenario.title}</span>
                      <strong>{scenario.prompt}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.assistantSection}>
                <p className={styles.assistantSectionTitle}>Konteks proyek</p>
                <div className={styles.assistantStats}>
                  <article className={styles.assistantStatCard}>
                    <strong>{workspaceDocuments.length}</strong>
                    <span>file proyek</span>
                  </article>
                  <article className={styles.assistantStatCard}>
                    <strong>{activeConversation?.documents.length ?? 0}</strong>
                    <span>file di sesi ini</span>
                  </article>
                  <article className={styles.assistantStatCard}>
                    <strong>{activeConversation?.messages.length ?? 0}</strong>
                    <span>catatan di sesi aktif</span>
                  </article>
                </div>
              </div>

              <div className={styles.assistantSection}>
                <p className={styles.assistantSectionTitle}>Cara pakai yang paling enak</p>
                <div className={styles.assistantTips}>
                  <p>1. Mulai dari unggah plan, gambar, atau spesifikasi proyek untuk memberi konteks awal.</p>
                  <p>2. Tambahkan referensi FBC, NEC, atau dokumen standar jika Anda ingin review yang lebih grounded.</p>
                  <p>3. Minta AI memisahkan antara asumsi umum, temuan review, dan tindakan lanjut untuk engineer.</p>
                </div>
              </div>
            </aside>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}
        </section>
      </section>
    </main>
  );
}
