import {
  SimpleSummaryCard,
  SimpleSummaryCardProps,
} from '../../../components/custom/simpleSummary';

export type MetricCardsProps = { summaries: SimpleSummaryCardProps[] };
export const MetricCards: React.FC<MetricCardsProps> = ({ summaries }) => {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
      {summaries.map((summary, index) => (
        <SimpleSummaryCard key={index} {...summary} />
      ))}
    </div>
  );
};
