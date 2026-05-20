import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockContext } from "@lifetimesoft/agent-sdk/testing"
import agent, { type VideoTimelapseInput } from "./index"
import {
    generateBeforeImageInChrome,
    generateVideoInChrome,
    uploadVideoToTikTokStudioInChrome,
} from "./chrome-flow-api"

vi.mock("./chrome-flow-api", () => ({
    generateBeforeImageInChrome: vi.fn(),
    generateVideoInChrome: vi.fn(),
    uploadVideoToTikTokStudioInChrome: vi.fn(),
}))

const mockGenerateBeforeImage = vi.mocked(generateBeforeImageInChrome)
const mockGenerateVideo = vi.mocked(generateVideoInChrome)
const mockUploadVideo = vi.mocked(uploadVideoToTikTokStudioInChrome)

const validInput: VideoTimelapseInput = {
    image_url: "https://example.com/after.png",
    product_id: "product-123",
    product: "Modern sofa",
    description: "Minimal living room setup",
    category: "furniture",
}

describe("video-timelapse-2tiktok-agent", () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mockGenerateBeforeImage.mockResolvedValue("https://example.com/before.png")
        mockGenerateVideo.mockResolvedValue("https://example.com/timelapse.mp4")
        mockUploadVideo.mockResolvedValue(undefined)
    })

    it("has __isAgent flag", () => {
        expect(agent.__isAgent).toBe(true)
    })

    it("returns failed output when required input is missing", async () => {
        const ctx = createMockContext()
        const result = await agent.run(ctx)

        expect(result).toMatchObject({
            video_url: "",
            status: "failed",
            tiktok_upload_status: "skipped",
        })
        expect(mockGenerateBeforeImage).not.toHaveBeenCalled()
        expect(mockGenerateVideo).not.toHaveBeenCalled()
        expect(mockUploadVideo).not.toHaveBeenCalled()
    })

    it("generates a before image, creates a video, and uploads it to TikTok", async () => {
        const ctx = createMockContext({ input: validInput })
        const result = await agent.run(ctx)

        expect(mockGenerateBeforeImage).toHaveBeenCalledWith(
            validInput.image_url,
            expect.stringContaining("เฟอร์นิเจอร์"),
            expect.any(Function),
        )
        expect(mockGenerateVideo).toHaveBeenCalledWith(
            "https://example.com/before.png",
            validInput.image_url,
            expect.stringContaining("timelapse"),
            expect.any(Function),
        )
        expect(mockUploadVideo).toHaveBeenCalledWith(
            "https://example.com/timelapse.mp4",
            expect.stringContaining("#เฟอร์นิเจอร์"),
            expect.any(Function),
            validInput.product_id,
        )
        expect(result).toEqual({
            video_url: "https://example.com/timelapse.mp4",
            status: "completed",
            product_id: validInput.product_id,
            product: validInput.product,
            category: validInput.category,
            before_prompt: expect.stringContaining("เฟอร์นิเจอร์"),
            before_image_url: "https://example.com/before.png",
            after_image_url: validInput.image_url,
            tiktok_upload_status: "completed",
        })
    })

    it("keeps the generated video URL when TikTok upload fails", async () => {
        mockUploadVideo.mockRejectedValue(new Error("upload failed"))

        const ctx = createMockContext({ input: validInput })
        const result = await agent.run(ctx)

        expect(result).toMatchObject({
            video_url: "https://example.com/timelapse.mp4",
            status: "failed",
            before_image_url: "https://example.com/before.png",
            tiktok_upload_status: "failed",
        })
    })
})
