export const FallbackAvatar: React.FC<{ name: string; size?: number }> = ({
  name,
}) => {
  let initials = '**';
  const CleanedName = name.trim();
  if (CleanedName.length === 1) initials = `${CleanedName[0].toUpperCase()}*`;
  const nameParts = CleanedName.split(' ').filter((part) => part.length > 0);
  if (nameParts.length >= 2) {
    initials = `${nameParts[0][0].toUpperCase()}${nameParts[1][0].toUpperCase()}`;
  } else if (nameParts.length === 1) {
    initials = `${nameParts[0][0].toUpperCase()}*`;
  }
  const backgroundColor = stringToColorGradian(name);

  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
      style={{
        background: backgroundColor,
        color: '#fff',
      }}
    >
      {initials}
    </div>
  );
};

// Simple hash function to generate a color from a string
function stringToColorGradian(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const startColor = `hsl(${hash % 360}, 60%, 50%)`;
  const endColor = `hsl(${(hash + 60) % 360}, 60%, 50%)`;
  return `linear-gradient(135deg, ${startColor}, ${endColor})`;
}
