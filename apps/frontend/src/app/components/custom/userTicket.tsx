import { FallbackAvatar } from '../ui/fallbackAvatar';

export const UserTicket: React.FC<{
  name: string;
  shortMsg: string;
  avatarUrl?: string;
}> = ({ name, shortMsg, avatarUrl }) => {
  return (
    <div className="flex items-center gap-2.5">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-7 h-7 rounded-full shrink-0"
        />
      ) : (
        <FallbackAvatar name={name} />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{shortMsg}</p>
      </div>
    </div>
  );
};
