export interface IMetricCollection {
  getMetrics(): Promise<string>
}
