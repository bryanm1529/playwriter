# Browserwright

Control your actual Chrome browser with AI - like Playwright, but for tabs you're already using.

[**Install from Chrome Web Store**](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe)

## What is Browserwright?

Browserwright is a Chrome extension that enables AI assistants to connect to your existing Chrome instance without spawning a new browser or requiring Chrome to be started in CDP mode. This allows AI agents (Claude, Cursor, VS Code) to interact with your actual browser session through the Model Context Protocol.

## Key Features

- **Works with your tabs**: Control tabs you're already using, not a new browser instance
- **No CDP mode required**: No need to restart Chrome with special flags
- **MCP integration**: Exposes browser control through the Model Context Protocol
- **Full Playwright API**: LLMs can use their existing Playwright knowledge
- **Accessibility snapshots**: Token-efficient structured text instead of screenshots

## Quick Start

1. Install the extension in your Chrome browser
2. Press **Ctrl+Shift+P** (Cmd+Shift+P on Mac) to attach the current tab
3. Or click the extension icon, or drag a tab into the "browserwright" tab group
4. The icon turns green when successfully connected
5. Your AI assistant can now control the browser!

## Use Cases

- Browser automation without disrupting your workflow
- AI-assisted web browsing and testing
- Debugging and development with MCP-enabled tools
- Controlling tabs that require your login session

## Permissions

This extension requires:

- **debugger**: To access Chrome DevTools Protocol
- **tabGroups**: To organize connected tabs
- **tabs**: To manage browser tabs
- **all_urls**: To work with any website
- **nativeMessaging**: For seamless communication with AI tools

## Privacy & Security

Browserwright runs locally in your browser and does not send any data to external servers. All browser control happens through the standard Chrome DevTools Protocol on your machine.

## Support

For issues, feature requests, or contributions, visit the [GitHub repository](https://github.com/sicmundus/browserwright).

## License

Apache-2.0
