import { ClickHouseClient } from '@org/clickhouse_client'
import {
  createConsumerClient,
  type KafkaEachBatchPayload,
} from '@org/kafka_client'

type AnalyticsRecord = Record<string, unknown>

interface AnalyticsConfig {
  kafkaBrokers: string[]
  kafkaClientId: string
  kafkaGroupId: string
  kafkaTopic: string
  clickhouseUrl: string
  clickhouseDatabase: string
  clickhouseUsername: string
  clickhousePassword: string
  clickhouseTable: string
  batchSize: number
}

interface BufferedMessage {
  row: AnalyticsRecord
  offset: string
  partition: number
  topic: string
}

function readConfig(): AnalyticsConfig {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'kafka:29092')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return {
    kafkaBrokers: brokers,
    kafkaClientId: process.env['KAFKA_CLIENT_ID'] ?? 'analytics-consumer',
    kafkaGroupId: process.env['KAFKA_GROUP_ID'] ?? 'analytics-consumer-group',
    kafkaTopic: process.env['KAFKA_TOPIC'] ?? 'enriched.events',
    clickhouseUrl: process.env['CLICKHOUSE_URL'] ?? 'http://clickhouse:8123',
    clickhouseDatabase: process.env['CLICKHOUSE_DATABASE'] ?? 'default',
    clickhouseUsername: process.env['CLICKHOUSE_USERNAME'] ?? 'default',
    clickhousePassword: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    clickhouseTable: process.env['CLICKHOUSE_TABLE'] ?? 'events',
    batchSize: Number.parseInt(process.env['BATCH_SIZE'] ?? '100', 10),
  }
}

function parseMessageValue(rawValue: Buffer | null): AnalyticsRecord | null {
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue.toString('utf8')) as AnalyticsRecord
  } catch {
    return null
  }
}

async function main() {
  const config = readConfig()
  const clickhouse = ClickHouseClient.create({
    url: config.clickhouseUrl,
    database: config.clickhouseDatabase,
    username: config.clickhouseUsername,
    password: config.clickhousePassword,
    requestTimeout: 30_000,
    maxOpenConnections: 10,
    compression: { response: true, request: false },
  })
  const consumer = createConsumerClient({
    brokers: config.kafkaBrokers,
    clientId: config.kafkaClientId,
    groupId: config.kafkaGroupId,
  })

  let shuttingDown = false
  const bufferedRows: BufferedMessage[] = []

  const flush = async (commitOffsetsIfNecessary: () => Promise<void>) => {
    if (bufferedRows.length === 0) {
      return
    }

    const rowsToWrite = bufferedRows.map(({ row }) => row)
    await clickhouse.insert(config.clickhouseTable, rowsToWrite)
    bufferedRows.length = 0
    await commitOffsetsIfNecessary()
  }

  const shutdown = async () => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    await consumer.shutdown().catch(() => undefined)
    await clickhouse.disconnect().catch(() => undefined)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  console.log(
    `analytics-consumer starting: topic=${config.kafkaTopic}, table=${config.clickhouseTable}`
  )

  await consumer.connect()
  await consumer.subscribe(config.kafkaTopic)

  try {
    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: async ({
        batch,
        resolveOffset,
        commitOffsetsIfNecessary,
        heartbeat,
        isRunning,
        isStale,
      }: KafkaEachBatchPayload) => {
        for (const message of batch.messages) {
          if (!isRunning() || isStale()) {
            break
          }

          const parsed = parseMessageValue(message.value)
          if (parsed === null) {
            console.warn(
              `Skipping invalid analytics message at ${batch.topic}[${batch.partition}] offset ${message.offset}`
            )
            resolveOffset(message.offset)
            continue
          }

          bufferedRows.push({
            row: parsed,
            offset: message.offset,
            partition: batch.partition,
            topic: batch.topic,
          })
          resolveOffset(message.offset)

          if (bufferedRows.length >= config.batchSize) {
            await flush(commitOffsetsIfNecessary)
          }

          await heartbeat()
        }

        await flush(commitOffsetsIfNecessary)
      },
    })
  } finally {
    await shutdown()
  }
}

void main().catch((error: unknown) => {
  console.error('analytics-consumer failed to start', error)
  process.exitCode = 1
})
