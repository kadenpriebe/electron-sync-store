/**
 * Regenerates the two README screenshots from a real run of the demo.
 *
 *   npm run screenshots
 *
 * Run it whenever the inspector's wording or layout changes, so the pictures
 * in the README are not describing a version of the app that no longer exists.
 *
 * Two things make this more than a call to capturePage().
 *
 * The app panes cannot be captured. Each is a WebContentsView, which has no
 * display surface of its own, so capturePage() on one fails outright with
 * "Current display surface not available for capture". Capturing the inspector
 * window gets everything except the two pages, leaving empty rectangles where
 * they belong. So the same two pages are opened as ordinary windows on the
 * same preload and the same store — genuinely the same app, at the same state
 * — and pasted into the slots afterwards.
 *
 * That means the helper windows are a lie waiting to happen, and the ordering
 * below is what keeps them honest:
 *
 *   calm     the pane content is fully visible, redraw counters and all, so
 *            the helpers are open for the whole story and see exactly the
 *            updates the panes see. They are closed again before the
 *            inspector is captured, so "windows kept updated" reads 2.
 *
 *   details  the event log is on screen, and a third and fourth window would
 *            show up in it. So the story runs with no helper open, the
 *            inspector is captured first, and only then are the helpers
 *            opened to fill the slots — which in this view are short enough
 *            that only the page title and the number show.
 *
 * Each view needs its own run of the app, so that its story is the only thing
 * that ever happened.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, nativeImage, webContents } = require("electron");

require(path.join(__dirname, "..", "dist", "example", "main.js"));

const VIEWS = {
  calm: { file: "inspector.png", details: false },
  details: { file: "inspector-details.png", details: true },
};

const arg = process.argv.find((a) => a.startsWith("--view="));
const view = arg ? arg.slice("--view=".length) : "calm";
if (!VIEWS[view]) {
  console.error(`unknown view: ${view} (expected ${Object.keys(VIEWS).join(" or ")})`);
  process.exit(1);
}

const DOCS = path.join(__dirname, "..", "docs");
const PAGES = path.join(__dirname, "..", "dist", "example");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (wc, code) => wc.executeJavaScript(code, true);

function find() {
  const all = webContents.getAllWebContents();
  return {
    inspector: all.find((wc) => wc.getURL().includes("inspector.html")),
    a: all.find((wc) => /\/index\.html/.test(wc.getURL())),
  };
}

/** Where the two panes sit, in the inspector page's own coordinates. */
function slots(inspector) {
  return js(
    inspector,
    `(function () {
       var box = function (id) {
         var r = document.getElementById(id).getBoundingClientRect();
         return { x: r.x, y: r.y, w: r.width, h: r.height };
       };
       return { a: box("slot-a"), b: box("slot-b"), dpr: window.devicePixelRatio };
     })()`,
  );
}

/** Five clicks in one moment, then a name: six changes, far fewer messages. */
async function story(a) {
  for (let i = 0; i < 5; i++) {
    await js(a, 'document.getElementById("inc").click()');
  }
  await wait(400);
  await js(
    a,
    `(function () {
       var input = document.getElementById("user-input");
       // React ignores a directly assigned .value, so go through the setter
       // it is watching and let the event bubble as a real keystroke would.
       Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
         .set.call(input, "grace");
       input.dispatchEvent(new Event("input", { bubbles: true }));
     })()`,
  );
  // Long enough for every dot to land: the demo animates them in slow motion,
  // and a capture taken mid-flight shows a guess that is about to be settled.
  await wait(7000);
}

function helper(file, rect, x) {
  const win = new BrowserWindow({
    width: Math.round(rect.w),
    height: Math.round(rect.h),
    x,
    y: 40,
    show: true,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(PAGES, "preload.js"),
    },
  });
  void win.loadFile(path.join(PAGES, file));
  return win;
}

/**
 * Paste the pane captures into the inspector capture.
 *
 * Done on a canvas in a throwaway window rather than with an image library,
 * so regenerating the screenshots needs nothing that building the project
 * does not already need.
 */
async function composite(base, panes, outFile) {
  const win = new BrowserWindow({ show: false, width: 100, height: 100 });
  await win.loadURL("about:blank");
  const url = await js(
    win.webContents,
    `(async function () {
       var spec = ${JSON.stringify({ base: base.toDataURL(), panes })};
       var load = function (src) {
         return new Promise(function (ok, no) {
           var img = new Image();
           img.onload = function () { ok(img); };
           img.onerror = no;
           img.src = src;
         });
       };
       var bottom = await load(spec.base);
       var canvas = document.createElement("canvas");
       canvas.width = bottom.width;
       canvas.height = bottom.height;
       var ctx = canvas.getContext("2d");
       ctx.drawImage(bottom, 0, 0);
       for (var i = 0; i < spec.panes.length; i++) {
         var p = spec.panes[i];
         ctx.drawImage(await load(p.src), p.x, p.y, p.w, p.h);
       }
       return canvas.toDataURL("image/png");
     })()`,
  );
  win.destroy();
  // Canvas encodes PNG about a third larger than Chromium's own encoder does,
  // and these are committed files, so hand it back through nativeImage.
  const png = Buffer.from(url.split(",")[1], "base64");
  fs.writeFileSync(outFile, nativeImage.createFromBuffer(png).toPNG());
}

app.whenReady().then(async () => {
  let failed;
  try {
    await wait(2500);
    const { inspector, a } = find();
    if (!inspector || !a) throw new Error("the demo did not come up");

    if (VIEWS[view].details) {
      await js(inspector, 'document.getElementById("details-toggle").click()');
      await wait(1200);
    }

    // In the calm view the helpers live through the story, so that the redraw
    // counters they show are the ones the real panes show.
    let helpers = [];
    if (!VIEWS[view].details) {
      const before = await slots(inspector);
      helpers = [
        helper("index.html", before.a, 40),
        helper("index-react.html", before.b, 560),
      ];
      await wait(1500);
    }

    await story(a);

    // Measured now, not earlier: window A's box grows a line once the owner
    // has answered it, which moves its slot down the page.
    const rects = await slots(inspector);
    const at = (r) => ({
      x: Math.round(r.x * rects.dpr),
      y: Math.round(r.y * rects.dpr),
      w: Math.round(r.w * rects.dpr),
      h: Math.round(r.h * rects.dpr),
    });

    let shots;
    if (VIEWS[view].details) {
      // Capture the log before any extra window can appear in it.
      const base = await inspector.capturePage();
      helpers = [
        helper("index.html", rects.a, 40),
        helper("index-react.html", rects.b, 560),
      ];
      await wait(1800);
      shots = { base, panes: await Promise.all(helpers.map((h) => h.webContents.capturePage())) };
      for (const h of helpers) h.destroy();
    } else {
      for (const [i, h] of helpers.entries()) {
        const r = i === 0 ? rects.a : rects.b;
        h.setBounds({ x: i === 0 ? 40 : 560, y: 40, width: Math.round(r.w), height: Math.round(r.h) });
      }
      await wait(1200);
      const panes = await Promise.all(helpers.map((h) => h.webContents.capturePage()));
      // Back down to two windows before capturing anything that counts them.
      for (const h of helpers) h.destroy();
      await wait(2500);
      shots = { base: await inspector.capturePage(), panes };
    }

    const out = path.join(DOCS, VIEWS[view].file);
    await composite(
      shots.base,
      [
        { src: shots.panes[0].toDataURL(), ...at(rects.a) },
        { src: shots.panes[1].toDataURL(), ...at(rects.b) },
      ],
      out,
    );
    console.log(`wrote ${path.relative(process.cwd(), out)}`);
  } catch (err) {
    failed = err;
    console.error("screenshot run failed:", err && err.stack);
  }
  app.exit(failed ? 1 : 0);
});
