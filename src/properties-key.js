/**
 * dsh-code-nav — Java properties 键名规则（纯函数，浏览器/node 通用）。
 *
 * properties 的键扫描规则与其它行式配置不同，且**大纲（config-outline.js）与
 * 高亮（tokenize.js）必须同口径**，否则会出现「大纲能列出、但不高亮」这类
 * 不一致。故把规则集中在这里，两边都调用它：
 *
 * - `=` `:` 与**空白**都是键值分隔符（`server.port 8080`）；
 * - `\` 是转义符，`\:` / `\=` / `\ ` 中的分隔符属于键名本身（`key\:part`）；
 * - 转义符不能是行尾最后一个字符（那属于续行语法，见 config-outline.js）。
 *
 * 共享作用域约定见 lang-registry.js 文件头。
 */

/**
 * 找出 properties 键在 `body` 中的结束位置。
 *
 * 返回 `-1` 表示**整行都是键**（没有分隔符的裸键，例如 `key\:part`、`plainkey`）。
 * 返回 `0` 表示第一个字符就是分隔符（`=value`），调用方应视为无键。
 *
 * @param {string} body 去掉行首空白后的行内容
 * @returns {number} 分隔符下标，或 -1（整行是键）
 */
export function propertiesKeyEnd(body) {
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === "\\") {
      // 转义吃掉下一个字符；行尾孤立反斜杠不属于键名（续行标记）
      if (k + 1 >= body.length) return k;
      k++;
      continue;
    }
    if (ch === "=" || ch === ":" || ch === " " || ch === "\t") return k;
  }
  return -1;
}

/** properties 是否把该行视为「无分隔符的裸键行」（整行都是键名）。 */
export function isPropertiesBareKeyLine(body) {
  return propertiesKeyEnd(body) === -1;
}

/**
 * 取出 properties 行的**键文本**（未反转义），没有键时返回 ""。
 *
 * 这是大纲与高亮共用的唯一截断规则，因此两者不可能对同一行给出不同结论：
 * - 找到分隔符（下标 > 0）→ 键是分隔符之前的部分（去掉尾随空白）；
 * - 整行都是键（返回 -1）→ 键是整行；
 * - 行首就是分隔符（下标 0，例如 `=v`）→ 没有键。
 *
 * 行尾的孤立反斜杠是**续行标记**而非键名的一部分，故 `a\` 的键是 `a`
 * （上一版高亮要求「必须返回 -1」，导致这类键大纲有条却不高亮）。
 *
 * @param {string} body 去掉行首空白后的行内容
 * @returns {string} 键文本（未反转义），无键返回 ""
 */
export function propertiesKeySlice(body) {
  const cut = propertiesKeyEnd(body);
  if (cut === -1) return body;
  if (cut > 0) return body.slice(0, cut).trim();
  return "";
}

/**
 * Java properties 键名反转义：`\:`→`:`、`\\`→`\`、`\t`、`\uXXXX`，未知转义取字面。
 * @param {string} name 原始（未反转义）键名
 * @returns {string}
 */
export function unescapePropertyKey(name) {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = name[i + 1];
    if (next === undefined) { out += ch; continue; }   // 末尾孤立反斜杠按字面保留
    i++;
    if (next === "t") out += "\t";
    else if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "f") out += "\f";
    else if (next === "u") {
      const hex = name.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
      else out += "u";
    } else out += next;                                // \: \= \\ \# \! 以及未知转义
  }
  return out;
}
