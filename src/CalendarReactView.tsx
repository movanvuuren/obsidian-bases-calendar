import type {
  EventApi,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventMountArg,
  DateSelectArg,
  ViewMountArg,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { BasesEntry, BasesPropertyId, DateValue, getIconIds, setIcon, Value } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CalendarEntry } from "./calendar-view";
import { useApp } from "./hooks";

const ZOOM_LEVELS = ["01:00:00", "00:30:00", "00:15:00"] as const;

export interface CalendarHandle {
  updateSize(): void;
  unselect(): void;
}

interface CalendarReactViewProps {
  entries: CalendarEntry[];
  weekStartDay: number;
  initialView: string;
  initialSlotDuration: string;
  scrollToTime: string;
  detailProperty: BasesPropertyId | null;
  iconProperty: BasesPropertyId | null;
  involvementProperty: BasesPropertyId | null;
  properties: BasesPropertyId[];
  onViewChange: (view: string) => void;
  onZoomChange: (slotDuration: string) => void;
  onEntryClick: (entry: BasesEntry, isModEvent: boolean) => void;
  onEntryContextMenu: (evt: React.MouseEvent, entry: BasesEntry) => void;
  onEventDrop?: (
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
  ) => Promise<void>;
  editable: boolean;
  onCreateEntry?: (start: Date, end: Date, allDay: boolean) => void;
  calendarHandleRef?: React.RefObject<CalendarHandle | null>;
}

export const CalendarReactView: React.FC<CalendarReactViewProps> = ({
  entries,
  weekStartDay,
  initialView,
  initialSlotDuration,
  scrollToTime,
  detailProperty,
  iconProperty,
  involvementProperty,
  properties,
  onViewChange,
  onZoomChange,
  onEntryClick,
  onEntryContextMenu,
  onEventDrop,
  editable,
  onCreateEntry,
  calendarHandleRef,
}) => {
  const app = useApp();
  const calendarRef = useRef<FullCalendar>(null);
  const [slotDuration, setSlotDuration] = useState(initialSlotDuration);
  const slotDurationRef = useRef(initialSlotDuration);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hoverParentRef = useRef<{ hoverPopover: any }>({ hoverPopover: null });

  const handleZoom = useCallback(
    (direction: "in" | "out") => {
      const currentIdx = ZOOM_LEVELS.indexOf(slotDurationRef.current as typeof ZOOM_LEVELS[number]);
      const nextIdx = direction === "in"
        ? Math.min(currentIdx + 1, ZOOM_LEVELS.length - 1)
        : Math.max(currentIdx - 1, 0);
      const next = ZOOM_LEVELS[nextIdx];
      slotDurationRef.current = next;
      setSlotDuration(next);
      onZoomChange(next);
    },
    [onZoomChange],
  );

  const customButtons = useMemo(
    () => ({
      zoomIn:  { text: "+", hint: "Zoom in",  click: () => handleZoom("in") },
      zoomOut: { text: "−", hint: "Zoom out", click: () => handleZoom("out") },
    }),
    [handleZoom],
  );

  useEffect(() => {
    if (calendarHandleRef) {
      (calendarHandleRef as React.RefObject<CalendarHandle | null>).current = {
        updateSize: () => calendarRef.current?.getApi().updateSize(),
        unselect: () => calendarRef.current?.getApi().unselect(),
      };
    }
    return () => {
      if (calendarHandleRef) {
        (calendarHandleRef as React.RefObject<CalendarHandle | null>).current = null;
      }
    };
  }, [calendarHandleRef]);

  const events = entries.map((calEntry) => {
    // FullCalendar treats allDay end dates as exclusive; add one day to make inclusive.
    let adjustedEndDate = calEntry.endDate;
    if (calEntry.allDay && calEntry.endDate) {
      const startOnly = new Date(
        calEntry.startDate.getFullYear(),
        calEntry.startDate.getMonth(),
        calEntry.startDate.getDate(),
      );
      const endOnly = new Date(
        calEntry.endDate.getFullYear(),
        calEntry.endDate.getMonth(),
        calEntry.endDate.getDate(),
      );
      if (startOnly.getTime() === endOnly.getTime()) {
        adjustedEndDate = undefined;
      } else {
        adjustedEndDate = new Date(calEntry.endDate);
        adjustedEndDate.setDate(adjustedEndDate.getDate() + 1);
      }
    }

    let following = false;
    if (involvementProperty) {
      const involvement = tryGetValue(calEntry.entry, involvementProperty);
      following = involvement?.toString().trim().toLowerCase() === "following";
    }

    return {
      id: calEntry.entry.file.path,
      classNames: following ? ["is-following"] : [],
      title: calEntry.entry.file.basename,
      start: calEntry.startDate,
      end: adjustedEndDate,
      allDay: calEntry.allDay,
      backgroundColor: calEntry.backgroundColor,
      borderColor: calEntry.borderColor,
      extendedProps: {
        entry: calEntry.entry,
        originalEndDate: calEntry.endDate,
        allDay: calEntry.allDay,
        following,
      },
    };
  });

  const handleEventClick = useCallback(
    (clickInfo: EventClickArg) => {
      const target = clickInfo.jsEvent.target as HTMLElement;
      const entry = clickInfo.event.extendedProps.entry as BasesEntry;
      const isModEvent = clickInfo.jsEvent.ctrlKey || clickInfo.jsEvent.metaKey;

      if (target.closest("a.tag")) return;
      if (target.closest(".internal-link")) return;
      const clickedExternal = target.closest("a.external-link") as HTMLAnchorElement | undefined;
      if (clickedExternal?.href) return;

      clickInfo.jsEvent.preventDefault();
      onEntryClick(entry, isModEvent);
    },
    [app, onEntryClick],
  );

  const contextMenuListenersRef = useRef(new WeakMap<HTMLElement, (evt: Event) => void>());

  const handleEventMouseEnter = useCallback(
    (mouseEnterInfo: { event: EventApi; el: HTMLElement; jsEvent: MouseEvent }) => {
      const entry = mouseEnterInfo.event.extendedProps.entry as BasesEntry;
      const el = mouseEnterInfo.el;

      if (app) {
        app.workspace.trigger("hover-link", {
          event: mouseEnterInfo.jsEvent,
          source: "bases",
          hoverParent: hoverParentRef.current,
          targetEl: el,
          linktext: entry.file.path,
        });
      }

      const prevHandler = contextMenuListenersRef.current.get(el);
      if (prevHandler) el.removeEventListener("contextmenu", prevHandler);

      const contextMenuHandler = (evt: Event) => {
        evt.preventDefault();
        const syntheticEvent = {
          nativeEvent: evt as MouseEvent,
          currentTarget: el,
          target: evt.target as HTMLElement,
          preventDefault: () => evt.preventDefault(),
          stopPropagation: () => evt.stopPropagation(),
        } as unknown as React.MouseEvent;
        onEntryContextMenu(syntheticEvent, entry);
      };
      contextMenuListenersRef.current.set(el, contextMenuHandler);
      el.addEventListener("contextmenu", contextMenuHandler);
    },
    [app, onEntryContextMenu],
  );

  const handleEventDrop = useCallback(
    async (dropInfo: EventDropArg) => {
      if (!onEventDrop) {
        dropInfo.revert();
        return;
      }

      const entry = dropInfo.event.extendedProps.entry as BasesEntry;
      const originalEndDate = dropInfo.event.extendedProps.originalEndDate as Date | undefined;
      const allDay = dropInfo.event.extendedProps.allDay as boolean;
      const newStart = dropInfo.event.start;
      const newEnd = dropInfo.event.end;

      if (!newStart) {
        dropInfo.revert();
        return;
      }

      let actualEndDate: Date | undefined;
      if (originalEndDate) {
        if (allDay && newEnd) {
          actualEndDate = new Date(newEnd);
          actualEndDate.setDate(actualEndDate.getDate() - 1);
        } else if (!allDay && newEnd) {
          actualEndDate = new Date(newEnd);
        } else {
          actualEndDate = new Date(newStart);
        }
      }

      try {
        await onEventDrop(entry, newStart, actualEndDate, allDay);
      } catch {
        dropInfo.revert();
      }
    },
    [onEventDrop],
  );

  const hasNonEmptyValue = useCallback((value: Value): boolean => {
    if (!value || !value.isTruthy()) return false;
    const str = value.toString();
    return Boolean(str && str.trim().length > 0);
  }, []);

  // Renders a property value with list-aware truncation.
  // Uses Obsidian's renderTo for rich DOM output, then counts the actual child nodes
  // (individual chips/links) to decide truncation — more reliable than string splitting
  // since we don't know the exact separator Obsidian uses for multi-select values.
  const ListPropertyValue: React.FC<{ value: Value; maxItems?: number; chips?: boolean }> = ({
    value,
    maxItems = 2,
    chips = false,
  }) => {
    const nodeRef = useCallback(
      (node: HTMLElement | null) => {
        if (!node || !app) return;
        while (node.firstChild) node.removeChild(node.firstChild);

        if (value instanceof DateValue) {
          if ("date" in value && value.date && value.date instanceof Date) {
            const opts: Intl.DateTimeFormatOptions =
              "time" in value && (value as { time?: unknown }).time
                ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                : { year: "numeric", month: "short", day: "numeric" };
            node.appendChild(
              document.createTextNode(value.date.toLocaleDateString(undefined, opts)),
            );
          }
          return;
        }

        // Render into a detached temp element so we can inspect the output.
        const temp = document.createElement("span");
        value.renderTo(temp, app.renderContext);
        const children = Array.from(temp.childNodes);

        if (chips) {
          // One chip per person: split a flat "A, B" text node, otherwise wrap each
          // rendered child (link/chip), skipping bare separators between them.
          const items: Node[] = [];
          if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
            for (const part of (children[0].textContent ?? "").split(/,\s*/)) {
              const text = part.trim();
              if (text) items.push(document.createTextNode(text));
            }
          } else {
            for (const child of children) {
              if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? "").replace(/[,\s]/g, "")) continue;
              items.push(child);
            }
          }
          const shown = items.slice(0, 3);
          for (const item of shown) {
            const chip = document.createElement("span");
            chip.className = "bases-calendar-chip";
            chip.appendChild(item);
            node.appendChild(chip);
          }
          if (items.length > shown.length) {
            const badge = document.createElement("span");
            badge.className = "bases-calendar-prop-overflow";
            badge.textContent = `+${items.length - shown.length}`;
            node.appendChild(badge);
          }
          return;
        }

        // If Obsidian emitted a single text node, try splitting it by commas to
        // get a meaningful item count (handles "Alice, Bob, Carol" flat strings).
        let effectiveCount = children.length;
        let splitItems: string[] | null = null;
        if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
          const parts = (children[0].textContent ?? "")
            .split(/,\s*/)
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (parts.length > 1) {
            effectiveCount = parts.length;
            splitItems = parts;
          }
        }

        if (effectiveCount <= maxItems) {
          // Few items — move rendered children directly into the target node.
          while (temp.firstChild) node.appendChild(temp.firstChild);
        } else if (splitItems) {
          // Was a single text node that we split — render truncated plain text.
          node.appendChild(
            document.createTextNode(splitItems.slice(0, maxItems).join(", ")),
          );
          const badge = document.createElement("span");
          badge.className = "bases-calendar-prop-overflow";
          badge.textContent = `+${effectiveCount - maxItems}`;
          node.appendChild(badge);
        } else {
          // Multiple child nodes (chips/links) — move first maxItems, then badge.
          children.slice(0, maxItems).forEach((child) => node.appendChild(child));
          const badge = document.createElement("span");
          badge.className = "bases-calendar-prop-overflow";
          badge.textContent = `+${effectiveCount - maxItems}`;
          node.appendChild(badge);
        }
      },
      [value, chips],
    );
    return <span className="bases-calendar-prop-list" ref={nodeRef} />;
  };

  const iconIds = useMemo(() => new Set(getIconIds()), []);

  // Renders an emoji as text, or a Lucide icon when the value is an icon name
  // (e.g. "music" or "lucide-music").
  const IconBadge: React.FC<{ icon: string }> = ({ icon }) => {
    const lucideId = iconIds.has(icon)
      ? icon
      : iconIds.has(`lucide-${icon}`)
        ? `lucide-${icon}`
        : null;
    const nodeRef = useCallback(
      (node: HTMLElement | null) => {
        if (!node) return;
        node.empty?.();
        if (lucideId) setIcon(node, lucideId);
        else node.textContent = icon;
      },
      [lucideId, icon],
    );
    return <span className="bases-calendar-event-icon" ref={nodeRef} />;
  };

  const FollowIcon: React.FC = () => {
    const nodeRef = useCallback((node: HTMLElement | null) => {
      if (node) setIcon(node, "eye");
    }, []);
    return <span className="bases-calendar-follow-icon" ref={nodeRef} title="Following" />;
  };

  const renderEventContent = useCallback(
    (eventInfo: EventContentArg) => {
      if (!app) return null;

      const entry = eventInfo.event.extendedProps.entry as BasesEntry;

      // Skip detail row for short timed events (≤20 min) to avoid overflow.
      const { start, end, allDay } = eventInfo.event;
      const durationMs =
        !allDay && start !== null && end !== null ? end.getTime() - start.getTime() : null;
      const isShortTimed = durationMs !== null && durationMs <= 20 * 60 * 1000;
      // Up to 30 minutes there is only room for one line, so put people beside the title.
      const isCompact = durationMs !== null && durationMs <= 30 * 60 * 1000;

      // Title: first valid property from order (or file basename fallback).
      const validProperties: { propertyId: BasesPropertyId; value: Value }[] = [];
      for (const prop of properties) {
        const value = tryGetValue(entry, prop);
        if (value && hasNonEmptyValue(value)) {
          validProperties.push({ propertyId: prop, value });
        }
      }
      const titleProp = validProperties[0];

      // Detail line: use detailProperty if configured, otherwise remaining order props.
      let detailNode: React.ReactNode = null;
      if (isShortTimed) {
        detailNode = null;
      } else if (detailProperty) {
        const detailValue = tryGetValue(entry, detailProperty);
        if (detailValue && hasNonEmptyValue(detailValue)) {
          detailNode = (
            <div className="bases-calendar-event-property bases-calendar-person-tag">
              <span className="bases-calendar-event-property-value">
                <ListPropertyValue value={detailValue} chips />
              </span>
            </div>
          );
        }
      } else {
        const restProps = validProperties.slice(1);
        if (restProps.length > 0) {
          detailNode = (
            <>
              {restProps.map(({ propertyId: prop, value }) => (
                <div key={prop} className="bases-calendar-event-property">
                  <span className="bases-calendar-event-property-value">
                    <ListPropertyValue value={value} />
                  </span>
                </div>
              ))}
            </>
          );
        }
      }

      let iconText = "";
      if (iconProperty) {
        const iconValue = tryGetValue(entry, iconProperty);
        if (iconValue && hasNonEmptyValue(iconValue)) iconText = iconValue.toString().trim();
      }

      return (
        <div
          className={`bases-calendar-event-content${iconText ? " has-icon" : ""}${isCompact ? " is-compact" : ""}`}
        >
          {iconText && (
            <span className="bases-calendar-event-bookmark">
              <IconBadge icon={iconText} />
            </span>
          )}
          <div className="bases-calendar-event-title">
            {eventInfo.event.extendedProps.following && <FollowIcon />}
            {titleProp
              ? <ListPropertyValue value={titleProp.value} maxItems={1} />
              : entry.file.basename}
          </div>
          {detailNode && (
            <div className="bases-calendar-event-properties">{detailNode}</div>
          )}
        </div>
      );
    },
    [properties, detailProperty, iconProperty, app, hasNonEmptyValue, iconIds],
  );

  const handleSelect = useCallback(
    (sel: DateSelectArg) => {
      if (!onCreateEntry) return;
      let end = sel.end;
      if (sel.allDay) {
        // FullCalendar's all-day end is exclusive; make it inclusive.
        end = new Date(sel.end);
        end.setDate(end.getDate() - 1);
      }
      onCreateEntry(sel.start, end, sel.allDay);
    },
    [onCreateEntry],
  );

  const lastClickRef = useRef<{ time: number; at: number } | null>(null);

  // A double-click on a slot creates a one-hour entry (or a one-day entry in
  // month view). FullCalendar has no double-click callback, so detect it here.
  const handleDateClick = useCallback(
    (click: { date: Date; allDay: boolean }) => {
      if (!onCreateEntry) return;
      const now = Date.now();
      const last = lastClickRef.current;
      const key = click.date.getTime();
      if (last && last.time === key && now - last.at < 400) {
        lastClickRef.current = null;
        const end = click.allDay
          ? new Date(click.date)
          : new Date(click.date.getTime() + 60 * 60 * 1000);
        onCreateEntry(click.date, end, click.allDay);
      } else {
        lastClickRef.current = { time: key, at: now };
      }
    },
    [onCreateEntry],
  );

  // Expose the entry's solid colour (and a readable text colour) to the CSS styles.
  const handleEventDidMount = useCallback((arg: EventMountArg) => {
    const color = arg.event.borderColor;
    if (!color) return;
    arg.el.style.setProperty("--ev-color", color);
    arg.el.style.setProperty("--ev-text", readableTextColor(color));
  }, []);

  const handleViewDidMount = useCallback(
    (arg: ViewMountArg) => {
      onViewChange(arg.view.type);
    },
    [onViewChange],
  );

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView={initialView}
      views={{
        // Month auto-sizes to show all week rows (no inner scroll needed).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dayGridMonth: { contentHeight: "auto" } as any,
        timeGridWeek: {},
        workWeek: {
          type: "timeGridWeek",
          weekends: false,
          buttonText: "Work week",
        },
        threeDay: {
          type: "timeGrid",
          duration: { days: 3 },
          buttonText: "3 day",
        },
        timeGridDay: { buttonText: "Today" },
      }}
      firstDay={weekStartDay}
      headerToolbar={{
        left: "title",
        center: "",
        right: "dayGridMonth,timeGridWeek,workWeek,threeDay,timeGridDay prev,today,next zoomOut,zoomIn",
      }}
      customButtons={customButtons}
      buttonText={{ today: "Today" }}
      nowIndicator={true}
      scrollTime={scrollToTime}
      slotDuration={slotDuration}
      slotEventOverlap={false}
      eventMinHeight={20}
      navLinks={false}
      events={events}
      eventContent={renderEventContent}
      eventClick={handleEventClick}
      eventMouseEnter={handleEventMouseEnter}
      eventDrop={(info) => void handleEventDrop(info)}
      select={handleSelect}
      eventDidMount={handleEventDidMount}
      viewDidMount={handleViewDidMount}
      height="100%"
      fixedWeekCount={false}
      fixedMirrorParent={document.body ?? undefined}
      eventDurationEditable={false}
      selectable={Boolean(onCreateEntry)}
      selectMirror={false}
      unselectAuto={false}
      selectMinDistance={6}
      dateClick={handleDateClick}
      editable={editable}
    />
  );
};

function tryGetValue(entry: BasesEntry, propId: BasesPropertyId): Value | null {
  try {
    return entry.getValue(propId);
  } catch {
    return null;
  }
}

// White text on dark colours, near-black on light ones (perceived luminance).
function readableTextColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1a1a1a" : "#ffffff";
}
