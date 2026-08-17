/**
 * Boult Execution Telemetry - Phase 1
 * 
 * Comprehensive observability system providing:
 * - Execution metrics (latency, throughput, success rates)
 * - Distributed tracing (OpenTelemetry compatible)
 * - Structured logging with context
 * - Health checks and alerting
 * - Performance profiling
 * 
 * Integration points:
 * - Operator Runtime (run/step transitions)
 * - Execution Context (trace propagation)
 * - Task Registry (action metrics)
 * - Database (query performance)
 */

import { executionContextManager } from './boult-execution-context.js';

// ============================================================================
// METRIC TYPES
// ============================================================================

export const METRIC_TYPES = {
  COUNTER: 'counter',       // Increment-only (e.g., total requests)
  GAUGE: 'gauge',           // Up/down values (e.g., active runs)
  HISTOGRAM: 'histogram',   // Distribution (e.g., latency)
  SUMMARY: 'summary'       // Pre-aggregated quantiles
};

// ============================================================================
// METRIC NAMES
// ============================================================================

export const EXECUTION_METRICS = {
  // Run metrics
  RUNS_STARTED: 'boult_runs_started_total',
  RUNS_COMPLETED: 'boult_runs_completed_total',
  RUNS_FAILED: 'boult_runs_failed_total',
  RUN_DURATION: 'boult_run_duration_ms',
  ACTIVE_RUNS: 'boult_active_runs',

  // Step metrics
  STEPS_STARTED: 'boult_steps_started_total',
  STEPS_COMPLETED: 'boult_steps_completed_total',
  STEPS_FAILED: 'boult_steps_failed_total',
  STEP_DURATION: 'boult_step_duration_ms',
  STEP_TRANSITIONS: 'boult_step_transitions_total',

  // Action metrics
  ACTIONS_STARTED: 'boult_actions_started_total',
  ACTIONS_COMPLETED: 'boult_actions_completed_total',
  ACTIONS_FAILED: 'boult_actions_failed_total',
  ACTION_DURATION: 'boult_action_duration_ms',
  ACTION_RETRIES: 'boult_action_retries_total',

  // Approval metrics
  APPROVALS_REQUESTED: 'boult_approvals_requested_total',
  APPROVALS_GRANTED: 'boult_approvals_granted_total',
  APPROVALS_DENIED: 'boult_approvals_denied_total',
  APPROVAL_WAIT_TIME: 'boult_approval_wait_time_ms',

  // Idempotency metrics
  IDEMPOTENT_HITS: 'boult_idempotent_hits_total',
  IDEMPOTENT_MISSES: 'boult_idempotent_misses_total',

  // Error metrics
  ERRORS_BY_CATEGORY: 'boult_errors_by_category_total',
  ERRORS_BY_ACTION: 'boult_errors_by_action_total',

  // Database metrics
  DB_QUERY_DURATION: 'boult_db_query_duration_ms',
  DB_ERRORS: 'boult_db_errors_total',

  // Integration metrics
  INTEGRATION_CALLS: 'boult_integration_calls_total',
  INTEGRATION_ERRORS: 'boult_integration_errors_total',
  INTEGRATION_LATENCY: 'boult_integration_latency_ms'
};

// ============================================================================
// TELEMETRY COLLECTOR
// ============================================================================

export class TelemetryCollector {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.bufferSize = options.bufferSize || 1000;
    this.flushInterval = options.flushInterval || 30000; // 30 seconds
    this.samplingRate = options.samplingRate || 1.0; // 100% by default
    
    this.metrics = new Map();
    this.spans = [];
    this.events = [];
    this.logs = [];
    
    this.flushTimer = null;
    this.startFlushTimer();
  }

  startFlushTimer() {
    if (this.flushInterval > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
    }
  }

  stopFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // Check if we should sample this data point
  shouldSample() {
    return Math.random() < this.samplingRate;
  }

  // Record a metric
  recordMetric(name, value, labels = {}, timestamp = Date.now()) {
    if (!this.enabled || !this.shouldSample()) return;

    const key = this.serializeLabels(name, labels);
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        name,
        labels,
        values: [],
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity
      });
    }

    const metric = this.metrics.get(key);
    metric.values.push({ value, timestamp });
    metric.count++;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);

    // Keep buffer size in check
    if (metric.values.length > this.bufferSize) {
      metric.values.shift();
    }
  }

  // Increment a counter
  incrementCounter(name, labels = {}, value = 1) {
    this.recordMetric(name, value, labels);
  }

  // Record a gauge value
  recordGauge(name, value, labels = {}) {
    this.recordMetric(name, value, labels);
  }

  // Record a histogram value (duration, etc.)
  recordHistogram(name, value, labels = {}) {
    this.recordMetric(name, value, labels);
  }

  // Start a span for distributed tracing
  startSpan(name, options = {}) {
    if (!this.enabled) return null;

    const context = executionContextManager.getCurrentContext();
    const parentSpanId = options.parentSpanId || context?.spanId;
    const traceId = options.traceId || context?.traceId || this.generateTraceId();
    
    const span = {
      id: this.generateSpanId(),
      traceId,
      parentSpanId,
      name,
      kind: options.kind || 'internal',
      startTime: Date.now(),
      endTime: null,
      status: 'unset', // unset, ok, error
      attributes: options.attributes || {},
      events: [],
      links: options.links || []
    };

    this.spans.push(span);
    return span;
  }

  // End a span
  endSpan(span, status = 'ok', attributes = {}) {
    if (!span) return;

    span.endTime = Date.now();
    span.status = status;
    Object.assign(span.attributes, attributes);

    // Record duration metric
    const duration = span.endTime - span.startTime;
    this.recordHistogram('boult_span_duration_ms', duration, {
      span_name: span.name,
      status
    });
  }

  // Add event to span
  addSpanEvent(span, name, attributes = {}) {
    if (!span) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes
    });
  }

  // Record a structured event
  recordEvent(type, payload = {}) {
    if (!this.enabled) return;

    const context = executionContextManager.getCurrentContext();
    
    this.events.push({
      type,
      timestamp: new Date().toISOString(),
      traceId: context?.traceId,
      executionId: context?.executionId,
      runId: context?.runId,
      ...payload
    });

    // Trim buffer
    if (this.events.length > this.bufferSize) {
      this.events.shift();
    }
  }

  // Log with context
  log(level, message, meta = {}) {
    if (!this.enabled) return;

    const context = executionContextManager.getCurrentContext();
    
    this.logs.push({
      timestamp: new Date().toISOString(),
      level,
      message,
      traceId: context?.traceId,
      executionId: context?.executionId,
      runId: context?.runId,
      ...meta
    });

    // Trim buffer
    if (this.logs.length > this.bufferSize) {
      this.logs.shift();
    }
  }

  // Flush data to exporters
  async flush() {
    if (!this.enabled) return;

    const data = {
      metrics: Array.from(this.metrics.values()),
      spans: this.spans.filter(s => s.endTime !== null), // Only completed spans
      events: [...this.events],
      logs: [...this.logs]
    };

    // Clear flushed data
    this.spans = this.spans.filter(s => s.endTime === null); // Keep open spans
    this.events = [];
    this.logs = [];

    // Call exporters
    await this.export(data);
  }

  // Export data to configured backends
  async export(data) {
    // Console exporter (default)
    if (process.env.TELEMETRY_CONSOLE_EXPORT === 'true') {
      this.exportToConsole(data);
    }

    // HTTP exporter
    if (process.env.TELEMETRY_HTTP_ENDPOINT) {
      await this.exportToHttp(data);
    }
  }

  exportToConsole(data) {
    console.log('[TELEMETRY FLUSH]', {
      timestamp: new Date().toISOString(),
      metricsCount: data.metrics.length,
      spansCount: data.spans.length,
      eventsCount: data.events.length,
      logsCount: data.logs.length
    });

    // Log slow spans
    const slowSpans = data.spans.filter(s => (s.endTime - s.startTime) > 5000);
    if (slowSpans.length > 0) {
      console.warn('[TELEMETRY] Slow spans detected:', slowSpans.map(s => ({
        name: s.name,
        duration: s.endTime - s.startTime
      })));
    }

    // Log errors
    const errorLogs = data.logs.filter(l => l.level === 'error');
    if (errorLogs.length > 0) {
      console.error('[TELEMETRY] Errors:', errorLogs.length);
    }
  }

  async exportToHttp(data) {
    try {
      const response = await fetch(process.env.TELEMETRY_HTTP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        console.error('[TELEMETRY] HTTP export failed:', response.status);
      }
    } catch (err) {
      console.error('[TELEMETRY] HTTP export error:', err.message);
    }
  }

  // Utility methods
  serializeLabels(name, labels) {
    const sortedKeys = Object.keys(labels).sort();
    const labelStr = sortedKeys.map(k => `${k}=${labels[k]}`).join(',');
    return `${name}{${labelStr}}`;
  }

  generateTraceId() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  generateSpanId() {
    return crypto.randomBytes(8).toString('hex');
  }

  // Get current statistics
  getStats() {
    return {
      metrics: this.metrics.size,
      activeSpans: this.spans.filter(s => s.endTime === null).length,
      completedSpans: this.spans.filter(s => s.endTime !== null).length,
      events: this.events.length,
      logs: this.logs.length
    };
  }

  // Health check
  healthCheck() {
    return {
      status: 'healthy',
      enabled: this.enabled,
      stats: this.getStats(),
      samplingRate: this.samplingRate
    };
  }
}

// ============================================================================
// EXECUTION TELEMETRY INTEGRATION
// ============================================================================

export class ExecutionTelemetry {
  constructor(collector) {
    this.collector = collector;
  }

  // Run lifecycle
  onRunStarted(run) {
    this.collector.incrementCounter(EXECUTION_METRICS.RUNS_STARTED, {
      intent: run.intent,
      complexity: run.complexity
    });
    
    this.collector.recordGauge(EXECUTION_METRICS.ACTIVE_RUNS, 1, {
      run_id: run.runId
    });

    this.collector.recordEvent('run_started', {
      runId: run.runId,
      intent: run.intent,
      complexity: run.complexity,
      planCount: run.planSnapshot?.length || 0
    });
  }

  onRunCompleted(run, durationMs) {
    this.collector.incrementCounter(EXECUTION_METRICS.RUNS_COMPLETED, {
      intent: run.intent,
      status: run.status
    });

    this.collector.recordHistogram(EXECUTION_METRICS.RUN_DURATION, durationMs, {
      intent: run.intent,
      complexity: run.complexity,
      status: run.status
    });

    this.collector.recordGauge(EXECUTION_METRICS.ACTIVE_RUNS, 0, {
      run_id: run.runId
    });

    this.collector.recordEvent('run_completed', {
      runId: run.runId,
      status: run.status,
      durationMs
    });
  }

  onRunFailed(run, error, durationMs) {
    this.collector.incrementCounter(EXECUTION_METRICS.RUNS_FAILED, {
      intent: run.intent,
      error_category: error.category || 'unknown'
    });

    this.collector.recordHistogram(EXECUTION_METRICS.RUN_DURATION, durationMs, {
      intent: run.intent,
      status: 'failed'
    });

    this.collector.incrementCounter(EXECUTION_METRICS.ERRORS_BY_CATEGORY, {
      category: error.category || 'unknown',
      intent: run.intent
    });

    this.collector.recordGauge(EXECUTION_METRICS.ACTIVE_RUNS, 0, {
      run_id: run.runId
    });

    this.collector.recordEvent('run_failed', {
      runId: run.runId,
      error: error.message,
      category: error.category,
      durationMs
    });
  }

  // Step lifecycle
  onStepTransition(step, fromStatus, toStatus) {
    this.collector.incrementCounter(EXECUTION_METRICS.STEP_TRANSITIONS, {
      step_kind: step.kind,
      from_status: fromStatus,
      to_status: toStatus
    });

    if (toStatus === 'running') {
      this.collector.incrementCounter(EXECUTION_METRICS.STEPS_STARTED, {
        step_kind: step.kind
      });
    } else if (toStatus === 'completed') {
      this.collector.incrementCounter(EXECUTION_METRICS.STEPS_COMPLETED, {
        step_kind: step.kind
      });
    } else if (toStatus === 'failed') {
      this.collector.incrementCounter(EXECUTION_METRICS.STEPS_FAILED, {
        step_kind: step.kind
      });
    }
  }

  onStepCompleted(step, durationMs) {
    this.collector.recordHistogram(EXECUTION_METRICS.STEP_DURATION, durationMs, {
      step_kind: step.kind,
      status: 'completed'
    });
  }

  // Action lifecycle
  onActionStarted(actionType, executionId) {
    this.collector.incrementCounter(EXECUTION_METRICS.ACTIONS_STARTED, {
      action_type: actionType
    });

    this.collector.startSpan('action_execution', {
      attributes: {
        action_type: actionType,
        execution_id: executionId
      }
    });
  }

  onActionCompleted(actionType, result, durationMs) {
    this.collector.incrementCounter(EXECUTION_METRICS.ACTIONS_COMPLETED, {
      action_type: actionType,
      status: result.status
    });

    this.collector.recordHistogram(EXECUTION_METRICS.ACTION_DURATION, durationMs, {
      action_type: actionType,
      status: result.status
    });

    if (result.metadata?.attemptCount > 1) {
      this.collector.incrementCounter(EXECUTION_METRICS.ACTION_RETRIES, {
        action_type: actionType,
        attempt_count: result.metadata.attemptCount
      });
    }
  }

  onActionFailed(actionType, error, durationMs) {
    this.collector.incrementCounter(EXECUTION_METRICS.ACTIONS_FAILED, {
      action_type: actionType,
      error_category: error.category || 'unknown'
    });

    this.collector.incrementCounter(EXECUTION_METRICS.ERRORS_BY_ACTION, {
      action_type: actionType,
      category: error.category || 'unknown'
    });

    this.collector.recordHistogram(EXECUTION_METRICS.ACTION_DURATION, durationMs, {
      action_type: actionType,
      status: 'failed'
    });
  }

  // Approval lifecycle
  onApprovalRequested(actionType, runId) {
    this.collector.incrementCounter(EXECUTION_METRICS.APPROVALS_REQUESTED, {
      action_type: actionType
    });

    this.collector.recordEvent('approval_requested', {
      actionType,
      runId,
      requestedAt: new Date().toISOString()
    });
  }

  onApprovalGranted(actionType, runId, waitTimeMs) {
    this.collector.incrementCounter(EXECUTION_METRICS.APPROVALS_GRANTED, {
      action_type: actionType
    });

    this.collector.recordHistogram(EXECUTION_METRICS.APPROVAL_WAIT_TIME, waitTimeMs, {
      action_type: actionType
    });
  }

  onApprovalDenied(actionType, runId) {
    this.collector.incrementCounter(EXECUTION_METRICS.APPROVALS_DENIED, {
      action_type: actionType
    });
  }

  // Idempotency
  onIdempotentHit(actionType) {
    this.collector.incrementCounter(EXECUTION_METRICS.IDEMPOTENT_HITS, {
      action_type: actionType
    });
  }

  onIdempotentMiss(actionType) {
    this.collector.incrementCounter(EXECUTION_METRICS.IDEMPOTENT_MISSES, {
      action_type: actionType
    });
  }

  // Database operations
  onDbQuery(durationMs, operation, table) {
    this.collector.recordHistogram(EXECUTION_METRICS.DB_QUERY_DURATION, durationMs, {
      operation,
      table
    });
  }

  onDbError(operation, error) {
    this.collector.incrementCounter(EXECUTION_METRICS.DB_ERRORS, {
      operation,
      error_type: error.name || 'unknown'
    });
  }

  // Integration calls
  onIntegrationCall(integration, operation, durationMs) {
    this.collector.incrementCounter(EXECUTION_METRICS.INTEGRATION_CALLS, {
      integration,
      operation
    });

    this.collector.recordHistogram(EXECUTION_METRICS.INTEGRATION_LATENCY, durationMs, {
      integration,
      operation
    });
  }

  onIntegrationError(integration, operation, error) {
    this.collector.incrementCounter(EXECUTION_METRICS.INTEGRATION_ERRORS, {
      integration,
      operation,
      error_category: categorizeError(error)
    });
  }
}

// ============================================================================
// HEALTH CHECKS
// ============================================================================

export class HealthChecker {
  constructor(telemetry) {
    this.telemetry = telemetry;
    this.checks = new Map();
  }

  registerCheck(name, checkFn) {
    this.checks.set(name, checkFn);
  }

  async runChecks() {
    const results = {};
    let overall = 'healthy';

    for (const [name, checkFn] of this.checks) {
      try {
        const result = await checkFn();
        results[name] = { status: 'healthy', ...result };
      } catch (err) {
        results[name] = { status: 'unhealthy', error: err.message };
        overall = 'unhealthy';
      }
    }

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      checks: results
    };
  }
}

// ============================================================================
// ALERTING
// ============================================================================

export class AlertManager {
  constructor(options = {}) {
    this.thresholds = options.thresholds || {
      errorRate: 0.1,      // 10% error rate
      latencyP95: 5000,    // 5 seconds
      activeRuns: 100      // 100 concurrent runs
    };
    this.alerts = [];
  }

  checkThresholds(metrics) {
    const alerts = [];

    // Check error rate
    const totalActions = metrics[EXECUTION_METRICS.ACTIONS_COMPLETED] || 0;
    const failedActions = metrics[EXECUTION_METRICS.ACTIONS_FAILED] || 0;
    const errorRate = totalActions > 0 ? failedActions / totalActions : 0;

    if (errorRate > this.thresholds.errorRate) {
      alerts.push({
        severity: 'warning',
        type: 'high_error_rate',
        message: `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.errorRate * 100).toFixed(1)}%`,
        value: errorRate
      });
    }

    // Check latency (using histogram)
    const latencyMetric = metrics[EXECUTION_METRICS.ACTION_DURATION];
    if (latencyMetric && latencyMetric.max > this.thresholds.latencyP95) {
      alerts.push({
        severity: 'warning',
        type: 'high_latency',
        message: `Max latency ${latencyMetric.max}ms exceeds threshold ${this.thresholds.latencyP95}ms`,
        value: latencyMetric.max
      });
    }

    return alerts;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const telemetryCollector = new TelemetryCollector({
  enabled: process.env.TELEMETRY_ENABLED !== 'false',
  samplingRate: parseFloat(process.env.TELEMETRY_SAMPLING_RATE || '1.0'),
  flushInterval: parseInt(process.env.TELEMETRY_FLUSH_INTERVAL || '30000')
});

export const executionTelemetry = new ExecutionTelemetry(telemetryCollector);

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  METRIC_TYPES,
  EXECUTION_METRICS,
  TelemetryCollector,
  ExecutionTelemetry,
  HealthChecker,
  AlertManager,
  telemetryCollector,
  executionTelemetry
};
