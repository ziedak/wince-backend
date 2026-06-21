import {
  SummaryCard,
  SummaryCardProps,
} from '../../../components/custom/summary';

export type KPICardsProps = { summaries: SummaryCardProps[] };
export const KPICards: React.FC<KPICardsProps> = ({ summaries }) => {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
      {summaries.map((summary, index) => (
        <SummaryCard key={index} {...summary} />
      ))}
    </div>
  );
};
