/**
 * dsh-code-nav — 「选区 → 引用 chip」的运行时行为测试。
 *
 * 这些行为（插入 → 发送展开 / 点击落地）跑在浏览器 bundle 里，单测没法直接
 * import 模板文件。做法是**文本抽取模板的真实代码**再求值：
 *
 *  - 从 `scripts/client.template.js` 里切出 `//#region selection → draft` 与
 *    `//#region quote source`，拼成一个函数体；
 *  - 用 `new Function` 把模板依赖的 `__cn`（真 src 纯函数）/ `ctxLocale` /
 *    `localStorage` / `crypto` 作为参数注入 —— region 里 `typeof localStorage`
 *    的判断对参数同样成立，存储可以用内存假实现，测试无副作用；
 *  - 宿主（会话输入面板、input-trigger 服务、会话 scope 事件、betterSidebar）
 *    用假实现，维护「clipboard 投影草稿 + occurrences + command chip」的最小
 *    状态机，并记录调用。
 *
 * 覆盖：payload-in-ref（cnq1）在存储被清空 / 写不进时仍可发送与点击、旧 q…
 * ref 只读兼容、坏 ref 不崩、command chip 折叠、公开事件插入路径（无私有
 * actions）、自带纯文本 source、失败原因文案、跨会话点击、记录校验与 id 生成。
 * 零依赖，`node --test` 可直接跑。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { selectionPayload } from "../src/selection.js";
import { detectTextOf, needsLeadingSpace, hasQuoteMarkers, CHIP_PLACEHOLDER } from "../src/draft-coords.js";

// ---------- 从模板里抽取真实代码 ----------

/** 切出 `//#region <label>` 到对应 `//#endregion` 之间的源码。 */
function sliceRegion(source, label) {
  const start = source.indexOf("//#region " + label);
  assert.notEqual(start, -1, "模板里找不到 region: " + label);
  const end = source.indexOf("//#endregion", start);
  assert.notEqual(end, -1, "region 没有闭合: " + label);
  return source.slice(start, end);
}

const template = readFileSync(new URL("../scripts/client.template.js", import.meta.url), "utf8");
const extracted =
  sliceRegion(template, "selection → draft") + "\n" + sliceRegion(template, "quote source");

// 只把测试需要的符号交出去；状态对象直接暴露，便于断言注册结果。
const RETURN_SHAPE =
  "\nreturn {insertSelection, insertQuoteChip, insertFallbackChip, insertChipAtCaret, " +
  "insertChipViaCaret, insertChipViaEvent, appendToDraft, insertViaActions, insertTextViaEvent, " +
  "canUseInsertActions, detectProjectionOf, createQuoteSource, createQuoteTextSource, " +
  "resolveQuote, quoteId, makeQuoteRef, parseQuoteRef, quoteRecords, quoteSource, quoteTextSource, " +
  "QUOTE_SOURCE, QUOTE_TEXT_SOURCE, QUOTE_REF_PREFIX, QUOTE_STORE_KEY};";

/** 每个「模块实例」都重新求值一次模板代码（模拟两份 bundle 实例 / 刷新后页面）。 */
function makeRuntime(storage, cryptoImpl) {
  const __cn = { selectionPayload, detectTextOf, needsLeadingSpace, hasQuoteMarkers, CHIP_PLACEHOLDER };
  const ctxLocale = () => (key) => (key === "selection.chip" ? "引用 {where}" : key);
  const factory = new Function("__cn", "ctxLocale", "localStorage", "crypto", extracted + RETURN_SHAPE);
  return factory(__cn, ctxLocale, storage, cryptoImpl === undefined ? globalThis.crypto : cryptoImpl);
}

// ---------- 宿主假实现 ----------

/** 内存版 Storage。 */
function makeStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index) {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    get length() {
      return map.size;
    }
  };
}

/** 完全不可用的 Storage（隐私模式 / 配额拒绝）：新 chip 不该依赖它。 */
function makeBrokenStorage() {
  return {
    getItem() {
      throw new Error("storage denied");
    },
    setItem() {
      throw new Error("storage denied");
    },
    removeItem() {
      throw new Error("storage denied");
    },
    clear() {
      throw new Error("storage denied");
    },
    key() {
      return null;
    },
    length: 0
  };
}

const SAMPLE = {
  path: "C:\\proj\\src\\a.ts",
  cwd: "C:\\proj",
  lines: { start: 2, end: 3 },
  text: "const x = 1;\nconst y = 2;"
};
const SAMPLE_PAYLOAD = selectionPayload(SAMPLE.path, SAMPLE.cwd, SAMPLE.lines, SAMPLE.text);

/**
 * 会话输入面板假实现。维护宿主的两个投影：
 *  - `draft`（clipboard 投影：引用 chip / command chip / quote 都展开成 clipboardText）+ `occurrences`；
 *  - 光标 / span（detect 投影：引用 chip、command chip 与 quote 都折成 1 个 U+FFFC）。
 * command chip 的 clipboardText 是 `token.trimEnd()`，token 去掉 trimEnd 的
 * separator（通常 1 个空格）是 chip 之后另一个 **独立 TextNode**：它进 clipboard
 * 投影，也进 detect 投影，但不是 chip（command-chip-node.tsx:100 / runtime.ts:316-326）。
 * quote 节点（对话区「引用」）的 clipboard 投影是 `formatQuoteText`（每行 `> ` 前缀，
 * ui-primitives/src/markdown/quote-text.ts），detect 投影同样只占 1 个 U+FFFC，
 * 但 `occurrences` 不含它；宿主当前 `InputState` 也没有 `quotes` 字段，所以用
 * `quotes` 夹具 + `exposeQuotes` 开关分别模拟「看不见」与「将来暴露」两种宿主。
 * 行内更复杂的编辑不支持：被测代码只在光标处 / 文档末尾插入。
 * @param {{draft?:string, caret?:number, commandToken?:string, phase?:string, claim?:object,
 *          actions?:false|"insertTextOnly", reference?:boolean, refuseActions?:boolean,
 *          quotes?:Array<{offset:number, text:string}>, exposeQuotes?:boolean}} options
 */
function makeInput(options = {}) {
  const commandToken = typeof options.commandToken === "string" ? options.commandToken : "";
  // 宿主真值（见上方注释）：chip 只占 spelling；token 的 separator 是单独的自由文本，
  // 所以 detect 末尾 = 1 + (draft.length - spelling.length)。
  const commandSpelling = commandToken.trimEnd();
  // quote 夹具：`text` 是 clipboard 投影片段（真实宿主里是 `> …` 每行加前缀），
  // detect 投影里只占 1 个字符。offset 是 clipboard 坐标。
  const quotes = Array.isArray(options.quotes)
    ? options.quotes.map((q) => ({ offset: Number(q.offset), text: String(q.text) }))
    : [];
  const state = {
    draft: typeof options.draft === "string" ? options.draft : "",
    occurrences: [],
    draftRev: 0
  };
  const detectLength = () => {
    let len = state.draft.length;
    if (commandToken.length > 0 && state.draft.startsWith(commandSpelling)) {
      // chip(1) + spelling 之后的全部内容（separator + 用户输入）
      len += 1 - commandSpelling.length;
    }
    for (const occ of state.occurrences) len += 1 - occ.length;
    for (const quote of quotes) len += 1 - quote.text.length;
    return Math.max(0, len);
  };
  let caret = typeof options.caret === "number" ? options.caret : state.draft.length === 0 ? 0 : detectLength();
  const calls = { insertText: [], insertReference: [], notify: [], setDraft: [], captures: 0 };

  const sortedOccurrences = () => state.occurrences.slice().sort((a, b) => a.offset - b.offset);

  /** 文档里的「非文本单元」（command chip + 引用 chip + quote），按 detect 顺序。 */
  const units = () => {
    const out = [];
    let detectCursor = 0;
    let clipCursor = 0;
    if (commandToken.length > 0) {
      // chip 的 clipboard 只有 spelling（不含 separator），separator 留在普通文本里
      out.push({ detect: 0, clip: 0, length: commandSpelling.length });
      detectCursor = 1;
      clipCursor = commandSpelling.length;
    }
    const raw = [];
    for (const occ of sortedOccurrences()) raw.push({ clip: occ.offset, length: occ.length });
    for (const quote of quotes) raw.push({ clip: quote.offset, length: quote.text.length });
    raw.sort((a, b) => a.clip - b.clip);
    for (const unit of raw) {
      const plain = unit.clip - clipCursor;
      if (plain < 0) continue;
      detectCursor += plain;
      out.push({ detect: detectCursor, clip: unit.clip, length: unit.length });
      detectCursor += 1;
      clipCursor = unit.clip + unit.length;
    }
    return out;
  };

  /** detect 坐标 → clipboard 坐标。 */
  const clipOffsetOf = (detectAt) => {
    let detectCursor = 0;
    let clipCursor = 0;
    for (const unit of units()) {
      const plain = unit.detect - detectCursor;
      if (detectAt <= detectCursor + plain) return clipCursor + (detectAt - detectCursor);
      if (detectAt <= unit.detect + 1) return unit.clip + unit.length;
      detectCursor = unit.detect + 1;
      clipCursor = unit.clip + unit.length;
    }
    return Math.min(clipCursor + Math.max(0, detectAt - detectCursor), state.draft.length);
  };

  /** 在 detect 坐标插入纯文本（不带 occurrence）。 */
  const insertPlainAt = (detectAt, text) => {
    const clipAt = clipOffsetOf(detectAt);
    state.draft = state.draft.slice(0, clipAt) + text + state.draft.slice(clipAt);
    for (const occ of state.occurrences) {
      if (occ.offset >= clipAt) occ.offset += text.length;
    }
    for (const quote of quotes) {
      if (quote.offset >= clipAt) quote.offset += text.length;
    }
    state.occurrences.sort((a, b) => a.offset - b.offset);
    return clipAt;
  };

  const insertText = (text, span) => {
    calls.insertText.push({ text, span: { ...span } });
    assert.equal(span.start, span.end, "假输入框只实现折叠光标");
    if (options.refuseActions === true) return false;
    if (span.draftRev !== state.draftRev) return false;
    insertPlainAt(span.start, text);
    caret = span.start + text.length;
    state.draftRev += 1;
    return true;
  };

  const input = {
    state: {
      getSnapshot() {
        const snapshot = {
          draft: state.draft,
          draftRev: state.draftRev,
          occurrences: state.occurrences.map((o) => ({ offset: o.offset, length: o.length })),
          phase: options.phase,
          claim: options.claim
        };
        // 当前宿主 InputState 没有 quotes；exposeQuotes 打开时模拟「将来暴露」的
        // 精确折叠分支（DraftQuote = {offset, length, text}，text 是原始选中文本）。
        if (options.exposeQuotes === true) {
          snapshot.quotes = quotes.map((q) => ({ offset: q.offset, length: q.text.length, text: q.text }));
        }
        return snapshot;
      }
    },
    notify(level, text) {
      calls.notify.push({ level, text });
    },
    setDraft(next) {
      calls.setDraft.push(String(next));
      state.draft = String(next);
      state.occurrences = [];
      state.draftRev += 1;
      caret = state.draft.length;
    },
    /** 供假 ctx.emit("slash/input-insert-text") 调用：等价于宿主按 detect 坐标插文本。 */
    emitInsert(payload) {
      const span = payload !== undefined && payload !== null && payload.span !== undefined ? payload.span : {};
      const text = payload !== undefined && payload !== null && typeof payload.text === "string" ? payload.text : "";
      if (typeof span.draftRev !== "number" || span.draftRev !== state.draftRev) return false;
      if (typeof span.start !== "number" || typeof span.end !== "number" || span.start !== span.end) return false;
      insertPlainAt(span.start, text);
      caret = span.start + text.length;
      state.draftRev += 1;
      return true;
    },
    /** 测试夹具：把光标放到 detect 坐标（模拟用户在草稿中间）。 */
    setCaret(value) {
      caret = value;
    },
    getCaret() {
      return caret;
    }
  };

  if (options.actions === "insertTextOnly") {
    input.actions = { insertText };
  } else if (options.actions !== false) {
    input.actions = {
      captureInsertion() {
        calls.captures += 1;
        return { start: caret, end: caret, draftRev: state.draftRev };
      },
      insertText
    };
  }

  if (options.reference !== false) {
    input.insertReference = (chip, span) => {
      calls.insertReference.push({ chip, span: { ...span } });
      assert.equal(span.start, span.end, "假输入框只实现折叠光标");
      if (span.draftRev !== state.draftRev) return false;
      const clipAt = clipOffsetOf(span.start);
      const inserted = chip.clipboardText;
      state.draft = state.draft.slice(0, clipAt) + inserted + state.draft.slice(clipAt);
      for (const occ of state.occurrences) {
        if (occ.offset >= clipAt) occ.offset += inserted.length;
      }
      for (const quote of quotes) {
        if (quote.offset >= clipAt) quote.offset += inserted.length;
      }
      state.occurrences.push({ offset: clipAt, length: inserted.length });
      state.occurrences.sort((a, b) => a.offset - b.offset);
      caret = span.start + 1;
      state.draftRev += 1;
      return true;
    };
  }

  return { input, state, calls };
}

/**
 * 插件上下文假实现。
 * @param {{input:object, sessionId:string, knownSessions:string[], triggers?:boolean,
 *          rejectSources?:string[], triggerError?:Error, emitNoop?:boolean,
 *          openFileThrows?:boolean}} options
 */
function makeContext(options) {
  const state = { registered: {}, registerCalls: 0, openFile: [], events: [] };
  const triggers = options.triggers === false
    ? undefined
    : {
      registerSource(source) {
        state.registerCalls += 1;
        if (options.triggerError !== undefined) throw options.triggerError;
        if (Array.isArray(options.rejectSources) && options.rejectSources.includes(source.name)) {
          // 非重复注册的失败：消息里不能带 source 名，否则会被当成 duplicate。
          throw new Error("registration unavailable");
        }
        state.registered[source.name] = source;
        return () => {
          if (state.registered[source.name] === source) delete state.registered[source.name];
        };
      }
    };
  const input = options.input;
  const ctx = {
    sessions: {
      scope(sessionId) {
        if (!options.knownSessions.includes(sessionId)) return undefined;
        return {
          sessionId: sessionId,
          emit(name, payload) {
            state.events.push({ name, payload });
            if (name !== "slash/input-insert-text") return;
            if (options.emitNoop === true) return;
            input.emitInsert(payload);
          }
        };
      }
    },
    get(name) {
      if (name === "conversation") return { input: { for: () => input } };
      if (name === "inputTriggers") return triggers;
      return undefined;
    },
    betterSidebar: {
      openFile(scope, path, focus, lines) {
        if (options.openFileThrows === true) throw new Error("host openFile exploded");
        state.openFile.push([scope, path, focus, lines]);
      }
    }
  };
  return { ctx, state };
}

/** 一条完整测试环境：一份存储 + 一个模块实例 + 假宿主。 */
function makeHarness(options = {}) {
  const storage = options.storage ?? makeStorage();
  const sessionId = options.sessionId ?? "s1";
  const knownSessions = options.knownSessions ?? [sessionId];
  const built = makeInput(options.input);
  const context = makeContext({
    input: built.input,
    sessionId,
    knownSessions,
    triggers: options.triggers,
    rejectSources: options.rejectSources,
    triggerError: options.triggerError,
    emitNoop: options.emitNoop,
    openFileThrows: options.openFileThrows
  });
  return {
    storage,
    runtime: makeRuntime(storage, options.crypto),
    sessionId,
    ctx: context.ctx,
    state: context.state,
    input: built.input,
    inputState: built.state,
    calls: built.calls
  };
}

/** 读回 localStorage 里的记录数组。 */
function readStore(harness) {
  const raw = harness.storage.getItem(harness.runtime.QUOTE_STORE_KEY);
  return raw === null ? [] : JSON.parse(raw);
}

/** 造一条旧版（存储里的）引用记录。 */
function legacyRecord(overrides = {}) {
  return {
    id: "q1-abcd",
    sessionId: "s1",
    n: 1,
    path: SAMPLE.path,
    cwd: SAMPLE.cwd,
    lines: { start: 2, end: 3 },
    label: "引用 a.ts L2-3",
    clipboardText: SAMPLE_PAYLOAD.header,
    text: SAMPLE_PAYLOAD.text,
    ...overrides
  };
}

// ---------- payload-in-ref：插入 / 存储 / codec ----------

test("insertQuoteChip：空草稿落成自包含 cnq1 chip，codec 与投影逐字一致", async () => {
  const h = makeHarness();
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);

  // 空草稿不需要补分隔空格
  assert.equal(h.calls.insertText.length, 0, "空草稿不应该先插空格");
  assert.equal(h.calls.insertReference.length, 1);
  const { chip, span } = h.calls.insertReference[0];
  assert.equal(chip.source, h.runtime.QUOTE_SOURCE);
  assert.equal(chip.label, "引用 a.ts L2-3");
  assert.equal(chip.clipboardText, "src/a.ts:2-3");
  assert.equal(span.start, 0);

  // ref 自包含：cnq1: + JSON，字段齐全且没有 legacy id
  assert.ok(chip.ref.startsWith(h.runtime.QUOTE_REF_PREFIX), "ref 不是 cnq1 前缀：" + chip.ref);
  const payload = h.runtime.parseQuoteRef(chip.ref);
  assert.notEqual(payload, undefined, "cnq1 ref 解析失败");
  assert.equal(payload.v, 1);
  assert.equal(payload.path, SAMPLE.path);
  assert.equal(payload.cwd, SAMPLE.cwd);
  assert.deepEqual(payload.lines, { start: 2, end: 3 });
  assert.equal(payload.label, "引用 a.ts L2-3");
  assert.equal(payload.clipboardText, "src/a.ts:2-3");
  assert.equal(payload.text, SAMPLE_PAYLOAD.text);

  // 新 chip 不写 localStorage
  assert.deepEqual(readStore(h), [], "新 chip 不应写 localStorage");

  // 输入框拿到 chip 的 clipboard 投影 + 一条 occurrence
  const snapshot = h.input.state.getSnapshot();
  assert.equal(snapshot.draft, "src/a.ts:2-3");
  assert.deepEqual(snapshot.occurrences, [{ offset: 0, length: "src/a.ts:2-3".length }]);

  // 发送时展开成围栏块、剪贴板投影是 header
  const source = h.state.registered[h.runtime.QUOTE_SOURCE];
  assert.equal(typeof source, "object");
  assert.equal(source.name, h.runtime.QUOTE_SOURCE);
  assert.equal(await source.codec.serialize(chip.ref), SAMPLE_PAYLOAD.text);
  assert.equal(source.codec.clipboardText(chip.ref), SAMPLE_PAYLOAD.header);

  // 记录失效时必须让宿主拒绝发送，绝不静默降级
  await assert.rejects(() => source.codec.serialize("q-missing"), /no longer available/);
});

test("insertQuoteChip：非空草稿先补一个空格，chip 落在草稿末尾之后", () => {
  const h = makeHarness({ input: { draft: "hello", caret: 5 } });
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);

  assert.equal(h.calls.insertText.length, 1, "应当恰好补一个分隔空格");
  assert.equal(h.calls.insertText[0].text, " ");
  assert.equal(h.calls.insertText[0].span.start, 5);

  assert.equal(h.calls.insertReference.length, 1);
  const { span } = h.calls.insertReference[0];
  assert.equal(span.start, "hello".length + 1);
  assert.equal(h.input.state.getSnapshot().draft, "hello " + SAMPLE_PAYLOAD.header);
  assert.deepEqual(readStore(h), []);
});

test("payload-in-ref：localStorage 清空 / 写不进 / 新实例都不影响发送与点击", async () => {
  // 1) 清空存储后仍能展开、点击：载荷在 ref 里
  const h = makeHarness();
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  const ref = h.calls.insertReference[0].chip.ref;
  h.storage.clear();
  const source = h.runtime.createQuoteSource(h.ctx);
  assert.equal(await source.codec.serialize(ref), SAMPLE_PAYLOAD.text);
  assert.equal(source.codec.clipboardText(ref), SAMPLE_PAYLOAD.header);
  assert.equal(source.openReference({ sessionId: "s1" }, { ref }), true);
  assert.deepEqual(h.state.openFile[0][3], { line: 2, lineEnd: 3 });

  // 2) 全新实例（刷新 / 另一标签页）、空存储：同样能解析
  const fresh = makeHarness({ storage: h.storage });
  const freshSource = fresh.runtime.createQuoteSource(fresh.ctx);
  assert.equal(await freshSource.codec.serialize(ref), SAMPLE_PAYLOAD.text);
  assert.equal(freshSource.openReference({ sessionId: "s1" }, { ref }), true);
  assert.equal(fresh.state.openFile[0][1], SAMPLE.path);

  // 3) 存储完全不可写（隐私模式 / 配额拒绝）：新 chip 照样插入成功
  const broken = makeHarness({ storage: makeBrokenStorage() });
  assert.equal(broken.runtime.insertQuoteChip(broken.ctx, broken.sessionId, SAMPLE), true);
  const brokenRef = broken.calls.insertReference[0].chip.ref;
  const brokenSource = broken.runtime.createQuoteSource(broken.ctx);
  assert.equal(await brokenSource.codec.serialize(brokenRef), SAMPLE_PAYLOAD.text);
  assert.equal(brokenSource.openReference({ sessionId: "s1" }, { ref: brokenRef }), true);
});

test("openReference：新 chip 用当前会话打开；记录缺失时每次点击只提示一条", () => {
  const h = makeHarness({ knownSessions: ["s1", "s2"] });
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  const ref = h.calls.insertReference[0].chip.ref;
  const source = h.runtime.createQuoteSource(h.ctx);

  // 跨会话点击：用点击时的 session + ref 里的 cwd 打开（F17）
  assert.equal(source.openReference({ sessionId: "s2" }, { ref }), true);
  assert.deepEqual(h.state.openFile[0], [
    { sessionId: "s2", cwd: SAMPLE.cwd },
    SAMPLE.path,
    undefined,
    { line: 2, lineEnd: 3 }
  ]);
  assert.deepEqual(h.calls.notify, [], "ref 自包含时不该提示缺失");

  // 缺失记录：不打开文件，只发一条 error 提示
  assert.equal(source.openReference({ sessionId: "s1" }, { ref: "q-missing" }), false);
  assert.equal(h.state.openFile.length, 1);
  assert.deepEqual(h.calls.notify, [{ level: "error", text: "selection.chipMissing" }]);
  // 再点一次（记录仍缺）：再提示一条，不会静默
  assert.equal(source.openReference({ sessionId: "s1" }, { ref: "q-missing" }), false);
  assert.equal(h.calls.notify.length, 2);
});

test("旧版 q… ref：只读存储仍能展开，且跨会话点击不再被拒（F17）", async () => {
  const h = makeHarness({ knownSessions: ["s1", "s2"] });
  const record = legacyRecord();
  h.storage.setItem(h.runtime.QUOTE_STORE_KEY, JSON.stringify([record]));

  assert.deepEqual(h.runtime.resolveQuote(record.id), record);
  const source = h.runtime.createQuoteSource(h.ctx);
  assert.equal(await source.codec.serialize(record.id), record.text);
  assert.equal(source.codec.clipboardText(record.id), record.clipboardText);
  // 未知 ref：clipboardText 原样返回，serialize 拒绝（阻止发送）
  assert.equal(source.codec.clipboardText("q-nope"), "q-nope");
  await assert.rejects(() => source.codec.serialize("q-nope"), /no longer available/);

  // 另一个会话点同一枚旧 chip：用当前 session + 记录里的 cwd 打开，不拒绝
  assert.equal(source.openReference({ sessionId: "s2" }, { ref: record.id }), true);
  assert.deepEqual(h.state.openFile[0], [
    { sessionId: "s2", cwd: SAMPLE.cwd },
    SAMPLE.path,
    undefined,
    { line: 2, lineEnd: 3 }
  ]);
  assert.deepEqual(h.calls.notify, []);
});

test("旧记录校验（F16）：坏 cwd / lines / 类型 / 长度整条跳过，损坏 JSON 不抛", () => {
  const h = makeHarness();
  const good = legacyRecord({ id: "q-good" });
  const bad = [
    legacyRecord({ id: "q-bad-cwd", cwd: 42 }),
    legacyRecord({ id: "q-bad-lines", lines: "2-3" }),
    legacyRecord({ id: "q-bad-line-start", lines: { start: "2", end: 3 } }),
    legacyRecord({ id: "q-bad-text", text: 123 }),
    legacyRecord({ id: "q-bad-path", path: "" }),
    legacyRecord({ id: "q-bad-id", id: "" })
  ];
  h.storage.setItem(h.runtime.QUOTE_STORE_KEY, JSON.stringify([...bad, good]));
  assert.notEqual(h.runtime.resolveQuote("q-good"), undefined);
  for (const record of bad) {
    assert.equal(h.runtime.resolveQuote(record.id), undefined, "坏记录未被跳过：" + record.id);
  }
  // 存储里是损坏 JSON：解析按空处理，调用方拿到 undefined 而不是异常
  h.storage.setItem(h.runtime.QUOTE_STORE_KEY, "{not json");
  const fresh = makeHarness({ storage: h.storage });
  assert.equal(fresh.runtime.resolveQuote("q-good"), undefined);
  // 记录不够合法时旧 ref 的 serialize 仍走「拒绝发送」
  return assert.rejects(() => fresh.runtime.createQuoteSource(fresh.ctx).codec.serialize("q-good"), /no longer available/);
});

test("坏 cnq1 ref：解析不崩，serialize 拒绝，clipboardText 原样返回", async () => {
  const h = makeHarness();
  const source = h.runtime.createQuoteSource(h.ctx);
  const broken = [
    "cnq1:{not json",
    h.runtime.QUOTE_REF_PREFIX + JSON.stringify({ v: 2, path: "x", label: "l", clipboardText: "c", text: "t" }),
    h.runtime.QUOTE_REF_PREFIX + JSON.stringify({ v: 1, path: "x", label: "l", clipboardText: "c" }),
    h.runtime.QUOTE_REF_PREFIX + JSON.stringify({ v: 1, path: "x", label: "l", clipboardText: "c", text: "t", lines: "2-3" })
  ];
  for (const ref of broken) {
    assert.equal(h.runtime.parseQuoteRef(ref), undefined, "坏 ref 不应解析成功：" + ref);
    await assert.rejects(() => source.codec.serialize(ref), /no longer available/);
    assert.equal(source.codec.clipboardText(ref), ref);
  }
  // cwd / lines 缺省时 JSON 里就不写这两个键
  const minimal = h.runtime.makeQuoteRef({
    path: "C:\\proj\\x.ts",
    label: "引用 x.ts",
    clipboardText: "x.ts",
    text: "```x.ts\nx\n```"
  });
  const parsed = h.runtime.parseQuoteRef(minimal);
  assert.notEqual(parsed, undefined);
  assert.ok(!("cwd" in parsed), "cwd 缺省时不应写进 ref");
  assert.ok(!("lines" in parsed), "lines 缺省时不应写进 ref");
});

test("insertQuoteChip：文件名里的 $& / $` / $' / $$ 原样进标签", () => {
  for (const basename of ["a$&b.ts", "a$`b.ts", "a$'b.ts", "a$$b.ts"]) {
    const h = makeHarness();
    const sel = {
      path: "C:\\proj\\src\\" + basename,
      cwd: "C:\\proj",
      lines: { start: 2, end: 3 },
      text: "x"
    };
    assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, sel), true);
    const { chip } = h.calls.insertReference[0];
    assert.ok(chip.label.includes(basename), "标签被替换模式弄花了：" + chip.label);
    assert.ok(!chip.label.includes("{where}"), "标签残留占位符：" + chip.label);
    assert.equal(h.runtime.parseQuoteRef(chip.ref).label, chip.label);
  }
});

// ---------- 降级链 / 公开事件通道 ----------

test("无 input-trigger 服务：跳过两档 chip，直接纯文本并提示原因（F15）", () => {
  const h = makeHarness({ triggers: false });
  assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), true);

  assert.equal(h.calls.insertReference.length, 0, "没有 source 时不应插 chip");
  assert.equal(h.input.state.getSnapshot().draft, SAMPLE_PAYLOAD.text);
  assert.deepEqual(h.calls.notify, [{ level: "info", text: "selection.noChipChannel" }]);
  assert.deepEqual(readStore(h), []);
});

test("中间档（F8）：没有 quote source 时改用自带的 codeNavQuoteText chip", async () => {
  const h = makeHarness({ rejectSources: ["codeNavQuote"] });
  assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), true);

  assert.equal(h.calls.insertReference.length, 1);
  const { chip } = h.calls.insertReference[0];
  assert.equal(chip.source, h.runtime.QUOTE_TEXT_SOURCE);
  assert.equal(chip.ref, SAMPLE_PAYLOAD.text, "纯文本 chip 的 ref 就是发送时要展开的文本");
  assert.equal(chip.clipboardText, SAMPLE_PAYLOAD.header);
  assert.equal(chip.appearance, undefined, "纯文本 chip 不需要 appearance");
  assert.equal(h.input.state.getSnapshot().draft, SAMPLE_PAYLOAD.header);
  assert.deepEqual(readStore(h), [], "纯文本 chip 不写存储");

  // 自带 source 的恒等 codec：ref 原样进剪贴板 / 发送文本
  const textSource = h.state.registered[h.runtime.QUOTE_TEXT_SOURCE];
  assert.equal(textSource.codec.clipboardText(chip.ref), chip.ref);
  assert.equal(await textSource.codec.serialize(chip.ref), chip.ref);
  // 失败原因不该是「输入框忙」
  assert.deepEqual(h.calls.notify, []);
});

test("F5：actions 只有 insertText（缺 captureInsertion）时 chip 走公开事件通道", () => {
  const h = makeHarness({ input: { actions: "insertTextOnly", draft: "hi" } });
  // 整条 insertSelection 必须成功（先落可点击 chip，不因为缺私有接口而整档失败）
  assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), true);

  // 空格与 chip 都走事件 / insertReference，不碰私有 captureInsertion
  assert.equal(h.calls.captures, 0);
  assert.equal(h.calls.insertText.length, 0);
  assert.equal(h.state.events.length, 1);
  assert.equal(h.state.events[0].name, "slash/input-insert-text");
  assert.equal(h.state.events[0].payload.text, " ");
  assert.deepEqual(h.state.events[0].payload.span, { draftRev: 0, start: 2, end: 2 });

  assert.equal(h.calls.insertReference.length, 1);
  const { chip, span } = h.calls.insertReference[0];
  assert.equal(span.draftRev, 1, "chip 必须用空格事件之后的 draftRev");
  assert.equal(span.start, 3, "chip 必须落在折叠后的文档末尾");
  assert.equal(h.input.state.getSnapshot().draft, "hi " + chip.clipboardText);
});

test("F5：actions 缺失时纯文本插入走公开事件通道", () => {
  const empty = makeHarness({ input: { actions: false, reference: false } });
  assert.equal(empty.runtime.insertSelection(empty.ctx, empty.sessionId, SAMPLE), true);
  assert.equal(empty.input.state.getSnapshot().draft, SAMPLE_PAYLOAD.text);
  assert.equal(empty.calls.setDraft.length, 0, "有事件通道时不该整串回写草稿");
  assert.deepEqual(empty.state.events[0].payload, {
    text: SAMPLE_PAYLOAD.text,
    span: { draftRev: 0, start: 0, end: 0 }
  });

  // 非空草稿：事件通道自己补一个前导空格（只追加到末尾）
  const filled = makeHarness({ input: { actions: false, reference: false, draft: "x" } });
  assert.equal(filled.runtime.insertSelection(filled.ctx, filled.sessionId, SAMPLE), true);
  assert.equal(filled.state.events[0].payload.text, " " + SAMPLE_PAYLOAD.text);
  assert.equal(filled.input.state.getSnapshot().draft, "x " + SAMPLE_PAYLOAD.text);
});

test("事件插入的成功判定：draftRev 不前进就算失败，回退 setDraft", () => {
  const h = makeHarness({ input: { actions: false, reference: false }, emitNoop: true });
  assert.equal(h.runtime.insertTextViaEvent(h.ctx, h.sessionId, "X"), false, "emit 无效时必须判失败");
  assert.equal(h.state.events.length, 1, "事件确实发出过一次");

  // appendToDraft 继续降级到旧版整串回写
  assert.equal(h.runtime.appendToDraft(h.ctx, h.sessionId, "X"), true);
  assert.equal(h.calls.setDraft.length, 1);
  assert.equal(h.input.state.getSnapshot().draft, "X");
});

test("F10：command chip 折叠后 leading-space / 插入点都用 detect 坐标", () => {
  const token = "/review ";
  const h = makeHarness({
    input: { draft: token + "hello", caret: 7, commandToken: token, phase: "claimed", claim: { token } }
  });
  const before = h.input.state.getSnapshot();
  // 宿主真值：clipboard "/review hello" → detect = U+FFFC + " " + "hello"（7 字符）
  assert.equal(h.runtime.detectProjectionOf(before).text, CHIP_PLACEHOLDER + " hello");

  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  assert.equal(h.calls.insertText.length, 1);
  // 7 = detect 坐标的文档末尾（chip 1 + separator 1 + "hello" 5）；旧模型会算成 6
  assert.equal(h.calls.insertText[0].span.start, 7);
  const { span } = h.calls.insertReference[0];
  assert.equal(span.start, 8, "空格之后 chip 落在 detect 坐标 8（旧模型 7）");
  assert.equal(h.input.state.getSnapshot().draft, token + "hello " + SAMPLE_PAYLOAD.header);
});

test("F10b：command chip 之后只有 separator（rest 为空）时不再多补一个空格", () => {
  const token = "/goal ";
  const h = makeHarness({
    input: { draft: token, commandToken: token, phase: "claimed", claim: { token } }
  });
  // 宿主投影：chip + separator = "\uFFFC "（2 字符），末尾前一个字符已经是空格
  const projection = h.runtime.detectProjectionOf(h.input.state.getSnapshot());
  assert.equal(projection.text, CHIP_PLACEHOLDER + " ");
  assert.equal(projection.text.length, 2, "文档末尾 detect 坐标是 2（含 separator）");
  assert.equal(projection.command, true);

  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  assert.equal(h.calls.insertText.length, 0, "separator 已经存在，不能再补分隔空格");
  const { span } = h.calls.insertReference[0];
  assert.equal(span.start, 2, "chip 落在 separator 之后");
  assert.equal(h.input.state.getSnapshot().draft, token + SAMPLE_PAYLOAD.header);
});

test("F10c：submitting 相位的 claim 同样折叠；事件通道追加落在 separator 之后", () => {
  const token = "/goal ";
  const h = makeHarness({
    input: { draft: token, commandToken: token, phase: "submitting", claim: { token }, actions: false }
  });
  const projection = h.runtime.detectProjectionOf(h.input.state.getSnapshot());
  assert.equal(projection.text, CHIP_PLACEHOLDER + " ", "submitting 相位也要折叠 command chip（C-1）");
  assert.equal(projection.command, true);

  assert.equal(h.runtime.insertTextViaEvent(h.ctx, h.sessionId, "X"), true);
  const event = h.state.events[0];
  assert.equal(event.name, "slash/input-insert-text");
  assert.equal(event.payload.text, "X", "separator 已在草稿里，不应再补前导空格");
  // 旧模型把 command chip 当 token.length 个字符，会算出坐标 1，落进 token 中间
  assert.deepEqual(event.payload.span, { draftRev: 0, start: 2, end: 2 }, "追加坐标在 separator 之后");
  assert.equal(h.input.state.getSnapshot().draft, token + "X", "X 应落在 separator 之后");
});

test("F10d：separator 被删掉时 command chip 只折成 1 个字符", () => {
  const token = "/goal ";
  const h = makeHarness({
    input: { draft: "/goal", commandToken: token, phase: "claimed", claim: { token } }
  });
  const projection = h.runtime.detectProjectionOf(h.input.state.getSnapshot());
  assert.equal(projection.text, CHIP_PLACEHOLDER, "draft 不以 token 开头时不能再凭空补 separator");
  assert.equal(projection.command, true);
});

test("F11：paddedInsert 用 detect 投影判断前后空白（不拿 clipboard 坐标切）", () => {
  const h = makeHarness({ input: { draft: "" } });
  const { input } = h;
  // 造草稿：ab + chip + " cd"，再把光标放到 detect 5（空格之后、cd 之前）
  assert.equal(input.actions.insertText("ab", { start: 0, end: 0, draftRev: 0 }), true);
  assert.equal(input.insertReference({ clipboardText: "CHIP" }, { start: 2, end: 2, draftRev: 1 }), true);
  assert.equal(input.actions.insertText(" cd", { start: 3, end: 3, draftRev: 2 }), true);
  input.setCaret(4);
  assert.equal(h.input.state.getSnapshot().draft, "abCHIP cd");

  assert.equal(h.runtime.appendToDraft(h.ctx, h.sessionId, "X"), true);
  const last = h.calls.insertText[h.calls.insertText.length - 1];
  // detect 投影 "ab\uFFFC cd"：左侧是空格 → 不补左空格；右侧是 "cd" → 补右空格
  assert.equal(last.text, "X ", "paddedInsert 没有按 detect 投影判断空白");
});

// ---------- F14 / F15 / F16 ----------

test("F14：重复注册的错误消息只含 source 名也视为已注册", () => {
  const h = makeHarness({ triggerError: new Error('cannot register "codeNavQuote": source is taken') });
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  assert.equal(h.runtime.quoteSource.ready, true);
  assert.equal(h.runtime.quoteSource.disposer, undefined, "借用的 source 不应有 disposer");
  assert.equal(h.runtime.quoteSource.borrowed, true);
});

test("F15：composer 明确拒绝时提示 insertRefused，而不是无 chip 通道", () => {
  const h = makeHarness({ input: { reference: false, refuseActions: true } });
  assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), false);
  assert.deepEqual(h.calls.notify, [{ level: "error", text: "selection.insertRefused" }]);
});

// ---------- CLIENT-2：冻结相位（sending / submitting / adjudicating） ----------

test("CLIENT-2：冻结相位下 insertSelection 一个字节都不写", () => {
  // 宿主只给 insertReference 加了相位守卫，actions.insertText 与事件通道都没有：
  // 旧实现会先补一个分隔空格、再把围栏块写进正在发送的草稿，还上报成功。
  for (const phase of ["sending", "submitting", "adjudicating"]) {
    const h = makeHarness({ input: { draft: "hello", phase: phase } });
    const before = h.input.state.getSnapshot();
    assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), false, phase);
    assert.equal(h.input.state.getSnapshot().draft, before.draft, phase + "：草稿内容不能被改动");
    assert.equal(h.input.state.getSnapshot().draftRev, before.draftRev, phase + "：不能产生任何编辑版本");
    assert.deepEqual(h.calls.insertText, [], phase + "：不能写分隔空格");
    assert.deepEqual(h.calls.insertReference, [], phase + "：不能调 insertReference");
    assert.deepEqual(h.calls.setDraft, [], phase + "：不能整串回写草稿");
    assert.deepEqual(h.state.events, [], phase + "：不能走公开事件通道");
    assert.deepEqual(h.calls.notify, [{ level: "error", text: "selection.insertRefused" }], phase);
  }
});

test("CLIENT-2：可编辑相位（plain / claimed / 无 phase 的旧宿主）照常插入", () => {
  for (const phase of ["plain", "claimed", undefined]) {
    const h = makeHarness({ input: { draft: "hello", phase: phase } });
    assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), true, String(phase));
    assert.ok(h.calls.insertReference.length > 0 || h.calls.insertText.length > 0, String(phase));
    assert.deepEqual(h.calls.notify, [], String(phase));
  }
});

test("CLIENT-2：读不到快照时按「不是冻结相位」处理（旧宿主兼容）", () => {
  // 旧宿主没有 phase、或 getSnapshot 抛错：不能把插入整个拦死，继续走原有降级链。
  const h = makeHarness({ input: { draft: "hello", phase: "sending" } });
  h.input.state.getSnapshot = () => {
    throw new Error("state unavailable");
  };
  assert.equal(h.runtime.insertSelection(h.ctx, h.sessionId, SAMPLE), true);
  // 自包含 ref 仍可插入（读快照失败不等于冻结）
  assert.equal(h.calls.insertReference.length, 1);
  assert.deepEqual(h.calls.notify, []);
});

test("F16：quoteId 优先 crypto.randomUUID，退化时是 n + 8 位随机", () => {
  const real = makeRuntime(makeStorage(), globalThis.crypto);
  const a = real.quoteId(3);
  const b = real.quoteId(3);
  assert.match(a, /^q3-/, "id 前缀应保留编号：" + a);
  assert.ok(a.length > 20, "应使用 randomUUID 而不是 4 位后缀：" + a);
  assert.notEqual(a, b, "两次生成的 id 不应相同");

  const fallback = makeRuntime(makeStorage(), null).quoteId(7);
  assert.match(fallback, /^q7-[0-9a-z]{8}$/, "退化路径应为 8 位随机后缀：" + fallback);
});

// ---------- C-2：草稿里有 quote 时 detect 投影不可信 ----------

/**
 * quote 节点的 clipboard 投影（宿主 formatQuoteText：每行加 `"> "` 前缀）。
 * 选中文本是 `"  q"`（缩进代码），于是投影以 `">   q"` 开头 —— 插件按
 * occurrences 折出来的 detect 文本在插入点前一位恰好是空格，真实 detect 里
 * 却是普通字符：这正是「少补一个空格 → chip 粘在文字后面」的那类错位。
 */
const QUOTE_CLIP = ">   q";
const QUOTE_FIXTURE = { offset: 0, text: QUOTE_CLIP };
const QUOTE_DRAFT = QUOTE_CLIP + " x";

test("C-2a：草稿含未暴露的 quote 时投影不可信，chip 前保守补空格", () => {
  const h = makeHarness({ input: { draft: QUOTE_DRAFT, caret: 3, quotes: [QUOTE_FIXTURE] } });
  const projection = h.runtime.detectProjectionOf(h.input.state.getSnapshot());
  // 真实宿主：quote 折成 1 个 U+FFFC → detect 是 "￼ x"（3 字符）
  assert.equal(hasQuoteMarkers(QUOTE_DRAFT), true, "quote 的 clipboard 投影每行以 `> ` 开头");
  assert.equal(projection.trusted, false, "看不到 quotes 时必须把投影标记成不可信");
  assert.equal(projection.text, QUOTE_DRAFT, "旧投影把 quote 正文整段算进去，比真实 detect 长");
  // 不可信投影上的空白判断会漏掉这个空格（宿主真值需要补），所以不能再用它
  assert.equal(needsLeadingSpace(projection.text, 3), false);

  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  assert.equal(h.calls.insertText.length, 1, "不可信时必须补一个分隔空格");
  assert.equal(h.calls.insertText[0].text, " ");
  const { span } = h.calls.insertReference[0];
  assert.equal(span.start, 4, "空格之后 chip 落在 detect 4");
  assert.equal(h.input.state.getSnapshot().draft, QUOTE_DRAFT + " " + SAMPLE_PAYLOAD.header);
});

test("C-2b：宿主暴露 quotes 时精确折叠（quote 只占 1 个 U+FFFC）", () => {
  const h = makeHarness({
    input: { draft: QUOTE_DRAFT, caret: 3, quotes: [QUOTE_FIXTURE], exposeQuotes: true }
  });
  const projection = h.runtime.detectProjectionOf(h.input.state.getSnapshot());
  assert.equal(projection.trusted, true, "quotes 可用时投影是精确的");
  assert.equal(projection.text, CHIP_PLACEHOLDER + " x");
  assert.equal(projection.text.length, 3, "quote 在 detect 投影里只占 1 个字符");
  // 精确投影上看到的「前一个字符」与宿主一致 → 需要补空格
  assert.equal(needsLeadingSpace(projection.text, 3), true);

  // 与 C-2a 同一夹具：插入结果一致（保守补偿没有多补）
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  assert.equal(h.calls.insertText.length, 1);
  assert.equal(h.calls.insertText[0].text, " ");
  assert.equal(h.calls.insertReference[0].span.start, 4);
  assert.equal(h.input.state.getSnapshot().draft, QUOTE_DRAFT + " " + SAMPLE_PAYLOAD.header);

  // quote 紧贴插入点（detect 1，紧跟 U+FFFC 之后）：精确折叠下 chip 落在 quote 后
  const tight = makeHarness({
    input: { draft: QUOTE_CLIP + " x", caret: 1, quotes: [QUOTE_FIXTURE], exposeQuotes: true }
  });
  assert.equal(tight.runtime.insertQuoteChip(tight.ctx, tight.sessionId, SAMPLE), true);
  assert.equal(tight.calls.insertText[0].text, " ", "U+FFFC 之后需要分隔空格");
  assert.equal(tight.calls.insertReference[0].span.start, 2, "chip 在 quote 后一个空格之后");
});

test("C-2c：草稿没有 quote 标记时投影仍可信，行为与修复前一致", () => {
  // `> ` 必须出现在行首；行中的 `>` 不是 quote 痕迹
  assert.equal(hasQuoteMarkers("a > b"), false);
  assert.equal(hasQuoteMarkers("x\n> y"), true);
  assert.equal(hasQuoteMarkers(""), false);
  assert.equal(hasQuoteMarkers(undefined), false);

  const plain = makeHarness({ input: { draft: "hello", caret: 5 } });
  const projection = plain.runtime.detectProjectionOf(plain.input.state.getSnapshot());
  assert.equal(projection.trusted, true);
  assert.equal(projection.text, "hello");
  // 与修复前的既有断言（"非空草稿先补一个空格"）完全一致
  assert.equal(plain.runtime.insertQuoteChip(plain.ctx, plain.sessionId, SAMPLE), true);
  assert.equal(plain.calls.insertText.length, 1);
  assert.equal(plain.calls.insertText[0].text, " ");
  assert.equal(plain.calls.insertReference[0].span.start, 6);
  assert.equal(plain.input.state.getSnapshot().draft, "hello " + SAMPLE_PAYLOAD.header);

  // 空草稿：不补任何空格
  const empty = makeHarness();
  assert.equal(empty.runtime.insertQuoteChip(empty.ctx, empty.sessionId, SAMPLE), true);
  assert.equal(empty.calls.insertText.length, 0);
  assert.equal(empty.calls.insertReference[0].span.start, 0);
});

test("C-2d：事件通道在不可信投影下也按 trusted 保守补前导空格", () => {
  const h = makeHarness({
    input: { draft: QUOTE_DRAFT, caret: 3, quotes: [QUOTE_FIXTURE], actions: false }
  });
  assert.equal(h.runtime.insertTextViaEvent(h.ctx, h.sessionId, "X"), true);
  assert.equal(h.state.events.length, 1);
  assert.equal(h.state.events[0].payload.text, " X", "不可信且草稿非空 → 一律补前导空格");
  assert.equal(h.input.state.getSnapshot().draft, QUOTE_DRAFT + " X");

  // 可信投影保持旧行为：尾部已有空白就不补
  const trusted = makeHarness({ input: { draft: "hi ", actions: false } });
  assert.equal(trusted.runtime.insertTextViaEvent(trusted.ctx, trusted.sessionId, "X"), true);
  assert.equal(trusted.state.events[0].payload.text, "X");
});

// ---------- C-4：openReference 失败不再静默 ----------

test("C-4：openFile 抛错时 openReference 发 chipOpenFailed 提示，不再静默", () => {
  const h = makeHarness({ openFileThrows: true });
  assert.equal(h.runtime.insertQuoteChip(h.ctx, h.sessionId, SAMPLE), true);
  const ref = h.calls.insertReference[0].chip.ref;
  const source = h.runtime.createQuoteSource(h.ctx);

  assert.equal(source.openReference({ sessionId: "s1" }, { ref }), false);
  assert.equal(h.state.openFile.length, 0, "抛错时没有落地");
  assert.deepEqual(h.calls.notify, [{ level: "error", text: "selection.chipOpenFailed" }]);

  // session 缺失也不能在提示通道里再抛一次（拿不到 sessionId 就静默）
  assert.equal(source.openReference(undefined, { ref: "q-missing" }), false);
  assert.equal(h.calls.notify.length, 1, "没有 sessionId 时提醒无从送达，但绝不抛错");
});
