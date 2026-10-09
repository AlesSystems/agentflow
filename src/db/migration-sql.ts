type Token = { value: string; word: boolean; identifier: boolean };
const forbidden = new Set([
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "VACUUM",
  "ATTACH",
  "DETACH",
  "PRAGMA",
]);
function reject(): never {
  throw new Error("NONTRANSACTIONAL_MIGRATION");
}
function tokens(sql: string): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0 || sql.slice(i + 2, end).includes("/*")) reject();
      i = end + 2;
      continue;
    }
    if (["'", '"', "`", "["].includes(c)) {
      const close = c === "[" ? "]" : c;
      let closed = false;
      i++;
      while (i < sql.length) {
        if (sql[i++] !== close) continue;
        if (c !== "[" && sql[i] === close) {
          i++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) reject();
      result.push({ value: "quoted", word: false, identifier: c !== "'" });
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(sql.slice(i));
    if (word) {
      result.push({
        value: word[0].toUpperCase(),
        word: true,
        identifier: true,
      });
      i += word[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      sql.slice(i),
    );
    if (number) {
      result.push({ value: number[0], word: false, identifier: false });
      i += number[0].length;
      continue;
    }
    if (!";(),.+-*/%=<>!|&~".includes(c)) reject();
    result.push({ value: c, word: false, identifier: false });
    i++;
  }
  return result;
}
// This bounded recognizer protects the runner's transaction. SQLite parses complete SQL.
export function validateMigrationSql(sql: string): void {
  const input = tokens(sql);
  let i = 0;
  const is = (value: string) => input[i]?.word && input[i].value === value;
  const take = (value: string) => {
    if (!is(value)) reject();
    i++;
  };
  const name = () => {
    if (
      !input[i]?.identifier ||
      (input[i].word && forbidden.has(input[i].value))
    )
      reject();
    i++;
    if (input[i]?.value === ".") {
      i++;
      if (
        !input[i]?.identifier ||
        (input[i].word && forbidden.has(input[i].value))
      )
        reject();
      i++;
    }
  };
  while (i < input.length) {
    if (input[i].value === ";") {
      i++;
      continue;
    }
    let header = i;
    if (input[header]?.value === "CREATE" && input[header].word) {
      header++;
      if (["TEMP", "TEMPORARY"].includes(input[header]?.value)) header++;
    }
    if (
      header > i &&
      input[header]?.word &&
      input[header].value === "TRIGGER"
    ) {
      i = header + 1;
      if (is("IF")) {
        take("IF");
        take("NOT");
        take("EXISTS");
      }
      name();
      if (is("BEFORE") || is("AFTER")) i++;
      else if (is("INSTEAD")) {
        take("INSTEAD");
        take("OF");
      }
      if (is("UPDATE")) {
        i++;
        if (is("OF")) {
          i++;
          name();
          while (input[i]?.value === ",") {
            i++;
            name();
          }
        }
      } else if (is("INSERT") || is("DELETE")) i++;
      else reject();
      take("ON");
      name();
      if (is("FOR")) {
        take("FOR");
        take("EACH");
        take("ROW");
      }
      if (is("WHEN")) {
        i++;
        const start = i;
        let cases = 0;
        while (i < input.length && !is("BEGIN")) {
          const token = input[i++];
          if (token.value === ";") reject();
          if (token.word && token.value === "CASE") cases++;
          else if (token.word && token.value === "END" && cases > 0) cases--;
          else if (token.word && forbidden.has(token.value)) reject();
        }
        if (i === start || cases) reject();
      }
      take("BEGIN");
      let statements = 0;
      while (!is("END")) {
        if (
          !input[i]?.word ||
          !["SELECT", "INSERT", "UPDATE", "DELETE"].includes(input[i].value)
        )
          reject();
        let cases = 0;
        while (i < input.length && input[i].value !== ";") {
          const token = input[i++];
          if (token.word && token.value === "CASE") cases++;
          else if (token.word && token.value === "END" && cases > 0) cases--;
          else if (token.word && forbidden.has(token.value)) reject();
        }
        if (cases || input[i]?.value !== ";") reject();
        i++;
        statements++;
      }
      if (!statements) reject();
      take("END");
      if (input[i]?.value !== ";") reject();
      i++;
    } else {
      while (i < input.length && input[i].value !== ";") {
        const token = input[i++];
        if (
          token.word &&
          (forbidden.has(token.value) || token.value === "TRIGGER")
        )
          reject();
      }
      if (input[i]?.value !== ";") reject();
      i++;
    }
  }
}
