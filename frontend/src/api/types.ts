/**
 * API 契约（TypeScript）。字段名严格对齐 `backend/app/schemas.py`。
 */

export type Kind = 'sms' | 'notification' | 'call';
export type Role = 'admin' | 'user';
export type ThemeMode = 'light' | 'dark' | 'system';
export type Locale = 'zh' | 'en';

// --------------------------------------------------------------------- ingest

export interface IngestResponse {
  ok: boolean;
  id: number;
  duplicate: boolean;
  code: string | null;
  received_at: string;
  time_source: string;
}

// --------------------------------------------------------------------- auth

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SetupRequest extends LoginRequest {
  display_name?: string;
}

export interface RegisterRequest extends LoginRequest {
  display_name?: string;
}

export interface UserOut {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_admin: boolean;
  is_active: boolean;
  locale: string;
  theme_seed: string;
  theme_mode: ThemeMode;
  created_at: string;
  last_login_at: string | null;
  /** 是否有服务端重编码的头像 */
  has_avatar: boolean;
  /** 头像更新时间（缓存失效指纹，拼进 avatar URL query） */
  avatar_updated_at: string | null;
}

export interface PreferencesUpdate {
  locale?: Locale | null;
  theme_seed?: string | null;
  theme_mode?: ThemeMode | null;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export interface SetupStatus {
  setup_required: boolean;
  allow_public_registration: boolean;
}

// --------------------------------------------------------------------- devices

export interface ShareOut {
  user_id: number;
  username: string;
  display_name: string;
  created_at: string;
}

export interface DeviceOut {
  id: number;
  name: string;
  description: string;
  color: string;
  sim_label: string;
  is_active: boolean;
  owner_id: number;
  owner_name: string;
  is_owner: boolean;
  created_at: string;
  last_ingest_at: string | null;
  secret_fingerprint: string;
  device_mark: string;
  last_auth_kind: string;
  message_count: number;
  shares: ShareOut[];
  /** 仅创建/轮换响应返回，用于接入向导 */
  secret?: string | null;
}
export interface TestPushOut {
  sender: string;
  code: string | null;
  received_at: string;
  time_source: string;
  sign_ok: boolean;
  auth_kind: string;
}

export interface TestSessionOut {
  session_id: string;
  expires_at: string;
}

export interface TestSessionStatus {
  active: boolean;
  push: TestPushOut | null;
}


export interface DeviceCreate {
  name: string;
  description?: string;
  color?: string;
  sim_label?: string;
}

export interface DeviceUpdate {
  name?: string;
  description?: string;
  color?: string;
  sim_label?: string;
  is_active?: boolean;
}

export interface ShareCreate {
  username: string;
}


// --------------------------------------------------------------------- messages

export interface CodeCandidateOut {
  code: string;
  confidence: number;
}

export interface MessageOut {
  id: number;
  device_id: number;
  device_name: string;
  device_color: string;
  kind: Kind;
  sender: string;
  content: string;
  raw_content: string;
  received_at: string;
  ingested_at: string;
  sent_at: string | null;
  time_source: string;
  time_doubtful: boolean;
  sim_slot: string;
  code: string | null;
  code_confidence: number | null;
  code_candidates: CodeCandidateOut[];
  code_expires_at: string | null;
  code_expired: boolean;
  can_delete: boolean;
  raw_payload: Record<string, unknown>;
}

export interface MessagePage {
  items: MessageOut[];
  next_cursor: string | null;
}

export interface FacetItem {
  value: string;
  label: string;
  count: number;
}

export interface FacetsOut {
  senders: FacetItem[];
  devices: FacetItem[];
  total: number;
}

export interface PurgeRequest {
  before_days: number;
  device_ids?: number[] | null;
}

export interface PurgeResponse {
  deleted: number;
}

export interface DeleteResponse {
  ok: boolean;
}

/** 消息列表/筛选条件（前端侧，映射为重复 query 参数） */
export interface MessageFilters {
  q?: string;
  senders?: string[];
  device_ids?: Array<number | string>;
  kind?: Kind | '';
  has_code?: boolean;
  from?: string;
  to?: string;
  /** `received_at`（默认）或 `ingested_at` */
  sort?: 'received_at' | 'ingested_at';
  order?: 'asc' | 'desc';
  limit?: number;
}

// --------------------------------------------------------------------- admin

export interface AdminUserCreate {
  username: string;
  display_name?: string;
  password?: string | null;
  role?: Role;
}

export interface AdminUserUpdate {
  display_name?: string | null;
  role?: Role | null;
  is_active?: boolean | null;
  password?: string | null;
}

export interface CreatedUserOut {
  user: UserOut;
  initial_password: string | null;
}

export interface AdminDeviceOut extends DeviceOut {
  message_count: number;
  shared_with_count: number;
}

export interface SettingsOut {
  allow_public_registration: boolean;
  device_limit_per_user: number;
  rate_limit_per_device_per_min: number;
  max_body_bytes: number;
  max_content_chars: number;
}

export interface SettingsUpdate {
  allow_public_registration?: boolean;
  device_limit_per_user?: number;
  rate_limit_per_device_per_min?: number;
  max_body_bytes?: number;
  max_content_chars?: number;
}

export interface AuditOut {
  id: number;
  at: string;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_kind: string;
  action: string;
  target_type: string;
  target_id: string;
  ip: string;
  success: boolean;
  detail: Record<string, unknown>;
}

export interface AuditPage {
  items: AuditOut[];
  next_cursor: string | null;
}

export interface StatsOut {
  users: number;
  devices: number;
  messages: number;
  messages_24h: number;
  codes_24h: number;
  db_bytes: number;
  last_ingest_at: string | null;
}

export interface LoginAttemptOut {
  at: string;
  username: string;
  ip: string;
  success: boolean;
}

export interface LockoutOut {
  username: string;
  locked: boolean;
  failed_count: number;
}

// --------------------------------------------------------------------- misc

export interface HealthOut {
  ok: boolean;
  sse_subscribers: number;
}

/** SSE 事件（`GET /api/events`） */
export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}
