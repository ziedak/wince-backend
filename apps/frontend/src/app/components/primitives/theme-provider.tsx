// components/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import { Theme } from "@radix-ui/themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    // Set attribute="class" so next-themes adds the .dark class to the <html> tag
    <NextThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {/* 
        Leave 'appearance' off of the Radix <Theme>. 
        Radix will naturally watch the <html> class injected by next-themes!
      */}
      <Theme accentColor="indigo">
        {children}
      </Theme>
    </NextThemeProvider>
  );
}