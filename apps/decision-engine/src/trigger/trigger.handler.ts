import { createLogger } from '@org/logger'
import type { EnrichedEvent } from '@org/types'
import * as http from 'node:http'
import { DecisionOrchestrator, SessionFeaturesService } from '../services'

/**
 * HTTP handler for the fast-path trigger endpoint (POST /v1/trigger).
 *
 * The enrichment-session service sends trigger events directly here, bypassing
 * the second Kafka hop and achieving sub-100ms end-to-end latency. The response
 * is sent 202 immediately; the decision pipeline runs asynchronously so enrichment
 * latency is never coupled to the decision pipeline duration.
 *
 * Before invoking the orchestrator, the event is refreshed with the latest session
 * state from Redis (cart_value, is_frustrated) to ensure scoring reflects the most
 * recent activity rather than the snapshot captured when the trigger event fired.
 *
 * All events are still published to Kafka by enrichment-session for durability
 * and analytics — this endpoint is purely for low-latency delivery.
 */
export class TriggerHandler {
  private readonly logger = createLogger({ service: 'TriggerHandler' })

  constructor(
    private readonly orchestrator: DecisionOrchestrator,
    private readonly internalSecret: string,
    private readonly sessionFeatures?: SessionFeaturesService
  ) {}

  handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Authenticate before reading body to fail fast on invalid callers
    const authHeader = req.headers['x-internal-secret']
    if (authHeader !== this.internalSecret) {
      res.writeHead(401).end('unauthorized')
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      // Respond 202 before starting the pipeline — decouples enrichment latency
      res.writeHead(202).end()
      void this.process(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      this.logger.warn({ err }, 'TriggerHandler: request read error')
    })
  }

  private async process(body: string): Promise<void> {
    let event: EnrichedEvent
    try {
      event = JSON.parse(body) as EnrichedEvent
    } catch {
      this.logger.warn(
        { preview: body.slice(0, 200) },
        'TriggerHandler: invalid JSON in request body'
      )
      return
    }

    // Freshen mutable session state from Redis so the risk scorer uses the latest
    // cart value and frustration signal, not the snapshot in the trigger event payload.
    if (this.sessionFeatures) {
      try {
        const ctx = await this.sessionFeatures.getSessionContext(event.sid)
        if (ctx) {
          event = {
            ...event,
            cart_value: ctx.cartValue,
            is_frustrated: ctx.isFrustrated,
            rage_click_count: ctx.rageClickCount,
            session_available: ctx.sessionAvailable,
          }
        }
      } catch (err) {
        this.logger.warn(
          { err, sid: event.sid },
          'TriggerHandler: Redis session freshen failed, using event payload'
        )
      }
    }

    await this.orchestrator.decide(event)
  }
}
