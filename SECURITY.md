# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

## Security Considerations

This tool interacts with browser automation via Chrome DevTools Protocol (CDP). Users should be aware:

- **CDP Access**: When enabled, CDP provides full control over the browser. Only expose CDP on localhost.
- **Code Execution**: The `execute` tool runs arbitrary JavaScript in a sandboxed VM context.
- **Extension Permissions**: The Chrome extension requires broad permissions to function.

## Best Practices

When using Browserwright:

1. Never expose CDP port (default: 9222) to untrusted networks
2. Don't run untrusted code through the execute tool
3. Review automation scripts before running them
4. Keep dependencies updated

## Dependencies

This project relies on:
- playwright-core: Browser automation
- @modelcontextprotocol/sdk: MCP server framework

Run `pnpm audit` regularly to check for known vulnerabilities.
