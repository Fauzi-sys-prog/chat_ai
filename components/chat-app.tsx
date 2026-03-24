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
  const authTitle = isRegisterMode ? "Create your reviewer account" : "Sign in to your project review workspace";
  const authCopy = isRegisterMode
    ? "Create an account to manage projects, upload plans, and run AI-assisted building-code reviews."
    : "Sign in to an existing project. Email and Google will map to the same account when the address matches.";
  const emailSubmitLabel = isRegisterMode ? "Create account with email" : "Sign in with email";
  const googleSubmitLabel = isRegisterMode ? "Create account with Google" : "Sign in with Google";
  const googleProvider = authProviders?.google ?? null;
  const googleReady = Boolean(googleClientId && googleProvider?.enabled);
  const googleHelperText = googleProvider?.enabled
    ? googleProvider.description
    : googleProvider?.reason ??
      (googleClientId
        ? "Google sign-in is still being prepared."
        : "Google sign-in is not configured on the frontend yet.");

  const quickPrompts = [
    "Review this plan and identify rooms, fixtures, and areas that need MEP attention.",
    "Build the most relevant FBC and NEC checklist for this project.",
    "Turn this review into action items that a field engineer can execute.",
    "Summarize this reference file for a reviewer who just joined the project.",
    "Explain the Vision -> Code -> Routing workflow for this plan in practical terms.",
    "Answer at a high level first, then mark any points that still require project files or code references.",
  ];
  const proofCards = [
    {
      label: "Primary users",
      title: "Architecture, MEP, and code review teams",
      copy: "Built for teams that need to read plans, load FBC or NEC references, and turn review findings into follow-up work without jumping between files.",
    },
    {
      label: "Core problem",
      title: "Plan review and code lookup are still manual",
      copy: "Blueprint review, code lookup, and handoff to engineers are usually fragmented. This app brings them together in one project dashboard.",
    },
    {
      label: "Core workflow",
      title: "Intake plans, match codes, prepare handoff",
      copy: "Users upload plans and references, ask AI to generate review checklists, then convert findings into notes ready for design or field teams.",
    },
  ];
  const trustSignals = [
    "Vision intake for plans and reference files",
    "Code-aware review grounded in FBC and NEC",
    "Audit trail, request logs, and usage tracking",
    "PostgreSQL, migrations, and a deploy-ready path",
  ];
  const recruiterSignals = [
    {
      title: "Product thinking",
      copy: "The problem, target user, and building-plan review workflow are clear from the landing page through the active project view.",
    },
    {
      title: "End-to-end execution",
      copy: "This app demonstrates dashboard work, auth, data layers, uploads, AI review, and observability inside one coherent product.",
    },
    {
      title: "Operational realism",
      copy: "It includes projects, reference files, run logs, audit trails, quota signals, and a stable demo fallback for live presentations.",
    },
  ];
  const demoScenarios = [
    {
      title: "Intake plan",
      prompt: "Review this plan and identify rooms, fixtures, and areas that need MEP attention.",
    },
    {
      title: "Code checklist",
      prompt: "Build the most relevant FBC and NEC checklist for this project.",
    },
    {
      title: "Handoff engineer",
      prompt: "Turn this review into action items that a field engineer can execute.",
    },
  ];

  function handleSwitchAuthMode(nextMode: "login" | "register") {
    setAuthMode(nextMode);
    setError(null);
  }
  const starterFlows = [
    {
      title: "Fast plan review",
      description: "Start from the uploaded plan or drawing and ask AI to identify rooms, fixtures, and review areas.",
      prompt: "Review this plan and identify rooms, fixtures, and areas that need MEP attention.",
    },
    {
      title: "Building code checklist",
      description: "Use AI to assemble the most relevant review points from FBC, NEC, or project reference documents.",
      prompt: "Build the most relevant FBC and NEC checklist for this project.",
    },
    {
      title: "Action items MEP",
      description: "Turn review findings into a follow-up list that can be handed to an engineer or drafter.",
      prompt: "Turn this review into action items that a field engineer can execute.",
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
      label: "Active project",
      value: activeWorkspace?.name ?? "Not selected yet",
      ready: Boolean(activeWorkspace),
    },
    {
      label: "Plan files",
      value:
        projectPlanDocuments.length > 0
          ? `${projectPlanDocuments.length} files detected`
          : "No plan uploaded yet",
      ready: projectPlanDocuments.length > 0,
    },
    {
      label: "Code references",
      value:
        codeReferenceDocuments.length > 0
          ? `${codeReferenceDocuments.length} active references`
          : "No FBC / NEC loaded yet",
      ready: codeReferenceDocuments.length > 0,
    },
    {
      label: "Review session",
      value: activeConversation ? `${activeConversation.messages.length} active notes` : "No session yet",
      ready: Boolean(activeConversation),
    },
  ];

  async function readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Request failed.");
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
          setError(err instanceof Error ? err.message : "Failed to load the workspace.");
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
          setError(err instanceof Error ? err.message : "Failed to load workspace data.");
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
      setError(err instanceof Error ? err.message : "Authentication failed.");
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
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
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
      setError("Enter your email first to send a password reset.");
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
        throw new Error((await response.text()) || "Failed to send the password reset email.");
      }
      setError("The password reset link has been requested. Check your inbox or the email queue.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the password reset email.");
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
      setError(err instanceof Error ? err.message : "Failed to load the workspace.");
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
      setError(err instanceof Error ? err.message : "Failed to create the workspace.");
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
      setError(err instanceof Error ? err.message : "Failed to invite the member.");
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
      setError(err instanceof Error ? err.message : "Failed to remove the member.");
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
      setError(err instanceof Error ? err.message : "Failed to save member metadata.");
    }
  }

  async function handleInvitationDecision(tokenValue: string, action: "accept" | "reject") {
    try {
      setError(null);
      const response = await apiFetch(`/api/backend/workspace-invitations/${tokenValue}/${action}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to process the invitation.");
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
      setError(err instanceof Error ? err.message : "Failed to process the invitation.");
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
      setError(err instanceof Error ? err.message : "Failed to create the mock checkout session.");
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
      setError(err instanceof Error ? err.message : "Failed to save workspace settings.");
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
      setError(err instanceof Error ? err.message : "Failed to save the department budget.");
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
      setError(err instanceof Error ? err.message : "Failed to delete the department budget.");
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
        throw new Error((await response.text()) || "Failed to retry the email job.");
      }
      await fetchEmailJobs(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
      await fetchEmailWorkerStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry the email job.");
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
      setError(err instanceof Error ? err.message : "Failed to create the API key.");
    }
  }

  async function downloadProtectedFile(path: string, filename: string) {
    const response = await apiFetch(path);
    if (!response.ok) {
      throw new Error((await response.text()) || "Failed to download the file.");
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
      setError(err instanceof Error ? err.message : "Failed to download the request log.");
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
      setError(err instanceof Error ? err.message : "Failed to load request logs.");
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
      setError(err instanceof Error ? err.message : "Failed to change the request log page.");
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
      setError(err instanceof Error ? err.message : "Failed to export the invoice.");
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
        throw new Error((await response.text()) || "Failed to revoke the API key.");
      }
      await fetchWorkspaceApiKeys(activeWorkspace.id);
      await fetchWorkspaceApiKeyUsage(activeWorkspace.id);
      await fetchAuditLogs(activeWorkspace.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke the API key.");
    }
  }

  async function handleCopyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setError("Failed to copy the invite link.");
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
      setError(err instanceof Error ? err.message : "Failed to create a new review session.");
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
      setError(err instanceof Error ? err.message : "Failed to load the review session.");
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
        throw new Error((await response.text()) || "Failed to delete the review session.");
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
      setError(err instanceof Error ? err.message : "Failed to delete the review session.");
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
      setError(err instanceof Error ? err.message : "Failed to reset the review session.");
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
        throw new Error((await response.text()) || "The document upload failed.");
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
      setError(err instanceof Error ? err.message : "Failed to upload the document.");
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
        throw new Error((await response.text()) || "Failed to delete the document.");
      }

      await loadConversation(activeConversation.id);
      await fetchConversationSummaries();
      await fetchAnalytics();
      await fetchAdminAnalytics();
      if (activeWorkspace?.id) {
        await fetchWorkspaceDocuments(activeWorkspace.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete the document.");
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
              current.title === "New chat" || current.title === "New review"
                ? trimmed.slice(0, 48) || "New review"
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
        throw new Error((await response.text()) || "Failed to get a response.");
      }

      if (!response.body) {
        throw new Error("The server stream is not available.");
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
        throw new Error("The model did not return any response.");
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
                    ? { ...message, content: message.content || "Response stopped." }
                    : message,
                ),
              }
            : current,
        );
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "An error occurred while contacting the AI model.";
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
                          `I cannot answer that right now. ${errorMessage}`,
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
          <h1>An AI workspace for plan intake, code knowledge, and coordinated MEP review.</h1>
          <p className={styles.subcopy}>
            This product shows how one dashboard can be used to read plans, load FBC or NEC references,
            generate review checklists, and prepare handoff work for engineers without splitting the
            workflow across disconnected tools.
          </p>
          <div className={styles.recruiterStrip}>
            <span className={styles.recruiterStripLabel}>What This App Demonstrates</span>
            <strong>AI review workflows, code-grounded reasoning, and end-to-end full-stack execution.</strong>
          </div>
          <div className={styles.statusStrip}>
            <article className={styles.statusCard}>
              <span className={styles.statusLabel}>Backend</span>
              <strong>{backendStatus === "online" ? "Online" : backendStatus === "offline" ? "Offline" : "Checking"}</strong>
              <p>{backendStatus === "online" ? "The local API is ready." : "The backend connection is being checked."}</p>
            </article>
            <article className={styles.statusCard}>
              <span className={styles.statusLabel}>Data layer</span>
              <strong>PostgreSQL ready</strong>
              <p>The schema, migrations, and project data flow are prepared for a more production-ready rollout.</p>
            </article>
            <article className={styles.statusCard}>
              <span className={styles.statusLabel}>AI path</span>
              <strong>{aiMode === "demo" ? "Stable demo mode" : "Hybrid ready"}</strong>
              <p>Vision intake, code-reference retrieval, and a demo fallback are available in one product flow.</p>
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
                <p className={styles.statusLabel}>For Recruiters</p>
                <strong className={styles.recruiterTitle}>What this product shows about how I work</strong>
              </div>
              <p className={styles.recruiterCopy}>
                The goal is not just to build an AI chat surface, but to design a usable and stable
                plan-review workflow with a clear product point of view for design and MEP teams.
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
                <p className={styles.statusLabel}>Suggested demo flow</p>
                <strong className={styles.demoFlowTitle}>Three steps to show the product value</strong>
              </div>
              <p className={styles.demoFlowCopy}>
                Open the app, create a project, upload a plan and code references, then show how AI review
                becomes a concrete checklist and next-step handoff.
              </p>
            </div>
            <div className={styles.demoFlowGrid}>
              <article className={styles.demoStepCard}>
                <span className={styles.demoStepNumber}>01</span>
                <strong>Start with plan intake</strong>
                <p>Show that a plan or layout can enter the workflow as the starting context for room and fixture identification.</p>
              </article>
              <article className={styles.demoStepCard}>
                <span className={styles.demoStepNumber}>02</span>
                <strong>Load FBC or NEC</strong>
                <p>Show that building-code references can be used to generate a grounded review checklist.</p>
              </article>
              <article className={styles.demoStepCard}>
                <span className={styles.demoStepNumber}>03</span>
                <strong>Convert it into handoff work</strong>
                <p>Close with action items, review notes, and product logs so the workflow feels ready for the next team.</p>
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
                Create account
              </button>
              <button
                className={`${styles.authTab} ${authMode === "login" ? styles.authTabActive : ""}`}
                type="button"
                onClick={() => handleSwitchAuthMode("login")}
              >
                Sign in
              </button>
            </div>

            <form className={styles.authForm} onSubmit={handleAuthSubmit}>
              <p className={styles.authSectionNote}>
                {isRegisterMode
                  ? "Use email and password if you want to create a new project account manually."
                  : "Sign in with the email and password already linked to this review workspace."}
              </p>
              {authMode === "register" ? (
                <label className={styles.label}>
                  Name
                  <input
                    className={styles.authInput}
                    autoComplete="name"
                    value={authName}
                    onChange={(event) => setAuthName(event.target.value)}
                    placeholder="Your name"
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
                  placeholder="name@company.com"
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
                  placeholder="At least 8 characters"
                />
              </label>

              <button className={styles.button} type="submit" disabled={isAuthenticating || isBooting}>
                {isAuthenticating ? "Processing..." : emailSubmitLabel}
              </button>

              {authMode === "login" ? (
                <button className={styles.ghostButton} type="button" onClick={handlePasswordResetRequest}>
                  I forgot my password
                </button>
              ) : null}
            </form>

            {googleReady ? (
              <>
                <div className={styles.authDivider}>
                  <span>{isRegisterMode ? "or create an account faster" : "or continue with Google"}</span>
                </div>
                <div className={styles.googleAuthRow}>
                  <div ref={googleButtonRef} />
                </div>
                <p className={styles.authHint}>{googleHelperText}</p>
                {showGoogleDevHint ? (
                  <p className={styles.authHint}>
                    If the Google button does not respond locally, make sure this browser origin is registered in Google Cloud OAuth.
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
      ? "Project quota is almost exhausted. Upgrade the plan or reset the quota soon."
      : tokenQuotaRatio >= 0.75 || documentQuotaRatio >= 0.75
        ? "Project usage is running high. Monitor quotas so reviews and uploads do not stall."
        : null;
  const budgetWarning = departmentBudgetSignal
    ? departmentBudgetSignal.status === "exceeded"
      ? `The ${departmentBudgetSignal.department} department has exceeded its monthly budget.`
      : `The ${departmentBudgetSignal.department} department is nearing its monthly budget limit.`
    : null;
  const showStarterFlows = Boolean(activeConversation && (activeConversation.messages?.length ?? 0) <= 1);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTopline}>
          <div>
            <p className={styles.eyebrow}>Building Plan Automation MVP</p>
            <h1>An AI workspace for plan intake, FBC or NEC knowledge, and coordinated MEP review.</h1>
          </div>
          <div className={styles.accountCard}>
            <p className={styles.accountName}>{user.name}</p>
            <p className={styles.accountMeta}>{user.email}</p>
            <p className={styles.accountMeta}>
              {user.email_verified ? "Email verified" : "Email not yet verified"}
            </p>
            <button className={styles.ghostButton} type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        <p className={styles.subcopy}>
          The goal of this product is to bring drawing intake, building-code references, and AI-assisted
          review into one dashboard that can produce checklists, findings, and technical handoff notes.
          Recruiters should immediately understand that this is a project review workflow, not a generic chat UI.
        </p>
        <div className={styles.statusStrip}>
          <article className={styles.statusCard}>
            <span className={styles.statusLabel}>Backend</span>
            <strong>{backendStatus === "online" ? "Online" : backendStatus === "offline" ? "Offline" : "Checking"}</strong>
            <p>{backendStatus === "online" ? "The local server is running and ready to accept requests." : "The backend status is being checked."}</p>
          </article>
          <article className={styles.statusCard}>
            <span className={styles.statusLabel}>Mode AI</span>
            <strong>{aiMode === "demo" ? "Stable demo mode" : aiMode === "live" ? "Live AI mode" : "Hybrid ready"}</strong>
            <p>
              {aiMode === "demo"
                ? "The review workflow can still be demonstrated even when the live provider is not active."
                : "The AI path is ready for plan review, code lookup, and technical notes."}
            </p>
          </article>
          <article className={styles.statusCard}>
            <span className={styles.statusLabel}>Active project</span>
            <strong>{activeWorkspace ? activeWorkspace.name : "No project selected yet"}</strong>
            <p>{workspaces.length} connected projects with reference files, review sessions, and usage tracking.</p>
          </article>
        </div>
        <div className={styles.trustBar}>
          <span className={styles.trustChip}>Vision intake for plans and drawings</span>
          <span className={styles.trustChip}>FBC and NEC grounded review checklists</span>
          <span className={styles.trustChip}>Audit trails and request logs included</span>
          <span className={styles.trustChip}>Stable demo path available</span>
        </div>

        {quotaWarning || budgetWarning ? (
          <div className={styles.warningBanner}>
            <strong>{budgetWarning ? "Budget signal" : "Quota signal"}</strong>
            <span>{budgetWarning ?? quotaWarning}</span>
          </div>
        ) : null}

        {pendingInvites.length > 0 ? (
          <div className={styles.auditPanel}>
            <div className={styles.teamHeader}>
              <div>
                <p className={styles.analyticsLabel}>Pending invites</p>
                <h2 className={styles.adminTitle}>Incoming project invites</h2>
              </div>
            </div>

            <div className={styles.memberList}>
              {pendingInvites.map((invite) => (
                <article key={invite.id} className={styles.memberCard}>
                  <strong>{invite.workspace_name}</strong>
                  <span>
                    Created {new Date(invite.created_at).toLocaleString("en-US")}
                  </span>
                  <span>{invite.accept_url}</span>
                  <div className={styles.memberActions}>
                    <button
                      className={styles.ghostButton}
                      type="button"
                      onClick={() => handleCopyInviteLink(invite.accept_url)}
                    >
                      Copy link
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => handleInvitationDecision(invite.token, "accept")}
                    >
                      Accept
                    </button>
                    <button
                      className={styles.deleteButton}
                      type="button"
                      onClick={() => handleInvitationDecision(invite.token, "reject")}
                    >
                      Decline
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
                <p className={styles.analyticsLabel}>Project portfolio</p>
                <h2 className={styles.adminTitle}>Project spaces and review library</h2>
              </div>
            </div>

            <form className={styles.inlineForm} onSubmit={handleCreateWorkspace}>
              <input
                className={styles.authInput}
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="New project name"
              />
              <button className={styles.button} type="submit">
                Create project
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
                    {workspace.member_count} active collaborators
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.teamPanel}>
            <div className={styles.teamHeader}>
              <div>
                <p className={styles.analyticsLabel}>Project summary</p>
                <h2 className={styles.adminTitle}>
                  {workspaceBilling?.workspace_name ?? "Select a project"}
                </h2>
              </div>
            </div>

            {workspaceBilling ? (
              <>
                {workspaceSubscription ? (
                  <div className={styles.subscriptionPanel}>
                    <div>
                      <p className={styles.subscriptionTitle}>Active project summary</p>
                      <p className={styles.subscriptionMeta}>
                        {workspaceSubscription.seats_in_use} active collaborators • status {workspaceSubscription.status}
                        • period resets{" "}
                        {new Date(workspaceSubscription.current_period_end).toLocaleDateString("en-US")}
                      </p>
                      <p className={styles.subscriptionMeta}>
                        AI tokens {workspaceSubscription.quota_tokens_used.toLocaleString("en-US")} /{" "}
                        {workspaceSubscription.monthly_token_quota.toLocaleString("en-US")} • files{" "}
                        {workspaceSubscription.quota_documents_used} / {workspaceSubscription.monthly_document_quota}
                      </p>
                    </div>
                    <p className={styles.subscriptionPrice}>
                      {workspaceSubscription.plan_name}
                      <span>active plan</span>
                    </p>
                  </div>
                ) : null}

                {canManageMembers && showDetailedBilling ? (
                  <div className={styles.memberActions}>
                    <button className={styles.button} type="button" onClick={handleMockCheckout}>
                      Simulate Stripe checkout
                    </button>
                  </div>
                ) : null}

                <div className={styles.billingGrid}>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>Collaborators</span>
                    <strong>{workspaceBilling.member_count}</strong>
                    <p>Total people in this project</p>
                  </article>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>AI tokens</span>
                    <strong>{workspaceBilling.estimated_total_tokens.toLocaleString("en-US")}</strong>
                    <p>Estimated review token usage</p>
                  </article>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>Review sessions</span>
                    <strong>{workspaceBilling.chats_sent}</strong>
                    <p>Total review interactions sent</p>
                  </article>
                  <article className={styles.analyticsCard}>
                    <span className={styles.analyticsLabel}>Files</span>
                    <strong>{workspaceBilling.documents_uploaded}</strong>
                    <p>Uploaded plans and references</p>
                  </article>
                </div>

                {showDetailedBilling && invoiceSummary ? (
                  <div className={styles.auditPanel}>
                    <div className={styles.teamHeader}>
                      <div>
                        <p className={styles.analyticsLabel}>Cost estimate</p>
                        <h3 className={styles.subscriptionTitle}>Current period estimate</h3>
                      </div>
                      {canManageMembers ? (
                        <button className={styles.ghostButton} type="button" onClick={handleExportInvoiceCsv}>
                          Download invoice CSV
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
                        <span className={styles.analyticsLabel}>Usage</span>
                        <strong>${invoiceSummary.estimated_usage_cost_usd.toFixed(4)}</strong>
                        <p>{invoiceSummary.token_usage.toLocaleString("en-US")} estimated tokens</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Requests</span>
                        <strong>{invoiceSummary.request_count}</strong>
                        <p>{invoiceSummary.api_key_request_count} through API keys</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Total</span>
                        <strong>${invoiceSummary.total_usd.toFixed(2)}</strong>
                        <p>
                          {new Date(invoiceSummary.period_start).toLocaleDateString("en-US")} -{" "}
                          {new Date(invoiceSummary.period_end).toLocaleDateString("en-US")}
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
                            <p className={styles.analyticsLabel}>Member summary</p>
                            <h3 className={styles.subscriptionTitle}>Usage by member</h3>
                          </div>
                        </div>
                        <div className={styles.auditList}>
                          {invoiceSummary.member_breakdown.map((member) => (
                            <article key={`${invoiceSummary.workspace_id}-${member.email}`} className={styles.auditItem}>
                              <strong>{member.name}</strong>
                              <span>{member.email}</span>
                              <span>
                                department {member.department ?? "-"} • cost center {member.cost_center ?? "-"}
                              </span>
                              <span>
                                {member.token_usage.toLocaleString("en-US")} tokens • $
                                {member.estimated_usage_cost_usd.toFixed(4)}
                              </span>
                              <span>
                                {member.chats_sent} review prompts • {member.documents_uploaded} documents
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
                            <p className={styles.analyticsLabel}>Department budgets</p>
                            <h3 className={styles.subscriptionTitle}>Budget threshold signals</h3>
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
                                utilization {(item.utilization_ratio * 100).toFixed(1)}% • alert at{" "}
                                {(item.alert_threshold_ratio * 100).toFixed(0)}%
                              </span>
                              <span>{item.member_count} members tagged to this department</span>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {invoiceHistory.length > 0 ? (
                      <div className={styles.auditPanel}>
                        <div className={styles.teamHeader}>
                          <div>
                            <p className={styles.analyticsLabel}>Invoice history</p>
                            <h3 className={styles.subscriptionTitle}>Last 6 months</h3>
                          </div>
                        </div>
                        <div className={styles.auditList}>
                          {invoiceHistory.map((invoice) => (
                            <article key={`${invoice.workspace_id}-${invoice.period_start}`} className={styles.auditItem}>
                              <strong>{invoice.period_label}</strong>
                              <span>
                                total ${invoice.total_usd.toFixed(2)} • tokens{" "}
                                {invoice.token_usage.toLocaleString("en-US")}
                              </span>
                              <span>
                                requests {invoice.request_count} • documents {invoice.document_uploads}
                              </span>
                              <span>
                                {new Date(invoice.period_start).toLocaleDateString("en-US")} -{" "}
                                {new Date(invoice.period_end).toLocaleDateString("en-US")}
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
                      placeholder="Invite a collaborator by email"
                    />
                    <button className={styles.button} type="submit">
                      Invite
                    </button>
                  </form>
                ) : null}

                <div className={styles.memberList}>
                  {activeWorkspace.members.map((member) => (
                    <article key={member.email} className={styles.memberCard}>
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                      <span>
                        department {member.department ?? "-"} • cost center {member.cost_center ?? "-"}
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
                            placeholder="Department"
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
                      placeholder="Cost center"
                    />
                          <div />
                          <button
                            className={styles.ghostButton}
                            type="button"
                            onClick={() => handleSaveMemberMetadata(member.email)}
                          >
                            Save tags
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
                            Remove member
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
                        <h3 className={styles.subscriptionTitle}>Workspace activity trail</h3>
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
                            {log.actor_email ? <span>actor {log.actor_email}</span> : null}
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
                            <span>{new Date(log.created_at).toLocaleString("en-US")}</span>
                          </article>
                        ))
                      ) : (
                        <p className={styles.emptyText}>No audit log entries are available for this workspace yet.</p>
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
                  <p className={styles.analyticsLabel}>Workspace usage</p>
                  <h2 className={styles.adminTitle}>Usage meter by member</h2>
                </div>
              </div>

              <div className={styles.memberList}>
                {memberUsage.map((entry) => (
                  <article key={entry.email} className={styles.memberCard}>
                    <strong>{entry.name}</strong>
                    <span>{entry.email}</span>
                    <span>
                      {entry.estimated_total_tokens.toLocaleString("en-US")} tokens • $
                      {entry.estimated_total_cost_usd.toFixed(4)}
                    </span>
                    <span>
                      {entry.chats_sent} review prompts • {entry.documents_uploaded} documents
                    </span>
                  </article>
                ))}
                {memberUsage.length === 0 ? (
                  <p className={styles.emptyText}>There is no member usage data to show yet.</p>
                ) : null}
              </div>
            </section>

            <section className={styles.teamPanel}>
              <div className={styles.teamHeader}>
                <div>
                  <p className={styles.analyticsLabel}>Workspace settings</p>
                  <h2 className={styles.adminTitle}>Plan, quotas, and email operations</h2>
                </div>
              </div>

              {workspaceSettings ? (
                <form className={styles.settingsGrid} onSubmit={handleSaveWorkspaceSettings}>
                  <label className={styles.label}>
                    Plan name
                    <input
                      className={styles.authInput}
                      value={planName}
                      onChange={(event) => setPlanName(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Included seats
                    <input
                      className={styles.authInput}
                      type="number"
                      value={seatsIncluded}
                      onChange={(event) => setSeatsIncluded(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Base price USD
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
                    Per-seat price USD
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
                    Monthly token quota
                    <input
                      className={styles.authInput}
                      type="number"
                      value={monthlyTokenQuota}
                      onChange={(event) => setMonthlyTokenQuota(event.target.value)}
                      disabled={!canEditWorkspaceSettings}
                    />
                  </label>
                  <label className={styles.label}>
                    Monthly document quota
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
                    <strong>{workspaceSettings.smtp_enabled ? "Ready" : "Disabled"}</strong>
                    <p>{workspaceSettings.smtp_enabled ? "Invite email delivery is enabled" : "SMTP is not configured yet"}</p>
                  </article>
                  <div className={styles.settingsActions}>
                    <button
                      className={styles.button}
                      type="submit"
                      disabled={!canEditWorkspaceSettings}
                    >
                      Save settings
                    </button>
                  </div>
                </form>
              ) : (
                <p className={styles.emptyText}>Workspace settings are not available for this access level yet.</p>
              )}

              {workspaceSettings ? (
                <div className={styles.auditPanel}>
                  <div className={styles.teamHeader}>
                    <div>
                      <p className={styles.analyticsLabel}>Department budgets</p>
                      <h3 className={styles.subscriptionTitle}>Department spending limits</h3>
                    </div>
                  </div>

                  {canManageMembers ? (
                    <form className={styles.filterRow} onSubmit={handleSaveDepartmentBudget}>
                      <input
                        className={styles.authInput}
                        value={departmentBudgetName}
                        onChange={(event) => setDepartmentBudgetName(event.target.value)}
                        placeholder="Department name"
                      />
                      <input
                        className={styles.authInput}
                        type="number"
                        step="0.01"
                        value={departmentBudgetUsd}
                        onChange={(event) => setDepartmentBudgetUsd(event.target.value)}
                        placeholder="Monthly budget USD"
                      />
                      <input
                        className={styles.authInput}
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="1"
                        value={departmentBudgetThreshold}
                        onChange={(event) => setDepartmentBudgetThreshold(event.target.value)}
                        placeholder="Alert ratio"
                      />
                      <button className={styles.button} type="submit">
                        Save budget
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
                              budget ${budget.monthly_budget_usd.toFixed(2)} • alert at{" "}
                              {(budget.alert_threshold_ratio * 100).toFixed(0)}%
                            </span>
                            <span>
                              current spend ${alert?.spend_usd.toFixed(4) ?? "0.0000"} • utilization{" "}
                              {alert ? `${(alert.utilization_ratio * 100).toFixed(1)}%` : "0.0%"}
                            </span>
                            <span>{alert?.member_count ?? 0} members tagged to this department</span>
                            {canManageMembers ? (
                              <div className={styles.memberActions}>
                                <button
                                  className={styles.deleteButton}
                                  type="button"
                                  onClick={() => handleDeleteDepartmentBudget(budget.id)}
                                >
                                  Remove budget
                                </button>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={styles.emptyText}>
                      No department budgets have been added yet. Add a spending limit so billing can raise earlier warnings.
                    </p>
                  )}
                </div>
              ) : null}

              <div className={styles.auditPanel}>
                <div className={styles.teamHeader}>
                  <div>
                    <p className={styles.analyticsLabel}>Observability</p>
                    <h3 className={styles.subscriptionTitle}>Request log overview</h3>
                  </div>
                </div>

                {workspaceObservability ? (
                  <>
                    <div className={styles.filterRow}>
                      <input
                        className={styles.authInput}
                        value={requestLogQuery}
                        onChange={(event) => setRequestLogQuery(event.target.value)}
                        placeholder="Search a path, for example /conversations"
                      />
                      <select
                        className={styles.authInput}
                        value={requestLogAuthMode}
                        onChange={(event) => setRequestLogAuthMode(event.target.value)}
                      >
                        <option value="">All auth modes</option>
                        <option value="session">session</option>
                        <option value="api_key">api_key</option>
                      </select>
                      <select
                        className={styles.authInput}
                        value={requestLogStatusCode}
                        onChange={(event) => setRequestLogStatusCode(event.target.value)}
                      >
                        <option value="">All statuses</option>
                        <option value="200">200</option>
                        <option value="401">401</option>
                        <option value="403">403</option>
                        <option value="404">404</option>
                        <option value="500">500</option>
                      </select>
                      <button className={styles.button} type="button" onClick={handleApplyRequestLogFilters}>
                        Apply
                      </button>
                    </div>

                    <div className={styles.memberActions}>
                      <button className={styles.ghostButton} type="button" onClick={handleExportRequestLogsCsv}>
                        Download request log CSV
                      </button>
                      <span className={styles.emptyText}>
                        {requestLogTotal} total logs • page {Math.floor(requestLogOffset / requestLogLimit) + 1}
                      </span>
                    </div>

                    <div className={styles.billingGrid}>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Requests</span>
                        <strong>{workspaceObservability.total_requests}</strong>
                        <p>Total recorded requests</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Errors</span>
                        <strong>{workspaceObservability.error_requests}</strong>
                        <p>HTTP 4xx/5xx</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Latency</span>
                        <strong>{workspaceObservability.avg_duration_ms} ms</strong>
                        <p>Average duration</p>
                      </article>
                      <article className={styles.analyticsCard}>
                        <span className={styles.analyticsLabel}>Last seen</span>
                        <strong>
                          {workspaceObservability.last_request_at
                            ? new Date(workspaceObservability.last_request_at).toLocaleDateString("en-US")
                            : "-"}
                        </strong>
                        <p>
                          {workspaceObservability.top_paths.length > 0
                            ? workspaceObservability.top_paths.join(" • ")
                            : "No dominant paths yet"}
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
                            <strong>Recent error</strong>
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
                          <span>{new Date(log.created_at).toLocaleString("en-US")}</span>
                        </article>
                      ))}
                      {requestLogs.length === 0 ? (
                        <p className={styles.emptyText}>There are no detailed request logs for this workspace yet.</p>
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
                          Previous page
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
                          Next page
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.emptyText}>Observability is not available for this access level yet.</p>
                )}
              </div>

              <div className={styles.auditPanel}>
                <div className={styles.teamHeader}>
                  <div>
                    <p className={styles.analyticsLabel}>Workspace API keys</p>
                    <h3 className={styles.subscriptionTitle}>Integration access</h3>
                  </div>
                </div>

                <form className={styles.inlineForm} onSubmit={handleCreateApiKey}>
                  <input
                    className={styles.authInput}
                    value={newApiKeyLabel}
                    onChange={(event) => setNewApiKeyLabel(event.target.value)}
                    placeholder="API key label"
                    disabled={!canManageMembers}
                  />
                  <button className={styles.button} type="submit" disabled={!canManageMembers}>
                    Create key
                  </button>
                </form>

                {latestApiKey ? (
                  <article className={styles.auditItem}>
                    <strong>New API key</strong>
                    <span>{latestApiKey}</span>
                    <span>Save it now. The raw key will not be shown again after this.</span>
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
                          ? `last used ${new Date(item.last_used_at).toLocaleString("en-US")}`
                          : `created ${new Date(item.created_at).toLocaleString("en-US")}`}
                      </span>
                      {item.status === "active" ? (
                        <div className={styles.memberActions}>
                          <button
                            className={styles.deleteButton}
                            type="button"
                            onClick={() => handleRevokeApiKey(item.id)}
                          >
                            Revoke access
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {workspaceApiKeys.length === 0 ? (
                    <p className={styles.emptyText}>There are no API keys for this workspace yet.</p>
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
                        {item.billable_request_count} billable requests • $
                        {item.estimated_cost_usd.toFixed(4)} •{" "}
                        {item.estimated_tokens.toLocaleString("en-US")} tokens
                      </span>
                      <span>
                        {item.last_used_at
                          ? `last used ${new Date(item.last_used_at).toLocaleString("en-US")}`
                          : "never used yet"}
                      </span>
                      <span>{item.last_path ? `last path ${item.last_path}` : "no path recorded yet"}</span>
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
                    <p className={styles.emptyText}>There is no recorded API key usage yet.</p>
                  ) : null}
                </div>
              </div>

              <div className={styles.auditPanel}>
                <div className={styles.teamHeader}>
                  <div>
                    <p className={styles.analyticsLabel}>Email queue</p>
                    <h3 className={styles.subscriptionTitle}>Invite delivery status</h3>
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
                        attempts {job.attempt_count} • worker {job.worker_name ?? "-"}
                        </span>
                      <span>
                        {job.sent_at
                          ? `sent ${new Date(job.sent_at).toLocaleString("en-US")}`
                          : `queued ${new Date(job.created_at).toLocaleString("en-US")}`}
                      </span>
                      {job.processing_started_at ? (
                        <span>
                          processing started {new Date(job.processing_started_at).toLocaleString("en-US")}
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
                            Retry send
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                  {emailJobs.length === 0 ? (
                    <p className={styles.emptyText}>There are no email jobs for this workspace yet.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {analytics ? (
          <div className={styles.analyticsGrid}>
            <article className={styles.analyticsCard}>
              <span className={styles.analyticsLabel}>Review sessions</span>
              <strong>{analytics.conversation_count}</strong>
              <p>{analytics.chats_sent} review prompts sent</p>
            </article>
            <article className={styles.analyticsCard}>
              <span className={styles.analyticsLabel}>Reference files</span>
              <strong>{analytics.document_count}</strong>
              <p>{analytics.total_chunks} indexed reference chunks</p>
            </article>
            <article className={styles.analyticsCard}>
              <span className={styles.analyticsLabel}>AI notes</span>
              <strong>{analytics.message_count}</strong>
              <p>{analytics.assistant_message_count} AI responses</p>
            </article>
            {!isSimpleWorkspaceMode ? (
              <>
                <article className={styles.analyticsCard}>
                  <span className={styles.analyticsLabel}>Estimated tokens</span>
                  <strong>{analytics.estimated_total_tokens.toLocaleString("en-US")}</strong>
                  <p>
                    prompt {analytics.estimated_prompt_tokens.toLocaleString("en-US")} • completion{" "}
                    {analytics.estimated_completion_tokens.toLocaleString("en-US")}
                  </p>
                </article>
                <article className={styles.analyticsCard}>
                  <span className={styles.analyticsLabel}>Estimated cost</span>
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
                <p className={styles.analyticsLabel}>Admin analytics</p>
                <h2 className={styles.adminTitle}>Cross-workspace summary</h2>
              </div>
              <p className={styles.adminSummary}>
                {adminAnalytics.user_count} users • {adminAnalytics.usage_event_count} usage events • $
                {adminAnalytics.estimated_total_cost_usd.toFixed(4)}
              </p>
            </div>

            <div className={styles.adminMetrics}>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.conversation_count}</strong>
                <span>Total conversations</span>
              </div>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.document_count}</strong>
                <span>Total documents</span>
              </div>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.message_count}</strong>
                <span>Total messages</span>
              </div>
              <div className={styles.adminMetric}>
                <strong>{adminAnalytics.estimated_total_tokens.toLocaleString("en-US")}</strong>
                <span>Total estimated tokens</span>
              </div>
            </div>

            {emailWorkerStatus ? (
              <div className={styles.metadataList}>
                <span className={styles.metadataTag}>
                  worker {emailWorkerStatus.worker_enabled ? "enabled" : "manual"}
                </span>
                <span className={styles.metadataTag}>
                  running {emailWorkerStatus.worker_running ? "yes" : "no"}
                </span>
                <span className={styles.metadataTag}>
                  queue {emailWorkerStatus.queue_depth}
                </span>
                <span className={styles.metadataTag}>
                  processing {emailWorkerStatus.processing_jobs}
                </span>
                <span className={styles.metadataTag}>
                  failed {emailWorkerStatus.failed_jobs}
                </span>
                {emailWorkerStatus.last_processed_at ? (
                  <span className={styles.metadataTag}>
                    last processed {new Date(emailWorkerStatus.last_processed_at).toLocaleString("en-US")}
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
                    {entry.conversation_count} review sessions • {entry.document_count} documents
                  </p>
                  <p className={styles.topUserCost}>
                    ${entry.estimated_total_cost_usd.toFixed(4)} •{" "}
                    {entry.estimated_total_tokens.toLocaleString("en-US")} tokens
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
            New review
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
                    {conversation.document_count} files • {conversation.message_count} notes
                  </span>
                  <span className={styles.conversationMeta}>
                    {new Date(conversation.updated_at).toLocaleString("en-US", {
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
                  Delete
                </button>
              </div>
            ))}
            {conversations.length === 0 ? (
              <div className={styles.sidebarEmptyCard}>
                <span className={styles.statusLabel}>Start here</span>
                <strong>No active review sessions yet</strong>
                <p>Create a new review to start reading plans, loading code references, or discussing project findings.</p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={styles.shell}>
          <div className={styles.knowledgeBar}>
            <div>
              <p className={styles.knowledgeEyebrow}>Plan intake and code knowledge</p>
              <h2 className={styles.knowledgeTitle}>
                {workspaceDocuments.length} project and reference files
              </h2>
              <p className={styles.documentMeta}>
                {activeConversation?.documents.length ?? 0} files linked directly to this review session
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
                {isUploading ? "Uploading..." : "Upload plans or codes"}
              </button>
              <button className={styles.ghostButton} type="button" onClick={handleReset}>
                Reset session
              </button>
            </div>
          </div>

          <div className={styles.planOpsBoard}>
            <div className={styles.planOpsHeader}>
              <div>
                <p className={styles.knowledgeEyebrow}>Pipeline MVP</p>
                <h3 className={styles.planOpsTitle}>Eyes - Brain - Hands</h3>
                <p className={styles.planOpsCopy}>
                  Use this dashboard to intake drawings, load FBC or NEC knowledge, and turn review findings
                  into checklists and technical handoff notes that are more ready to execute.
                </p>
              </div>
              <div className={styles.planStageRow}>
                <span className={styles.planStageChip}>Eyes: read plans and fixtures</span>
                <span className={styles.planStageChip}>Brain: match them to code</span>
                <span className={styles.planStageChip}>Hands: prepare routing and follow-up work</span>
              </div>
            </div>

            <div className={styles.planOpsGrid}>
              {projectReadiness.map((item) => (
                <article key={item.label} className={styles.planOpsCard}>
                  <span className={styles.analyticsLabel}>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p>{item.ready ? "Ready to use in the current review workflow." : "Still needs more setup before the pipeline feels complete."}</p>
                </article>
              ))}
            </div>

            <div className={styles.planActionRow}>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => handleQuickPrompt("Read this plan and identify rooms, fixtures, and areas that need MEP review.")}
              >
                Start plan intake
              </button>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => handleQuickPrompt("Build the most relevant FBC and NEC checklist for this project.")}
              >
                Request a code checklist
              </button>
              <button
                className={styles.ghostButton}
                type="button"
                onClick={() => handleQuickPrompt("Turn these review findings into action items that an engineer in the field can use.")}
              >
                Prepare an engineer handoff
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
                      {document.chunk_count} chunks •{" "}
                      {new Date(document.created_at).toLocaleString("en-US", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                    <p className={styles.documentMeta}>session: {document.conversation_title}</p>
                  </div>
                  <button
                    className={styles.deleteButton}
                    type="button"
                    onClick={() => handleDeleteDocument(document.id)}
                  >
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className={styles.emptyText}>
                There are no project files yet. You can start with a general question, then upload plans, FBC or NEC references, or project specifications for a sharper review.
              </p>
            )}
          </div>

          <div className={styles.workspaceMain}>
            <div className={styles.chatColumn}>
              <div className={styles.messages} ref={messagesRef}>
                {isBooting ? (
                  <article className={`${styles.message} ${styles.assistantMessage}`}>
                    <span className={styles.messageRole}>System</span>
                    <p>Preparing the review workspace...</p>
                  </article>
                ) : null}

                {showStarterFlows ? (
                  <section className={styles.starterPanel}>
                    <div className={styles.starterHeader}>
                      <span className={styles.statusLabel}>Suggested starting points</span>
                      <strong>Start with the review scenario that is easiest to demonstrate</strong>
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
                      {message.role === "user" ? "You" : "AI"}
                    </span>
                    <p>{message.content}</p>
                  </article>
                ))}
              </div>

              <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.label} htmlFor="prompt">
                  Write a review instruction
                </label>

                <textarea
                  ref={promptInputRef}
                  id="prompt"
                  className={styles.input}
                  rows={4}
                  placeholder="Example: read this plan and build an NEC checklist for the bathroom and kitchen, or convert the findings into next actions"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={!activeConversation}
                />

                <div className={styles.formFooter}>
                  <p className={styles.hint}>
                    Architecture: Next.js UI, FastAPI backend, PostgreSQL, reference retrieval, and AI review chat.
                  </p>
                  <div className={styles.actions}>
                    {isLoading ? (
                      <button className={styles.stopButton} type="button" onClick={handleStop}>
                        Stop
                      </button>
                    ) : null}
                    <button className={styles.button} type="submit" disabled={isLoading || !activeConversation}>
                      {isLoading ? "Streaming..." : "Send"}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <aside className={styles.assistantRail}>
              <div className={styles.assistantRailHeader}>
                <p className={styles.analyticsLabel}>Assistant</p>
                <h3 className={styles.subscriptionTitle}>Building plan review copilot</h3>
                {aiMode === "demo" ? (
                  <span className={styles.demoBadge}>Demo mode active</span>
                ) : null}
                <p className={styles.assistantCopy}>
                  Use this AI to read plans, load code references, write review findings, and prepare technical handoff notes in one place.
                </p>
                {aiMode === "demo" ? (
                  <p className={styles.demoHint}>
                    Responses are currently using a simulation fallback that still works well for workflow demos and user-flow testing.
                  </p>
                ) : null}
              </div>

              <div className={styles.assistantSection}>
                <p className={styles.assistantSectionTitle}>Quick tasks</p>
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
                <p className={styles.assistantSectionTitle}>Demo scenarios</p>
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
                <p className={styles.assistantSectionTitle}>Project context</p>
                <div className={styles.assistantStats}>
                  <article className={styles.assistantStatCard}>
                    <strong>{workspaceDocuments.length}</strong>
                    <span>project files</span>
                  </article>
                  <article className={styles.assistantStatCard}>
                    <strong>{activeConversation?.documents.length ?? 0}</strong>
                    <span>files in this session</span>
                  </article>
                  <article className={styles.assistantStatCard}>
                    <strong>{activeConversation?.messages.length ?? 0}</strong>
                    <span>notes in the active session</span>
                  </article>
                </div>
              </div>

              <div className={styles.assistantSection}>
                <p className={styles.assistantSectionTitle}>Recommended workflow</p>
                <div className={styles.assistantTips}>
                  <p>1. Start by uploading plans, drawings, or project specifications to establish context.</p>
                  <p>2. Add FBC, NEC, or standards documents if you want more grounded review outputs.</p>
                  <p>3. Ask the AI to separate general assumptions, review findings, and next actions for the engineer.</p>
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
