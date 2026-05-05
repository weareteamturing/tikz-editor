import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { remote } from "webdriverio";

if (shouldRerunUnderXvfb()) {
  const result = spawnSync("xvfb-run", ["-a", process.execPath, ...process.argv.slice(1)], {
    env: {
      ...process.env,
      TIKZ_DESKTOP_E2E_XVFB: "1"
    },
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

const appPath = resolveAppBinary();

if (!fs.existsSync(appPath)) {
  throw new Error(`Desktop binary not found at ${appPath}. Run "npm run tauri:build -- --no-bundle" first.`);
}

const driverProbe = spawnSync("tauri-driver", ["--help"], { encoding: "utf8" });
if (driverProbe.error) {
  throw new Error("tauri-driver is required for desktop e2e. Install it with: cargo install tauri-driver --locked");
}
if (driverProbe.status !== 0) {
  const output = `${driverProbe.stdout ?? ""}\n${driverProbe.stderr ?? ""}`.toLowerCase();
  if (output.includes("not supported on this platform")) {
    console.log("Skipping desktop e2e: tauri-driver is not supported on this platform.");
    process.exit(0);
  }
  throw new Error(`tauri-driver check failed:\n${driverProbe.stderr ?? driverProbe.stdout ?? ""}`);
}

const nativeDriver = resolveNativeWebkitDriver();
const driverArgs = nativeDriver ? ["--native-driver", nativeDriver] : [];
const driver = spawn("tauri-driver", driverArgs, {
  stdio: "pipe"
});

driver.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

await waitForDriverReady(driver);

const browser = await createSession(appPath);

try {
  await installDeterministicBridge(browser);
  const scenarios = [
    ["boot and tab lifecycle", scenarioBootAndTabLifecycle],
    ["isolation and restore", scenarioIsolationAndRestore],
    ["example open", scenarioExampleOpen],
    ["open, save, save as", scenarioOpenSaveSaveAs],
    ["export smoke", scenarioExportSmoke],
    ["unsaved guard", scenarioUnsavedGuard]
  ];

  const runStartedAt = Date.now();
  let passed = 0;
  for (const [name, scenario] of scenarios) {
    const scenarioName = String(name);
    const scenarioStartedAt = Date.now();
    try {
      await scenario(browser);
      passed += 1;
      console.log(`[desktop-e2e] PASS ${scenarioName} (${Date.now() - scenarioStartedAt}ms)`);
    } catch (error) {
      console.error(`[desktop-e2e] FAIL ${scenarioName} (${Date.now() - scenarioStartedAt}ms)`);
      throw error;
    }
  }
  console.log(`[desktop-e2e] Completed ${passed}/${scenarios.length} scenarios in ${Date.now() - runStartedAt}ms`);
} finally {
  await browser.deleteSession().catch(() => undefined);
  driver.kill("SIGTERM");
}

function resolveAppBinary() {
  const root = process.cwd();
  const plain = path.resolve(root, "src-tauri/target/release/app");
  if (fs.existsSync(plain)) {
    return plain;
  }
  if (process.platform === "darwin") {
    return path.resolve(root, "src-tauri/target/release/app.app/Contents/MacOS/app");
  }
  if (process.platform === "win32") {
    return path.resolve(root, "src-tauri/target/release/app.exe");
  }
  return plain;
}

function shouldRerunUnderXvfb() {
  if (process.platform !== "linux") {
    return false;
  }
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.TIKZ_DESKTOP_E2E_XVFB === "1") {
    return false;
  }

  const probe = spawnSync("xvfb-run", ["--help"], {
    encoding: "utf8",
    stdio: "ignore"
  });
  if (probe.error) {
    console.warn("Desktop e2e: DISPLAY is unset and xvfb-run is unavailable; continuing without virtual display.");
    return false;
  }
  return true;
}

async function waitForDriverReady(driverProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(4444)) {
      return;
    }
    if (driverProcess.exitCode != null) {
      throw new Error(`tauri-driver exited early with code ${driverProcess.exitCode}`);
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for tauri-driver to become ready.");
}

async function createSession(application) {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  let warnedCapabilityFallback = false;
  const capabilityCandidates = [
    {
      "tauri:options": {
        application
      },
      "wdio:enforceWebDriverClassic": true
    },
    {
      browserName: "wry",
      "tauri:options": {
        application
      },
      "wdio:enforceWebDriverClassic": true
    }
  ];

  while (Date.now() < deadline) {
    for (let index = 0; index < capabilityCandidates.length; index += 1) {
      const capabilities = capabilityCandidates[index];
      try {
        return await remote({
          hostname: "127.0.0.1",
          port: 4444,
          path: "/",
          capabilities,
          logLevel: "error"
        });
      } catch (error) {
        lastError = error;
        if (!warnedCapabilityFallback && index === 0) {
          warnedCapabilityFallback = true;
          console.warn("Desktop e2e: falling back to legacy WebDriver capabilities after initial session rejection.");
        }
      }
    }
    await delay(500);
  }
  throw new Error(`Unable to create desktop WebDriver session: ${String(lastError)}`);
}

async function installDeterministicBridge(browserInstance) {
  await browserInstance.execute(() => {
    const writes = [];
    const exports = [];
    const unsavedDecisions = [];
    const unsavedPrompts = [];
    const warnings = [];
    const errors = [];
    if (!window.__DESKTOP_E2E_CONSOLE_CAPTURE_INSTALLED__) {
      const originalWarn = console.warn.bind(console);
      const originalError = console.error.bind(console);
      console.warn = (...args) => {
        window.__DESKTOP_E2E_WARNINGS__.push(args.map((value) => String(value)).join(" "));
        originalWarn(...args);
      };
      console.error = (...args) => {
        window.__DESKTOP_E2E_ERRORS__.push(args.map((value) => String(value)).join(" "));
        originalError(...args);
      };
      window.__DESKTOP_E2E_CONSOLE_CAPTURE_INSTALLED__ = true;
    }
    const bridge = {
      openText: async (path) => {
        const resolvedPath = path ?? "/tmp/opened-from-e2e.tex";
        return {
          source: "\\\\draw (9,9)--(10,10); % desktop-opened",
          path: resolvedPath,
          name: resolvedPath.split("/").pop() ?? "opened-from-e2e.tex"
        };
      },
      saveText: async ({ text, suggestedName, path, forceSaveAs }) => {
        const computedPath =
          forceSaveAs || !path
            ? `/tmp/${(suggestedName ?? "tikz-document").replace(/[^A-Za-z0-9_.-]/g, "_")}`
            : path;
        writes.push({ text, path: computedPath, forceSaveAs });
        return {
          ok: true,
          path: computedPath,
          name: computedPath.split("/").pop() ?? "tikz-document.tex"
        };
      },
      exportFile: async ({ fileName }) => {
        exports.push(fileName);
        return true;
      },
      readClipboard: async () => "",
      writeClipboard: async () => undefined,
      readCustomClipboardText: async () => null,
      readCustomClipboardBytes: async () => null,
      writeClipboardBundle: async () => undefined,
      setWindowTitle: async (title) => {
        window.__DESKTOP_E2E_TITLE__ = title;
      },
      closeWindow: async () => {
        window.__DESKTOP_E2E_CLOSED__ = true;
      },
      confirmUnsavedChanges: async (message) => {
        unsavedPrompts.push(message);
        return unsavedDecisions.shift() ?? "cancel";
      },
      onMenuCommand: async () => () => undefined,
      onOpenRecent: async () => () => undefined,
      onWindowCloseRequest: async () => () => undefined,
      onContextMenuCommand: async () => () => undefined
    };
    window.__DESKTOP_E2E_WRITES__ = writes;
    window.__DESKTOP_E2E_EXPORTS__ = exports;
    window.__DESKTOP_E2E_UNSAVED_DECISIONS__ = unsavedDecisions;
    window.__DESKTOP_E2E_UNSAVED_PROMPTS__ = unsavedPrompts;
    window.__DESKTOP_E2E_WARNINGS__ = warnings;
    window.__DESKTOP_E2E_ERRORS__ = errors;
    window.__DESKTOP_E2E_CLOSED__ = false;
    window.__TIKZ_EDITOR_DESKTOP_TEST_API__.setBridgeOverride(bridge);
  });
}

async function scenarioBootAndTabLifecycle(browserInstance) {
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", 1);
  await dispatchCommand(browserInstance, "file.new-document");
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", 2);
  await dispatchCommand(browserInstance, "file.close-all-documents");
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", 1);
}

async function scenarioIsolationAndRestore(browserInstance) {
  await setSource(browserInstance, "\\draw (0,0)--(1,0); % doc1");
  await dispatchCommand(browserInstance, "file.new-document");
  await setSource(browserInstance, "\\draw (2,0)--(3,0); % doc2");

  const tabs = await browserInstance.$$("[data-testid^='tab-switch-']");
  await tabs[0].click();
  await expectTextContains(browserInstance, ".cm-content", "% doc1");
  await tabs[1].click();
  await expectTextContains(browserInstance, ".cm-content", "% doc2");
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", 2);
}

async function scenarioExampleOpen(browserInstance) {
  const before = await count(browserInstance, "[data-testid^='tab-switch-']");
  await dispatchCommand(browserInstance, "file.open-example");
  await browserInstance.$("[data-testid^='open-example-card-']").click();
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", before + 1);
}

async function scenarioOpenSaveSaveAs(browserInstance) {
  await dispatchCommand(browserInstance, "file.open-document");
  await expectTextContains(browserInstance, ".cm-content", "desktop-opened");

  await dispatchCommand(browserInstance, "file.save-document");
  await dispatchCommand(browserInstance, "file.save-document-as");
  const writes = await browserInstance.execute(() => window.__DESKTOP_E2E_WRITES__.length);
  assert.ok(writes >= 2, "expected at least two writes after save and save as");
}

async function scenarioExportSmoke(browserInstance) {
  await openModalForCommand(browserInstance, "file.export-svg-download", "[data-testid='svg-export-modal']");
  await browserInstance.$("[data-testid='svg-export-cancel']").click();
  await waitForModalToClose(browserInstance, "[data-testid='svg-export-modal']");

  await openModalForCommand(browserInstance, "file.export-png-download", "[data-testid='png-export-modal']");
  await browserInstance.$("[data-testid='png-export-cancel']").click();
  await waitForModalToClose(browserInstance, "[data-testid='png-export-modal']");

  await dispatchCommand(browserInstance, "file.export-pdf-download");
  await browserInstance.waitUntil(async () => {
    const exports = await browserInstance.execute(() => window.__DESKTOP_E2E_EXPORTS__);
    return exports.includes("tikz-export.pdf");
  }, {
    timeout: 30_000,
    interval: 250,
    timeoutMsg: await describePdfExportFailure(browserInstance)
  });
  await waitForCommandEffect(browserInstance, "file.export-standalone-latex-download", async () => {
    const exports = await browserInstance.execute(() => window.__DESKTOP_E2E_EXPORTS__);
    return exports.includes("tikz-export.tex");
  }, "Expected LaTeX export to run");

  const exports = await browserInstance.execute(() => window.__DESKTOP_E2E_EXPORTS__);
  assert.ok(exports.includes("tikz-export.pdf"), "expected PDF export to run");
  assert.ok(exports.includes("tikz-export.tex"), "expected LaTeX export to run");
}

async function scenarioUnsavedGuard(browserInstance) {
  await setSource(browserInstance, "\\draw (5,5)--(6,6); % dirty-close");
  const initialTabs = await count(browserInstance, "[data-testid^='tab-switch-']");
  let promptCount = await getUnsavedPromptCount(browserInstance);

  await queueUnsavedDecision(browserInstance, "cancel");
  await dispatchCommand(browserInstance, "file.close-document");
  await expectUnsavedPromptCount(browserInstance, promptCount + 1);
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", initialTabs);

  promptCount += 1;
  const writesBeforeSave = await browserInstance.execute(() => window.__DESKTOP_E2E_WRITES__.length);
  await queueUnsavedDecision(browserInstance, "save");
  await dispatchCommand(browserInstance, "file.close-document");
  await expectUnsavedPromptCount(browserInstance, promptCount + 1);
  await browserInstance.waitUntil(async () => {
    const writes = await browserInstance.execute(() => window.__DESKTOP_E2E_WRITES__.length);
    return writes > writesBeforeSave;
  }, {
    timeout: 10_000,
    timeoutMsg: "Expected save-on-close to write the document"
  });
  await expectCount(browserInstance, "[data-testid^='tab-switch-']", Math.max(1, initialTabs - 1));

  await setSource(browserInstance, "\\draw (7,7)--(8,8); % dirty-window-close");
  promptCount += 1;
  await queueUnsavedDecision(browserInstance, "discard");
  await browserInstance.execute(() => {
    window.__TIKZ_EDITOR_DESKTOP_TEST_API__.triggerWindowCloseRequest();
  });
  await expectUnsavedPromptCount(browserInstance, promptCount + 1);
  const closed = await browserInstance.execute(() => window.__DESKTOP_E2E_CLOSED__);
  assert.equal(closed, true, "window close should be confirmed after discard");
}

async function dispatchCommand(browserInstance, commandId) {
  await browserInstance.waitUntil(async () => {
    return await browserInstance.execute((id) => {
      return window.__TIKZ_EDITOR_APP_TEST_API__.runCommand(id);
    }, commandId);
  }, {
    timeout: 10_000,
    timeoutMsg: `Command did not become enabled for ${commandId}`
  });
}

async function openModalForCommand(browserInstance, commandId, modalSelector) {
  await waitForCommandEffect(browserInstance, commandId, async () => {
    return await browserInstance.$(modalSelector).isExisting();
  }, `Expected ${modalSelector} to appear after ${commandId}`);
}

async function waitForModalToClose(browserInstance, modalSelector) {
  await browserInstance.waitUntil(async () => {
    return !(await browserInstance.$(modalSelector).isExisting());
  }, {
    timeout: 10_000,
    interval: 100,
    timeoutMsg: `Expected ${modalSelector} to close`
  });
}

async function waitForCommandEffect(browserInstance, commandId, checkEffect, timeoutMsg) {
  await browserInstance.waitUntil(async () => {
    if (await checkEffect()) {
      return true;
    }
    await dispatchCommand(browserInstance, commandId);
    await delay(150);
    return await checkEffect();
  }, {
    timeout: 15_000,
    interval: 250,
    timeoutMsg
  });
}

async function describePdfExportFailure(browserInstance) {
  const diagnostics = await browserInstance.execute(() => ({
    exports: window.__DESKTOP_E2E_EXPORTS__,
    warnings: window.__DESKTOP_E2E_WARNINGS__,
    errors: window.__DESKTOP_E2E_ERRORS__
  }));
  return `Expected PDF export to run. exports=${JSON.stringify(diagnostics.exports)} warnings=${JSON.stringify(diagnostics.warnings)} errors=${JSON.stringify(diagnostics.errors)}`;
}

async function setSource(browserInstance, value) {
  await browserInstance.execute((nextSource) => {
    window.__TIKZ_EDITOR_APP_TEST_API__.setSource(nextSource);
  }, value);
  let lastSource = "";
  await browserInstance.waitUntil(async () => {
    lastSource = await browserInstance.execute(() => window.__TIKZ_EDITOR_APP_TEST_API__.getSource());
    return lastSource === value;
  }, {
    timeout: 10_000,
    timeoutMsg: `Expected test API source to update to ${JSON.stringify(value)}; lastSource=${JSON.stringify(lastSource)}`
  });
}

async function queueUnsavedDecision(browserInstance, decision) {
  await browserInstance.execute((nextDecision) => {
    window.__DESKTOP_E2E_UNSAVED_DECISIONS__.push(nextDecision);
  }, decision);
}

async function getUnsavedPromptCount(browserInstance) {
  return await browserInstance.execute(() => window.__DESKTOP_E2E_UNSAVED_PROMPTS__.length);
}

async function expectUnsavedPromptCount(browserInstance, expectedCount) {
  let lastObserved = -1;
  await browserInstance.waitUntil(async () => {
    lastObserved = await getUnsavedPromptCount(browserInstance);
    return lastObserved === expectedCount;
  }, {
    timeout: 10_000,
    timeoutMsg: `Expected unsaved prompt count to become ${expectedCount}; last observed ${lastObserved}`
  });
}

async function expectCount(browserInstance, selector, expectedCount) {
  let lastObserved = -1;
  await browserInstance.waitUntil(async () => {
    lastObserved = await count(browserInstance, selector);
    return lastObserved === expectedCount;
  }, {
    timeout: 10_000,
    timeoutMsg: `Expected ${selector} count to become ${expectedCount}; last observed ${lastObserved}`
  });
}

async function count(browserInstance, selector) {
  return (await browserInstance.$$(selector)).length;
}

async function expectTextContains(browserInstance, selector, snippet) {
  let lastText = "";
  let lastSource = "";
  await browserInstance.waitUntil(async () => {
    const text = await browserInstance.execute((targetSelector) => {
      return document.querySelector(targetSelector)?.textContent ?? "";
    }, selector);
    lastText = text;
    lastSource = await browserInstance.execute(() => window.__TIKZ_EDITOR_APP_TEST_API__.getSource());
    return text.includes(snippet);
  }, {
    timeout: 10_000,
    timeoutMsg: `Expected ${selector} text to include ${snippet}; lastText=${JSON.stringify(lastText)} lastSource=${JSON.stringify(lastSource)}`
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortOpen(port) {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

function resolveNativeWebkitDriver() {
  const envCandidates = [
    process.env.WEBKIT_WEBDRIVER_PATH,
    process.env.NATIVE_WEBDRIVER_PATH
  ].filter(Boolean);
  const pathCandidates = binariesFromPath(process.platform === "win32" ? ["WebKitWebDriver.exe"] : ["WebKitWebDriver"]);
  const fallbackCandidates = [
    "/usr/bin/WebKitWebDriver",
    "/usr/libexec/webkit2gtk-4.1/WebKitWebDriver",
    "/usr/libexec/webkit2gtk-4.0/WebKitWebDriver"
  ];

  const candidates = [...envCandidates, ...pathCandidates, ...fallbackCandidates];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function binariesFromPath(names) {
  const rawPath = process.env.PATH ?? "";
  if (!rawPath) {
    return [];
  }
  const entries = rawPath.split(path.delimiter).filter(Boolean);
  const candidates = [];
  for (const entry of entries) {
    for (const name of names) {
      candidates.push(path.join(entry, name));
    }
  }
  return candidates;
}
