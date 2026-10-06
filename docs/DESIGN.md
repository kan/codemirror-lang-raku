# codemirror-lang-raku 開発指示書（Claude Code 向け）

このリポジトリでは、CodeMirror 6 用の Raku（旧 Perl 6）言語サポートパッケージを開発する。
以下のガイドラインに従って作業すること。迷ったら CodeMirror 公式パッケージ（`@codemirror/lang-*`）の流儀に合わせる。

---

## 1. 命名ルール（最優先で守る）

### npm パッケージ名
- **`codemirror-lang-raku`** を使う（スコープなし）。
  - CodeMirror 公式の言語パッケージ例ページでは、言語サポートは `@codemirror/lang-python` や `codemirror-lang-elixir` のような名前のパッケージとして提供されると説明されている。公式テンプレート（lang-example）の README も、コミュニティ製は `codemirror-lang-EXAMPLE` 形式で公開するよう案内している。
  - `@codemirror/lang-*` スコープは公式専用。使いたい場合は CodeMirror 側に issue を立てて publish 権限を依頼する必要があるので、**勝手に使わない**。
- 作業開始時に `npm view codemirror-lang-raku` で名前が空いているか確認し、埋まっていたら作業を止めてユーザーに報告する（代替案: `@kan/codemirror-lang-raku`）。
- 名前に `perl6` は入れない。言語の正式名は Raku。`perl6` は `keywords` と README の説明で拾えるようにする。

### リポジトリ名
- `kan/codemirror-lang-raku`（npm 名と一致させる）。

### エクスポート名（公式の慣習）
| 名前 | 型 | 説明 |
|---|---|---|
| `raku(config?)` | `() => LanguageSupport` | **メインのエントリ関数**。言語名そのままの関数名にするのが慣習（`@codemirror/lang-css` の `css()` と同じ）。 |
| `rakuLanguage` | `LRLanguage`（または `StreamLanguage`） | 言語本体。 |
| `rakuCompletion` | `Extension` | 補完ソース（任意。入れる場合）。 |
| `parser` | Lezer `LRParser` | Lezer 文法を使う場合のみ export（再利用・テスト用）。 |

- 設定項目が無いうちは `raku()` は引数なしでよい。後から設定を追加する場合はオブジェクト1個を受ける形にする。
- 関数・変数は camelCase。Lezer のノード名は PascalCase（`VariableName`, `StringLiteral` など）。

### Lezer 文法を別パッケージに分ける場合
- 公式は `@lezer/<lang>` + `@codemirror/lang-<lang>` の2分割だが、本プロジェクトは **最初は1パッケージに同梱**する（公式テンプレートと同じ構成）。分割が必要になったらユーザーに相談する。その場合の名前は `lezer-raku` を想定。

---

## 2. 出発点

- 公式テンプレート **codemirror/lang-example** をベースにする（リポジトリは現在 `code.haverbeke.berlin/codemirror/lang-example` にある。GitHub のミラーが古い可能性があるので注意）。
- テンプレート内の `EXAMPLE` / `example` を `git grep` してすべて `raku` / `Raku` に置換する。
- ビルド・テストのスクリプト構成（rollup + `@lezer/generator` の rollup プラグイン、`test/cases.txt` 形式の文法テスト）はテンプレートのものを維持する。
- 依存バージョンは作業時点の最新 6.x を `npm view` で確認して使う。記憶のバージョンを書かない。

### package.json の要件
- `"type": "module"`、ESM + CJS の両方を出力、`types` を同梱。
- `@codemirror/language`, `@codemirror/state`, `@codemirror/view`, `@lezer/highlight`, `@lezer/lr` などは **`^6.x` の緩い範囲**で dependencies に入れる（利用側で重複インスタンスが生じると動かないため、厳しすぎるピン留めはしない）。
- `keywords`: `codemirror`, `codemirror6`, `lezer`, `raku`, `perl6`, `syntax-highlighting`
- `license`: MIT（ユーザーに別指定がなければ）。

---

## 3. パーサ方針

Raku は「エディタ向け増分パーサ」にとって非常に難しい言語なので、**段階的に**進める。

### 推奨: Lezer 文法 + 外部トークナイザ
- 構文木が得られ、インデント・折りたたみ・括弧対応・構文選択が効く。CodeMirror 公式もこの方式を基本としている。
- 文脈自由で書けない部分は TypeScript の `ExternalTokenizer` / `ContextTracker` で処理する（下記の難所）。
- StreamParser（CodeMirror 5 方式のトークナイザ）は実装が楽だが構文木が浅く、型名と変数名の区別などで限界が来る。**フェーズ1のプロトタイプとして使うのは可**だが、最終形は Lezer にする。採用方針を変える場合はユーザーに確認する。

### Raku の難所（外部トークナイザ化を検討する部分）
- 任意デリミタのクォート: `q{}`, `qq[]`, `Q<>`, `q:to/END/` の **heredoc**、`「」` などの Unicode 括弧、デリミタのネスト。
- アダーブ: `qq:w`, `q:c`, `:x` など。
- 文字列内補間: `"$var"`, `"@arr[]"`, `"{ expr }"`, `"$obj.method()"`。
- 正規表現・grammar サブ言語: `/.../`, `rx//`, `m:g//`, `s///`, `tr///`, `regex`/`token`/`rule` 宣言の本体。`/` が除算か正規表現かの判定。
- コメント: `#` 行コメント、`` #`( ... ) `` 埋め込みコメント（任意の括弧）、`#|` / `#=` の宣言子ブロック。
- POD6: `=begin pod` ... `=end pod`, `=head1` など（行頭 `=` 判定）。
- シギルと twigil: `$`, `@`, `%`, `&` × `*`, `!`, `.`, `^`, `:`, `?`, `=`, `~`。
- 識別子にハイフン・アポストロフィを含む（`is-prime`, `don't`）。ただし `$a-1` のような減算との区別に注意。
- Unicode 演算子（`∈`, `≤`, `…`, `»+«` などのハイパー演算子）、メタ演算子（`[+]`, `Z+`, `X~`, `R-`）。
- ユーザー定義演算子（`infix:<+++>`）は完全対応を目指さず、宣言部の名前ハイライト程度でよい。

**方針**: エラー耐性を最優先。どんな入力でも木が壊れてハイライトが全面崩壊しないこと。完全な構文解析は目標にしない。

---

## 4. ハイライト・メタデータ

- `styleTags` で **`@lezer/highlight` の標準タグのみ**を使う（独自 CSS クラスは作らない）。既存テーマがそのまま効くことが重要。
  - 例: `my`/`our`/`has` → `t.definitionKeyword`、`if`/`for`/`given` → `t.controlKeyword`、`sub`/`method`/`class`/`grammar`/`role` → `t.definitionKeyword`、`$x` → `t.variableName`、`$!attr` → `t.propertyName`、`Int`/`Str` 等の型 → `t.typeName`、POD → `t.docComment`、正規表現 → `t.regexp`、補間部分 → `t.special(t.string)` など。
- `indentNodeProp` / `foldNodeProp`: ブロック `{}`、`()`, `[]`、POD ブロック、heredoc を折りたたみ対象にする。
- `languageData`:
  - `commentTokens: { line: "#" }`と `` block: { open: "#`(", close: ")" } ``（ブロックコメントは任意括弧だが、最も使われる丸括弧を採用した。選択範囲の丸括弧が釣り合わないとコメントの範囲がずれる）
  - `closeBrackets: { brackets: ["(", "[", "{", "'", '"', "「"] }`
  - `indentOnInput` 用の正規表現（`}` 入力時の再インデント）。
- 補完（フェーズ 4 で実装）: キーワード、主要な組み込み型・関数・メソッド・特殊変数の固定の一覧。`completeFromList` は語を `\w` で切るため、`IO::Path`、`starts-with`、`$*OUT`、`.` の直後を扱えるよう独自の `CompletionSource`（`src/complete.ts`）にした。

---

## 5. テスト

- `test/*.txt` に Lezer の文法テスト（`@lezer/generator/test` の `fileTests`）を書く。**機能を追加するたびにテストケースを先に書く**。
- 最低限カバーするケース: 各種クォート/heredoc/補間、正規表現と除算の区別、埋め込みコメント、POD、twigil、ハイフン入り識別子、ハイパー演算子、`grammar` 宣言。
- エラー耐性テスト: 閉じていない文字列・括弧・heredoc でもパースが完了し、後続行が正しく復帰すること。
- 実コードでのスモークテスト: Raku のコアモジュールや Rosetta Code の Raku 例など、ライセンス上問題ないものを fixtures にしてパースが例外なく終わることを確認する（出典を明記する）。
- パフォーマンス: 数千行のファイルで増分再パースが体感的に遅くならないこと。

---

## 6. ドキュメント・デモ

- README（英語）に以下を含める:
  - インストール方法と最小の使用例（`EditorView` + `basicSetup` + `raku()`）
  - API リファレンス（エクスポート一覧。公式パッケージの README と同じ書式）
  - `@codemirror/language-data` 風に使う場合の `LanguageDescription.of({ name: "Raku", alias: ["perl6"], extensions: [...], load })` の例
  - 対応拡張子: `.raku`, `.rakumod`, `.rakutest`, `.rakudoc`, および旧拡張子 `.p6`, `.pl6`, `.pm6`, `.pod6`
  - 既知の制限（未対応構文の一覧）
- `demo/` にブラウザで確認できるページを用意する（Vite などで `npm run dev`）。

---

## 7. 作業フェーズ

1. **雛形**: lang-example から作成、名前置換、ビルドとテストが通る状態にする。
2. **基本ハイライト**: コメント、単純な文字列、数値、キーワード、シギル付き変数、ブロック構造。
3. **難所対応**: クォート構文全般・heredoc・補間 → 正規表現 → POD → 演算子類。1つずつテスト付きで。
4. **エディタ機能**: インデント、折りたたみ、括弧、補完。
5. **公開準備**: README、CHANGELOG、`npm pack` で中身確認。**`npm publish` はユーザーの明示的な指示があるまで実行しない。**

各フェーズの終わりに、何ができて何が未対応かを短く報告すること。

---

## 8. 禁止事項・注意

- `@codemirror/*` スコープの名前で公開しない。
- 他エディタの Raku 定義（TextMate 文法、Emacs raku-mode など）を **コピーしない**。参考にするのはよいが、ライセンスを確認し、コードは自前で書く。
- 独自のハイライト CSS クラスやテーマを同梱しない（必要ならデモ側でのみ使う）。
- CodeMirror 本体の内部 API（`_` 始まりや非公開モジュール）に依存しない。
