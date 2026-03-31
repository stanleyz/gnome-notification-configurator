import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageList from "resource:///org/gnome/shell/ui/messageList.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

import { FullscreenAdapter } from "../managers/message-tray/fullscreen.js";
import { IdleAdapter } from "../managers/message-tray/idle.js";
import { MessageTrayManager } from "../managers/message-tray/manager.js";
import { TimeoutAdapter } from "../managers/message-tray/timeout.js";

import { UrgencyAdapter } from "../managers/source/urgency.js";

import { SourceManager } from "../managers/source/manager.js";
import { ProcessingAdapter } from "../managers/source/processing.js";

import type { NotificationTheme } from "../utils/constants.js";
import { DEFAULT_THEME } from "../utils/constants.js";
import type {
  Position,
  SettingsManager,
  VerticalPosition,
} from "../utils/settings.js";
import {
  getBannerBin,
  getMessageTrayContainer,
  hideBannerAppTitleRow,
  resolveNotificationWidgets,
  resolveNotificationWidgetsFromBanner,
  type NotificationWidgets,
} from "./notification-widgets.js";

const ANIMATION_TIME = 200;

export class NotificationsManager {
  private settingsManager: SettingsManager;
  private messageTrayManager: MessageTrayManager;
  private sourceManager: SourceManager;

  private fullscreenAdapter: FullscreenAdapter;
  private idleAdapter: IdleAdapter;
  private timeoutAdapter: TimeoutAdapter;
  private urgencyAdapter: UrgencyAdapter;
  private processingAdapter: ProcessingAdapter;

  constructor(settingsManager: SettingsManager) {
    this.messageTrayManager = new MessageTrayManager(settingsManager);
    this.sourceManager = new SourceManager(settingsManager);
    this.settingsManager = settingsManager;

    this.fullscreenAdapter = new FullscreenAdapter(settingsManager);
    this.idleAdapter = new IdleAdapter(settingsManager);
    this.timeoutAdapter = new TimeoutAdapter(settingsManager);
    this.urgencyAdapter = new UrgencyAdapter(settingsManager);
    this.processingAdapter = new ProcessingAdapter(settingsManager);

    this.fullscreenAdapter.register(this.messageTrayManager);
    this.idleAdapter.register(this.messageTrayManager);
    this.timeoutAdapter.register(this.messageTrayManager);
    this.urgencyAdapter.register(this.sourceManager);
    this.processingAdapter.register(this.sourceManager);

    this.setupPositioning(settingsManager);

    this.enable();
  }

  private positionSignalId?: number;
  private injectionManager = new InjectionManager();
  private stackedNotifications?: St.BoxLayout;
  private stackedNotificationMap = new WeakMap<
    MessageTray.Notification,
    MessageList.NotificationMessage
  >();

  private static readonly HORIZONTAL_ALIGNMENT_MAP: Record<
    Position,
    Clutter.ActorAlign
  > = {
    fill: Clutter.ActorAlign.FILL,
    left: Clutter.ActorAlign.START,
    right: Clutter.ActorAlign.END,
    center: Clutter.ActorAlign.CENTER,
  };

  private static readonly VERTICAL_ALIGNMENT_MAP: Record<
    VerticalPosition,
    Clutter.ActorAlign
  > = {
    fill: Clutter.ActorAlign.FILL,
    top: Clutter.ActorAlign.START,
    bottom: Clutter.ActorAlign.END,
    center: Clutter.ActorAlign.CENTER,
  };

  private isVerticalAlignTop() {
    return (
      getBannerBin()?.get_y_align() === Clutter.ActorAlign.START ||
      getBannerBin()?.get_y_align() === Clutter.ActorAlign.FILL
    );
  }

  private shouldStackNotifications() {
    return (
      this.settingsManager.timeoutOverrideEnabled &&
      this.settingsManager.notificationTimeout === 0
    );
  }

  private getStackedNotificationsContainer() {
    if (!this.stackedNotifications) {
      this.stackedNotifications = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_expand: true,
      });
    }

    return this.stackedNotifications;
  }

  private ensureStackContainerAttached(bannerBin: St.Widget) {
    const stackedNotifications = this.getStackedNotificationsContainer();
    const children = bannerBin.get_children();
    if (children.length === 1 && children[0] === stackedNotifications) {
      return;
    }

    for (const child of children) {
      bannerBin.remove_child(child);
    }

    bannerBin.add_child(stackedNotifications);
  }

  private detachStackContainer(bannerBin: St.Widget) {
    const children = bannerBin.get_children();
    for (const child of children) {
      bannerBin.remove_child(child);
    }
  }

  private makeColorStyle(
    [red, green, blue, alpha]: NotificationTheme["appNameColor"],
    kind: "color" | "background" = "color",
  ): string {
    const redComponent = Math.round(red * 255);
    const greenComponent = Math.round(green * 255);
    const blueComponent = Math.round(blue * 255);
    const hex = `#${redComponent.toString(16).padStart(2, "0")}${greenComponent.toString(16).padStart(2, "0")}${blueComponent.toString(16).padStart(2, "0")}`;
    const value =
      alpha < 1
        ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`
        : hex;
    return `${kind}: ${value};`;
  }

  private makeFontSizeStyle(fontSize: number): string {
    return `font-size: ${fontSize}px;`;
  }

  private makeStyle(
    color: NotificationTheme["appNameColor"],
    fontSize: number,
    kind: "color" | "background" = "color",
  ): string {
    if (kind === "background") {
      return this.makeColorStyle(color, kind);
    }

    const colorStyle = this.makeColorStyle(color, kind);
    const fontSizeStyle = this.makeFontSizeStyle(fontSize);
    return `${colorStyle} ${fontSizeStyle}`;
  }

  private applyTheme(widgets: NotificationWidgets) {
    if (!this.settingsManager.colorsEnabled) {
      return;
    }

    const theme = this.settingsManager.getThemeFor(
      widgets.sourceName,
      widgets.titleText,
      widgets.bodyText,
    );
    if (!theme) {
      return;
    }

    widgets.source?.set_style(
      this.makeStyle(
        theme.appNameColor,
        theme.appNameFontSize ?? DEFAULT_THEME.appNameFontSize,
      ),
    );
    widgets.time?.set_style(
      this.makeStyle(
        theme.timeColor,
        theme.timeFontSize ?? DEFAULT_THEME.timeFontSize,
      ),
    );
    widgets.title?.set_style(
      this.makeStyle(
        theme.titleColor,
        theme.titleFontSize ?? DEFAULT_THEME.titleFontSize,
      ),
    );
    widgets.body?.set_style(
      this.makeStyle(
        theme.bodyColor,
        theme.bodyFontSize ?? DEFAULT_THEME.bodyFontSize,
      ),
    );

    const existingStyle = widgets.container.get_style() ?? "";
    widgets.container.set_style(
      `${existingStyle} ${this.makeColorStyle(theme.backgroundColor, "background")}`,
    );
  }

  private applyNotificationCustomizations(
    widgets: NotificationWidgets,
    bannerBin: St.Widget | null,
  ) {
    const { sourceName, titleText, bodyText } = widgets;

    const position = this.settingsManager.getPositionFor(
      sourceName,
      titleText,
      bodyText,
    );
    Main.messageTray.bannerAlignment =
      NotificationsManager.HORIZONTAL_ALIGNMENT_MAP[position];

    const verticalPosition = this.settingsManager.getVerticalPositionFor(
      sourceName,
      titleText,
      bodyText,
    );
    bannerBin?.set_y_align(
      NotificationsManager.VERTICAL_ALIGNMENT_MAP[verticalPosition],
    );

    const margins = this.settingsManager.getMarginsFor(
      sourceName,
      titleText,
      bodyText,
    );
    if (margins) {
      widgets.container.set_style(
        `margin-top: ${margins.top}px; margin-bottom: ${margins.bottom}px; margin-left: ${margins.left}px; margin-right: ${margins.right}px;`,
      );
    }

    if (this.settingsManager.shouldHideAppTitleRowFor(sourceName, titleText, bodyText)) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        hideBannerAppTitleRow();
        return GLib.SOURCE_REMOVE;
      });
    }

    this.applyTheme(widgets);
  }


  private patchAnimations() {
    const proto = MessageTray.MessageTray
      .prototype as unknown as MessageTray.MessageTrayProto;

    const self = this;

    this.injectionManager.overrideMethod(
      proto,
      "_showNotification",
      (original) =>
        function (this: MessageTray.MessageTrayProto) {
          original.call(this);
          if (!self.isVerticalAlignTop()) {
            this._bannerBin.y = 0;
          }
        },
    );

    this.injectionManager.overrideMethod(
      proto,
      "_onNotificationRequestBanner",
      (original) =>
        function (
          this: MessageTray.MessageTrayProto,
          source,
          notification,
        ) {
          if (!self.shouldStackNotifications()) {
            return original.call(this, source, notification);
          }

          if (notification.acknowledged) {
            return;
          }

          if (notification.urgency === MessageTray.Urgency.LOW) {
            return;
          }

          const notificationSource = notification.source;
          if (!notificationSource) {
            return;
          }

          if (
            !notificationSource.policy.showBanners &&
            notification.urgency !== MessageTray.Urgency.CRITICAL
          ) {
            return;
          }

          const existingBanner = self.stackedNotificationMap.get(notification);
          if (existingBanner) {
            return;
          }

          const bannerBin = getBannerBin();
          if (!bannerBin) {
            return;
          }

          const banner = new MessageList.NotificationMessage(notification);
          banner.can_focus = false;
          banner.add_style_class_name("notification-banner");

          self.ensureStackContainerAttached(bannerBin);

          const stackedNotifications =
            self.getStackedNotificationsContainer();
          stackedNotifications.insert_child_at_index(banner, 0);

          const widgets = resolveNotificationWidgetsFromBanner(banner);
          if (widgets) {
            self.applyNotificationCustomizations(widgets, bannerBin);
          }

          self.stackedNotificationMap.set(notification, banner);

          notification.connect("destroy", () => {
            self.stackedNotificationMap.delete(notification);
            banner.destroy();

            if (stackedNotifications.get_n_children() === 0) {
              self.detachStackContainer(bannerBin);
              this._banner = null;
              this._notification = null;
              this.hide();
            }
          });

          this._notification = notification;
          this._banner = banner;
          this._notificationState = MessageTray.State.SHOWN;
          notification.acknowledged = true;
          notification.playSound();
          this.show();
        },
    );

    this.injectionManager.overrideMethod(
      proto,
      "_updateShowingNotification",
      (original) =>
        function (this: MessageTray.MessageTrayProto) {
          if (self.isVerticalAlignTop()) {
            original.call(this);
            return;
          }

          this._notificationState = MessageTray.State.SHOWING;
          this._bannerBin.remove_all_transitions();
          this._bannerBin.set_pivot_point(0.5, 0.5);
          this._bannerBin.scale_x = 0.9;
          this._bannerBin.scale_y = 0.9;
          this._bannerBin.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
              this._notificationState = MessageTray.State.SHOWN;
              this._showNotificationCompleted();
              this._updateState();
            },
          });
        },
    );

    this.injectionManager.overrideMethod(
      proto,
      "_hideNotification",
      (original) =>
        function (this: MessageTray.MessageTrayProto, animate) {
          if (self.shouldStackNotifications()) {
            return;
          }

          if (self.isVerticalAlignTop()) {
            original.call(this, animate);
            return;
          }

          this._notificationFocusGrabber.ungrabFocus();
          this._banner?.disconnectObject(this);
          this._resetNotificationLeftTimeout();
          this._bannerBin.remove_all_transitions();

          const duration = animate ? ANIMATION_TIME : 0;
          this._notificationState = MessageTray.State.HIDING;
          this._bannerBin.ease({
            opacity: 0,
            scale_x: 0.9,
            scale_y: 0.9,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
              this._notificationState = MessageTray.State.HIDDEN;
              this._hideNotificationCompleted();
              this._updateState();
            },
          });
        },
    );
  }

  private setupPositioning(settingsManager: SettingsManager) {
    const bannerBin = getBannerBin();

    Main.messageTray.bannerAlignment =
      NotificationsManager.HORIZONTAL_ALIGNMENT_MAP[
        settingsManager.notificationPosition
      ];
    bannerBin?.set_y_align(
      NotificationsManager.VERTICAL_ALIGNMENT_MAP[
        settingsManager.verticalPosition
      ],
    );

    settingsManager.events.on("notificationPositionChanged", (position) => {
      Main.messageTray.bannerAlignment =
        NotificationsManager.HORIZONTAL_ALIGNMENT_MAP[position];
    });

    settingsManager.events.on("verticalPositionChanged", (verticalPosition) => {
      bannerBin?.set_y_align(
        NotificationsManager.VERTICAL_ALIGNMENT_MAP[verticalPosition],
      );
    });

    this.patchAnimations();

    const messageTrayContainer = getMessageTrayContainer();
    this.positionSignalId = messageTrayContainer?.connect("child-added", () => {
      const widgets = resolveNotificationWidgets(messageTrayContainer);
      if (!widgets) return;

      this.applyNotificationCustomizations(widgets, bannerBin ?? null);
    });
  }

  private enable() {
    this.messageTrayManager.enable();
    this.sourceManager.enable();
  }

  private disable() {
    this.sourceManager.disable();
    this.messageTrayManager.disable();
  }

  dispose() {
    this.disable();
    this.injectionManager.clear();

    if (this.stackedNotifications) {
      for (const child of this.stackedNotifications.get_children()) {
        this.stackedNotifications.remove_child(child);
      }
      this.stackedNotifications = undefined;
    }

    if (typeof this.positionSignalId === "number") {
      getMessageTrayContainer()?.disconnect(this.positionSignalId);
      this.positionSignalId = undefined;
    }

    this.fullscreenAdapter.dispose();
    this.idleAdapter.dispose();
    this.timeoutAdapter.dispose();
    this.urgencyAdapter.dispose();
    this.processingAdapter.dispose();

    this.messageTrayManager.dispose();
    this.sourceManager.dispose();

    Main.messageTray.bannerAlignment = Clutter.ActorAlign.CENTER;
    getBannerBin()?.set_y_align(Clutter.ActorAlign.START);
  }
}
