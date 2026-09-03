/**
 * The end-to-end check: drives the real demo and asserts on what it does.
 *
 * The unit tests run in a plain Node process against an in-memory bridge,
 * which is the right seam for the store's logic and the wrong one for
 * everything Electron owns — the blocking bootstrap, a window reloading and
 * re-bootstrapping, a broadcast reaching two real renderer processes exactly
 * once each. That is what this covers.
 *
 * It needs a display, so CI does not run it.
 *
 *   npm run verify
 *
 * Exits non-zero if any check fails.
 */
const path = require("node:path");
const { app, webContents } = require("electron");

// Boots the example exactly as `npm start` does, then drives it from outside.
require(path.join(__dirname, "..", "dist", "example", "main.js"));

const out = [];
const say = (...a) => out.push(a.join(" "));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  say((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

const js = (wc, code) => wc.executeJavaScript(code, true);
function find() {
  const all = webContents.getAllWebContents();
  return {
    inspector: all.find((wc) => wc.getURL().includes("inspector.html")),
    a: all.find((wc) => /\/index\.html/.test(wc.getURL())),
    b: all.find((wc) => /index-react\.html/.test(wc.getURL())),
  };
}
const read = (wc) => js(wc, '({count:+document.getElementById("count").textContent,' +
  'cd:+document.getElementById("count-draws").textContent,' +
  'nd:+document.getElementById("name-draws").textContent,' +
  'note:document.getElementById("note").textContent,' +
  'name:document.getElementById("user").textContent})');
const stat = (insp, id) => js(insp, 'document.getElementById("' + id + '").textContent');
const type = (wc, text) => js(wc, 'var i=document.getElementById("user-input");' +
  'var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;' +
  's.call(i,' + JSON.stringify(text) + ');i.dispatchEvent(new Event("input",{bubbles:true}));true');
const logText = (insp) => js(insp, 'Array.from(document.querySelectorAll("#log li")).map(function(l){return l.textContent}).join("\\n")');

app.whenReady().then(async () => {
  await wait(2600);
  for (const wc of webContents.getAllWebContents()) {
    wc.on("console-message", (e) => {
      if (e.level === "error" || e.level === 3) errors.push(wc.id + ": " + e.message);
    });
  }
  const { inspector, a, b } = find();
  check("both windows and the inspector are up", !!inspector && !!a && !!b);
  if (!inspector || !a || !b) return finish();

  // 1. a click in A reaches B
  await js(a, 'document.getElementById("inc").click();true');
  await wait(1200);
  let ra = await read(a), rb = await read(b);
  check("a click in A reaches B", ra.count === 1 && rb.count === 1, `A ${ra.count} B ${rb.count}`);

  // 2. very slow: the guess shows in A while B has not heard
  await js(inspector, 'document.querySelector("[data-latency=\\"1500\\"]").click();true');
  await wait(400);
  await js(a, 'document.getElementById("inc").click();true');
  await wait(500);
  ra = await read(a); rb = await read(b);
  check("at 1.5 s A shows the guess and B has not heard", ra.count === 2 && rb.count === 1, `A ${ra.count} B ${rb.count}`);
  await wait(5000);
  ra = await read(a); rb = await read(b);
  check("and B catches up once the message lands", ra.count === 2 && rb.count === 2, `A ${ra.count} B ${rb.count}`);
  await js(inspector, 'document.querySelector("[data-latency=\\"0\\"]").click();true');
  await wait(400);

  // 3. a refusal rolls back
  await js(inspector, 'document.getElementById("reject-next").click();true');
  await wait(300);
  await js(b, 'document.getElementById("inc").click();true');
  await wait(1500);
  ra = await read(a); rb = await read(b);
  check("a refused click rolls back and says why", rb.count === 2 && rb.note.includes("rolled back"), `B ${rb.count} "${rb.note}"`);
  check("and the other window never saw it", ra.count === 2, `A ${ra.count}`);

  // 4. selectors: typing must not redraw the count
  const cdA = (await read(a)).cd, cdB = (await read(b)).cd;
  await type(a, "grace");
  await wait(1200);
  ra = await read(a); rb = await read(b);
  check("typing a name changes it in both windows", ra.name === "grace" && rb.name === "grace", `${ra.name}/${rb.name}`);
  check("and redraws neither count", ra.cd === cdA && rb.cd === cdB, `A ${cdA}->${ra.cd} B ${cdB}->${rb.cd}`);

  // 5. the load, and the batching
  const asksBefore = +(await stat(inspector, "asks"));
  const sentBefore = +(await stat(inspector, "sent-out"));
  await js(inspector, 'document.getElementById("rush").click();true');
  await wait(6000);
  const asks = +(await stat(inspector, "asks")) - asksBefore;
  const sent = +(await stat(inspector, "sent-out")) - sentBefore;
  ra = await read(a); rb = await read(b);
  check("50 clicks at once are all answered", asks === 50, `asks ${asks}`);
  check("in far fewer messages than asks", sent > 0 && sent <= 10, `sent out ${sent}`);
  check("both windows land on the same count", ra.count === rb.count && ra.count === 52, `A ${ra.count} B ${rb.count}`);
  check("and the pages redrew a handful of times, not fifty", ra.cd < 15 && rb.cd < 15, `A ${ra.cd} B ${rb.cd}`);

  // 6. restart B: re-bootstrap, then one more change reaches it exactly once
  await js(inspector, 'document.getElementById("clear").click();true');
  await js(inspector, 'document.querySelector("[data-reload=\\"b\\"]").click();true');
  await wait(2500);
  const b2 = find().b;
  await js(a, 'document.getElementById("inc").click();true');
  await wait(1500);
  ra = await read(a); rb = await read(b2);
  check("a restarted window re-bootstraps and keeps up", ra.count === 53 && rb.count === 53, `A ${ra.count} B ${rb.count}`);
  const tail = await logText(inspector);
  const arrivals = (tail.match(/arrived · used it/g) || []).length;
  check("and the next change reached each window exactly once", arrivals === 2, `${arrivals} arrivals`);

  // 7. nothing anywhere reported a hole
  const whole = await logText(inspector);
  check("no window ever reported a missing message", !/a number is missing|fresh copy/.test(whole));
  finish();
});

function finish() {
  check("no console errors", errors.length === 0, errors.join(" | "));
  say("");
  say(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
  console.log("\n" + out.join("\n") + "\n");
  app.exit(failures === 0 ? 0 : 1);
}
setTimeout(finish, 60000);
