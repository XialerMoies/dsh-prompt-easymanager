// dsh-prompt-easymanager · 个人提示词库（包内 chunk）
//
// 由 client.editor.js 用 require.async 拉起；必须注册成 id "dsh-prompt-easymanager"
// + chunk 文件名，否则宿主报「loaded without registering」。
//
// ⚠️ 改完必须重启 dsh —— chunk 的 rev 跟着 client.js 的 mtime 走。改完跑
//    `npm run bump:rev`。
//
// 这一块是**提示词库本身**：分类卡片列表、展开详情、编辑表单、新建/刷新。
// 分工：总开关管「注不注入」，提示词组合管「哪几条生效 + 预设」，
// 本块管「库里有哪几条、每条长什么样」，系统提示词管「dsh 原生段落怎么改写」。
//
// ⚠️ **状态不在这里**：prompts / busy / edit / openId / closedCats / message / err
//    以及 send / load 全留在 client.editor.js —— 它们跟 /state、/edit、/reload
//    几条接口的数据流缠在一起，而且测试按 hook 下标塞状态。本块只搬渲染。

window.__ModuleLoader__.load({
  id: "dsh-prompt-easymanager",
  chunk: "client.editor.library.js",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    function create(api) {
      var ActionButton = api.ui.ActionButton;
      var Button = api.ui.Button;
      var Input = api.ui.Input;
      var Menu = api.ui.Menu;
      var Modal = api.ui.Modal;
      var Tag = api.ui.Tag;
      var IconChevronDownOutlineRegular = api.ui.IconChevronDownOutlineRegular;
      var fmtTokens = api.tokens;
      var CARD = api.style.CARD;
      var CARDS_GRID = api.style.CARDS_GRID;
      var CARD_ACTIONS = api.style.CARD_ACTIONS;
      var CARD_DESC_ROW = api.style.CARD_DESC_ROW;
      var CARD_DETAILS = api.style.CARD_DETAILS;
      var CARD_HEAD = api.style.CARD_HEAD;
      var CARD_HEADING = api.style.CARD_HEADING;
      var CARD_MAIN_ROW = api.style.CARD_MAIN_ROW;
      var CARD_TITLE = api.style.CARD_TITLE;
      var CHEVRON = api.style.CHEVRON;
      var CHEVRON_OPEN = api.style.CHEVRON_OPEN;
      var DD = api.style.DD;
      var DETAILS_GRID = api.style.DETAILS_GRID;
      var DT = api.style.DT;
      var FORM = api.style.FORM;
      var FORM_FIELD = api.style.FORM_FIELD;
      var FORM_LABEL = api.style.FORM_LABEL;
      var FORM_ROW = api.style.FORM_ROW;
      var FORM_TEXTAREA = api.style.FORM_TEXTAREA;
      var HEADING_COUNT = api.style.HEADING_COUNT;
      var HEADING_TITLE = api.style.HEADING_TITLE;
      // ⚠️ MODE_LABEL **不在 api.style 里** —— 宿主是当 api.mode 导出的
      //    （跟 api.label / api.tokens 一样，是函数不是样式对象）。
      var MODE_LABEL = api.mode;
      var MONO = api.style.MONO;
      var MUTED = api.style.MUTED;
      var RAW_NAME = api.style.RAW_NAME;
      var STATUS_LINE = api.style.STATUS_LINE;

      /**
       * 按分类把提示词分组。
       *
       * ⚠️ 原来这段在编辑器里**写了两遍**（一遍在空态判断之前、永远走不到，
       *    一遍在 else 分支里），连注释都一样。搬过来时合成一份。
       */
      function groupByCategory(props) {
  // 按分类分组显示。组内顺序：内置五类的固定次序 → 自定义分类按名字排。
    // 空分类不显示（只有一条也不显示，免得满屏小标题）。
    var seen = {};
    var groups = [];
    for (var gi = 0; gi < props.builtinCategories.length; gi++) {
      groups.push({ id: props.builtinCategories[gi].id, items: [] });
      seen[props.builtinCategories[gi].id] = true;
    }
    var customs = [];
    for (var pi = 0; pi < props.prompts.length; pi++) {
      var c = (props.prompts[pi] && props.prompts[pi].category) || "other";
      if (!seen[c]) {
        seen[c] = true;
        customs.push(c);
      }
    }
    customs.sort();
    for (var ci = 0; ci < customs.length; ci++) groups.push({ id: customs[ci], items: [] });
    for (var qi = 0; qi < props.prompts.length; qi++) {
      var qc = (props.prompts[qi] && props.prompts[qi].category) || "other";
      for (var gj = 0; gj < groups.length; gj++) {
        if (groups[gj].id === qc) {
          groups[gj].items.push(props.prompts[qi]);
          break;
        }
      }
    }

        return groups;
      }

  /** 取某个分类的建议 order；自定义分类返回 null（没有建议值）。 */
  function suggestedOrderOf(category, props) {
    for (var i = 0; i < props.builtinCategories.length; i++) {
      if (props.builtinCategories[i].id === category) return props.builtinCategories[i].order;
    }
    return null;
  }

  function categoryName(id, props) {
    for (var i = 0; i < props.builtinCategories.length; i++) {
      if (props.builtinCategories[i].id === id) return props.builtinCategories[i].name;
    }
    return id || "其他";
  }

  /**
   * 改分类时**带出建议 order**（用户选的方案）。之后 order 仍然可以手改。
   * 自定义分类没有建议值，那就保持原样不动。
   */
  function setCategory(v, props) {
    props.setEdit(function (prev) {
      var next = Object.assign({}, prev, { category: v });
      var sug = suggestedOrderOf(v, props);
      if (sug !== null) next.order = sug;
      return next;
    });
  }

  function newPrompt(props) {
    var base = "my-prompt";
    var n = 1;
    var ids = {};
    for (var i = 0; i < props.prompts.length; i++) ids[props.prompts[i].id] = true;
    while (ids[base + "-" + n]) n += 1;
    // 新条目默认落在「身份」类 —— 这是最常见的自定义提示词
    var cat = "identity";
    var sug = suggestedOrderOf(cat, props);
    props.setEdit({
      isNew: true,
      id: base + "-" + n,
      name: "新提示词",
      description: "",
      category: cat,
      mode: "append",
      order: sug === null ? 100 : sug,
      text: "",
      source: "none",
    });
  }

  function field(key, props) {
    return function (e) {
      var v = e.target.value;
      props.setEdit(function (prev) {
        return Object.assign({}, prev, { [key]: v });
      });
    };
  }

  function MenuSelect(props) {
    var openState = react.useState(false);
    var open = openState[0];
    var setOpen = openState[1];
    var current = props.options.find(function (option) { return option.id === props.value; });
    var anchor = react.createElement(
      ActionButton,
      {
        type: "button",
        disabled: props.disabled,
        title: props.title,
        "data-pm-category": props["data-pm-category"],
        "aria-haspopup": "menu",
        "aria-expanded": open ? "true" : "false",
        onClick: function () { setOpen(function (value) { return !value; }); },
      },
      [
        react.createElement("span", { key: "label" }, current ? current.label : props.placeholder || "选择"),
        react.createElement(
          "span",
          { key: "icon", style: { color: "var(--dsw-alias-label-tertiary)", display: "inline-flex" } },
          react.createElement(IconChevronDownOutlineRegular, { size: 12 }),
        ),
      ],
    );
    return react.createElement(Menu, {
      open: open,
      anchor: anchor,
      items: props.options.map(function (option) {
        return { id: option.id, label: option.label, disabled: option.disabled === true };
      }),
      selectedId: props.value,
      onSelect: function (id) {
        setOpen(false);
        props.onChange(id);
      },
      onClose: function () { setOpen(false); },
      portal: true,
    });
  }

  function renderForm(props) {
    if (!props.edit) return null;
    var idOk = /^[a-z0-9][a-z0-9._-]*$/i.test(props.edit.id || "");
    return react.createElement("div", { style: FORM }, [
      react.createElement("div", { key: "r1", style: FORM_FIELD }, [
        react.createElement("span", { key: "l", style: FORM_LABEL }, "id"),
        react.createElement(Input, {
          key: "i",
          value: props.edit.id,
          disabled: !props.edit.isNew,
          onChange: field("id", props),
          placeholder: "只允许字母数字 . _ -",
          title: props.edit.isNew ? "唯一标识，创建后不可改" : "已存在的条目不能改 id（改 id 等于换一条）",
        }),
        !idOk ? react.createElement(Tag, { key: "w", tone: "warning" }, "id 非法") : null,
      ]),
      react.createElement("div", { key: "r2", style: FORM_ROW }, [
        react.createElement("div", { key: "name", style: FORM_FIELD }, [
          react.createElement("span", { key: "l", style: FORM_LABEL }, "名称"),
          react.createElement(Input, {
            key: "i",
            value: props.edit.name,
            onChange: field("name", props),
            placeholder: "显示名",
          }),
        ]),
        react.createElement("div", { key: "mode", style: FORM_FIELD }, [
          react.createElement("span", { key: "l", style: FORM_LABEL }, "模式"),
          react.createElement(MenuSelect, {
            key: "s",
            value: props.edit.mode,
            options: [
              { id: "append", label: "追加" },
              { id: "none", label: "不注入" },
            ],
            onChange: function (value) {
              props.setEdit(function (prev) { return Object.assign({}, prev, { mode: value }); });
            },
          }),
        ]),
      ]),
      // 分类菜单复用 DSH Menu；自定义分类仍通过文本输入处理。
      react.createElement("div", { key: "r2b", style: FORM_ROW }, [
        react.createElement("div", { key: "category", style: FORM_FIELD }, [
          react.createElement("span", { key: "l", style: FORM_LABEL }, "分类"),
          (function () {
            var CAT_CUSTOM = "\u0000custom";
            var current = props.edit.category || "";
            var isBuiltin = props.builtinCategories.some(function (c) {
              return c.id === current;
            });
            // 当前值既不是内置、也不在已知自定义里 → 也是"自定义"
            var isKnownCustom = props.customCategories.indexOf(current) >= 0;
            var selectValue = isBuiltin ? current : isKnownCustom ? current : CAT_CUSTOM;
            var opts = [];
            for (var i = 0; i < props.builtinCategories.length; i++) {
              (function (c) {
                opts.push({ id: c.id, label: c.name + "（" + c.id + "）" });
              })(props.builtinCategories[i]);
            }
            for (var j = 0; j < props.customCategories.length; j++) {
              (function (c) {
                opts.push({ id: c, label: c + "（自定义）" });
              })(props.customCategories[j]);
            }
            opts.push({ id: CAT_CUSTOM, label: "＋ 自定义…" });
            return react.createElement(
              "span",
              { key: "cw", style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", minWidth: "0" } },
              [
                react.createElement(MenuSelect, {
                  key: "sel",
                  value: selectValue,
                  options: opts,
                  "data-pm-category": "select",
                  onChange: function (v) {
                    if (v === CAT_CUSTOM) {
                      props.setEdit(function (prev) { return Object.assign({}, prev, { category: "" }); });
                      return;
                    }
                    setCategory(v, props);
                  },
                }),
                // 只有"自定义"时才出现输入框
                isBuiltin || isKnownCustom
                  ? null
                  : react.createElement(
                      "div",
                      { key: "custom-wrap", style: { display: "grid", flex: "1 1 180px", minWidth: "0" } },
                      react.createElement(Input, {
                        value: current,
                        "data-pm-category": "text",
                        onChange: function (e) {
                          var v = e.target.value;
                          props.setEdit(function (prev) {
                            return Object.assign({}, prev, { category: v });
                          });
                        },
                        placeholder: "自己起个分类名",
                        title: "自定义分类没有建议 order，不会动你已填的 order。",
                      }),
                    ),
              ],
            );
          })(),
        ]),
        react.createElement("div", { key: "order", style: FORM_FIELD }, [
          react.createElement("span", { key: "l", style: FORM_LABEL }, "order"),
          react.createElement(Input, {
            key: "o",
            type: "number",
            value: props.edit.order,
            onChange: field("order", props),
            title: "插入位置。100 = persona 之后、工具说明之前；2900 = 工具说明之后",
          }),
        ]),
      ]),
      react.createElement(
        "div",
        { key: "r2c", style: STATUS_LINE },
        (function () {
          var hint = null;
          for (var i = 0; i < props.builtinCategories.length; i++) {
            if (props.builtinCategories[i].id === props.edit.category) hint = props.builtinCategories[i].hint;
          }
          var pos = "order " + props.edit.order + "：";
          if (props.edit.order < 900) pos += "在 dsh 自带 persona 之后、文件引用之前";
          else if (props.edit.order < 3000) pos += "在文件引用与工具说明之间";
          else if (props.edit.order < 9000) pos += "在所有工具说明之后";
          else pos += "在交付物相关段落之间";
          return (hint ? hint + "　" : "") + pos;
        })(),
      ),
      react.createElement("div", { key: "r3", style: FORM_FIELD }, [
        react.createElement("span", { key: "l", style: FORM_LABEL }, "说明"),
        react.createElement(Input, {
          key: "i",
          value: props.edit.description,
          onChange: field("description", props),
          placeholder: "一句话说明，会显示在选择器里",
        }),
      ]),
      props.edit.mode === "none"
        ? react.createElement(
            "div",
            { key: "none-note", style: MUTED },
            "不注入模式不需要正文 —— 已有的正文文件在保存时会被删除。",
          )
        : react.createElement("div", { key: "body", style: FORM_FIELD }, [
            react.createElement("span", { key: "l", style: FORM_LABEL }, "正文"),
            react.createElement("textarea", {
              key: "t",
              style: FORM_TEXTAREA,
              value: props.edit.text,
              onChange: field("text", props),
              placeholder: "提示词正文（保存后写到 prompts/" + props.edit.id + ".md）",
            }),
          ]),
      react.createElement("div", { key: "foot", style: CARD_ACTIONS }, [
        react.createElement(
          "span",
          { key: "n", style: STATUS_LINE },
          props.edit.mode === "none" ? "" : "约 " + props.edit.text.length + " 字符 · 保存到 prompts/" + props.edit.id + ".md",
        ),
        react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
        react.createElement(
          ActionButton,
          {
            key: "s",
            type: "button",
            variant: "primary",
            disabled: props.busy || !idOk,
            onClick: function () {
              props.send(
                {
                  action: "upsert",
                  prompt: {
                    id: props.edit.id,
                    name: props.edit.name,
                    description: props.edit.description,
                    category: props.edit.category || "other",
                    mode: props.edit.mode,
                    order: Number(props.edit.order),
                    text: props.edit.text,
                  },
                },
                props.edit.isNew ? "已新建「" + props.edit.name + "」" : "已保存「" + props.edit.name + "」",
              );
            },
          },
          props.busy ? "保存中…" : "保存",
        ),
        react.createElement(
          ActionButton,
          {
            key: "c",
            type: "button",
            variant: "outline",
            disabled: props.busy,
            onClick: function () {
              props.setEdit(null);
            },
          },
          "取消",
        ),
      ]),
    ]);
  }

  /** 展开某张卡片（原生插件列表就是这个交互：点卡片头展开详情）。 */
  function toggleOpen(id, props) {
    props.setOpenId(function (prev) {
      return prev === id ? null : id;
    });
  }

  function pillFor(mode) {
    if (mode === "append") return react.createElement(Tag, { tone: "info" }, "追加");
    return react.createElement(Tag, { tone: "outline" }, "不注入");
  }

  /**
   * 一张个人提示词卡片。
   *
   * ⚠️ 头部结构**与系统提示词卡片（renderSectionCard）保持一致** ——
   *    两块内容在同一个页面里上下挨着，头部长得不一样会显得是两套东西：
   *      一行：名字（+ 原始 id 小字） → 徽章 → 字数 → 箭头
   *      两行：id / 描述（有才显示）
   *    原来这里是「标题 + 徽章 + 箭头」挤在 CARD_MAIN_ROW 里、下面单独一行
   *    id、再一行描述 —— 高度和信息排布都跟系统那边对不上。
   *
   * ⚠️ 两个坑沿用 renderSectionCard 的结论（那边踩过，这边照抄）：
   *    1. 内边距要用 `CARD_HEAD`（12px 14px）—— `CARD_MAIN_ROW` 只是布局行、
   *       没有 padding，只用它内容会贴着边框；
   *    2. `CARD_HEAD` 是 `flexDirection: "column"`，`CARD_MAIN_ROW` 没设
   *       flexDirection，Object.assign 之后 column 会赢 —— 要一行就得显式
   *       改回 row。否则名字/徽章/箭头竖成三行居中（真机上就是这么错的）。
   */
  /**
   * 一个大类别卡片，里面装这个类别的个人提示词卡片。
   *
   * 用户要的：**个人提示词的卡片跟系统提示词的卡片长得一样，
   * 外面再套一层大类别卡片。**
   *
   * 为什么要套这一层（而不只是给分组标题加个框）：
   *   原来分类是「一段灰字标题 + 一个网格」，网格里的卡片各自独立，
   *   分类归属只靠标题的位置暗示。套上类别卡片之后边界是画出来的，
   *   而且可以折叠 —— 库大了以后能整类收起来。
   *
   * 折叠状态复用 props.openId（存 `"cat:<id>"`）：
   *   个人提示词的 id 不可能以 `cat:` 开头（id 是文件名派生、不许有冒号），
   *   所以两边塞进同一个格不会撞。
   *
   * ⚠️ 卡片头**照抄系统提示词卡片那套**（CARD_HEAD + CARD_MAIN_ROW +
   *    显式 flexDirection: "row"），理由见 renderRow 上面那段。
   */
  function renderGroupCard(g, isCustom, props) {
    var openKey = "cat:" + g.id;
    // ⚠️ 默认**展开**。
    //
    //    全折叠的话，打开设置页只能看见一排分类名，库里有什么一条都看不到
    //    —— 而「库里有几条提示词」正是进这个页面最先要知道的事。
    //    所以折叠要做成**显式动作**：用户自己点了才折，没点过就一直是开的。
    //    （不是「默认 null = 全折」那种，那样每次进来都得手点一遍。）
    var isOpen = props.closedCats.indexOf(openKey) < 0;
    var cards = [];
    for (var i = 0; i < g.items.length; i++) cards.push(renderRow(g.items[i], props));
    return react.createElement(
      "div",
      {
        key: "grp-" + g.id,
        style: Object.assign({}, CARD, { marginBottom: "10px" }),
      },
      [
        react.createElement(
          Button,
          {
            key: "head",
            type: "button",
            variant: "ghost",
            size: "md",
            "data-pm-disclosure": "1",
            style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
              flexDirection: "row",
              minHeight: "0",
              height: "auto",
              padding: "10px 14px",
            }),
            "aria-expanded": isOpen,
            onClick: function () {
              var next = props.closedCats.slice();
              var at = next.indexOf(openKey);
              if (at >= 0) next.splice(at, 1);
              else next.push(openKey);
              props.setClosedCats(next);
            },
          },
          [
            react.createElement("span", { key: "n", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) }, categoryName(g.id, props)),
            isCustom
              ? react.createElement(Tag, { key: "t", tone: "quiet" }, "自定义分类")
              : null,
            react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
            react.createElement("span", { key: "c", style: HEADING_COUNT }, g.items.length + " 条"),
            react.createElement(
              "span",
              { key: "ch", style: isOpen ? CHEVRON_OPEN : CHEVRON },
              react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } },
                react.createElement(IconChevronDownOutlineRegular, { size: 14 })),
            ),
          ],
        ),
        isOpen
          ? react.createElement(
              "div",
              { key: "body", style: CARD_DETAILS },
              react.createElement("div", { style: CARDS_GRID }, cards),
            )
          : null,
      ],
    );
  }

  function renderRow(p, props) {
    if (!p || !p.id) return null;
    var isEditing = props.edit && props.edit.id === p.id && !props.edit.isNew;
    var isOpen = props.openId === p.id || isEditing;
    return react.createElement(
      // 与原生 .card 对齐：.5px 描边 + settings-card-fill + radius-xl + overflow hidden
      "div",
      { key: p.id, style: isOpen ? Object.assign({}, CARD, { borderColor: "var(--dsw-alias-border-l3)" }) : CARD },
      react.createElement(
        Button,
        {
          type: "button",
          variant: "ghost",
          size: "md",
          "data-pm-disclosure": "1",
          style: Object.assign({}, CARD_HEAD, CARD_MAIN_ROW, {
            flexDirection: "row",
            minHeight: "0",
            height: "auto",
            padding: "10px 14px",
          }),
          "aria-expanded": isOpen,
          onClick: function () {
            toggleOpen(p.id, props);
          },
        },
        [
          react.createElement(
            "span",
            { key: "t", style: Object.assign({}, CARD_TITLE, { flex: "0 1 auto" }) },
            p.name || p.id,
          ),
          // 原始 id 小字跟在后面 —— 名字给人看，这个给排查用。同一行，不占高度。
          react.createElement("span", { key: "raw", style: RAW_NAME, title: p.id }, p.id),
          react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
          pillFor(p.mode),
          react.createElement("span", { key: "c", style: HEADING_COUNT }, fmtTokens(p.tokens)),
          react.createElement(
            "span",
            { key: "ch", style: isOpen ? CHEVRON_OPEN : CHEVRON },
            react.createElement("span", { style: { color: "var(--dsw-alias-label-tertiary)" } },
              react.createElement(IconChevronDownOutlineRegular, { size: 14 })),
          ),
        ],
      ),
      // 第二行留给描述：没有就不占位（原来无论有没有都留一行空）
      p.description && !isOpen
        ? react.createElement("div", { key: "d", style: CARD_DESC_ROW }, p.description)
        : null,
      isOpen
        ? react.createElement(
            "div",
            { style: CARD_DETAILS },
            isEditing
              ? renderForm(props)
              : react.createElement("div", null, [
                  // 原生的详情区是 `dt/dd` 两列网格
                  react.createElement("dl", { key: "meta", style: DETAILS_GRID }, [
                    react.createElement("dt", { key: "l1", style: DT }, "模式"),
                    react.createElement(
                      "dd",
                      { key: "v1", style: DD },
                      MODE_LABEL[p.mode] || p.mode,
                    ),
                    react.createElement("dt", { key: "l2", style: DT }, "order"),
                    react.createElement(
                      "dd",
                      { key: "v2", style: DD },
                      String(p.order) + "　（100 = persona 之后；2900 = 工具说明之后）",
                    ),
                    react.createElement("dt", { key: "l3", style: DT }, "规模"),
                    react.createElement(
                      "dd",
                      { key: "v3", style: DD },
                      fmtTokens(p.tokens) + " · " + p.chars + " 字符",
                    ),
                    react.createElement("dt", { key: "l4", style: DT }, "正文"),
                    react.createElement(
                      "dd",
                      { key: "v4", style: DD },
                      p.source === "file"
                        ? p.file
                        : p.source === "inline"
                          ? "内联在 catalog.json 里（保存后会转成文件）"
                          : "无（不注入模式）",
                    ),
                  ]),
                  p.text
                    ? react.createElement("pre", { key: "body", style: MONO }, p.text)
                    : null,
                  react.createElement("div", { key: "act", style: CARD_ACTIONS }, [
                    react.createElement(
                      ActionButton,
                      {
                        key: "e",
                        type: "button",
                        disabled: props.busy,
                        onClick: function () {
                          props.setEdit({
                            isNew: false,
                            id: p.id,
                            name: p.name || p.id,
                            description: p.description || "",
                            category: p.category || "other",
                            mode: p.mode || "append",
                            order: p.order == null ? 100 : p.order,
                            text: p.text || "",
                            source: p.source,
                          });
                        },
                      },
                      "编辑",
                    ),
                    react.createElement(
                      ActionButton,
                      {
                        key: "d",
                        type: "button",
                        variant: "outline",
                        disabled: props.busy,
                        title: "删除这条（正文文件一并删除）",
                        onClick: function () {
                          if (typeof props.requestDelete === "function") props.requestDelete(p);
                        },
                      },
                      "删除",
                    ),
                  ]),
                ]),
          )
        : null,
    );
  }

      /**
       * 「个人提示词」标题行 + 分类卡片 —— **一个**整体。
       *
       * ⚠️ 标题行和卡片必须在一起：`SECTION` 是 `gap:12px` 的列，body 里每一项
       *    之间都隔 12px。拆成两项的话标题和卡片之间会硬隔 12px、还各自和上下
       *    邻居等距，看着就像标题是独立的一条、跟卡片没关系。
       */
      function LibraryBlock(props) {
        var deleteState = react.useState(null);
        var deleteTarget = deleteState[0];
        var setDeleteTarget = deleteState[1];
        var viewProps = Object.assign({}, props, {
          requestDelete: function (prompt) { setDeleteTarget(prompt); },
        });
        var body = [renderHeader(props)].concat(renderCards(viewProps));
        if (deleteTarget) {
          body.push(
            react.createElement(
              Modal,
              {
                key: "delete-modal",
                open: true,
                title: "删除提示词",
                closeLabel: "关闭",
                onClose: function () { setDeleteTarget(null); },
              },
              [
                react.createElement(
                  "p",
                  { key: "message", style: { margin: "0 0 14px", lineHeight: "1.6" } },
                  "确定删除「" + (deleteTarget.name || deleteTarget.id) + "」吗？正文文件也会删掉。",
                ),
                react.createElement(
                  "div",
                  { key: "actions", style: CARD_ACTIONS },
                  [
                    react.createElement(
                      ActionButton,
                      {
                        key: "delete",
                        type: "button",
                        variant: "primary",
                        onClick: function () {
                          var target = deleteTarget;
                          setDeleteTarget(null);
                          props.send({ action: "delete", id: target.id }, "已删除「" + (target.name || target.id) + "」");
                        },
                      },
                      "删除",
                    ),
                    react.createElement(
                      ActionButton,
                      {
                        key: "cancel",
                        type: "button",
                        variant: "outline",
                        onClick: function () { setDeleteTarget(null); },
                      },
                      "取消",
                    ),
                  ],
                ),
              ],
            ),
          );
        }
        return react.createElement("div", null, body);
      }

      /** 「个人提示词」标题行：名字 + 条数 + 提示条 + 新建/刷新。 */
      function renderHeader(props) {
  // 分组标题（对齐原生 .catalogHeading：h3 + 计数）
  //
  // ⚠️ 间距跟「系统提示词」那个标题行**取同一组值**（下面 22 / 10）。
  //    两个区块在同一个页面里上下挨着，标题跟卡片的距离不一样会显得
  //    一个是「标题+内容」、另一个是「一条独立的说明条」。
  var header = react.createElement(
    "div",
    { style: Object.assign({}, CARD_HEADING, { marginTop: "22px", marginBottom: "10px" }) },
    [
    react.createElement("h3", { key: "t", style: Object.assign({}, HEADING_TITLE, { margin: 0 }) }, "个人提示词"),
    react.createElement("span", { key: "c", style: HEADING_COUNT }, props.prompts.length + " 条"),
    react.createElement("span", { key: "sp", style: { flex: "1 1 auto" } }),
      props.message
      ? react.createElement(Tag, { key: "m", tone: props.err ? "danger" : "success" }, props.message)
      : null,
    react.createElement(
      ActionButton,
      {
        key: "n",
        type: "button",
        variant: "outline",
        disabled: props.busy || !!props.edit,
         onClick: function () { newPrompt(props); },
      },
      "新建",
    ),
    react.createElement(
      ActionButton,
      {
        key: "r",
        variant: "outline",
        disabled: props.busy || !!props.edit,
        title: "从磁盘重新读取提示词库",
        onClick: props.reload || props.load,
      },
      "重新读取",
    ),
    ],
  );
        // ⚠️ 这一句原来漏了（搬过来时只留了 `var header = react.createElement(...)`，
        //    没把 return 带上）—— 表现是整块标题静默消失，而且不报错。
        return header;
      }

      /** 分类卡片列（含空态、以及贴在最前的新建表单）。 */
      function renderCards(props) {
  // 个人提示词：标题行 + 分类卡片，最后作为一个块推入（见下面那段说明）
  var cards = [];
  if (props.prompts.length === 0) {
    // "新建"表单放在卡片列之外（它需要整行宽度）
    if (props.edit && props.edit.isNew) {
      cards.push(
        react.createElement(
          "div",
          { key: "new", style: Object.assign({}, CARD, { marginBottom: "10px" }) },
          react.createElement("div", { style: CARD_DETAILS }, renderForm(props)),
        ),
      );
    }
    cards.push(
      react.createElement(
        "div",
        { key: "empty", style: STATUS_LINE },
        "提示词库是空的，点「新建」加一条。",
      ),
    );
  } else {
    // "新建"表单放在卡片列最前（它需要整行宽度）
    if (props.edit && props.edit.isNew) {
      cards.push(
        react.createElement(
          "div",
          { key: "new", style: Object.assign({}, CARD, { marginBottom: "10px" }) },
          react.createElement("div", { style: CARD_DETAILS }, renderForm(props)),
        ),
      );
    }
    var groups = groupByCategory(props);
  for (var gk = 0; gk < groups.length; gk++) {
      var g = groups[gk];
      if (g.items.length === 0) continue;
      // ⚠️ 第二个参数是「这是不是自定义分类」，**不是** `seen[g.id]`。
      //
      //    `seen` 是「这个 id 有没有被处理过」的记账表，内置分类在初始化时
      //    就全被标成 true —— 直接把它传进去的后果是**每个分类都被打上
      //    「自定义分类」徽章**（用户看到「领域」标着自定义，就是这个 bug）。
      //    判据要用「在不在内置表里」反推。
      cards.push(
        renderGroupCard(
          g,
          !props.builtinCategories.some(function (b) { return b.id === g.id; }),
          props,
        ),
      );
    }
  }
        return cards;
      }

      /** 这一块没有 CSS module，只有内联样式；保留成接口形状，宿主会调。 */
      function installStyles() {}

      return {
        LibraryBlock: LibraryBlock,
        installStyles: installStyles,
      };
    }

    module.exports.create = create;
    return module.exports;
  },
});
