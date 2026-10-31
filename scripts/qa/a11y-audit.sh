#!/usr/bin/env bash
# Sprint 13 AC-11: every clickable node on the connected device's screen has a
# name (text or content-desc, its own or a child's when the node merges them).
# Prints the unnamed ones for screen $1.
# A scrim with importantForAccessibility="no" still shows as clickable here;
# TalkBack skips it, so it is not a finding (sprint 13 audit).
# Usage: bash scripts/qa/a11y-audit.sh <screen-name>
export MSYS_NO_PATHCONV=1
P="${TMPDIR:-${TEMP:-/tmp}}"
adb shell uiautomator dump /sdcard/ui.xml >/dev/null; adb exec-out cat /sdcard/ui.xml > "$P/a11y-$1.xml"
node -e '
const x=require("fs").readFileSync(process.argv[1],"utf8");
// Walk the tree; a clickable node is named if it or any descendant has text/content-desc.
const re=/<node ([^>]*?)(\/?)>|<\/node>/g; const stack=[]; const out=[]; let m, total=0;
while((m=re.exec(x))){
  if(m[0]==="</node>"){ const n=stack.pop(); if(n.click){ total++; if(!n.named) out.push(n);} if(stack.length&&n.named) stack[stack.length-1].named=true; continue; }
  const a=m[1]; const g=k=>(a.match(new RegExp(k+"=\"([^\"]*)\""))||[])[1]||"";
  if(g("package")!=="com.travelapp.companion") { if(m[2]==="/") continue; stack.push({click:false,named:false}); continue; }
  const n={click:g("clickable")==="true", named:!!(g("text").trim()||g("content-desc").trim()), id:g("resource-id"), b:g("bounds"), cls:g("class")};
  if(m[2]==="/"){ total+=n.click?1:0; if(n.click&&!n.named) out.push(n); if(stack.length&&n.named) stack[stack.length-1].named=true; } else stack.push(n);
}
console.log(process.argv[2]+": "+total+" clickable, "+out.length+" unnamed"); for(const n of out) console.log("  - "+(n.id||n.cls)+" "+n.b);
' "$P/a11y-$1.xml" "$1"
