# AGENTS.md

## Context Rules
- Read only files directly related to the task.
- Do not scan the entire repository.
- Avoid recursive searches unless necessary.
- Ignore build artifacts and generated files.
- Use minimum number of tool calls.
- Do not open large files unless explicitly required.
- Reuse existing context whenever possible.

## Coding Rules
- Use TypeScript strict mode.
- Prefer modifying existing code over creating new files.
- Keep changes minimal and focused.
- Do not add dependencies without approval.

## Output Rules
- Explain briefly.
- Avoid long code dumps.
- Show only modified sections.

## Before Reading Files
1. Identify relevant files.
2. Read only direct dependencies.
3. Stop searching once enough information is found.
