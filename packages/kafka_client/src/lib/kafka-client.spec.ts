import { createProducerClient } from './kafka-client.js';

// KafkaJS is mocked to avoid requiring a live broker in unit tests.
vi.mock('kafkajs', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const sendBatch = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn().mockResolvedValue(undefined);
  function Kafka() {
    this.producer = function () {
      return { connect, send, sendBatch, disconnect };
    };
  }
  return { Kafka, CompressionTypes: { Snappy: 2 } };
});

describe('createProducerClient', () => {
  it('returns an object implementing ProducerClient', async () => {
    const client = createProducerClient({
      brokers: ['localhost:9092'],
      clientId: 'test-client',
    });
    expect(typeof client.send).toBe('function');
    expect(typeof client.sendBatch).toBe('function');
    expect(typeof client.isHealthy).toBe('function');
    expect(typeof client.shutdown).toBe('function');
  });

  it('sendBatch is a no-op for empty records', async () => {
    const client = createProducerClient({
      brokers: ['localhost:9092'],
      clientId: 'test-client',
    });
    await expect(client.sendBatch([])).resolves.toBeUndefined();
  });
});

