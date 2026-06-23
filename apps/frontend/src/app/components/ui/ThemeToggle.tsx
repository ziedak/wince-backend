'use client';

import { useTheme } from 'next-themes';
import { Button } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration UI mismatch errors
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Button variant="outline" className="opacity-0" />;

  return (
    <Button
      variant="outline"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {resolvedTheme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
    </Button>
  );
}
