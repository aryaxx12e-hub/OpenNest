export type PrincipalType =
  "built-in" | "extension" | "ai-provider" | "sync-target" | "external-storage" | "user";

export interface Principal {
  readonly id: string;
  readonly type: PrincipalType;
  readonly label: string;
}

export type WorkspaceCapability =
  | "workspace.read.metadata"
  | "workspace.read.content"
  | "workspace.write"
  | "workspace.export"
  | "workspace.delete";

export type ExternalCapability =
  | `network.connect:${string}`
  | `credential.use:${string}`
  | `ai.invoke:${string}`
  | "sync.push"
  | "sync.pull";

export type Capability = WorkspaceCapability | ExternalCapability;

export type CapabilityFamily = "workspace" | "network" | "credential" | "ai" | "sync";

export interface ParsedCapability {
  readonly family: CapabilityFamily;
  readonly capability: Capability;
  readonly qualifier?: string;
}

export type ResourceScope =
  | { readonly kind: "workspace"; readonly workspaceId: string }
  | {
      readonly kind: "folder";
      readonly workspaceId: string;
      readonly folderId: string;
      readonly includeDescendants: boolean;
    }
  | {
      readonly kind: "notes";
      readonly workspaceId: string;
      readonly noteIds: readonly string[];
    }
  | {
      readonly kind: "files";
      readonly workspaceId: string;
      readonly fileIds: readonly string[];
    }
  | { readonly kind: "origin"; readonly origin: string }
  | { readonly kind: "provider"; readonly providerId: string };

export type GrantStatus = "active" | "revoked";

export type EffectiveGrantStatus = "active" | "expired" | "exhausted" | "revoked";

export interface CapabilityGrant {
  readonly id: string;
  readonly principalId: string;
  readonly capability: Capability;
  readonly scope: ResourceScope;
  readonly purpose: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly sessionOnly: boolean;
  readonly sessionId: string | null;
  readonly status: GrantStatus;
  readonly builtIn: boolean;
  readonly auditRef: string | null;
  readonly revokedAt: number | null;
}

export interface HighRiskConfirmation {
  readonly confirmedAt: number;
  readonly scopeDigest: string;
  readonly itemCount: number;
}

export interface CapabilityRequest {
  readonly capability: Capability;
  readonly scope: ResourceScope;
  readonly purpose: string;
  readonly confirmation?: HighRiskConfirmation;
}

export interface CapabilityHandle {
  readonly id: string;
  readonly grantId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly capability: Capability;
  readonly scope: ResourceScope;
  readonly expiresAt: number;
}

export interface CreateGrantInput {
  readonly principalId: string;
  readonly capability: Capability;
  readonly scope: ResourceScope;
  readonly purpose: string;
  readonly expiresAt?: number | null;
  readonly maxUses?: number | null;
  readonly sessionOnly?: boolean;
  readonly sessionId?: string | null;
  readonly builtIn?: boolean;
  readonly auditRef?: string | null;
}

export interface GrantStore {
  list(): Promise<CapabilityGrant[]>;
  get(id: string): Promise<CapabilityGrant | null>;
  put(grant: CapabilityGrant): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ConsentRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpointOrigin: string;
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly revokedAt: number | null;
}

export interface CreateConsentInput {
  readonly sessionId: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpointOrigin: string;
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly expiresAt: number;
}

export interface ConsentExpectation {
  readonly sessionId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpointOrigin: string;
  readonly payloadHash: string;
  readonly dataClasses: readonly DataClass[];
  readonly at: number;
}

export interface ConsentStore {
  list(): Promise<ConsentRecord[]>;
  get(id: string): Promise<ConsentRecord | null>;
  put(record: ConsentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ConsentRegistry {
  create(input: CreateConsentInput): Promise<ConsentRecord>;
  get(id: string): Promise<ConsentRecord | null>;
  list(): Promise<ConsentRecord[]>;
  consume(id: string, expected: ConsentExpectation): Promise<ConsentRecord>;
  revoke(id: string, at: number): Promise<ConsentRecord>;
  clear(): Promise<void>;
}

export type AuditEvent =
  | "grant.created"
  | "grant.revoked"
  | "grant.denied"
  | "capability.allowed"
  | "capability.denied"
  | "capability.completed"
  | "capability.failed"
  | "data.exported"
  | "data.restored"
  | "data.deleted"
  | "audit.integrity_failed"
  | "rate.limited"
  | "ai.requested"
  | "ai.completed"
  | "ai.failed"
  | "ai.aborted"
  | "extension.installed"
  | "extension.updated"
  | "extension.enabled"
  | "extension.disabled"
  | "extension.uninstalled"
  | "extension.started"
  | "extension.terminated"
  | "extension.integrity_failed"
  | "extension.safe_mode";

export type AuditOutcome = "allowed" | "denied" | "completed" | "failed" | "info";

export interface AuditEntry {
  readonly id: string;
  readonly sequence: number;
  readonly at: number;
  readonly event: AuditEvent;
  readonly outcome: AuditOutcome;
  readonly principalId: string | null;
  readonly capability: string | null;
  readonly scopeDigest: string | null;
  readonly itemCount: number | null;
  readonly reason: string | null;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface AuditInput {
  readonly event: AuditEvent;
  readonly outcome: AuditOutcome;
  readonly principalId?: string | null;
  readonly capability?: string | null;
  readonly scopeDigest?: string | null;
  readonly itemCount?: number | null;
  readonly reason?: string | null;
}

export interface AuditVerification {
  readonly valid: boolean;
  readonly entries: number;
  readonly brokenAt: number | null;
}

export interface AuditStore {
  list(): Promise<AuditEntry[]>;
  append(entry: AuditEntry): Promise<void>;
  clear(): Promise<void>;
}

export interface AuditLog {
  append(input: AuditInput): Promise<AuditEntry>;
  list(): Promise<AuditEntry[]>;
  verify(): Promise<AuditVerification>;
  clear(): Promise<void>;
}

export interface PrivacyStore {
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  readonly grants: GrantStore;
  readonly audit: AuditStore;
  readonly consents: ConsentStore;
}

export interface GrantRegistry {
  create(input: CreateGrantInput): Promise<CapabilityGrant>;
  get(id: string): Promise<CapabilityGrant | null>;
  list(): Promise<CapabilityGrant[]>;
  revoke(id: string, at: number): Promise<CapabilityGrant>;
  revokeAll(principalId?: string): Promise<number>;
  reserveUse(id: string): Promise<CapabilityGrant>;
  ensureBuiltIns(workspaceId: string): Promise<CapabilityGrant[]>;
  clearSession(sessionId: string): Promise<number>;
}

export interface CapabilityBroker {
  request(input: CapabilityRequest): Promise<CapabilityHandle>;
  invoke<T>(
    handle: CapabilityHandle,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T>;
  revoke(grantId: string): Promise<void>;
  revokeAll(): Promise<number>;
  listGrants(): Promise<CapabilityGrant[]>;
  endSession(): Promise<void>;
}

export type DataClass = "D0" | "D1" | "D2" | "D3" | "D4" | "D5";

export type DataStorage = "indexeddb" | "localstorage" | "memory" | "file";

export type DataRetention = "until-delete" | "session" | "until-cleared" | "external";

export interface DataInventoryEntry {
  readonly id: string;
  readonly labelKey: string;
  readonly dataClass: DataClass;
  readonly storage: DataStorage;
  readonly includedInBackup: boolean;
  readonly derivedFrom: readonly string[];
  readonly deletedWithSource: boolean;
  readonly retention: DataRetention;
}

export type FlowConsent = "built-in" | "explicit" | "not-available";

export interface FlowMatrixEntry {
  readonly id: string;
  readonly labelKey: string;
  readonly source: string;
  readonly destination: string;
  readonly dataClasses: readonly DataClass[];
  readonly purposeKey: string;
  readonly retentionKey: string;
  readonly consent: FlowConsent;
  readonly available: boolean;
  readonly revocationLimitKey: string | null;
}
