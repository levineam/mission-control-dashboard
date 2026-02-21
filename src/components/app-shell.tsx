'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { NavItems } from '@/components/nav-items';
import { ThemeToggle } from '@/components/theme-toggle';
import { Separator } from '@/components/ui/separator';

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Global 10-second auto-refresh (moved from dashboard.tsx)
  useEffect(() => {
    const interval = window.setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [router]);

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-bold">MC</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Mission Control</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <NavItems />
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between px-2">
            <ThemeToggle />
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 !h-4" />
          <h1 className="text-sm font-semibold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Mission Control
          </h1>
        </header>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
