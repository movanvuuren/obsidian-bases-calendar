import { App, Modal, Setting, TFile, normalizePath } from "obsidian";
import { GOOGLE_CALENDAR_COLORS } from "./colors";

export interface NewEntryRequest {
  start: Date;
  end: Date;
  allDay: boolean;
}

export interface NewEntryOptions {
  folder: string;
  templatePath: string;
  startProp: string;
  endProp: string | null;
  personProp: string;
  iconProp: string;
  involvementProp: string;
  colorProp: string;
  onDone?: () => void;
}

interface EntryDetails {
  title: string;
  person: string;
  icon: string;
  involvement: "attending" | "following";
  color: string;
}

class NewEntryModal extends Modal {
  private title = "";
  private person = "";
  private icon = "";
  private involvement: "attending" | "following" = "attending";
  private color = "";

  constructor(
    app: App,
    private request: NewEntryRequest,
    private onSubmit: (details: EntryDetails) => void,
    private onDone?: () => void,
    initialColor = "",
  ) {
    super(app);
    this.color = initialColor;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "New calendar entry" });
    contentEl.createEl("p", {
      text: describeRange(this.request),
      cls: "bases-calendar-new-entry-range",
    });

    const submit = () => {
      const title = this.title.trim();
      if (!title) return;
      this.close();
      this.onSubmit({
        title,
        person: this.person.trim(),
        icon: this.icon.trim(),
        involvement: this.involvement,
        color: this.color,
      });
    };

    new Setting(contentEl).setName("Name").addText((text) => {
      text.setPlaceholder("Activity name").onChange((v) => (this.title = v));
      text.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName("Who")
      .setDesc("Optional. Separate several people with commas.")
      .addText((text) => {
        text.onChange((v) => (this.person = v));
        text.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            submit();
          }
        });
      });

    new Setting(contentEl)
      .setName("Icon")
      .setDesc("Optional. An emoji, or a Lucide icon name such as music.")
      .addText((text) => {
        text.onChange((v) => (this.icon = v));
        text.inputEl.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            submit();
          }
        });
      });

    new Setting(contentEl)
      .setName("Involvement")
      .setDesc("Following entries are shown with a lighter fill.")
      .addDropdown((dd) =>
        dd
          .addOption("attending", "Attending")
          .addOption("following", "Following")
          .setValue(this.involvement)
          .onChange((v) => (this.involvement = v as "attending" | "following")),
      );

    const colorSetting = new Setting(contentEl).setName("Colour");
    const swatches = colorSetting.controlEl.createDiv({ cls: "bases-calendar-swatches" });
    const buttons = new Map<string, HTMLButtonElement>();
    const select = (name: string) => {
      this.color = this.color === name ? "" : name;
      buttons.forEach((btn, key) => btn.toggleClass("is-selected", key === this.color));
    };
    for (const [name, hex] of Object.entries(GOOGLE_CALENDAR_COLORS)) {
      const btn = swatches.createEl("button", {
        cls: "bases-calendar-swatch",
        attr: { type: "button", "aria-label": name, title: name },
      });
      btn.style.backgroundColor = hex;
      btn.toggleClass("is-selected", name === this.color);
      btn.addEventListener("click", () => select(name));
      buttons.set(name, btn);
    }

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Create").setCta().onClick(submit),
    );
  }

  onClose(): void {
    this.contentEl.empty();
    this.onDone?.();
  }
}

export function promptNewEntry(
  app: App,
  request: NewEntryRequest,
  options: NewEntryOptions,
): void {
  new NewEntryModal(
    app,
    request,
    (details) => {
      void createEntry(app, request, options, details);
    },
    options.onDone,
    templateColor(app, options),
  ).open();
}

// The colour already set in the template, so the picker starts on it.
function templateColor(app: App, options: NewEntryOptions): string {
  if (!options.templatePath) return "";
  const template = app.vault.getAbstractFileByPath(options.templatePath);
  if (!(template instanceof TFile)) return "";
  const value = app.metadataCache.getFileCache(template)?.frontmatter?.[options.colorProp];
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  return name in GOOGLE_CALENDAR_COLORS ? name : "";
}

async function createEntry(
  app: App,
  request: NewEntryRequest,
  options: NewEntryOptions,
  details: EntryDetails,
): Promise<void> {
  const { title } = details;
  const dateStr = formatDate(request.start);
  const safeTitle = title.replace(/[\\/:*?"<>|#^[\]]/g, "-");
  const folder = options.folder ? normalizePath(options.folder) : "";
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }

  let path = normalizePath(`${folder}/${safeTitle}_${dateStr}.md`);
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) {
    path = normalizePath(`${folder}/${safeTitle}_${dateStr}_${n}.md`);
  }

  let body = "";
  if (options.templatePath) {
    const template = app.vault.getAbstractFileByPath(options.templatePath);
    if (template instanceof TFile) body = await app.vault.read(template);
  }

  const file = await app.vault.create(path, body);
  await app.fileManager.processFrontMatter(file, (fm) => {
    const fmt = request.allDay ? formatDate : formatDateTime;
    fm[options.startProp] = fmt(request.start);
    if (options.endProp) {
      fm[options.endProp] = fmt(request.end);
    }
    if (details.person) {
      const people = details.person.split(",").map((p) => p.trim()).filter(Boolean);
      fm[options.personProp] = people.length > 1 ? people : people[0];
    }
    if (details.icon) fm[options.iconProp] = details.icon;
    fm[options.involvementProp] = details.involvement;
    if (details.color) fm[options.colorProp] = details.color;
  });
  await app.workspace.getLeaf(false).openFile(file);
}

function describeRange(request: NewEntryRequest): string {
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short", day: "numeric", month: "short",
  };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  if (request.allDay) {
    return request.start.toLocaleDateString(undefined, dateOpts);
  }
  return `${request.start.toLocaleDateString(undefined, dateOpts)}, ${request.start.toLocaleTimeString(undefined, timeOpts)} – ${request.end.toLocaleTimeString(undefined, timeOpts)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}
