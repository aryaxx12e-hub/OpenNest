import {
  AiError,
  createAiProviderRegistry,
  createOpenAiCompatibleAdapter,
  type AiCompletion,
  type AiCredentialHandle,
  type AiMessage,
  type AiPreparedPayload,
  type AiProviderAdapter,
  type AiProviderConfig,
  type AiProviderInput,
  type AiProviderStore,
  type AiRequest,
  type AiStreamEvent,
  type AiTransport,
} from "@opennest/ai";
import {
  MAX_CONSENT_TTL_MS,
  scopeDigest,
  type AuditLog,
  type CapabilityBroker,
  type CapabilityGrant,
  type CapabilityHandle,
  type ConsentRecord,
  type ConsentRegistry,
  type DataClass,
  type GrantRegistry,
  type HighRiskConfirmation,
  type Principal,
  type ResourceScope,
} from "@opennest/privacy";

export interface AiCredentialChoice {
  readonly kind: "session" | "vault";
  readonly id: string;
  readonly providerId: string;
}

export interface AiRequestInput {
  readonly providerId: string;
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly credential: AiCredentialChoice | null;
  readonly stream: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface AiPreparedRequest {
  readonly prepared: AiPreparedPayload;
  readonly provider: AiProviderConfig;
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly credential: AiCredentialChoice | null;
  readonly expiresAt: number;
}

export interface AiRuntime {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  listProviders(): Promise<AiProviderConfig[]>;
  createProvider(input: AiProviderInput): Promise<AiProviderConfig>;
  updateProvider(id: string, input: AiProviderInput): Promise<AiProviderConfig>;
  removeProvider(id: string): Promise<void>;
  prepare(input: AiRequestInput): Promise<AiPreparedRequest>;
  approveAndSend(
    input: AiPreparedRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AiCompletion>;
  approveAndStream(
    input: AiPreparedRequest,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<AiStreamEvent>;
  revokeConsent(id: string): Promise<void>;
  listConsents(): Promise<ConsentRecord[]>;
  dispose(): Promise<void>;
}

export interface AiRuntimeSettings {
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  readonly providers: AiProviderStore;
}

export interface AiPrivacyDependencies {
  readonly sessionId: string;
  readonly principal: Principal;
  readonly consents: ConsentRegistry;
  readonly grants: GrantRegistry;
  readonly audit: AuditLog;
  readonly broker: CapabilityBroker;
  revokeConsent(id: string): Promise<void>;
}

export interface CreateAiRuntimeInput {
  readonly privacy: AiPrivacyDependencies;
  readonly settings: AiRuntimeSettings;
  readonly transport: AiTransport;
  readonly createAdapter?: (provider: AiProviderConfig) => AiProviderAdapter;
  readonly now?: () => number;
}

interface Approval {
  readonly consent: ConsentRecord;
  readonly grants: readonly CapabilityGrant[];
}

interface Attempt {
  readonly provider: AiProviderConfig;
  readonly prepared: AiPreparedPayload;
  readonly adapter: AiProviderAdapter;
  readonly handles: readonly CapabilityHandle[];
  readonly credential: AiCredentialHandle | null;
  readonly providerDigest: string;
}

interface ActiveRequest {
  readonly controller: AbortController;
  readonly adapter: AiProviderAdapter;
  readonly done: Promise<void>;
}

function defaultCreateAdapter(provider: AiProviderConfig): AiProviderAdapter {
  return createOpenAiCompatibleAdapter(provider);
}

export function createAiRuntime(options: CreateAiRuntimeInput): AiRuntime {
  const { privacy, settings, transport } = options;
  const now = options.now ?? (() => Date.now());
  const createAdapter = options.createAdapter ?? defaultCreateAdapter;
  const approvals = new WeakMap<AiPreparedRequest, Approval>();
  const activeRequests = new Set<ActiveRequest>();
  const providers = createAiProviderRegistry({ store: settings.providers, now });
  let disposed = false;

  function assertActive(): void {
    if (disposed) {
      throw new AiError("runtime_disposed", "The AI runtime is disposed.");
    }
  }

  function abortActiveRequests(): void {
    for (const request of activeRequests) {
      request.controller.abort();
      request.adapter.abort();
    }
  }

  async function abortAndWaitForActiveRequests(): Promise<void> {
    const pending = [...activeRequests].map((request) => request.done);
    abortActiveRequests();
    await Promise.all(pending);
  }

  async function assertEnabled(): Promise<void> {
    if (!(await settings.getEnabled())) {
      throw new AiError(
        "ai_disabled",
        "Enable AI before preparing or sending a request."
      );
    }
  }

  async function requireProvider(id: string): Promise<AiProviderConfig> {
    const provider = await settings.providers.get(id);

    if (provider === null) {
      throw new AiError("unknown_provider", "The selected AI provider does not exist.");
    }

    return provider;
  }

  function validateCredential(
    provider: AiProviderConfig,
    credential: AiCredentialChoice | null
  ): void {
    if (provider.auth === "none") {
      if (credential !== null) {
        throw new AiError(
          "unexpected_credential",
          "This provider does not accept a credential."
        );
      }

      return;
    }

    if (credential === null) {
      throw new AiError(
        "credential_missing",
        "This provider requires a session credential."
      );
    }

    if (credential.providerId !== provider.id) {
      throw new AiError(
        "credential_provider_mismatch",
        "The credential belongs to another provider."
      );
    }
  }

  function normalizeDataClasses(value: readonly DataClass[]): readonly DataClass[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new AiError(
        "invalid_data_class",
        "An AI request needs at least one data class."
      );
    }

    const unique = [...new Set(value)];

    if (unique.length !== value.length) {
      throw new AiError(
        "invalid_data_class",
        "The AI request data classes contain duplicates."
      );
    }

    for (const dataClass of unique) {
      if (dataClass !== "D1" && dataClass !== "D2") {
        throw new AiError(
          "invalid_data_class",
          "AI requests may only use D1 or D2 data classes."
        );
      }
    }

    return unique.sort();
  }

  function normalizePurpose(value: string): string {
    const purpose = value.trim();

    if (purpose.length === 0 || purpose.length > 200) {
      throw new AiError("invalid_request", "An AI request needs a short purpose.");
    }

    return purpose;
  }

  function requestFromInput(input: AiRequestInput): AiRequest {
    return {
      model: input.model,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      stream: input.stream,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    };
  }

  function providerScope(providerId: string): ResourceScope {
    return { kind: "provider", providerId };
  }

  function aiCapability(providerId: string): `ai.invoke:${string}` {
    return `ai.invoke:${providerId}`;
  }

  function networkCapability(origin: string): `network.connect:${string}` {
    return `network.connect:${origin}`;
  }

  function credentialCapability(providerId: string): `credential.use:${string}` {
    return `credential.use:${providerId}`;
  }

  async function revokeGrants(approval: Approval): Promise<void> {
    for (const grant of approval.grants) {
      if (grant.status !== "active") {
        continue;
      }

      try {
        await privacy.grants.revoke(grant.id, now());
      } catch {
        // The grant may already have been revoked by another path.
      }
    }
  }

  async function revokeApproval(approval: Approval): Promise<void> {
    await revokeGrants(approval);

    try {
      await privacy.consents.revoke(approval.consent.id, now());
    } catch {
      // The consent may already have been revoked.
    }
  }

  async function getOrCreateApproval(
    preview: AiPreparedRequest,
    provider: AiProviderConfig,
    prepared: AiPreparedPayload,
    dataClasses: readonly DataClass[],
    purpose: string
  ): Promise<Approval> {
    const existing = approvals.get(preview);

    if (existing !== undefined) {
      return existing;
    }

    const at = now();
    const consent = await privacy.consents.create({
      sessionId: privacy.sessionId,
      principalId: privacy.principal.id,
      providerId: provider.id,
      model: prepared.request.model,
      endpointOrigin: prepared.origin,
      payloadHash: prepared.payloadHash,
      payloadBytes: prepared.payloadBytes,
      dataClasses,
      purpose,
      expiresAt: Math.min(preview.expiresAt, at + MAX_CONSENT_TTL_MS),
    });
    const grants: CapabilityGrant[] = [];

    try {
      const scope = providerScope(provider.id);
      const common = {
        principalId: privacy.principal.id,
        purpose,
        expiresAt: consent.expiresAt,
        maxUses: 1,
        sessionOnly: true,
        sessionId: privacy.sessionId,
        auditRef: consent.id,
      };

      grants.push(
        await privacy.grants.create({
          ...common,
          capability: aiCapability(provider.id),
          scope,
        })
      );
      grants.push(
        await privacy.grants.create({
          ...common,
          capability: networkCapability(prepared.origin),
          scope: { kind: "origin", origin: prepared.origin },
        })
      );

      if (preview.credential !== null) {
        grants.push(
          await privacy.grants.create({
            ...common,
            capability: credentialCapability(provider.id),
            scope,
          })
        );
      }
    } catch (error) {
      for (const grant of grants) {
        try {
          await privacy.grants.revoke(grant.id, now());
        } catch {
          // The grant may not have been stored.
        }
      }

      try {
        await privacy.consents.revoke(consent.id, now());
      } catch {
        // The consent may not have been stored.
      }

      throw error;
    }

    const approval = { consent, grants };
    approvals.set(preview, approval);

    return approval;
  }

  async function appendRequested(
    approval: Approval,
    provider: AiProviderConfig,
    digest: string
  ): Promise<void> {
    try {
      await privacy.audit.append({
        event: "ai.requested",
        outcome: "info",
        principalId: privacy.principal.id,
        capability: aiCapability(provider.id),
        scopeDigest: digest,
        itemCount: null,
        reason: null,
      });
    } catch (error) {
      await revokeApproval(approval);
      throw error;
    }
  }

  async function createHandles(
    approval: Approval,
    preview: AiPreparedRequest,
    provider: AiProviderConfig,
    prepared: AiPreparedPayload,
    purpose: string
  ): Promise<CapabilityHandle[]> {
    const scope = providerScope(provider.id);
    const handles: CapabilityHandle[] = [];

    try {
      handles.push(
        await privacy.broker.request({
          capability: aiCapability(provider.id),
          scope,
          purpose,
        })
      );
      handles.push(
        await privacy.broker.request({
          capability: networkCapability(prepared.origin),
          scope: { kind: "origin", origin: prepared.origin },
          purpose,
        })
      );

      if (preview.credential !== null) {
        const confirmation: HighRiskConfirmation = {
          confirmedAt: now(),
          scopeDigest: await scopeDigest(scope),
          itemCount: 1,
        };

        handles.push(
          await privacy.broker.request({
            capability: credentialCapability(provider.id),
            scope,
            purpose,
            confirmation,
          })
        );
      }

      return handles;
    } catch (error) {
      await revokeGrants(approval);
      throw error;
    }
  }

  async function begin(preview: AiPreparedRequest, stream: boolean): Promise<Attempt> {
    assertActive();
    await assertEnabled();

    if (preview.prepared.request.stream !== stream) {
      throw new AiError(
        "invalid_request",
        "The prepared AI request does not match this operation."
      );
    }

    if (now() >= preview.expiresAt) {
      throw new AiError(
        "payload_changed",
        "The AI request preview has expired. Prepare it again."
      );
    }

    const provider = await requireProvider(preview.provider.id);
    validateCredential(provider, preview.credential);

    const adapter = createAdapter(provider);
    const prepared = await adapter.prepare(preview.prepared.request);

    if (
      prepared.payloadHash !== preview.prepared.payloadHash ||
      prepared.origin !== preview.prepared.origin ||
      prepared.endpoint !== preview.prepared.endpoint
    ) {
      throw new AiError(
        "payload_changed",
        "The AI request changed after review. Prepare it again."
      );
    }

    const dataClasses = normalizeDataClasses(preview.dataClasses);
    const purpose = normalizePurpose(preview.purpose);
    const providerDigest = await scopeDigest(providerScope(provider.id));
    const approval = await getOrCreateApproval(
      preview,
      provider,
      prepared,
      dataClasses,
      purpose
    );

    await appendRequested(approval, provider, providerDigest);

    try {
      await privacy.consents.consume(approval.consent.id, {
        sessionId: privacy.sessionId,
        providerId: provider.id,
        model: prepared.request.model,
        endpointOrigin: prepared.origin,
        payloadHash: prepared.payloadHash,
        dataClasses,
        at: now(),
      });
    } catch (error) {
      await revokeGrants(approval);
      throw error;
    }

    const handles = await createHandles(approval, preview, provider, prepared, purpose);

    return {
      provider,
      prepared,
      adapter,
      handles,
      credential: preview.credential,
      providerDigest,
    };
  }

  function createActive(
    adapter: AiProviderAdapter,
    callerSignal: AbortSignal
  ): { active: ActiveRequest; cleanup: () => void } {
    const controller = new AbortController();
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const active = { controller, adapter, done };
    const onAbort = () => controller.abort(callerSignal.reason);

    activeRequests.add(active);

    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener("abort", onAbort, { once: true });
    }

    return {
      active,
      cleanup: () => {
        callerSignal.removeEventListener("abort", onAbort);
        activeRequests.delete(active);
        finish();
      },
    };
  }

  function isAbort(
    error: unknown,
    controller: AbortController,
    callerSignal: AbortSignal
  ): boolean {
    if (controller.signal.aborted || callerSignal.aborted) {
      return true;
    }

    if (error instanceof AiError && error.code === "aborted") {
      return true;
    }

    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "revoked"
    );
  }

  function safeReason(error: unknown): string {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      return (error as { code: string }).code;
    }

    return "unknown_error";
  }

  async function appendOutcome(
    attempt: Attempt,
    status: "completed" | "failed" | "aborted",
    error: unknown
  ): Promise<void> {
    const event =
      status === "completed"
        ? "ai.completed"
        : status === "aborted"
          ? "ai.aborted"
          : "ai.failed";
    const outcome =
      status === "completed" ? "completed" : status === "failed" ? "failed" : "info";
    const reason =
      status === "completed"
        ? null
        : status === "aborted"
          ? "aborted"
          : safeReason(error);

    await privacy.audit.append({
      event,
      outcome,
      principalId: privacy.principal.id,
      capability: aiCapability(attempt.provider.id),
      scopeDigest: attempt.providerDigest,
      itemCount: null,
      reason,
    });
  }

  async function invokeHandles<T>(
    handles: readonly CapabilityHandle[],
    outer: AbortController,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const signals: AbortSignal[] = [outer.signal];

    async function invokeAt(index: number): Promise<T> {
      if (index >= handles.length) {
        const linked = linkSignals(signals);

        try {
          return await operation(linked.signal);
        } finally {
          linked.cleanup();
        }
      }

      const handle = handles[index];

      if (handle === undefined) {
        throw new AiError("invalid_request", "The AI request is incomplete.");
      }

      return privacy.broker.invoke(handle, async (signal) => {
        signals.push(signal);

        try {
          return await invokeAt(index + 1);
        } finally {
          signals.pop();
        }
      });
    }

    return invokeAt(0);
  }

  async function sendCompletion(
    attempt: Attempt,
    callerSignal: AbortSignal
  ): Promise<AiCompletion> {
    const { active, cleanup } = createActive(attempt.adapter, callerSignal);
    let completed = false;

    try {
      const completion = await invokeHandles(
        attempt.handles,
        active.controller,
        async (signal) => {
          const onAbort = () => attempt.adapter.abort();
          signal.addEventListener("abort", onAbort, { once: true });

          try {
            return await attempt.adapter.complete({
              prepared: attempt.prepared,
              transport,
              credential: attempt.credential,
              signal,
            });
          } finally {
            signal.removeEventListener("abort", onAbort);
          }
        }
      );

      await appendOutcome(attempt, "completed", null);
      completed = true;

      return completion;
    } catch (error) {
      await appendOutcome(
        attempt,
        isAbort(error, active.controller, callerSignal) ? "aborted" : "failed",
        error
      );
      throw error;
    } finally {
      if (!completed) {
        active.controller.abort();
      }

      cleanup();
    }
  }

  return {
    async isEnabled() {
      assertActive();
      return settings.getEnabled();
    },
    async setEnabled(enabled) {
      assertActive();
      await settings.setEnabled(enabled);

      if (!enabled) {
        await abortAndWaitForActiveRequests();
      }
    },
    async listProviders() {
      assertActive();
      return settings.providers.list();
    },
    async createProvider(input) {
      assertActive();
      return providers.create(input);
    },
    async updateProvider(id, input) {
      assertActive();
      return providers.update(id, input);
    },
    async removeProvider(id) {
      assertActive();
      await providers.remove(id);
    },
    async prepare(input) {
      assertActive();
      await assertEnabled();

      const provider = await requireProvider(input.providerId);

      if (!provider.models.includes(input.model)) {
        throw new AiError(
          "model_not_allowed",
          "The selected model is not configured for this provider."
        );
      }

      validateCredential(provider, input.credential);

      const dataClasses = normalizeDataClasses(input.dataClasses);
      const purpose = normalizePurpose(input.purpose);
      const adapter = createAdapter(provider);
      const prepared = await adapter.prepare(requestFromInput(input));

      return {
        prepared,
        provider,
        dataClasses,
        purpose,
        credential: input.credential,
        expiresAt: now() + MAX_CONSENT_TTL_MS,
      };
    },
    async approveAndSend(input, requestOptions = {}) {
      const callerSignal = requestOptions.signal ?? new AbortController().signal;
      const attempt = await begin(input, false);

      return sendCompletion(attempt, callerSignal);
    },
    async *approveAndStream(input, requestOptions = {}) {
      const callerSignal = requestOptions.signal ?? new AbortController().signal;
      const attempt = await begin(input, true);
      const { active, cleanup } = createActive(attempt.adapter, callerSignal);
      const queue = new StreamQueue<AiStreamEvent>();
      let failure: unknown = null;
      let completed = false;
      let audited = false;
      const run = invokeHandles(attempt.handles, active.controller, async (signal) => {
        const onAbort = () => attempt.adapter.abort();
        signal.addEventListener("abort", onAbort, { once: true });

        try {
          for await (const event of attempt.adapter.stream({
            prepared: attempt.prepared,
            transport,
            credential: attempt.credential,
            signal,
          })) {
            queue.push(event);
          }
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      })
        .catch((error: unknown) => {
          failure = error;
        })
        .finally(() => {
          queue.close();
        });

      try {
        while (true) {
          const item = await queue.next();

          if (item.done) {
            break;
          }

          yield item.value;
        }

        await run;

        if (failure !== null) {
          throw failure;
        }

        await appendOutcome(attempt, "completed", null);
        completed = true;
        audited = true;
      } catch (error) {
        await appendOutcome(
          attempt,
          isAbort(error, active.controller, callerSignal) ? "aborted" : "failed",
          error
        );
        audited = true;
        throw error;
      } finally {
        if (!completed) {
          active.controller.abort();
          await run;
        }

        if (!audited) {
          await appendOutcome(attempt, "aborted", null);
        }

        active.controller.abort();
        cleanup();
      }
    },
    async revokeConsent(id) {
      assertActive();
      await privacy.revokeConsent(id);
    },
    async listConsents() {
      assertActive();
      return privacy.consents.list();
    },
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await abortAndWaitForActiveRequests();
      activeRequests.clear();
    },
  };
}

function linkSignals(signals: readonly AbortSignal[]): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const listeners: (() => void)[] = [];

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      continue;
    }

    const listener = () => controller.abort(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push(() => signal.removeEventListener("abort", listener));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const remove of listeners) {
        remove();
      }

      listeners.length = 0;
    },
  };
}

class StreamQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: ((item: IteratorResult<T>) => void)[] = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter === undefined) {
      this.values.push(value);
      return;
    }

    waiter({ value, done: false });
  }

  close(): void {
    if (this.ended) {
      return;
    }

    this.ended = true;

    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();

    if (value !== undefined) {
      return Promise.resolve({ value, done: false });
    }

    if (this.ended) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
