#!/usr/bin/env bash
# Materialize tool-specific views of the canonical repo-local .agents directory.

AGENT_SYMLINKS_DEBUG=${AGENT_SYMLINKS_DEBUG:-false}

_agent_debug() {
  [[ "$AGENT_SYMLINKS_DEBUG" == "true" ]] && echo "[agent-symlinks] $*" || true
}

setup_agent_symlinks() {
  local current_dir="$PWD"
  local root_dir="${EFFECT_RESONATE_ROOT_DIR:-$PWD}"
  local root_agents_dir="$root_dir/.agents"
  local local_agents_dir=""
  local agents_dir="$root_agents_dir"
  local agent_link_errors=0

  [[ -d "$current_dir/.agents" ]] && local_agents_dir="$current_dir/.agents"

  # A package may add a local .agents overlay. Local entries replace root entries
  # with the same basename; instruction files are concatenated root-first.
  if [[ -n "$local_agents_dir" && -d "$root_agents_dir" && "$local_agents_dir" != "$root_agents_dir" ]]; then
    local combined_dir="$local_agents_dir/.combined"
    local dir src
    mkdir -p "$combined_dir"

    for dir in commands skills hooks agents; do
      if [[ -d "$root_agents_dir/$dir" || -d "$local_agents_dir/$dir" ]]; then
        rm -rf "$combined_dir/$dir"
        mkdir -p "$combined_dir/$dir"
        for src in "$root_agents_dir/$dir"/*; do
          [[ -e "$src" ]] && ln -sfn "$src" "$combined_dir/$dir/$(basename "$src")"
        done
        for src in "$local_agents_dir/$dir"/*; do
          [[ -e "$src" ]] && ln -sfn "$src" "$combined_dir/$dir/$(basename "$src")"
        done
      fi
    done

    if [[ -f "$root_agents_dir/AGENTS.md" && -f "$local_agents_dir/AGENTS.md" ]]; then
      cat "$root_agents_dir/AGENTS.md" > "$combined_dir/AGENTS.md"
      printf '\n\n' >> "$combined_dir/AGENTS.md"
      cat "$local_agents_dir/AGENTS.md" >> "$combined_dir/AGENTS.md"
    elif [[ -f "$local_agents_dir/AGENTS.md" ]]; then
      ln -sfn "$local_agents_dir/AGENTS.md" "$combined_dir/AGENTS.md"
    elif [[ -f "$root_agents_dir/AGENTS.md" ]]; then
      ln -sfn "$root_agents_dir/AGENTS.md" "$combined_dir/AGENTS.md"
    fi
    agents_dir="$combined_dir"
  elif [[ -n "$local_agents_dir" ]]; then
    agents_dir="$local_agents_dir"
  fi

  if [[ ! -d "$agents_dir" ]]; then
    _agent_debug "No .agents directory found; skipping"
    return 0
  fi

  relative_agents_path() {
    node -e 'console.log(require("node:path").relative(process.argv[1], process.argv[2]))' \
      "$current_dir/$1" "$agents_dir"
  }

  link_agent_dir() {
    local tool_dir="$1" source_name="$2" destination_name="$3"
    local relative_path
    [[ -d "$agents_dir/$source_name" ]] || return 0
    if ! mkdir -p "$tool_dir"; then
      agent_link_errors=$((agent_link_errors + 1))
      return 0
    fi
    if ! relative_path=$(relative_agents_path "$tool_dir") || [[ -z "$relative_path" ]]; then
      echo "[agent-symlinks] could not calculate path for $tool_dir/$destination_name" >&2
      agent_link_errors=$((agent_link_errors + 1))
      return 0
    fi
    if [[ -e "$tool_dir/$destination_name" && ! -L "$tool_dir/$destination_name" ]]; then
      echo "[agent-symlinks] refusing to replace $tool_dir/$destination_name; move it and rerun setup" >&2
      agent_link_errors=$((agent_link_errors + 1))
      return 0
    fi
    ln -sfn "$relative_path/$source_name" "$tool_dir/$destination_name"
  }

  for dir in commands skills hooks agents; do
    link_agent_dir .claude "$dir" "$dir"
  done
  link_agent_dir .cursor commands commands
  link_agent_dir .cursor skills skills
  link_agent_dir .codex commands prompts
  link_agent_dir .codex skills skills
  link_agent_dir .gemini commands commands
  link_agent_dir .gemini skills skills

  if [[ -f "$agents_dir/AGENTS.md" ]]; then
    local context_path context_file
    if ! context_path=$(relative_agents_path .) || [[ -z "$context_path" ]]; then
      echo "[agent-symlinks] could not calculate path for agent instructions" >&2
      return 1
    fi
    for context_file in AGENTS.md CLAUDE.md GEMINI.md; do
      if [[ -e "$context_file" && ! -L "$context_file" ]]; then
        echo "[agent-symlinks] refusing to replace $context_file; move it and rerun setup" >&2
        agent_link_errors=$((agent_link_errors + 1))
      else
        ln -sfn "$context_path/AGENTS.md" "$context_file"
      fi
    done
  fi

  if (( agent_link_errors > 0 )); then
    return 1
  fi

  _agent_debug "Agent configuration ready"
}

setup_agent_symlinks
