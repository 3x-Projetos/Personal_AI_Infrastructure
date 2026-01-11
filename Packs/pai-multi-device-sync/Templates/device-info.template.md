# Device: {{DEVICE_NAME}}

**Type**: {{DEVICE_TYPE}}
**OS**: {{OPERATING_SYSTEM}}
**Architecture**: {{ARCHITECTURE}}
**First Seen**: {{FIRST_SEEN_DATE}}
**Primary Use**: {{PRIMARY_USE}}

---

## Hardware

**Specs**: {{HARDWARE_SPECS}}
**CPU**: {{CPU_INFO}}
**RAM**: {{RAM_SIZE}}
**Storage**: {{STORAGE_TYPE}} ({{STORAGE_CAPACITY}})
**Network**: {{NETWORK_INFO}}

---

## Software

**Git**: {{GIT_STATUS}} {{GIT_VERSION}}
**Node.js**: {{NODEJS_STATUS}} {{NODEJS_VERSION}}
**Bun**: {{BUN_STATUS}} {{BUN_VERSION}}
**Python**: {{PYTHON_STATUS}} {{PYTHON_VERSION}}
**Claude CLI**: {{CLAUDE_STATUS}} {{CLAUDE_VERSION}}

---

## Providers

**Active**:
{{#each ACTIVE_PROVIDERS}}
- {{this}}
{{/each}}

**Available**:
- Claude CLI (primary)
- LMStudio (local models)
- Gemini (if on work laptop)

---

## Projects

**Primary**:
{{#each PRIMARY_PROJECTS}}
- {{this}}
{{/each}}

**Secondary**:
{{#each SECONDARY_PROJECTS}}
- {{this}}
{{/each}}

---

## Sync Configuration

**Auto-sync**: {{AUTO_SYNC_ENABLED}}
**Conflict resolution**: {{CONFLICT_RESOLUTION_STRATEGY}}
**PII redaction**: {{PII_REDACTION_ENABLED}}

---

## Performance

**Average pull latency**: {{AVG_PULL_LATENCY}}
**Average push latency**: {{AVG_PUSH_LATENCY}}
**Network**: {{NETWORK_TYPE}} ({{NETWORK_SPEED}})

---

## Notes

{{DEVICE_NOTES}}

**Last Updated**: {{LAST_UPDATED_DATE}}
