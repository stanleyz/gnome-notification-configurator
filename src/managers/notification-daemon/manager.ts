import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib";
import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { NotificationDaemon } from "resource:///org/gnome/shell/ui/notificationDaemon.js";

import type { SettingsManager } from "../../utils/settings.js";

type NotificationMetadata = {
  appName: string;
  title: string;
  body: string;
};

type NotificationDaemonProto = {
  NotifyAsync: (
    params: unknown[],
    invocation: Gio.DBusMethodInvocation,
  ) => Promise<void>;
  CloseNotificationAsync: (
    params: unknown[],
    invocation: Gio.DBusMethodInvocation,
  ) => Promise<void>;
  CloseNotification?: (id: number) => void;
  _proxy: {
    NotifyAsync: (...args: unknown[]) => Promise<[number]>;
    CloseNotificationAsync: (...args: unknown[]) => Promise<void>;
  };
  _activeNotifications: Map<number, string>;
  _checkNotificationId: (invocation: Gio.DBusMethodInvocation, id: number) => boolean;
  _getSenderPid: (sender: string) => Promise<number>;
  _handleError: (invocation: Gio.DBusMethodInvocation, error: unknown) => void;
};

type FdoNotificationDaemonLike = {
  CloseNotification?: (id: number) => void;
};

type NotificationDaemonInstanceLike = {
  _fdoNotificationDaemon?: FdoNotificationDaemonLike;
};

type DbusReturnValue = Parameters<Gio.DBusMethodInvocation["return_value"]>[0];

const MAX_TRACKED_NOTIFICATIONS = 2000;

export class NotificationDaemonManager {
  private injectionManager = new InjectionManager();
  private notificationMetadata = new Map<number, NotificationMetadata>();

  constructor(private settingsManager: SettingsManager) {
    this.enable();
  }

  enable() {
    this.patchNotify();
    this.patchCloseNotification();
  }

  disable() {
    this.injectionManager.clear();
  }

  dispose() {
    this.disable();
    this.notificationMetadata.clear();
  }

  private shouldIgnoreDismissal(id: number) {
    const metadata = this.notificationMetadata.get(id);
    return metadata
      ? this.settingsManager.shouldIgnoreAppRequestedDismissalsFor(
          metadata.appName,
          metadata.title,
          metadata.body,
        )
      : this.settingsManager.shouldIgnoreAppRequestedDismissalsFor();
  }

  private patchNotify() {
    const manager = this;
    const proto = NotificationDaemon.prototype as unknown as NotificationDaemonProto;

    this.injectionManager.overrideMethod(proto, "NotifyAsync", () =>
      async function (
        this: NotificationDaemonProto,
        params: unknown[],
        invocation: Gio.DBusMethodInvocation,
      ) {
        const sender = invocation.get_sender();
        const pid = await this._getSenderPid(sender);
        const replaceId = typeof params?.[1] === "number" ? params[1] : 0;
        const hints =
          typeof params?.[6] === "object" && params[6] !== null
            ? (params[6] as Record<string, unknown>)
            : {};

        if (!this._checkNotificationId(invocation, replaceId)) {
          return;
        }

        params[6] = {
          ...hints,
          "x-shell-sender-pid": new GLib.Variant("u", pid),
          "x-shell-sender": new GLib.Variant("s", sender),
        };

        try {
          const [id] = await this._proxy.NotifyAsync(...params);
          this._activeNotifications.set(id, sender);
          const response = new GLib.Variant("(u)", [id]) as unknown as DbusReturnValue;
          invocation.return_value(response);

          const appName = typeof params?.[0] === "string" ? params[0] : "";
          const title = typeof params?.[3] === "string" ? params[3] : "";
          const body = typeof params?.[4] === "string" ? params[4] : "";

          manager.notificationMetadata.set(id, { appName, title, body });
          if (replaceId > 0 && replaceId !== id) {
            manager.notificationMetadata.delete(replaceId);
          }
          if (manager.notificationMetadata.size > MAX_TRACKED_NOTIFICATIONS) {
            const oldest = manager.notificationMetadata.keys().next().value;
            if (typeof oldest === "number") {
              manager.notificationMetadata.delete(oldest);
            }
          }
        } catch (error) {
          this._handleError(invocation, error);
        }
      },
    );
  }

  private patchCloseNotification() {
    const manager = this;
    const proto = NotificationDaemon.prototype as unknown as NotificationDaemonProto;

    if (typeof proto.CloseNotificationAsync === "function") {
      this.injectionManager.overrideMethod(
        proto,
        "CloseNotificationAsync",
        () =>
          async function (
            this: NotificationDaemonProto,
            params: unknown[],
            invocation: Gio.DBusMethodInvocation,
          ) {
            const id = typeof params?.[0] === "number" ? params[0] : 0;
            if (!this._checkNotificationId(invocation, id)) {
              return;
            }

            if (manager.shouldIgnoreDismissal(id)) {
              invocation.return_value(null);
              return;
            }

            try {
              await this._proxy.CloseNotificationAsync(...params);
              invocation.return_value(null);
              manager.notificationMetadata.delete(id);
            } catch (error) {
              this._handleError(invocation, error);
            }
          },
      );
    }

    if (typeof proto.CloseNotification === "function") {
      this.injectionManager.overrideMethod(
        proto,
        "CloseNotification",
        (original) => {
          if (!original) {
            return function (this: NotificationDaemonProto, id: number) {
              const notificationId = typeof id === "number" ? id : 0;
              if (manager.shouldIgnoreDismissal(notificationId)) {
                return;
              }
            };
          }

          return function (this: NotificationDaemonProto, id: number) {
            const notificationId = typeof id === "number" ? id : 0;
            if (manager.shouldIgnoreDismissal(notificationId)) {
              return;
            }
            const result = original.call(this, notificationId);
            manager.notificationMetadata.delete(notificationId);
            return result;
          };
        },
      );
    }

    const notificationDaemonInstance = (Main as unknown as {
      notificationDaemon?: NotificationDaemonInstanceLike;
    }).notificationDaemon;

    const fdoNotificationDaemon =
      notificationDaemonInstance?._fdoNotificationDaemon;

    if (typeof fdoNotificationDaemon?.CloseNotification === "function") {
      this.injectionManager.overrideMethod(
        fdoNotificationDaemon,
        "CloseNotification",
        (original) => {
          if (!original) {
            return function (this: FdoNotificationDaemonLike, id: number) {
              const notificationId = typeof id === "number" ? id : 0;
              if (manager.shouldIgnoreDismissal(notificationId)) {
                return;
              }
            };
          }

          return function (this: FdoNotificationDaemonLike, id: number) {
            const notificationId = typeof id === "number" ? id : 0;
            if (manager.shouldIgnoreDismissal(notificationId)) {
              return;
            }
            const result = original.call(this, notificationId);
            manager.notificationMetadata.delete(notificationId);
            return result;
          };
        },
      );
    }
  }
}
