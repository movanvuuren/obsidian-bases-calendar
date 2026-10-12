const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const notices = [];
class Notice {
  constructor(message) { this.message = message; notices.push(this); }
  hide() { this.hidden = true; }
}
const context = {
  exports: {},
  require: (name) => name === "obsidian" ? { BasesView: class {}, Notice } : {},
  document: {
    createDocumentFragment: () => ({ append() {}, appendChild(button) { this.button = button; } }),
    createElement: () => ({ addEventListener(_, handler) { this.click = handler; } }),
  },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/calendar-view.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText, context);

function setup(frontmatter) {
  const view = Object.create(context.exports.CalendarView.prototype);
  view.startDateProp = "note.start";
  view.endDateProp = "note.end";
  view.app = { fileManager: { async processFrontMatter(_, update) { update(frontmatter); } } };
  return view;
}
const entry = { file: { basename: "Test" } };
const tick = () => new Promise(setImmediate);
(async () => {
  const fm = { start: "2026-10-12T09:00", end: "2026-10-12T10:00", title: "Keep" };
  let view = setup(fm);
  await view.updateEntryDates(entry, new Date(2026, 9, 12, 9), new Date(2026, 9, 12, 11), false);
  assert.equal(fm.end, "2026-10-12T11:00");
  fm.title = "Edited separately";
  notices.at(-1).message.button.click();
  await tick();
  assert.equal(fm.end, "2026-10-12T10:00");
  assert.equal(fm.title, "Edited separately");

  const allDay = { start: "2026-10-12" };
  view = setup(allDay);
  await view.updateEntryDates(entry, new Date(2026, 9, 12), new Date(2026, 9, 14), true);
  assert.equal(allDay.end, "2026-10-14");
  notices.at(-1).message.button.click();
  await tick();
  assert.equal(Object.hasOwn(allDay, "end"), false);
  assert.equal(allDay.start, "2026-10-12");

  await view.updateEntryDates(entry, new Date(2026, 9, 13), new Date(2026, 9, 14), true);
  const undo = notices.at(-1).message.button;
  allDay.start = "2026-10-20";
  undo.click();
  await tick();
  assert.equal(allDay.start, "2026-10-20");
  assert.equal(allDay.end, "2026-10-14");

  view.app.fileManager.processFrontMatter = async () => { throw new Error("Write failed"); };
  await assert.rejects(view.updateEntryDates(entry, new Date(2026, 9, 13), undefined, true));
  assert.match(notices.at(-1).message, /Could not save/);
  console.log("Date update tests passed: timed resize, all-day resize, undo, missing end, conflict, save failure.");
})().catch(error => { console.error(error); process.exitCode = 1; });