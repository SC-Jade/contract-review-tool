#!/bin/sh
# assemble single-page artifact: shell + config + parser + app
# config.local.js(사내 설정)가 있으면 그걸, 없으면 config.example.js를 써요.
D=$(dirname "$0")
CFG="$D/config.local.js"; [ -f "$CFG" ] || CFG="$D/config.example.js"
{ cat "$D/shell.html"; printf '<script>\n'; cat "$CFG"; sed '/^if(typeof module/d' "$D/parse-core.js"; cat "$D/app.js"; printf '</script>\n'; } > "$D/contract-review.html"
echo "built with $(basename "$CFG")"
