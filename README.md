# video-timelapse-2tiktok-agent

This project is an agent built with `@lifetimesoft/agent-sdk`. It is specifically designed to run within the **Chrome Extension Host** environment.

## 🚀 Features

This agent performs an end-to-end workflow entirely inside the Chrome extension:
1. **Generate Image:** Automatically creates images based on configured prompts or inputs.
2. **Generate Video (Timelapse):** Compiles the generated images into a timelapse video.
3. **Post to TikTok:** Automates the process of uploading and posting the generated timelapse video to TikTok.

## 📦 Runtime Environment

- **Runtime:** `chrome`
- This agent leverages the Chrome Extension runtime capabilities, meaning it has access to browser APIs and runs securely within the extension context.

## 🛠️ Development

### Setup

```bash
npm install
```

### Build

```bash
# Build the agent for the browser environment
npm run build
```

### Test

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch
```

## 📝 License

MIT
