import React, { createContext, useContext, useState, useCallback, useRef } from "react";

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: "order" | "system" | "alert";
}

const initialNotifications: Notification[] = [
  { id: "1", title: "New Order", message: "Order COD-1042 received from Amine Shop", time: "2 min ago", read: false, type: "order" },
  { id: "2", title: "Delivery Confirmed", message: "Order COD-1038 delivered successfully", time: "15 min ago", read: false, type: "order" },
  { id: "3", title: "Integration Error", message: "Sheet sync failed for Atlas Store", time: "1h ago", read: false, type: "alert" },
  { id: "4", title: "New User", message: "Sara M. joined as agent", time: "3h ago", read: false, type: "system" },
  { id: "5", title: "Stock Alert", message: "Argan Oil Set is running low", time: "5h ago", read: true, type: "alert" },
];

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addNotification: (n: Omit<Notification, "id" | "read">) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

// Simple notification sound using Web Audio API
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const addNotification = useCallback((n: Omit<Notification, "id" | "read">) => {
    const newNotif: Notification = { ...n, id: Date.now().toString(), read: false };
    setNotifications(prev => [newNotif, ...prev]);
    playNotificationSound();
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, addNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
