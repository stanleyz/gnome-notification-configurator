import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { migrateRegexSchema } from "./migrations/regex.js";
import { NotificationDaemonManager } from "./managers/notification-daemon/manager.js";
import { NotificationsManager } from "./shell/notifications.js";

import { SettingsManager } from "./utils/settings.js";
import { ThemesManager } from "./utils/themes.js";

export default class NotificationConfiguratorExtension extends Extension {
  private settingsManager?: SettingsManager;
  private notificationsManager?: NotificationsManager;
  private themesManager?: ThemesManager;
  private notificationDaemonManager?: NotificationDaemonManager;

  enable() {
    const settings = this.getSettings();

    migrateRegexSchema(settings);

    this.settingsManager = new SettingsManager(settings);
    this.notificationsManager = new NotificationsManager(this.settingsManager);
    this.themesManager = new ThemesManager(this.settingsManager);
    this.notificationDaemonManager = new NotificationDaemonManager(
      this.settingsManager,
    );
  }

  disable() {
    this.settingsManager?.dispose();
    this.notificationsManager?.dispose();
    this.themesManager?.dispose();
    this.notificationDaemonManager?.dispose();

    this.settingsManager = undefined;
    this.notificationsManager = undefined;
    this.themesManager = undefined;
    this.notificationDaemonManager = undefined;
  }
}
