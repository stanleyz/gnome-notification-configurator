import type { Notification } from "resource:///org/gnome/shell/ui/messageTray.js";

declare module "resource:///org/gnome/shell/extensions/extension.js" {
  export * from "@girs/gnome-shell/extensions/extension";

  type CreateOverrideFunc<T> = (originalMethod: T) => T;

  export class InjectionManager {
    overrideMethod<P extends object, K extends string & keyof P>(
      prototype: P,
      methodName: K,
      createOverrideFunc: CreateOverrideFunc<P[K]>,
    ): void;
    restoreMethod<P extends object>(
      prototype: P,
      methodName: string & keyof P,
    ): void;
    clear(): void;
  }
}

declare module "resource:///org/gnome/shell/ui/notificationDaemon.js" {
  export * from "@girs/gnome-shell/ui/notificationDaemon";

  export class FdoNotificationDaemonSource {
    processNotification(
      notification: Notification,
      appName: string,
      appIcon: string,
    ): void;
  }

  export class GtkNotificationDaemonAppSource {
    addNotification(notification: Notification): void;
  }
}

declare module "resource:///org/gnome/shell/ui/messageList.js" {
  export * from "@girs/gnome-shell/ui/messageList";
  import type St from "gi://St";
  import type { Notification } from "resource:///org/gnome/shell/ui/messageTray.js";

  export class NotificationMessage extends St.Button {
    constructor(notification: Notification);
    can_focus: boolean;
    add_style_class_name(name: string): void;
    destroy(): void;
  }
}

declare module "resource:///org/gnome/shell/ui/messageTray.js" {
  export * from "@girs/gnome-shell/ui/messageTray";
  import type { Urgency } from "@girs/gnome-shell/ui/messageTray";

  export type MessageTrayProto = {
    _onNotificationRequestBanner: (
      source: Source,
      notification: Notification,
    ) => void;
    _updateNotificationTimeout: (timeout: number) => void;
    _updateState: () => void;
    _showNotification: () => void;
    _updateShowingNotification: () => void;
    _hideNotification: (animate: boolean) => void;
    _showNotificationCompleted: () => void;
    _hideNotificationCompleted: () => void;
    _resetNotificationLeftTimeout: () => void;
    _notificationFocusGrabber: { ungrabFocus: () => void };
    _userActiveWhileNotificationShown?: boolean;
    _banner: import("@girs/gnome-shell/ui/messageList").NotificationMessage | null;
    _bannerBin: import("gi://St").default.Widget & {
      ease: (params: Record<string, unknown>) => void;
    };
    _notification: Notification | null;
    _notificationState: number;
    hide: () => void;
    show: () => void;
  };

  export type NotificationProto = {
    setUrgency: (urgency: Urgency) => void;
  };
}
