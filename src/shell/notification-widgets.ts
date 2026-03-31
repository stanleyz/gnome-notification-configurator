import type Clutter from "gi://Clutter";
import type St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

type NotificationMetadata = {
  sourceName: string;
  titleText: string;
  bodyText: string;
};

type NotificationContainer = St.Widget & {
  notificationConfiguratorMetadata?: NotificationMetadata;
};

export type NotificationWidgets = {
  container: St.Widget;
  sourceText: Clutter.Text | null;
  source: St.Widget | null;
  time: St.Widget | null;
  title: St.Widget | null;
  body: St.Widget | null;
  sourceName: string;
  titleText: string;
  bodyText: string;
};

export function getMessageTrayContainer() {
  return Main.messageTray.get_first_child();
}

export function getBannerBin() {
  return (Main.messageTray as unknown as { _bannerBin: St.Widget })._bannerBin;
}

export function getFirstBannerRow() {
  return (
    (getBannerBin()
      ?.get_first_child()
      ?.get_child_at_index(0)
      ?.get_child_at_index(0) as St.Widget | null) ?? null
  );
}

export function hideBannerAppTitleRow() {
  const appTitleRow = getFirstBannerRow();
  if (!appTitleRow) return false;

  for (const _ of [0, 1]) {
    const child = appTitleRow.get_child_at_index(0);
    child?.get_parent()?.remove_child(child);
  }

  appTitleRow.set_x_expand(false);
  appTitleRow.get_parent()?.remove_child(appTitleRow);

  const targetWrapper = getFirstBannerRow();

  targetWrapper?.set_style("margin-top: 2px !important");
  targetWrapper?.add_child(appTitleRow);

  return true;
}

function getNotificationMetadata(container: St.Widget) {
  return (container as NotificationContainer).notificationConfiguratorMetadata;
}

function setNotificationMetadata(
  container: St.Widget,
  metadata: NotificationMetadata,
) {
  (container as NotificationContainer).notificationConfiguratorMetadata =
    metadata;
}

function readText(actor: Clutter.Actor | null | undefined) {
  return (actor as Clutter.Text | null)?.text ?? "";
}

function findWidgetByStyleClass(
  root: St.Widget,
  className: string,
): St.Widget | null {
  if (root.has_style_class_name?.(className)) {
    return root;
  }

  const children = root.get_children?.() ?? [];
  for (const child of children) {
    const found = findWidgetByStyleClass(child as St.Widget, className);
    if (found) {
      return found;
    }
  }

  return null;
}

export function resolveNotificationWidgets(
  messageTrayContainer: Clutter.Actor | null | undefined,
): NotificationWidgets | null {
  const container = messageTrayContainer?.get_first_child() as St.Widget | null;
  if (!container) return null;

  const notification = container.get_first_child() as St.Widget | null;
  if (!notification) return null;
  return resolveNotificationWidgetsFrom(container, notification);
}

export function resolveNotificationWidgetsFromBanner(
  banner: St.Widget | null | undefined,
): NotificationWidgets | null {
  if (!banner) return null;
  return resolveNotificationWidgetsFrom(banner, banner);
}

function resolveNotificationWidgetsFrom(
  container: St.Widget,
  notification: St.Widget,
): NotificationWidgets | null {
  const header =
    notification.get_first_child() !== notification.get_last_child()
      ? (notification.get_first_child() as St.Widget | null)
      : null;
  const headerContent = header?.get_child_at_index(1) as St.BoxLayout | null;
  const source = headerContent?.get_child_at_index(0) as St.Widget | null;
  const sourceText = source?.get_first_child() as Clutter.Text | null;
  const time = headerContent?.get_child_at_index(1) as St.Widget | null;
  const content = notification.get_last_child() as St.Widget | null;
  const contentBody = content?.get_child_at_index(1) as St.BoxLayout | null;
  const title = contentBody?.get_child_at_index(0) as St.Widget | null;
  const body = contentBody?.get_child_at_index(1) as St.Widget | null;
  const metadata = getNotificationMetadata(container);

  const sourceByClass = findWidgetByStyleClass(
    notification,
    "message-source-title",
  );
  const timeByClass = findWidgetByStyleClass(notification, "event-time");
  const titleByClass = findWidgetByStyleClass(notification, "message-title");
  const bodyByClass = findWidgetByStyleClass(notification, "message-body");
  const sourceLabel = sourceByClass ?? source;
  const timeLabel = timeByClass ?? time;
  const titleLabel = titleByClass ?? title;
  const bodyLabel = bodyByClass ?? body;

  const sourceName =
    readText(sourceLabel?.get_first_child()) ||
    sourceText?.text ||
    metadata?.sourceName ||
    "";
  const titleText =
    readText(titleLabel?.get_first_child()) || metadata?.titleText || "";
  const bodyText =
    readText(bodyLabel?.get_first_child()) || metadata?.bodyText || "";

  setNotificationMetadata(container, {
    sourceName,
    titleText,
    bodyText,
  });

  return {
    container,
    sourceText,
    source: sourceLabel,
    time: timeLabel,
    title: titleLabel,
    body: bodyLabel,
    sourceName,
    titleText,
    bodyText,
  };
}
