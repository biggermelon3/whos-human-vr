#!/usr/bin/env bash
# agent-runner.sh — drive ONE game agent with a coding-agent CLI (bash/WSL/macOS).
#
# The game (backend=file) writes  agent-workspace/<Agent>/inbox/turn-NNN.json ;
# this script pipes it to the chosen CLI as plain stdin and writes the reply to
# agent-workspace/<Agent>/outbox/turn-NNN.json . The CLI is a pure stdin->stdout
# transformer, so it needs no file tools and can't hang on an approval prompt.
#
# Usage (one per agent, each in its own terminal):
#   ./tools/agent-runner.sh A-01 claude
#   ./tools/agent-runner.sh A-02 codex
#   ./tools/agent-runner.sh A-03 gemini
set -u

AGENT="${1:?usage: agent-runner.sh <A-0X> [claude|codex|gemini] [workspace] [model]}"
CLI="${2:-claude}"
WORKSPACE="${3:-agent-workspace}"
MODEL="${4:-}"
POLL="${POLL_SECONDS:-0.8}"

# Serialize the heavy model invocation across ALL agent runners, so a small box
# never runs more than one CLI at once. The night and audit phases ask several
# agents concurrently (Promise.all), which would otherwise spawn 4-6 claude
# processes at the same moment. Uses flock when available (Linux); on systems
# without flock (e.g. Windows Git Bash) it is a transparent no-op.
LOCK_FILE="${WIH_AGENT_LOCK:-${TMPDIR:-/tmp}/wih-agent-cli.lock}"
have_flock() { command -v flock >/dev/null 2>&1; }

BASE="$WORKSPACE/$AGENT"
INBOX="$BASE/inbox"
OUTBOX="$BASE/outbox"
mkdir -p "$INBOX" "$OUTBOX"

SYS="You are an AI agent in a social-deduction (werewolf/mafia) game. Respond with ONLY one valid JSON object matching the fields in the request's responseHint — no markdown fences, no prose."
INSTR="Read the decision-request JSON from stdin and reply with ONLY the JSON object described by its responseHint field. Stay in character as your agent profile. No fences, no prose."

extract_json() {
  # strip ```fences``` and keep the first {...} block
  sed -E '1s/^```(json)?[[:space:]]*//; $s/[[:space:]]*```$//' \
    | awk 'BEGIN{d=0;started=0} { for(i=1;i<=length($0);i++){c=substr($0,i,1); if(c=="{"){d++;started=1} if(started)printf "%s",c; if(c=="}"){d--; if(d==0){print ""; exit}}} if(started)print ""}'
}

call_cli() {
  local req="$1"
  case "$CLI" in
    claude)
      local args=(-p "$INSTR" --output-format json --append-system-prompt "$SYS" --permission-mode bypassPermissions)
      [ -n "$MODEL" ] && args+=(--model "$MODEL")
      printf '%s' "$req" | claude "${args[@]}" | jq -r '.result // empty'
      ;;
    codex)
      local args=(exec --skip-git-repo-check -s read-only -a never)
      [ -n "$MODEL" ] && args+=(-m "$MODEL")
      args+=(-)
      printf '%s\n\n%s' "$INSTR" "$req" | codex "${args[@]}"
      ;;
    gemini)
      local args=(-p "$INSTR" --yolo)
      [ -n "$MODEL" ] && args+=(-m "$MODEL")
      printf '%s' "$req" | gemini "${args[@]}"
      ;;
    *) echo "unknown CLI: $CLI" >&2; exit 1 ;;
  esac
}

echo "[$AGENT] runner up (cli=$CLI). Watching $INBOX ..."
while true; do
  for f in "$INBOX"/turn-*.json; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    out="$OUTBOX/$name"
    [ -e "$out" ] && continue
    req="$(cat "$f")"
    echo "[$AGENT] -> $name"
    # Global lock: only one agent's CLI runs at a time across the whole box.
    if have_flock; then
      text="$( ( flock 9; call_cli "$req" 2>/dev/null || true ) 9>"$LOCK_FILE" )"
    else
      text="$(call_cli "$req" 2>/dev/null || true)"
    fi
    json="$(printf '%s' "$text" | extract_json)"
    if ! printf '%s' "$json" | jq empty >/dev/null 2>&1; then
      echo "[$AGENT] non-JSON reply — writing empty default"
      json="{}"
    fi
    printf '%s' "$json" > "$out.tmp" && mv -f "$out.tmp" "$out"
    echo "[$AGENT] <- $name ok"
  done
  sleep "$POLL"
done
