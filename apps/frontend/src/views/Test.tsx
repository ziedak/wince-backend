"use client";

import { useState } from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarMenuBadge,
  SidebarMenuAction,
  SidebarRail,
  SidebarSeparator,
  SidebarInput,
} from "@/components/ui/sidebar"; 
import {
  Home,
  Inbox,
  Calendar,
  Users,
  Settings,
  LogOut,
  User,
  Plus,
  ChevronRight,
  Search,
  Bell,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"; // if you have it
import { useIsMobile } from "../components/ui/use-mobile";

export default function Test() {
  // Controlled state: sidebar open/close
  const [isOpen, setIsOpen] = useState(true);
const isMobile = useIsMobile();
console.log("isMobile:", isMobile);
  return (
    <SidebarProvider open={isOpen} onOpenChange={setIsOpen}>
      {/* ---------- SIDEBAR ---------- */}
      <Sidebar variant="floating" collapsible="icon" side="left" >
        {/* Header with search */}
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="font-bold text-sm">A</span>
            </div>
            <span className="font-semibold text-lg">Acme</span>
          </div>
          {/* <SidebarInput placeholder="Search..." icon={<Search className="size-4" />} /> */}
        </SidebarHeader>

        <SidebarContent>
          {/* Main navigation group */}
          <SidebarGroup>
            <SidebarGroupLabel>General</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Dashboard" isActive>
                    <Home />
                    <span>Dashboard</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>5</SidebarMenuBadge>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Inbox">
                    <Inbox />
                    <span>Inbox</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>12</SidebarMenuBadge>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Calendar">
                    <Calendar />
                    <span>Calendar</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          {/* Team group with submenu */}
          <SidebarGroup>
            <SidebarGroupLabel>Team</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Members">
                    <Users />
                    <span>Members</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction showOnHover>
                    <Plus />
                  </SidebarMenuAction>
                </SidebarMenuItem>

                {/* Submenu example */}
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <User />
                    <span>Profile</span>
                    <ChevronRight className="ml-auto" />
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>Settings</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>Notifications</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>Security</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings">
                    <Settings />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Footer with user avatar and logout */}
        <SidebarFooter>
          <SidebarSeparator />
          <div className="flex items-center gap-3 px-2 py-1">
            <Avatar className="size-8">
              <AvatarImage src="https://github.com/shadcn.png" alt="User" />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <div className="flex-1 truncate">
              <p className="text-sm font-medium">John Doe</p>
              <p className="text-xs text-muted-foreground">john@acme.com</p>
            </div>
            <SidebarMenuAction className="relative" showOnHover>
              <LogOut />
            </SidebarMenuAction>
          </div>
        </SidebarFooter>

        {/* Rail for quick collapse/expand */}
        <SidebarRail />
      </Sidebar>

      {/* ---------- MAIN CONTENT ---------- */}
      <SidebarInset>
        <header className="flex h-16 items-center gap-4 border-b px-6">
          <SidebarTrigger />
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <div className="ml-auto flex items-center gap-4">
            <Bell className="size-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {isOpen ? "Expanded" : "Collapsed"}
            </span>
          </div>
        </header>
        <main className="flex-1 p-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border p-4 shadow-sm">
              <h3 className="font-medium">Total Users</h3>
              <p className="text-2xl font-bold">1,234</p>
            </div>
            <div className="rounded-lg border p-4 shadow-sm">
              <h3 className="font-medium">Active Projects</h3>
              <p className="text-2xl font-bold">42</p>
            </div>
            <div className="rounded-lg border p-4 shadow-sm">
              <h3 className="font-medium">Pending Tasks</h3>
              <p className="text-2xl font-bold">7</p>
            </div>
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            Press <kbd className="rounded border px-1.5 py-0.5 text-xs font-mono">⌘B</kbd> to toggle the sidebar.
          </p>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}