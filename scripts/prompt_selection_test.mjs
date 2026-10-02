/**
 * 勾选清单 —— 纯逻辑测试
 *
 * ═══ 这个模块存在的理由 ═══
 *
 * 老模型里「段落改写」和「注不注入」是两套东西，各走各的，于是：
 *     全局关掉 / 会话选「不注入」  →  段落改写**照样生效**
 *
 * 新模型把它们并成一份清单，`selection` 是 null 就一段都不套。
 * 这套测试就是钉住那个行为。
 *
 * 运行：node scripts/prompt_selection_test.mjs
 */
import { createSuite } from "./lib/test-harness.mjs";
import {
  emptySelection,
  normalizeSelection,
  applySelectionEdit,
  projectSelection,
  applyProjection,
  selectionFromNative,
  diffNative,
  isEmptySelection,
} from "./lib/prompt-selection.mjs";

const { ok, eq, done } = createSuite("勾选清单");

/** 造一份「dsh 原生装配」的样子。 */
const native = (...pairs) => pairs.map(([name, text]) => ({ name, text }));

const THREE = native(
  ["harness:identity", "你是助手"],
  ["tool:bash", "bash 的用法"],
  ["plan:policy", "计划策略"],
);

// ── 1. 校验：坏数据不许把整个预设拖垮 ──────────────────────────────────────
{
  eq(normalizeSelection(undefined), emptySelection(), "undefined → 空清单");
  eq(normalizeSelection(null), emptySelection(), "null → 空清单");
  eq(normalizeSelection([]), emptySelection(), "数组 → 空清单（不是对象）");
  eq(normalizeSelection("x"), emptySelection(), "字符串 → 空清单");

  const withJunk = normalizeSelection({
    listed: ["a", "a", "", 5, null, "b"],
    excluded: ["c", "c", 7, ""],
    sections: { a: { text: "改了" }, bad: "不是对象", "": { text: "x" } },
  });
  eq(withJunk.listed, ["a", "b"], "listed 去重、丢非字符串");
  eq(withJunk.excluded, ["c"], "excluded 去重、丢非字符串");
  eq(Object.keys(withJunk.sections), ["a"], "sections 丢掉坏记录和空名字");

  // 同名的原生段和改写副本是两套独立勾选：可以同时 listed + excluded。
  const both = normalizeSelection({ listed: ["x"], excluded: ["x"] });
  eq(both.excluded, ["x"], "两边都有 → excluded 生效");
  eq(both.listed, ["x"], "改写副本仍保持 listed");
  eq(
    normalizeSelection({ listed: ["x"], excluded: ["x"], sections: { x: { text: "t" } } }).sections,
    { x: { text: "t", original: "", originalHash: "e3b0c44298fc1c14", savedAt: "" } },
    "  改写副本正文独立保留",
  );
}

// ── 2. 默认：全勾 = 两个名单都空，而且**不含任何正文** ─────────────────────
{
  const def = selectionFromNative();
  eq(def.listed, [], "默认清单不列任何段");
  eq(def.excluded, [], "默认清单不排除任何段");
  eq(def.sections, {}, "**默认清单不存正文** —— 所以 dsh 升级能自动跟上");

  // 拿它投影，应该全都是原生
  const p = projectSelection({ native: THREE, selection: def });
  eq(p.outcome, "ok", "投影成功");
  eq(p.counts.native, 3, "三段全是原生");
  eq(p.counts.edited, 0, "没有改过的");
  eq(p.counts.dropped, 0, "没有排除的");
  eq(
    p.plan.map((r) => r.text),
    ["你是助手", "bash 的用法", "计划策略"],
    "正文就是原生正文",
  );
}

// ── 3. ⚠️ 核心：selection 为 null 时**一段都不套** ─────────────────────────
//
// 这是这次改造要修的 bug。老行为是「照样套全局那份改写」。
{
  const p = projectSelection({ native: THREE, selection: null });
  eq(p.outcome, "none", "**没有生效的清单 → outcome 是 none**");
  eq(
    p.plan.map((r) => r.mode),
    ["native", "native", "native"],
    "**每一段都是原生**（一段都不改）",
  );
  eq(
    p.plan.map((r) => r.text),
    ["你是助手", "bash 的用法", "计划策略"],
    "  正文也是原生正文，不是改写后的",
  );
  eq(p.counts.edited, 0, "没有改过的段");
  eq(p.counts.dropped, 0, "没有排除的段");
}

// ── 4. 改过的段：用改的那份，并报「官方动过没有」 ─────────────────────────
{
  const sel = {
    listed: ["tool:bash"],
    excluded: [],
    sections: { "tool:bash": { text: "我改的 bash 说明", original: "bash 的用法" } },
  };
  const p = projectSelection({ native: THREE, selection: sel });
  const bash = p.plan.find((r) => r.name === "tool:bash");
  eq(bash.mode, "edited", "这一段是「改过的」");
  eq(bash.text, "我改的 bash 说明", "用改的那份");
  eq(bash.drifted, false, "官方没动过 → 不报漂移");
  eq(p.counts.edited, 1, "改过 1 段");
  eq(
    p.plan.find((r) => r.name === "harness:identity").mode,
    "native",
    "没提到的段还是原生",
  );

  // 官方改了原文 → 报漂移（用户能看见「官方更新了这段」）
  const moved = native(["harness:identity", "你是助手"], ["tool:bash", "bash 的用法（官方改过）"], ["plan:policy", "计划策略"]);
  const p2 = projectSelection({ native: moved, selection: sel });
  eq(p2.plan.find((r) => r.name === "tool:bash").drifted, true, "**官方动过 → 报漂移**");
}

// ── 5. 取消勾选 = 原来的「关闭」 ──────────────────────────────────────────
{
  const sel = { listed: [], excluded: ["tool:bash"], sections: {} };
  const p = projectSelection({ native: THREE, selection: sel });
  const bash = p.plan.find((r) => r.name === "tool:bash");
  eq(bash.mode, "dropped", "不勾的段 = dropped");
  eq(bash.text, "", "正文清空（渲染时空段会被丢掉）");
  eq(p.counts.dropped, 1, "排除 1 段");
  eq(p.counts.total, 3, "总段数不变（还列在计划里，只是空的）");
}

// ── 6. 跟着 dsh 走：没动过的段，内容取**当前**的 ──────────────────────────
{
  // 清单是老的（那时 identity 是别的文字），但清单里没记它的正文
  const sel = { listed: [], excluded: [], sections: {} };
  const upgraded = native(
    ["harness:identity", "你是助手（新版）"], // dsh 升级改了
    ["tool:bash", "bash 的用法"],
    ["plan:policy", "计划策略"],
    ["tool:new", "新工具说明"], // dsh 加了新段
  );
  const p = projectSelection({ native: upgraded, selection: sel });
  eq(
    p.plan.find((r) => r.name === "harness:identity").text,
    "你是助手（新版）",
    "**没动过的段自动用新版**（这就是「不存正文」的收益）",
  );
  eq(
    p.plan.some((r) => r.name === "tool:new" && r.mode === "native"),
    true,
    "**dsh 新增的段自动就在提示词里**（不用改任何预设）",
  );
}

// ── 7. 改段 + 排除：原生排除不影响改写副本 ────────────────────────────────
{
  const sel = applySelectionEdit({
    native: THREE,
    selection: { listed: ["tool:bash"], excluded: [], sections: { "tool:bash": { text: "我改的" } } },
    name: "tool:bash",
    action: "exclude",
  });
  eq(sel.excluded, ["tool:bash"], "排进去了");
  eq(sel.listed, ["tool:bash"], "原生排除不取消改写副本的勾选");
  eq(sel.sections["tool:bash"].text, "我改的", "**取消勾选不丢改写副本**（之后可以重新勾回）");
  eq(
    projectSelection({ native: THREE, selection: sel }).plan.find((r) => r.name === "tool:bash").mode,
    "edited",
    "原生取消勾选后，仍勾选的改写副本继续注入",
  );
}

// ── 8. 勾上 / 不勾：两个名单的语义 ────────────────────────────────────────
//
// ⚠️ 这一节的语义想清楚再写，我第一版搞反了：
//
//     `listed`  = **用户主动勾的**（相当于把它钉在预设里）—— 界面第一栏那个勾
//     不在任何名单里 = 没动过 = **跟着 dsh 走**（自动包含，内容取最新）
//     `excluded` = 不勾的 → 不进提示词
//
//     所以「默认全勾」不用写任何东西 —— 两个名单都空就是全勾。
//     这正是「跟着 dsh 走」的来源。
{
  // 取消勾选 → 进 excluded
  const off = applySelectionEdit({
    native: THREE,
    selection: selectionFromNative(),
    name: "plan:policy",
    action: "exclude",
  });
  eq(off.excluded, ["plan:policy"], "不勾 → 进 excluded");
  eq(off.listed, [], "  不在 listed 里");

  // 再勾回来 → 从 excluded 里拿掉。**不必写进 listed**（没动过的段自动包含）
  const on = applySelectionEdit({ native: THREE, selection: off, name: "plan:policy", action: "include" });
  eq(on.excluded, [], "勾回来 → 撤销排除");
  eq(on.listed, ["plan:policy"], "  同时把它记进 listed（用户明确勾了，就该记住）");

  const p = projectSelection({ native: THREE, selection: on });
  eq(
    p.plan.find((r) => r.name === "plan:policy").mode,
    "native",
    "  投影出来是原生（回到了提示词里）",
  );

  // ⚠️ 就算不写 listed（比如手工构造的旧数据），只要不在 excluded 里，
  //    它照样在提示词里 —— 「跟着 dsh 走」不能依赖 listed。
  const legacy = { listed: [], excluded: [], sections: {} };
  eq(
    projectSelection({ native: THREE, selection: legacy }).plan.find((r) => r.name === "plan:policy")
      .mode,
    "native",
    "**没在任何名单里 → 自动包含**（这是「不存正文」能成立的前提）",
  );
}

// ── 9. 改正文：改好了但**不自动进清单** ───────────────────────────────────
//
// 用户刚在「系统提示词」那一栏改完，改动要先存下来（不然刷新就丢），
// 但他可能还没在清单里勾中它。所以：
//   改动存进 `sections`
//   `listed` 保持原样（原来有就留着，没有就等他勾）
{
  const sel = applySelectionEdit({
    native: THREE,
    selection: emptySelection(),
    name: "tool:bash",
    edit: { text: "我改的 bash 说明" },
  });
  eq(sel.sections["tool:bash"].text, "我改的 bash 说明", "正文存下来了");
  eq(sel.sections["tool:bash"].original, "bash 的用法", "**顺手记下当时的官方原文**");
  ok(!!sel.sections["tool:bash"].originalHash, "  并算了指纹");
  eq(sel.listed, [], "**没自动进 listed**（等用户勾）");

  // 已经勾着的段，改了正文之后仍在 listed 里
  const sel2 = applySelectionEdit({
    native: THREE,
    selection: { listed: ["tool:bash"], excluded: [], sections: { "tool:bash": { text: "旧改动" } } },
    name: "tool:bash",
    edit: { text: "新改动" },
  });
  eq(sel2.listed, ["tool:bash"], "**原本勾着的，改完仍在清单里**（改正文不该动名单）");
  eq(sel2.sections["tool:bash"].text, "新改动", "  正文更新了");

  // replace/edit 本身只保存副本，不自动启用；启用由组合草稿的勾选决定。
  const edited = applySelectionEdit({
    native: THREE,
    selection: selectionFromNative(),
    name: "tool:bash",
    action: undefined,
    edit: { text: "新的改写" },
  });
  eq(edited.listed, [], "**新改写默认未勾选**");
  eq(projectSelection({ native: THREE, selection: edited }).plan.find((r) => r.name === "tool:bash").mode,
    "native",
    "**未勾选时仍使用原生**",
  );
}

// ── 10. 换预设：清单里有、但当前装配没有的段 → 报 stale，**不硬塞回去** ────
{
  const sel = {
    listed: ["tool:pwsh"],
    excluded: [],
    sections: { "tool:pwsh": { text: "我改的 pwsh", original: "pwsh 的用法" } },
  };
  const p = projectSelection({ native: THREE, selection: sel }); // THREE 里没有 pwsh
  eq(p.stale.length, 1, "报出 1 段失效");
  eq(p.stale[0].name, "tool:pwsh", "  就是那段");
  eq(p.stale[0].mode, "stale", "  标成 stale");
  ok(
    !p.plan.some((r) => r.name === "tool:pwsh" && r.mode !== "stale"),
    "**没有把它当成新段塞回装配**（硬塞会插到错的位置）",
  );
  eq(p.unlisted.includes("tool:pwsh"), true, "  也报进 unlisted（界面要提示）");
}

// ── 11. 套回装配：只动该动的，不碰别的 ────────────────────────────────────
{
  const sections = [
    { name: "harness:identity", text: "你是助手" },
    { name: "tool:bash", text: "bash 的用法" },
    { name: "plan:policy", text: "计划策略" },
    { name: "别人的段", text: "别的插件挂的" },
  ];
  const sel = {
    listed: ["tool:bash"],
    excluded: ["plan:policy"],
    sections: { "tool:bash": { text: "我改的", original: "bash 的用法" } },
  };
  const p = projectSelection({ native: sections, selection: sel });
  const r = applyProjection(sections, p);

  eq(sections.find((s) => s.name === "tool:bash").text, "我改的", "改过的段被换掉了");
  eq(sections.find((s) => s.name === "plan:policy").text, "", "排除的段被清空");
  eq(sections.find((s) => s.name === "harness:identity").text, "你是助手", "没提到的段没动");
  eq(sections.find((s) => s.name === "别人的段").text, "别的插件挂的", "**别人的段一根手指都不碰**");

  // ⚠️ **光比正文不够，光比 changed 也不够。**
  //
  //    第一版只写「别人的段正文没变」+「changed 是 2」，于是
  //    「把不在计划里的段当成该保持原样」那种注入**验不出来** ——
  //    它把正文赋成自己的值，正文没变、changed 也没变，但它**确实碰了**。
  //
  //    所以钉住 `touched`：**碰过的段名，一个都不能多**。
  eq(
    r.touched.slice().sort(),
    ["plan:policy", "tool:bash"],
    "**只碰了该碰的两段**（改过的 + 排除的），别人的段连碰都没碰",
  );
  eq(r.changed, 2, "  其中 2 处的正文真的变了");

  // 幂等：再套一次不该再有变化
  const r2 = applyProjection(sections, p);
  eq(r2.changed, 0, "**再套一次没有变化**（幂等）");
  eq(r2.touched.length, 0, "  也一段都没碰（`touched` 记的是「真的改了」，不是「遍历过」）");

  // ⚠️ **装配里有、但投影计划里没有的段** —— 一根手指都不能碰。
  //
  //    这一条是补出来的：原来只测「不在计划里就当它该保持原样」那种注入，
  //    会发现不了问题 —— 因为对「本来就没进计划」的段，
  //    赋成它自己的值看不出差别。得造一个**看得出差别**的场景：
  //    一个计划里没有、但正文非空的段，被碰了就会被清空。
  {
    const s2 = [
      { name: "harness:identity", text: "你是助手" },
      { name: "只在装配里", text: "这段不在任何清单里，正文必须原样留着" },
    ];
    const plan2 = projectSelection({ native: [s2[0]], selection: selectionFromNative() });
    eq(
      plan2.plan.some((r) => r.name === "只在装配里"),
      false,
      "  前提：那段确实不在计划里",
    );
    const r3 = applyProjection(s2, plan2);
    eq(s2[1].text, "这段不在任何清单里，正文必须原样留着", "**不在计划里的段，正文原样留着**");
    eq(r3.touched, [], "  也没碰它");
  }
}

// ── 12. 空清单判定：用来拦住「什么都不勾就保存」 ───────────────────────────
{
  const names = ["a", "b", "c"];
  eq(
    isEmptySelection({ selection: selectionFromNative(), availableNative: names }),
    false,
    "**默认的全勾状态不算空**（两个名单都空，但原生段全在）",
  );
  eq(
    isEmptySelection({ selection: { listed: [], excluded: names, sections: {} }, availableNative: names }),
    true,
    "**原生段全排除、又没改过任何段 → 空，该拦住**",
  );
  eq(
    isEmptySelection({
      // ⚠️ 排除的是 a 和 b，**c 留着**；同时改过 a 的正文。
      //
      //    第一版我写成「a、b、c 全排除，又改了 a」—— 那组数据**自相矛盾**：
      //    校验逻辑会把被排除段的正文丢掉（排除优先，这是对的），
      //    于是「改过至少一段」这个前提根本没成立，测的就不是想测的东西了。
      selection: { listed: [], excluded: ["a", "b"], sections: { a: { text: "改了" } } },
      availableNative: names,
    }),
    false,
    "  改过至少一段就不算空（哪怕还排除了一些）",
  );
  eq(
    isEmptySelection({ selection: { listed: [], excluded: ["a"], sections: {} }, availableNative: names }),
    false,
    "只排除一部分不算空",
  );
}

// ── 13. 比对 dsh 的变化 ───────────────────────────────────────────────────
//
// ⚠️ 「新段」的判据是「**上次没看见过**」，所以清单里要存一份 `known`
//    （上次装配时看见的原生段名）。第一版拿「用户动过的名字」当已知集合，
//    于是所有没动过的段都被误报成「dsh 新增」。
{
  const sel = {
    listed: ["tool:bash"],
    excluded: ["plan:policy"],
    sections: { "tool:bash": { text: "我改的", original: "bash 的用法" } },
    // 上次看见过这三段
    known: ["harness:identity", "tool:bash", "plan:policy"],
  };

  const same = diffNative({ native: THREE, selection: sel });
  eq(same.added, [], "**完全没变 → 没有新段**（没动过的也不算新的）");
  eq(same.removed, [], "  没有消失的段");
  eq(same.drifted, [], "  没有漂移");
  eq(same.known, ["harness:identity", "tool:bash", "plan:policy"], "  回报这次的段名（要写回清单）");

  const changed = diffNative({
    native: native(
      ["harness:identity", "你是助手"],
      ["tool:bash", "bash 的用法（改了）"],
      ["plan:policy", "计划策略"],
      ["tool:new", "新的"],
    ),
    selection: sel,
  });
  eq(changed.drifted, ["tool:bash"], "**报出改过的那段官方动过**");
  eq(changed.added, ["tool:new"], "  **只报真正的新段**");
  eq(changed.removed, [], "  没有消失的");

  const gone = diffNative({
    native: native(["harness:identity", "你是助手"]),
    selection: sel,
  });
  eq(gone.removed.sort(), ["plan:policy", "tool:bash"], "**dsh 没了这两段 → 报出来**");
  eq(gone.added, [], "  剩下的那个不是新的（上次见过）");

  // 没有 known 的老数据：不该把所有段都报成「新增」
  // —— 用户动过的那些至少不该算新的
  const noKnown = diffNative({
    native: THREE,
    selection: { listed: ["tool:bash"], excluded: [], sections: { "tool:bash": { text: "x", original: "bash 的用法" } } },
  });
  eq(
    noKnown.added.includes("tool:bash"),
    false,
    "**老数据（没有 known）里，用户动过的段不算新增**",
  );
}

done();
