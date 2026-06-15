// Request tracing
export class RequestTracer {
  private static traces: Map<string, any> = new Map();

  static startTrace(traceId: string, operation: string) {
    const trace = {
      traceId,
      operation,
      startTime: Date.now(),
      spans: [],
    };

    RequestTracer.traces.set(traceId, trace);
    return trace;
  }

  static addSpan(traceId: string, spanName: string, metadata?: any) {
    const trace = RequestTracer.traces.get(traceId);
    if (trace) {
      trace.spans.push({
        name: spanName,
        timestamp: Date.now(),
        metadata,
      });
    }
  }

  static finishTrace(traceId: string) {
    const trace = RequestTracer.traces.get(traceId);
    if (trace) {
      trace.endTime = Date.now();
      trace.duration = trace.endTime - trace.startTime;

      // In production, send to distributed tracing system
      console.log("Trace completed:", JSON.stringify(trace, null, 2));

      RequestTracer.traces.delete(traceId);
      return trace;
    }
  }
}
