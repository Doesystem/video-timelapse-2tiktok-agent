# video-timelapse-2tiktok-agent

Chrome-runtime agent that turns a final product image into a vertical timelapse video and prepares it for TikTok Studio upload.

The agent is built with `@lifetimesoft/agent-sdk` and depends on Chrome Extension Host APIs for browser automation.

## What It Does

1. Opens Google Flow in Chrome.
2. Generates a "before" image from the provided final image.
3. Creates a 9:16 timelapse video from the before and after images.
4. Opens TikTok Studio upload.
5. Uploads the generated video, writes the caption, attaches a product link, and enables the AI-generated content setting.

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `image_url` | `string` | Yes | Final or "after" image URL used as the source image. |
| `product_id` | `string` | Yes | Product ID used when searching for a TikTok product link. |
| `product` | `string` | Yes | Product name included in the TikTok caption. |
| `description` | `string` | Yes | Caption description text. |
| `category` | `"home" \| "furniture"` | Yes | Controls the image/video prompts and hashtag set. |

Example:

```json
{
  "image_url": "https://example.com/after.png",
  "product_id": "123456789",
  "product": "Modern sofa",
  "description": "Minimal living room setup",
  "category": "furniture"
}
```

## Output

| Field | Type | Description |
| --- | --- | --- |
| `video_url` | `string` | Generated timelapse video URL. Empty when video generation fails. |
| `status` | `"completed" \| "failed"` | Overall run status. |
| `product_id` | `string` | Product ID from the input. |
| `product` | `string` | Product name from the input. |
| `category` | `string` | Category from the input. |
| `before_prompt` | `string` | Prompt used to generate the before image. |
| `before_image_url` | `string` | Generated before image URL. |
| `after_image_url` | `string` | Original input image URL. |
| `tiktok_upload_status` | `"completed" \| "failed" \| "skipped"` | TikTok upload result. |

Example success response:

```json
{
  "video_url": "https://example.com/timelapse.mp4",
  "status": "completed",
  "product_id": "123456789",
  "product": "Modern sofa",
  "category": "furniture",
  "before_prompt": "...",
  "before_image_url": "https://example.com/before.png",
  "after_image_url": "https://example.com/after.png",
  "tiktok_upload_status": "completed"
}
```

## Runtime Requirements

- Runtime: `chrome`
- Chrome Extension Host with access to `chrome.tabs` and `chrome.scripting`
- A signed-in Google Flow session
- A signed-in TikTok Studio session
- Network access to download the input image and generated video

## Development

Install dependencies:

```bash
npm install
```

Build the browser bundle:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run TypeScript checks:

```bash
npx tsc --noEmit
```

## Notes

- The Chrome automation leaves the tab open when a step fails so the page can be inspected.
- `category` must be either `home` or `furniture`; unsupported categories return a failed output without running Chrome automation.
- If TikTok upload fails after video generation, the response keeps the generated `video_url` and marks `tiktok_upload_status` as `failed`.

## License

MIT
